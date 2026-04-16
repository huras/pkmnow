import { clearScatterSolidBlockCache } from '../scatter-pass2-debug.js';
import { BIOME_VEGETATION, getTreeType, TREE_TILES, tileSurfaceAllowsScatterVegetation } from '../biome-tiles.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape, seededHash } from '../tessellation-logic.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import { PLAY_CHUNK_SIZE } from '../render/render-constants.js';
import { enqueuePlayChunkBake } from '../render/play-chunk-cache.js';
import { didFormalTreeSpawnAtRoot, getFormalTreeTrunkCircle, scatterPhysicsCircleAtOrigin } from '../walkability.js';
import { scatterItemKeyIsSolid, scatterItemKeyIsTree, validScatterOriginMicro } from '../scatter-pass2-debug.js';
import {
  setScatterItemKeyOverride,
  clearScatterItemKeyOverrides,
  SCATTER_ITEM_KEY_OVERRIDE_EMPTY
} from './scatter-item-override.js';
import { FORMAL_TRUNK_BASE_WIDTH_TILES, TRUNK_STRIP_WIDTH_FRAC } from '../scatter-collider-config.js';
import { playItemPickupSfx } from '../audio/item-pickup-sfx.js';
import { playTreeTackleSfx } from '../audio/tree-tackle-sfx.js';
import { playTreeCutHpZeroSfx } from '../audio/tree-cut-sfx.js';
import { playTreeCutHitSfx } from '../audio/tree-cut-hit-sfx.js';
import { playCrystalClinkSfx } from '../audio/crystal-clink-sfx.js';
import { playRockSmashingSfx } from '../audio/rock-smashing-sfx.js';

/** Scatter micro-origins `(ox,oy)` whose crystal base was broken by tackle (persist for this play session). */
const destroyedCrystalScatterOrigins = new Set();
/** Formal tree roots `(rootX,my)` cut in current play session. */
const destroyedFormalTreeRoots = new Set();
/** @type {Map<string, number>} key `rootX,my` -> regenAtSec */
const destroyedFormalTreeRegenAtSecByRoot = new Map();
/** @type {Map<string, 'cut' | 'burned'>} */
const destroyedFormalTreeCauseByRoot = new Map();
/** @type {Map<string, number>} key `rootX,my` -> burn meter points */
const formalTreeBurnMeterByRoot = new Map();
/** @type {Map<string, number>} key `rootX,my` -> burning visuals end (sec) before charred stump appears */
const burningFormalTreeEndsAtSecByRoot = new Map();
/** Burned stump already tackled and converted into charcoal pickup. */
const harvestedBurnedFormalTreeRoots = new Set();
/** @type {Map<string, number>} key `ox,oy` -> burn meter points */
const scatterTreeBurnMeterByOrigin = new Map();
/** @type {Map<string, number>} key `ox,oy` -> burning visuals end (sec) before charred stump appears */
const burningScatterTreeEndsAtSecByOrigin = new Map();
/** Scatter tree roots burned to charcoal stumps (still present until regen or harvested). */
const burnedScatterTreeOrigins = new Set();
/** Burned scatter stump already tackled and converted into charcoal pickup. */
const harvestedBurnedScatterTreeOrigins = new Set();
/** @type {Map<string, {
 *   ox: number,
 *   oy: number,
 *   itemKey: string,
 *   cols: number,
 *   rows: number,
 *   hitsMax: number,
 *   hitsRemaining: number,
 *   destroyed: boolean,
 *   regenAtSec: number,
 *   lastHitAtSec: number
 * }>} */
const detailBreakStateByOrigin = new Map();
let detailBreakSweepIter = null;
let detailBreakSweepCooldownSec = 0;
const DETAIL_REGEN_AFTER_BREAK_SEC = 80;
const FORMAL_TREE_REGEN_AFTER_BREAK_SEC = 80;
const FORMAL_TREE_BURN_METER_MAX = 100;
const FORMAL_TREE_BURN_METER_DECAY_PER_SEC = 4.5;
const FORMAL_TREE_BURN_GROUND_Z_MAX = 0.55;
const FORMAL_TREE_BURN_IMPACT_RADIUS_TILES = 0.3;
const FORMAL_TREE_BURNING_VISUAL_SEC = 5;
const FORMAL_TREE_BURN_ADD_BY_PROJECTILE = Object.freeze({
  ember: 34,
  flamethrowerShot: 16,
  incinerateShard: 28,
  incinerateCore: 54
});
const DETAIL_PARTIAL_DAMAGE_FORGET_SEC = 22;
/** Strength-relocated rock: drop override + detail state after no hits / grabs (frees override map memory). */
const DETAIL_SWEEP_STEP = 96;
const DETAIL_SWEEP_INTERVAL_SEC = 0.5;
const DETAIL_HIT_BAR_ANIM_SEC = 0.16;
const DETAIL_HIT_BAR_LINGER_SEC = 1.05;
const DETAIL_HIT_SHAKE_SEC = 0.18;

/** Short canopy/top “fall + fade” after trees are cut (wall-clock seconds, cheap drawImage only). */
const TREE_TOP_FALL_SEC = 0.58;
const MAX_TREE_TOP_FALLS = 56;

/**
 * @type {Array<
 *   | { kind: 'formal'; rootX: number; my: number; treeType: string; startWallSec: number }
 *   | { kind: 'scatterCanopy'; ox: number; oy: number; itemKey: string; cols: number; rows: number; startWallSec: number }
 *   | { kind: 'scatterFade'; ox: number; oy: number; itemKey: string; cols: number; rows: number; startWallSec: number }
 * >}
 */
const activeTreeTopFalls = [];

function easeOutQuadTreeFall(u) {
  const x = Math.max(0, Math.min(1, u));
  return 1 - (1 - x) * (1 - x);
}

function pruneTreeTopFalls(wallSec) {
  for (let i = activeTreeTopFalls.length - 1; i >= 0; i--) {
    const e = activeTreeTopFalls[i];
    if (wallSec - e.startWallSec > TREE_TOP_FALL_SEC + 0.08) activeTreeTopFalls.splice(i, 1);
  }
}

function isCrystalBreakItemKey(itemKey) {
  return String(itemKey || '').toLowerCase().includes('crystal');
}

/** Fall + fade for tree canopy, or ground fade for other vegetation (grass, tree-without-top, etc.). Crystals skipped (shard FX). */
function pushVegetationDissolveFromSt(st, startWallSec) {
  if (!st?.itemKey) return;
  if (isCrystalBreakItemKey(st.itemKey)) return;
  if (activeTreeTopFalls.length >= MAX_TREE_TOP_FALLS) activeTreeTopFalls.shift();
  if (scatterItemKeyIsTree(st.itemKey)) {
    const objSet = OBJECT_SETS[st.itemKey];
    const topPart = objSet?.parts?.find((p) => p.role === 'top' || p.role === 'tops');
    if (topPart?.ids?.length) {
      activeTreeTopFalls.push({
        kind: 'scatterCanopy',
        ox: st.ox,
        oy: st.oy,
        itemKey: st.itemKey,
        cols: st.cols,
        rows: st.rows,
        startWallSec
      });
      return;
    }
  }
  activeTreeTopFalls.push({
    kind: 'scatterFade',
    ox: st.ox,
    oy: st.oy,
    itemKey: st.itemKey,
    cols: st.cols,
    rows: st.rows,
    startWallSec
  });
}

function pushFormalTreeTopFall(rootX, my, treeType, startWallSec) {
  const ids = TREE_TILES[treeType];
  if (!ids?.top?.length) return;
  if (activeTreeTopFalls.length >= MAX_TREE_TOP_FALLS) activeTreeTopFalls.shift();
  activeTreeTopFalls.push({ kind: 'formal', rootX, my, treeType, startWallSec });
}

/** Enqueues sorted `renderItems` for canopy fall + fade (trees) or in-place fade (ground vegetation). */
export function appendTreeTopFallRenderItems(renderItems, wallNowSec, tileW, tileH) {
  void tileW;
  void tileH;
  pruneTreeTopFalls(wallNowSec);
  for (const e of activeTreeTopFalls) {
    const u = Math.max(0, Math.min(1, (wallNowSec - e.startWallSec) / TREE_TOP_FALL_SEC));
    if (u >= 1) continue;
    const dropYTiles = e.kind === 'scatterFade' ? 0 : easeOutQuadTreeFall(u) * 0.9;
    const alpha = Math.max(0, Math.min(1, 1 - Math.pow(Math.max(0, u - 0.08) / 0.92, 1.22)));
    if (alpha < 0.02) continue;
    if (e.kind === 'formal') {
      renderItems.push({
        type: 'formalTreeCanopyFall',
        originX: e.rootX,
        originY: e.my,
        treeType: e.treeType,
        dropYTiles,
        alpha,
        sortY: e.my + 1 + dropYTiles * 0.36
      });
    } else if (e.kind === 'scatterCanopy') {
      renderItems.push({
        type: 'scatterTreeCanopyFall',
        originX: e.ox,
        originY: e.oy,
        itemKey: e.itemKey,
        cols: e.cols,
        rows: e.rows,
        dropYTiles,
        alpha,
        sortY: e.oy + e.rows - 0.1 + dropYTiles * 0.36
      });
    } else {
      renderItems.push({
        type: 'scatterVegetationFadeOut',
        originX: e.ox,
        originY: e.oy,
        itemKey: e.itemKey,
        cols: e.cols,
        rows: e.rows,
        dropYTiles: 0,
        alpha,
        sortY: e.oy + e.rows - 0.1
      });
    }
  }
}

/** @typedef {{ x: number, y: number, vx: number, vy: number, tileId: number, cols: number, imgPath: string | null, age: number, maxAge: number }} CrystalShard */

/** @type {CrystalShard[]} */
export const activeCrystalShards = [];
/** Hit probe is slightly inside the peak lunge to avoid edge jitter exactly on tile borders. */
const TACKLE_HIT_PROBE_BACKOFF_TILES = 0.05;
/** Player tackle uses a capsule-like sweep (segment + this radius), not per-tile checks. */
const TACKLE_SWEEP_RADIUS_TILES = 0.32;
/** Tackle hurtbox scale over each detail's physical collider radius. */
const TACKLE_DETAIL_HURTBOX_RADIUS_MULT = 2;
/** Sampling only drives candidate origin lookup window; collision is exact segment-vs-circle. */
const TACKLE_ORIGIN_SCAN_STEP_TILES = 0.2;
/** Ground pickup radius for dropped crystal items (tiles). */
const CRYSTAL_DROP_PICK_RADIUS_TILES = 1.35;
const CRYSTAL_DROP_SUCTION_SPEED_TILES = 11.5;
const CRYSTAL_DROP_SUCTION_ACCEL = 26;
const CRYSTAL_DROP_SUCTION_FINISH_RADIUS = 0.18;
/** Spawned "small crystal" chunks that remain on ground after a large crystal breaks. */
export const activeSpawnedSmallCrystals = [];
/** Pickable drops created after breaking a small crystal chunk. */
export const activeCrystalDrops = [];
let crystalLootCount = 0;
let crystalDynIdSeq = 1;
/** @type {Map<string, number>} */
const collectedDetailInventory = new Map();
/** @type {Map<string, {
 *   x: number,
 *   y: number,
 *   hpMax: number,
 *   hpFrom: number,
 *   hpTo: number,
 *   animStartSec: number,
 *   animDurSec: number,
 *   hideAtSec: number
 * }>} */
const detailHitHpBars = new Map();
/** @type {Map<string, number>} */
const detailHitShakeAtSec = new Map();
/** @type {Array<{ x: number, y: number, age: number, maxAge: number }>} */
const activeDetailHitPulses = [];
/** Origins whose destroyed scatter regen is paused while Strength is carrying that lift. */
const strengthCarriedBlockRegenKeys = new Set();

export function isPlayCrystalScatterOriginDestroyed(ox, oy) {
  const st = detailBreakStateByOrigin.get(`${ox},${oy}`);
  return !!st?.destroyed;
}

export function isPlayDetailScatterOriginDestroyed(ox, oy) {
  return isPlayCrystalScatterOriginDestroyed(ox, oy);
}

export function isPlayFormalTreeRootDestroyed(rootX, my) {
  return destroyedFormalTreeRoots.has(`${rootX},${my}`);
}

export function isPlayFormalTreeRootCharred(rootX, my) {
  const key = `${rootX},${my}`;
  return destroyedFormalTreeCauseByRoot.get(key) === 'burned' && !harvestedBurnedFormalTreeRoots.has(key);
}

export function isPlayFormalTreeRootBurning(rootX, my) {
  return burningFormalTreeEndsAtSecByRoot.has(`${rootX},${my}`);
}

export function isPlayFormalTreeRootBurnedHarvested(rootX, my) {
  return harvestedBurnedFormalTreeRoots.has(`${rootX},${my}`);
}

export function isPlayScatterTreeOriginBurning(ox, oy) {
  return burningScatterTreeEndsAtSecByOrigin.has(`${ox},${oy}`);
}

export function isPlayScatterTreeOriginCharred(ox, oy) {
  const key = `${ox},${oy}`;
  return burnedScatterTreeOrigins.has(key) && !harvestedBurnedScatterTreeOrigins.has(key);
}

export function isPlayScatterTreeOriginBurnedHarvested(ox, oy) {
  return harvestedBurnedScatterTreeOrigins.has(`${ox},${oy}`);
}

/** True if this origin can be Strength-lifted as a non-destroyed rock/crystal (including damaged HP). */
export function isScatterDetailLiftableRockAt(ox, oy, itemKey) {
  const key = `${ox},${oy}`;
  const st = detailBreakStateByOrigin.get(key);
  if (st && st.destroyed) return false;
  if (st && st.itemKey && String(st.itemKey) !== String(itemKey)) return false;
  return true;
}

export function clearPlayCrystalTackleState() {
  strengthCarriedBlockRegenKeys.clear();
  clearScatterItemKeyOverrides();
  destroyedCrystalScatterOrigins.clear();
  destroyedFormalTreeRoots.clear();
  destroyedFormalTreeRegenAtSecByRoot.clear();
  destroyedFormalTreeCauseByRoot.clear();
  formalTreeBurnMeterByRoot.clear();
  burningFormalTreeEndsAtSecByRoot.clear();
  harvestedBurnedFormalTreeRoots.clear();
  scatterTreeBurnMeterByOrigin.clear();
  burningScatterTreeEndsAtSecByOrigin.clear();
  burnedScatterTreeOrigins.clear();
  harvestedBurnedScatterTreeOrigins.clear();
  detailBreakStateByOrigin.clear();
  detailBreakSweepIter = null;
  detailBreakSweepCooldownSec = 0;
  detailHitHpBars.clear();
  detailHitShakeAtSec.clear();
  activeDetailHitPulses.length = 0;
  activeCrystalShards.length = 0;
  activeSpawnedSmallCrystals.length = 0;
  activeCrystalDrops.length = 0;
  collectedDetailInventory.clear();
  crystalLootCount = 0;
  crystalDynIdSeq = 1;
  activeTreeTopFalls.length = 0;
}

function isCrystalItemKey(itemKey) {
  return String(itemKey || '').toLowerCase().includes('crystal');
}

function registerDestroyedCrystalOrigin(rootOx, rootOy) {
  destroyedCrystalScatterOrigins.add(`${rootOx},${rootOy}`);
  clearScatterSolidBlockCache();
}

function registerDestroyedFormalTreeRoot(rootX, my, nowSec, cause = 'cut', data = null) {
  const key = `${rootX},${my}`;
  burningFormalTreeEndsAtSecByRoot.delete(key);
  destroyedFormalTreeRoots.add(key);
  destroyedFormalTreeRegenAtSecByRoot.set(key, nowSec + FORMAL_TREE_REGEN_AFTER_BREAK_SEC);
  destroyedFormalTreeCauseByRoot.set(key, cause === 'burned' ? 'burned' : 'cut');
  formalTreeBurnMeterByRoot.delete(key);
  if (cause !== 'burned' && data) {
    const t = getMicroTile(rootX, my, data);
    const treeType = t ? getTreeType(t.biomeId, rootX, my, data.seed) : null;
    if (treeType) pushFormalTreeTopFall(rootX, my, treeType, nowSec);
  }
  enqueuePlayChunkBake(Math.floor(rootX / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
  enqueuePlayChunkBake(Math.floor((rootX + 1) / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
}

function formalTreeStumpCircleAtRoot(rootX, my) {
  const r = (FORMAL_TRUNK_BASE_WIDTH_TILES * TRUNK_STRIP_WIDTH_FRAC) / 2;
  const cx = rootX + FORMAL_TRUNK_BASE_WIDTH_TILES / 2;
  const cy = my + 0.5;
  return { cx, cy, r };
}

function scatterTreeSpecAtOrigin(ox, oy, data, getTileFn = null, originMemo = null) {
  if (!data) return null;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  if (ox < 0 || oy < 0 || ox >= microW || oy >= microH) return null;
  const p = scatterPhysicsCircleAtOrigin(ox, oy, data, originMemo, getTileFn, { ignoreDestroyed: true });
  if (!p || !scatterItemKeyIsTree(p.itemKey)) return null;
  const objSet = OBJECT_SETS[p.itemKey];
  if (!objSet) return null;
  const shape = parseShape(objSet.shape);
  const cols = Math.max(1, shape.cols);
  const rows = Math.max(1, shape.rows);
  return { ox, oy, itemKey: p.itemKey, cols, rows, cx: p.cx, cy: p.cy, r: p.radius };
}

function queueChunkRebakeOverlappingFootprint(rootOx, rootOy, cols, rows) {
  const keys = new Set();
  for (let dy = 0; dy < rows; dy++) {
    for (let dx = 0; dx < cols; dx++) {
      const mx = rootOx + dx;
      const my = rootOy + dy;
      keys.add(`${Math.floor(mx / PLAY_CHUNK_SIZE)},${Math.floor(my / PLAY_CHUNK_SIZE)}`);
    }
  }
  for (const key of keys) {
    const [sx, sy] = key.split(',');
    const cx = Number(sx);
    const cy = Number(sy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    enqueuePlayChunkBake(cx, cy, true);
  }
}

function markScatterTreeBurnedAndScheduleRegen(ox, oy, nowSec, data) {
  const key = `${ox},${oy}`;
  const spec = scatterTreeSpecAtOrigin(ox, oy, data);
  if (!spec) return false;
  let st = detailBreakStateByOrigin.get(key);
  if (!st) {
    st = {
      ox,
      oy,
      itemKey: spec.itemKey,
      cols: spec.cols,
      rows: spec.rows,
      hitsMax: 1,
      hitsRemaining: 0,
      destroyed: false,
      regenAtSec: 0,
      lastHitAtSec: nowSec
    };
    detailBreakStateByOrigin.set(key, st);
    detailBreakSweepIter = null;
  } else {
    st.itemKey = spec.itemKey;
    st.cols = spec.cols;
    st.rows = spec.rows;
    st.hitsRemaining = 0;
    st.lastHitAtSec = nowSec;
  }
  markDestroyedDetailAndScheduleRegen(st, nowSec, { skipTreeTopFall: true });
  burnedScatterTreeOrigins.add(key);
  harvestedBurnedScatterTreeOrigins.delete(key);
  scatterTreeBurnMeterByOrigin.delete(key);
  burningScatterTreeEndsAtSecByOrigin.delete(key);
  return true;
}

function addFormalTreeBurnMeterAndMaybeDestroy(rootX, my, projType, nowSec, data) {
  const key = `${rootX},${my}`;
  if (isPlayFormalTreeRootDestroyed(rootX, my)) return false;
  if (burningFormalTreeEndsAtSecByRoot.has(key)) return false;
  const add = FORMAL_TREE_BURN_ADD_BY_PROJECTILE[projType];
  if (!Number.isFinite(add) || add <= 0) return false;
  const cur = formalTreeBurnMeterByRoot.get(key) || 0;
  const next = Math.max(0, Math.min(FORMAL_TREE_BURN_METER_MAX, cur + add));
  
  const trunk = getFormalTreeTrunkCircle(rootX, my, data); // get trunk cx,cy
  if (trunk) {
    const hpMax = FORMAL_TREE_BURN_METER_MAX;
    const hpBefore = hpMax - cur;
    const hpAfter = hpMax - next;
    markDetailHitHpBar(`formal:${rootX},${my}`, trunk.cx, trunk.cy, hpMax, hpBefore, hpAfter, nowSec);
  }

  if (next >= FORMAL_TREE_BURN_METER_MAX) {
    formalTreeBurnMeterByRoot.delete(key);
    burningFormalTreeEndsAtSecByRoot.set(key, nowSec + FORMAL_TREE_BURNING_VISUAL_SEC);
    return true;
  }
  formalTreeBurnMeterByRoot.set(key, next);
  return false;
}

function addScatterTreeBurnMeterAndMaybeDestroy(ox, oy, projType, nowSec, data) {
  const key = `${ox},${oy}`;
  if (isPlayDetailScatterOriginDestroyed(ox, oy)) return false;
  if (burningScatterTreeEndsAtSecByOrigin.has(key)) return false;
  const spec = scatterTreeSpecAtOrigin(ox, oy, data);
  if (!spec) return false;
  const add = FORMAL_TREE_BURN_ADD_BY_PROJECTILE[projType];
  if (!Number.isFinite(add) || add <= 0) return false;
  const cur = scatterTreeBurnMeterByOrigin.get(key) || 0;
  const next = Math.max(0, Math.min(FORMAL_TREE_BURN_METER_MAX, cur + add));

  const hpMax = FORMAL_TREE_BURN_METER_MAX;
  const hpBefore = hpMax - cur;
  const hpAfter = hpMax - next;
  markDetailHitHpBar(key, spec.cx, spec.cy, hpMax, hpBefore, hpAfter, nowSec);

  if (next >= FORMAL_TREE_BURN_METER_MAX) {
    scatterTreeBurnMeterByOrigin.delete(key);
    burningScatterTreeEndsAtSecByOrigin.set(key, nowSec + FORMAL_TREE_BURNING_VISUAL_SEC);
    burnedScatterTreeOrigins.delete(key);
    harvestedBurnedScatterTreeOrigins.delete(key);
    return true;
  }
  scatterTreeBurnMeterByOrigin.set(key, next);
  return false;
}

/**
 * Accumulates fire damage into a formal-tree burn meter.
 * When full, tree becomes charred stump until normal regeneration timer restores it.
 */
export function tryApplyFireHitToFormalTreesAt(worldX, worldY, projZ, projType, data) {
  if (!data) return false;
  if (!Object.prototype.hasOwnProperty.call(FORMAL_TREE_BURN_ADD_BY_PROJECTILE, projType)) return false;
  if (Math.abs(Number(projZ) || 0) > FORMAL_TREE_BURN_GROUND_Z_MAX) return false;
  const ix = Math.floor(worldX);
  const iy = Math.floor(worldY);
  const nowSec = performance.now() * 0.001;
  let anyApplied = false;
  for (let my = iy - 1; my <= iy + 1; my++) {
    for (let rootX = ix - 1; rootX <= ix; rootX++) {
      if (!didFormalTreeSpawnAtRoot(rootX, my, data)) continue;
      const trunk = getFormalTreeTrunkCircle(rootX, my, data);
      if (!trunk) continue;
      const rr = trunk.r + FORMAL_TREE_BURN_IMPACT_RADIUS_TILES;
      const dx = worldX - trunk.cx;
      const dy = worldY - trunk.cy;
      if (dx * dx + dy * dy > rr * rr) continue;
      addFormalTreeBurnMeterAndMaybeDestroy(rootX, my, projType, nowSec, data);
      anyApplied = true;
    }
  }
  const scatterOriginMemo = new Map();
  for (let oy = iy - 2; oy <= iy + 1; oy++) {
    for (let ox = ix - 2; ox <= ix + 2; ox++) {
      const spec = scatterTreeSpecAtOrigin(ox, oy, data, null, scatterOriginMemo);
      if (!spec) continue;
      const rr = spec.r + FORMAL_TREE_BURN_IMPACT_RADIUS_TILES;
      const dx = worldX - spec.cx;
      const dy = worldY - spec.cy;
      if (dx * dx + dy * dy > rr * rr) continue;
      addScatterTreeBurnMeterAndMaybeDestroy(ox, oy, projType, nowSec, data);
      anyApplied = true;
    }
  }
  return anyApplied;
}

function tryHarvestCharredFormalTreeAtRoot(rootX, my) {
  const key = `${rootX},${my}`;
  if (!isPlayFormalTreeRootDestroyed(rootX, my)) return false;
  if (destroyedFormalTreeCauseByRoot.get(key) !== 'burned') return false;
  if (harvestedBurnedFormalTreeRoots.has(key)) return false;
  const stump = formalTreeStumpCircleAtRoot(rootX, my);
  spawnPickableCrystalDropAt(stump.cx, stump.cy, 'charcoal', 1);
  harvestedBurnedFormalTreeRoots.add(key);
  enqueuePlayChunkBake(Math.floor(rootX / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
  enqueuePlayChunkBake(Math.floor((rootX + 1) / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
  return true;
}

function tryHarvestCharredScatterTreeAtOrigin(ox, oy, data) {
  const key = `${ox},${oy}`;
  if (!burnedScatterTreeOrigins.has(key) || harvestedBurnedScatterTreeOrigins.has(key)) return false;
  const spec = scatterTreeSpecAtOrigin(ox, oy, data);
  if (!spec) return false;
  spawnPickableCrystalDropAt(spec.cx, spec.cy, 'charcoal', 1);
  harvestedBurnedScatterTreeOrigins.add(key);
  queueChunkRebakeOverlappingFootprint(spec.ox, spec.oy, spec.cols, spec.rows);
  return true;
}

function unregisterDestroyedDetailOrigin(rootOx, rootOy) {
  destroyedCrystalScatterOrigins.delete(`${rootOx},${rootOy}`);
  clearScatterSolidBlockCache();
}

function getDetailHpBarDisplayedHp(bar, nowSec) {
  if (!bar) return 0;
  const animT = Math.max(0, Math.min(1, (nowSec - bar.animStartSec) / Math.max(0.001, bar.animDurSec)));
  return bar.hpFrom + (bar.hpTo - bar.hpFrom) * animT;
}

function markDetailHitHpBar(key, x, y, hpMax, hpBefore, hpAfter, nowSec) {
  if (!key || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const maxHp = Math.max(1, hpMax | 0);
  const fromHpRaw = Math.max(0, Math.min(maxHp, hpBefore));
  const toHp = Math.max(0, Math.min(maxHp, hpAfter));
  const prev = detailHitHpBars.get(key);
  const fromHp = prev ? getDetailHpBarDisplayedHp(prev, nowSec) : fromHpRaw;
  detailHitHpBars.set(key, {
    x,
    y,
    hpMax: maxHp,
    hpFrom: Math.max(0, Math.min(maxHp, fromHp)),
    hpTo: toHp,
    animStartSec: nowSec,
    animDurSec: DETAIL_HIT_BAR_ANIM_SEC,
    hideAtSec: nowSec + DETAIL_HIT_BAR_LINGER_SEC
  });
}

function markDetailHitShake(key, nowSec) {
  if (!key) return;
  detailHitShakeAtSec.set(key, nowSec);
}

function spawnDetailHitPulse(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  activeDetailHitPulses.push({ x, y, age: 0, maxAge: 0.18 });
  if (activeDetailHitPulses.length > 64) {
    activeDetailHitPulses.splice(0, activeDetailHitPulses.length - 64);
  }
}

export function getActiveDetailHitHpBars() {
  const nowSec = performance.now() * 0.001;
  const out = [];
  for (const [key, bar] of detailHitHpBars.entries()) {
    if (!bar || nowSec > bar.hideAtSec) {
      detailHitHpBars.delete(key);
      continue;
    }
    out.push({
      x: bar.x,
      y: bar.y,
      hpMax: bar.hpMax,
      hpNow: getDetailHpBarDisplayedHp(bar, nowSec)
    });
  }
  return out;
}

export function getDetailHitShake01(key) {
  if (!key) return 0;
  const nowSec = performance.now() * 0.001;
  const hitAt = detailHitShakeAtSec.get(key);
  if (hitAt == null) return 0;
  const t = nowSec - hitAt;
  if (t >= DETAIL_HIT_SHAKE_SEC) {
    detailHitShakeAtSec.delete(key);
    return 0;
  }
  return Math.max(0, 1 - t / DETAIL_HIT_SHAKE_SEC);
}

export function getActiveDetailHitPulses() {
  return activeDetailHitPulses;
}

function countSpritesInObjectSet(objSet) {
  if (!objSet?.parts?.length) return 1;
  let n = 0;
  for (const part of objSet.parts) n += Array.isArray(part.ids) ? part.ids.length : 0;
  return Math.max(1, n);
}

function hitsForDetailBySpriteCount(objSet) {
  const spriteCount = countSpritesInObjectSet(objSet);
  return Math.max(1, Math.ceil(Math.sqrt(spriteCount)) * 2);
}

function hitsForFormalTree(treeType) {
  const ids = TREE_TILES[treeType];
  const count = (ids?.base?.length || 0) + (ids?.top?.length || 0);
  const spriteCount = Math.max(1, count);
  return Math.max(1, Math.ceil(Math.sqrt(spriteCount)) * 2);
}

/** Same HP curve as formal trees: base + top sprite count only (not whole object set). */
function hitsForScatterTreeItemKey(itemKey) {
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet?.parts?.length) return hitsForDetailBySpriteCount(objSet);
  const basePart = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  const topPart = objSet.parts.find((p) => p.role === 'top' || p.role === 'tops');
  const nBase = Array.isArray(basePart?.ids) ? basePart.ids.length : 0;
  const nTop = Array.isArray(topPart?.ids) ? topPart.ids.length : 0;
  const count = Math.max(1, nBase + nTop);
  return Math.max(1, Math.ceil(Math.sqrt(count)) * 2);
}

function getOrCreateDetailBreakState(rootOx, rootOy, itemKey, objSet, nowSec, initialHitsMax = null) {
  const key = `${rootOx},${rootOy}`;
  let st = detailBreakStateByOrigin.get(key);
  if (!st) {
    const { cols, rows } = parseShape(objSet?.shape || '[1x2]'); // Formal trees are 1x2 or 2x3 usually, but 1x2 is a safe default for hit state
    const hitsMax =
      initialHitsMax != null
        ? initialHitsMax
        : scatterItemKeyIsTree(itemKey)
          ? hitsForScatterTreeItemKey(itemKey)
          : hitsForDetailBySpriteCount(objSet);
    st = {
      ox: rootOx,
      oy: rootOy,
      itemKey,
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      hitsMax,
      hitsRemaining: hitsMax,
      destroyed: false,
      regenAtSec: 0,
      lastHitAtSec: nowSec
    };
    detailBreakStateByOrigin.set(key, st);
    detailBreakSweepIter = null;
  } else {
    st.itemKey = itemKey || st.itemKey;
    st.lastHitAtSec = nowSec;
  }
  return st;
}

function invalidateChunksOverlappingFootprint(rootOx, rootOy, cols, rows) {
  const keys = new Set();
  for (let dy = 0; dy < rows; dy++) {
    for (let dx = 0; dx < cols; dx++) {
      const mx = rootOx + dx;
      const my = rootOy + dy;
      keys.add(`${Math.floor(mx / PLAY_CHUNK_SIZE)},${Math.floor(my / PLAY_CHUNK_SIZE)}`);
    }
  }
  for (const k of keys) {
    const [sx, sy] = k.split(',');
    const cx = Number(sx);
    const cy = Number(sy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    // Keep stale chunk visible until fresh bake completes (prevents black gaps).
    enqueuePlayChunkBake(cx, cy, true);
  }
}

function pauseStrengthCarriedScatterRegen(ox, oy) {
  strengthCarriedBlockRegenKeys.add(`${ox},${oy}`);
}

function strengthRockItemKeyAllowed(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  if (scatterItemKeyIsTree(itemKey)) return false;
  if (isCrystalItemKey(itemKey)) return true;
  return /boulder|rock|stone|geode|stalag|stalagmite|gravel|ore/i.test(k);
}

/**
 * Strength: lift an intact solid rock/crystal scatter at this micro origin (hides map prop until placed / dropped).
 * @returns {{ hitsRemaining: number, hitsMax: number } | null}
 */
export function tryStrengthLiftSolidScatterAt(ox, oy, data, nowSec) {
  if (!data) return null;
  if (isPlayScatterTreeOriginCharred(ox, oy) || isPlayScatterTreeOriginBurning(ox, oy)) return null;
  const key = `${ox},${oy}`;
  const p = scatterPhysicsCircleAtOrigin(ox, oy, data);
  if (!p || scatterItemKeyIsTree(String(p.itemKey))) return null;
  const itemKey = String(p.itemKey);
  if (!strengthRockItemKeyAllowed(itemKey)) return null;
  if (!isScatterDetailLiftableRockAt(ox, oy, itemKey)) return null;
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return null;
  setScatterItemKeyOverride(ox, oy, null);
  const st = getOrCreateDetailBreakState(ox, oy, itemKey, objSet, nowSec);
  if (st.destroyed) return null;
  const hitsMax = Math.max(1, Math.floor(Number(st.hitsMax) || 1));
  const hitsRemaining = Math.max(1, Math.min(hitsMax, Math.floor(Number(st.hitsRemaining) || hitsMax)));
  pauseStrengthCarriedScatterRegen(ox, oy);
  detailHitHpBars.delete(key);
  detailHitShakeAtSec.delete(key);
  markDestroyedDetailAndScheduleRegen(st, nowSec, { skipTreeTopFall: true });
  return { hitsRemaining, hitsMax };
}

/**
 * Strength: after a carry, place the prop at a new micro origin (restores walkability + visuals via override).
 * @returns {boolean}
 */
export function strengthRelocateCarriedDetail(
  liftOx,
  liftOy,
  nox,
  noy,
  itemKey,
  cols,
  rows,
  data,
  nowSec,
  carriedHitsRemaining = null,
  carriedHitsMax = null
) {
  if (!data) return false;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const tileMemo = new Map();
  const getTileCached = (x, y) => {
    if (x < 0 || y < 0 || x >= microW || y >= microH) return null;
    const k = `${x},${y}`;
    if (tileMemo.has(k)) return tileMemo.get(k);
    const t = getMicroTile(x, y, data);
    tileMemo.set(k, t || null);
    return t || null;
  };
  const nTile = getTileCached(nox, noy);
  if (!nTile || !tileSurfaceAllowsScatterVegetation(nTile)) return false;
  const nk = `${nox},${noy}`;
  const exSt = detailBreakStateByOrigin.get(nk);
  if (exSt && !exSt.destroyed) return false;
  const oldKey = `${liftOx},${liftOy}`;
  strengthCarriedBlockRegenKeys.delete(oldKey);
  detailBreakStateByOrigin.delete(oldKey);
  detailHitHpBars.delete(oldKey);
  detailHitShakeAtSec.delete(oldKey);
  unregisterDestroyedDetailOrigin(liftOx, liftOy);
  setScatterItemKeyOverride(liftOx, liftOy, SCATTER_ITEM_KEY_OVERRIDE_EMPTY);
  invalidateChunksOverlappingFootprint(liftOx, liftOy, cols, rows);
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return false;
  detailBreakStateByOrigin.delete(nk);
  const st = getOrCreateDetailBreakState(nox, noy, itemKey, objSet, nowSec);
  const nextHitsMax = Number.isFinite(Number(carriedHitsMax))
    ? Math.max(1, Math.floor(Number(carriedHitsMax)))
    : Math.max(1, Math.floor(Number(st.hitsMax) || 1));
  st.hitsMax = nextHitsMax;
  const nextHitsRemaining = Number.isFinite(Number(carriedHitsRemaining))
    ? Math.max(1, Math.min(nextHitsMax, Math.floor(Number(carriedHitsRemaining))))
    : nextHitsMax;
  st.hitsRemaining = nextHitsRemaining;
  st.destroyed = false;
  st.regenAtSec = 0;
  st.lastHitAtSec = nowSec;
  destroyedCrystalScatterOrigins.delete(nk);
  setScatterItemKeyOverride(nox, noy, itemKey);
  st.strengthReloPlaced = true;
  invalidateChunksOverlappingFootprint(nox, noy, st.cols, st.rows);
  clearScatterSolidBlockCache();
  return true;
}

/**
 * Strength: re-embed carried scatter at the closest valid micro-origin to `(landX, landY)`,
 * then at the lift cell if needed — always world scatter (override + detail state), never a pickup.
 * @param {number} chebRadius — Chebyshev radius from `floor(landX),floor(landY)` to search.
 * @returns {boolean}
 */
export function strengthRelocateCarriedDetailNear(
  liftOx,
  liftOy,
  landX,
  landY,
  itemKey,
  cols,
  rows,
  data,
  nowSec,
  chebRadius = 10,
  carriedHitsRemaining = null,
  carriedHitsMax = null
) {
  if (!data) return false;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const cx = Math.max(0.5, Math.min(microW - 0.5, landX));
  const cy = Math.max(0.5, Math.min(microH - 0.5, landY));
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  const R = Math.max(0, Math.floor(chebRadius));
  /** @type {{ ox: number, oy: number, d2: number }[]} */
  const cand = [];
  for (let oy = iy - R; oy <= iy + R; oy++) {
    for (let ox = ix - R; ox <= ix + R; ox++) {
      if (ox < 0 || oy < 0 || ox >= microW || oy >= microH) continue;
      const ddx = ox + 0.5 - cx;
      const ddy = oy + 0.5 - cy;
      cand.push({ ox, oy, d2: ddx * ddx + ddy * ddy });
    }
  }
  cand.sort((a, b) => a.d2 - b.d2);
  for (const c of cand) {
    if (
      strengthRelocateCarriedDetail(
        liftOx,
        liftOy,
        c.ox,
        c.oy,
        itemKey,
        cols,
        rows,
        data,
        nowSec,
        carriedHitsRemaining,
        carriedHitsMax
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Strength: cancel carry — clear lift hole and spawn a pickup drop (no world re-embed).
 */
export function strengthDropCarriedAsPickup(liftOx, liftOy, cols, rows, itemKey, dropX, dropY) {
  const oldKey = `${liftOx},${liftOy}`;
  strengthCarriedBlockRegenKeys.delete(oldKey);
  detailBreakStateByOrigin.delete(oldKey);
  detailHitHpBars.delete(oldKey);
  detailHitShakeAtSec.delete(oldKey);
  unregisterDestroyedDetailOrigin(liftOx, liftOy);
  invalidateChunksOverlappingFootprint(liftOx, liftOy, cols, rows);
  setScatterItemKeyOverride(liftOx, liftOy, SCATTER_ITEM_KEY_OVERRIDE_EMPTY);
  spawnPickableCrystalDropAt(dropX, dropY, itemKey, null);
  clearScatterSolidBlockCache();
}

function segmentCircleFirstHitT(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (a <= 1e-8) return c <= 0 ? 0 : null;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sd = Math.sqrt(disc);
  const t0 = (-b - sd) / (2 * a);
  const t1 = (-b + sd) / (2 * a);
  if (t0 >= 0 && t0 <= 1) return t0;
  if (t1 >= 0 && t1 <= 1) return t1;
  return null;
}

function crystalColorTokenFromKey(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  const tokens = ['light-blue', 'blue', 'yellow', 'red', 'green', 'purple', 'pink'];
  for (const t of tokens) {
    if (k.includes(`${t}-crystal`) || k.includes(`${t} crystal`) || k.includes(t)) return t;
  }
  return 'blue';
}

function smallCrystalKeyForColor(colorToken) {
  const key = `small-${colorToken}-crystal [1x1]`;
  return OBJECT_SETS[key] ? key : 'small-blue-crystal [1x1]';
}

function crystalVisualFromItemKey(itemKey) {
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return null;
  const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return null;
  const path = TessellationEngine.getImagePath(objSet.file);
  const cols = path && path.includes('caves') ? 50 : 57;
  return {
    itemKey,
    tileId: base.ids[0],
    cols,
    imgPath: path || null
  };
}

function crystalDropVisualFromItemKey(itemKey) {
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return null;
  const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return null;
  const shape = parseShape(objSet.shape);
  const shapeCols = Math.max(1, shape.cols);
  const shapeRows = Math.max(1, shape.rows);
  const shapeCells = shapeCols * shapeRows;
  const allPartIds = [];
  let shapeMatchedPartIds = null;
  if (Array.isArray(objSet.parts)) {
    for (const part of objSet.parts) {
      if (!Array.isArray(part?.ids) || part.ids.length === 0) continue;
      if (!shapeMatchedPartIds && part.ids.length === shapeCells) {
        shapeMatchedPartIds = [...part.ids];
      }
      for (const id of part.ids) allPartIds.push(id);
    }
  }
  const crystalOnly = isCrystalItemKey(itemKey);
  const dropTileIds = crystalOnly
    ? (shapeMatchedPartIds ||
      (allPartIds.length === shapeCells ? allPartIds : [...base.ids]))
    : (allPartIds.length ? allPartIds : [...base.ids]);
  const dropShapeRows = crystalOnly
    ? shapeRows
    : Math.max(shapeRows, Math.ceil(dropTileIds.length / shapeCols));
  const path = TessellationEngine.getImagePath(objSet.file);
  const cols = path && path.includes('caves') ? 50 : 57;
  return {
    itemKey,
    tileId: dropTileIds[0] ?? base.ids[0],
    tileIds: dropTileIds,
    shapeCols,
    shapeRows: dropShapeRows,
    cols,
    imgPath: path || null
  };
}

function spawnSmallCrystalChunksFromLarge(rootOx, rootOy, itemKey) {
  const color = crystalColorTokenFromKey(itemKey);
  const smallKey = smallCrystalKeyForColor(color);
  const visual = crystalVisualFromItemKey(smallKey);
  const largeObj = OBJECT_SETS[itemKey];
  const shape = largeObj ? parseShape(largeObj.shape) : { rows: 2, cols: 2 };
  if (!visual) return;
  const cx = rootOx + shape.cols * 0.5;
  const cy = rootOy + shape.rows * 0.5;
  const offs = [
    [-0.38, -0.28],
    [0.38, -0.25],
    [-0.35, 0.3],
    [0.36, 0.33]
  ];
  for (const [ox, oy] of offs) {
    activeSpawnedSmallCrystals.push({
      id: crystalDynIdSeq++,
      x: cx + ox,
      y: cy + oy,
      radius: 0.3,
      ...visual
    });
  }
}

export function spawnPickableCrystalDropAt(x, y, itemKey, stackCount = null) {
  const resolvedItemKey = String(itemKey || 'unknown');
  const visual =
    crystalDropVisualFromItemKey(resolvedItemKey) ||
    crystalDropVisualFromItemKey('small-blue-crystal [1x1]') ||
    crystalVisualFromItemKey('small-blue-crystal [1x1]');
  if (!visual) return;
  const objSet = OBJECT_SETS[resolvedItemKey];
  const resolvedStackCount =
    stackCount == null
      ? countSpritesInObjectSet(objSet)
      : Math.max(1, Number(stackCount) || 1);
  activeCrystalDrops.push({
    id: crystalDynIdSeq++,
    x,
    y,
    vx: 0,
    vy: 0,
    pickRadius: CRYSTAL_DROP_PICK_RADIUS_TILES,
    stackCount: resolvedStackCount,
    age: 0,
    bobSeed: seededHash(Math.floor(x * 10), Math.floor(y * 10), 13291),
    maxAge: 90,
    collecting: false,
    collectShrink: 0,
    ...visual,
    itemKey: resolvedItemKey
  });
}

function markDestroyedDetailAndScheduleRegen(st, nowSec, opts = {}) {
  if (!st || st.destroyed) return;
  setScatterItemKeyOverride(st.ox, st.oy, null);
  if (!opts.skipTreeTopFall) pushVegetationDissolveFromSt(st, nowSec);
  st.destroyed = true;
  st.regenAtSec = nowSec + DETAIL_REGEN_AFTER_BREAK_SEC;
  registerDestroyedCrystalOrigin(st.ox, st.oy);
  invalidateChunksOverlappingFootprint(st.ox, st.oy, st.cols, st.rows);
}

function sweepDetailBreakState(data, nowSec) {
  if (!data || detailBreakStateByOrigin.size === 0) return;
  if (detailBreakSweepCooldownSec > nowSec) return;
  detailBreakSweepCooldownSec = nowSec + DETAIL_SWEEP_INTERVAL_SEC;
  if (!detailBreakSweepIter) detailBreakSweepIter = detailBreakStateByOrigin.entries();

  let processed = 0;
  while (processed < DETAIL_SWEEP_STEP) {
    const it = detailBreakSweepIter.next();
    if (it.done) {
      detailBreakSweepIter = null;
      break;
    }
    processed += 1;
    const [key, st] = it.value;
    if (!st) {
      detailBreakStateByOrigin.delete(key);
      continue;
    }
    if (st.destroyed) {
      if (strengthCarriedBlockRegenKeys.has(key)) {
        continue;
      }
      if (nowSec >= st.regenAtSec) {
        setScatterItemKeyOverride(st.ox, st.oy, null);
        unregisterDestroyedDetailOrigin(st.ox, st.oy);
        invalidateChunksOverlappingFootprint(st.ox, st.oy, st.cols, st.rows);
        detailBreakStateByOrigin.delete(key);
        burnedScatterTreeOrigins.delete(key);
        harvestedBurnedScatterTreeOrigins.delete(key);
        burningScatterTreeEndsAtSecByOrigin.delete(key);
        scatterTreeBurnMeterByOrigin.delete(key);
        detailHitHpBars.delete(key);
        detailHitShakeAtSec.delete(key);
      }
      continue;
    }
    if (st.strengthReloPlaced) continue;
    if (nowSec - st.lastHitAtSec >= DETAIL_PARTIAL_DAMAGE_FORGET_SEC) {
      setScatterItemKeyOverride(st.ox, st.oy, null);
      detailBreakStateByOrigin.delete(key);
      detailHitHpBars.delete(key);
      detailHitShakeAtSec.delete(key);
    }
  }
}

function spawnCrystalShards(rootOx, rootOy, itemKey, data) {
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return;
  const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return;
  const { rows, cols } = parseShape(objSet.shape);
  const path = TessellationEngine.getImagePath(objSet.file);
  const imgPath = path || null;
  const atlasCols = path && path.includes('caves') ? 50 : 57;
  const tid = base.ids[0];
  const cx = rootOx + cols * 0.5;
  const cy = rootOy + rows * 0.5;
  const seed = data.seed ?? 0;
  for (let i = 0; i < 4; i++) {
    const h1 = seededHash(rootOx + i * 3, rootOy, seed + 91011);
    const h2 = seededHash(rootOx, rootOy + i * 5, seed + 91019);
    const ang = i * (Math.PI * 0.5) + (h1 - 0.5) * 0.55;
    const sp = 1.35 + h2 * 1.85;
    activeCrystalShards.push({
      x: cx + (h1 - 0.5) * 0.08,
      y: cy + (h2 - 0.5) * 0.08,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 0.55,
      tileId: tid,
      cols: atlasCols,
      imgPath,
      age: 0,
      maxAge: 1.15 + h2 * 0.45
    });
  }
}

/**
 * If the tackled cell holds a crystal scatter, remove it and spawn shard particles.
 * @param {import('../player.js').player} player
 * @param {object | null | undefined} data
 */
export function tryBreakCrystalOnPlayerTackle(player, data) {
  if (!player || !data) return;
  let nx = Number(player.tackleDirNx);
  let ny = Number(player.tackleDirNy);
  let len = Math.hypot(nx, ny);
  if (!Number.isFinite(len) || len < 1e-4) {
    nx = 0;
    ny = 1;
    len = 1;
  }
  nx /= len;
  ny /= len;
  const px = player.x ?? 0;
  const py = player.y ?? 0;
  const reach = Math.max(0.2, Number(player._tackleReachTiles) || 2);
  const probeReach = Math.max(0.2, reach - TACKLE_HIT_PROBE_BACKOFF_TILES);
  const ex = px + nx * probeReach;
  const ey = py + ny * probeReach;
  tryBreakDetailsAlongSegment(px, py, ex, ey, data, { hitSource: 'tackle' });
}

function tryApplyTreeTackleEffects(cx, cy, biomeId, seed, data) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !data) return;
  const salt = Math.floor((seed ?? 0) + biomeId * 131 + cx * 17 + cy * 23);
  const branch = seededHash(Math.floor(cx * 10), Math.floor(cy * 10), salt + 77111);
  if (branch < 0.07) {
    const pool = getEncounters(biomeId);
    if (pool?.length) {
      const pick = pool[Math.floor(seededHash(Math.floor(cx), Math.floor(cy), salt + 77133) * pool.length)];
      const dex = encounterNameToDex(pick);
      if (dex != null) {
        void import('../wild-pokemon/wild-pokemon-manager.js').then((m) => {
          if (m?.summonDebugWildPokemon) m.summonDebugWildPokemon(dex, data, cx, cy);
        });
      }
    }
    return;
  }
  if (branch < 0.2) {
    const items = BIOME_VEGETATION[biomeId] || [];
    if (!items.length) return;
    const itemKey = items[Math.floor(seededHash(Math.floor(cx), Math.floor(cy), salt + 77177) * items.length)];
    if (!itemKey || scatterItemKeyIsSolid(itemKey) || scatterItemKeyIsTree(itemKey)) return;
    const objSet = OBJECT_SETS[itemKey];
    if (!objSet) return;
    spawnPickableCrystalDropAt(cx, cy, itemKey, countSpritesInObjectSet(objSet));
  }
}

/**
 * Applies tackle-trait detail breaking along a segment (capsule sweep against detail hurtboxes).
 * Useful for other moves (e.g. psybeam) that should behave like tackle on map details.
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {object | null | undefined} data
 * @param {{
 *   worldHitOnceSet?: Set<string>,
 *   spawnedHitOnceSet?: Set<number>,
 *   hitSource?: 'tackle' | 'cut' | 'other'
 * }} [opts]
 */
export function tryBreakDetailsAlongSegment(ax, ay, bx, by, data, opts = {}) {
  if (!data) return;
  const nowSec = performance.now() * 0.001;
  const hitSource = opts.hitSource === 'cut' ? 'cut' : opts.hitSource === 'other' ? 'other' : 'tackle';
  /** Charcoal pickup from burned stumps: cut or tackle (living trees stay cut-only). */
  const allowChargedStumpHarvest = hitSource === 'cut' || hitSource === 'tackle';
  const worldHitOnceSet = opts.worldHitOnceSet instanceof Set ? opts.worldHitOnceSet : null;
  const spawnedHitOnceSet = opts.spawnedHitOnceSet instanceof Set ? opts.spawnedHitOnceSet : null;
  const px = Number(ax);
  const py = Number(ay);
  const ex = Number(bx);
  const ey = Number(by);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(ex) || !Number.isFinite(ey)) return;
  const segLen = Math.hypot(ex - px, ey - py);
  if (!Number.isFinite(segLen) || segLen <= 1e-6) return;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  /** @type {Array<any>} */
  const hits = [];
  const steps = Math.max(2, Math.ceil(segLen / TACKLE_ORIGIN_SCAN_STEP_TILES));
  const sampledOriginKeys = new Set();
  const originMemo = new Map();
  const tileMemo = new Map();
  const microWm = data.width * MACRO_TILE_STRIDE;
  const microHm = data.height * MACRO_TILE_STRIDE;
  const seed = data.seed ?? 0;
  const getTileCached = (x, y) => {
    if (x < 0 || y < 0 || x >= microWm || y >= microHm) return null;
    const key = `${x},${y}`;
    if (tileMemo.has(key)) return tileMemo.get(key);
    const t = getMicroTile(x, y, data);
    tileMemo.set(key, t || null);
    return t || null;
  };
  for (const sc of activeSpawnedSmallCrystals) {
    if (spawnedHitOnceSet?.has(sc.id)) continue;
    const detailR = Math.max(0.01, (sc.radius || 0.3) * TACKLE_DETAIL_HURTBOX_RADIUS_MULT);
    const ht = segmentCircleFirstHitT(px, py, ex, ey, sc.x, sc.y, detailR + TACKLE_SWEEP_RADIUS_TILES);
    if (ht == null) continue;
    hits.push({ type: 'spawnedSmall', id: sc.id, itemKey: sc.itemKey, x: sc.x, y: sc.y, t: ht });
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = px + (ex - px) * t;
    const sy = py + (ey - py) * t;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    for (let oy = Math.max(0, iy - 5); oy <= Math.min(microH - 1, iy + 2); oy++) {
      for (let ox = Math.max(0, ix - 8); ox <= Math.min(microW - 1, ix + 2); ox++) {
        const key = `${ox},${oy}`;
        if (sampledOriginKeys.has(key)) continue;
        sampledOriginKeys.add(key);
        if (worldHitOnceSet?.has(key)) continue;
        if (isPlayScatterTreeOriginCharred(ox, oy)) {
          const spec = scatterTreeSpecAtOrigin(ox, oy, data, getTileCached, originMemo);
          if (spec) {
            const detailR = Math.max(0.01, spec.r * TACKLE_DETAIL_HURTBOX_RADIUS_MULT);
            const rr = detailR + TACKLE_SWEEP_RADIUS_TILES;
            const ht = segmentCircleFirstHitT(px, py, ex, ey, spec.cx, spec.cy, rr);
            if (ht != null) {
              hits.push({
                type: 'charredScatterTree',
                rootOx: ox,
                rootOy: oy,
                cx: spec.cx,
                cy: spec.cy,
                t: ht
              });
            }
          }
        }
        const p = scatterPhysicsCircleAtOrigin(ox, oy, data, originMemo);
        if (isPlayDetailScatterOriginDestroyed(ox, oy)) continue;
        if (p) {
          const detailR = Math.max(0.01, p.radius * TACKLE_DETAIL_HURTBOX_RADIUS_MULT);
          const rr = detailR + TACKLE_SWEEP_RADIUS_TILES;
          const ht = segmentCircleFirstHitT(px, py, ex, ey, p.cx, p.cy, rr);
          if (ht == null) continue;
          hits.push({
            type: 'worldDetail',
            rootOx: ox,
            rootOy: oy,
            itemKey: String(p.itemKey),
            cx: p.cx,
            cy: p.cy,
            t: ht
          });
          continue;
        }
        const charred = isPlayFormalTreeRootCharred(ox, oy);
        if (charred || (!isPlayFormalTreeRootDestroyed(ox, oy) && didFormalTreeSpawnAtRoot(ox, oy, data))) {
          const trunk = getFormalTreeTrunkCircle(ox, oy, data);
          const stump = trunk || (charred ? formalTreeStumpCircleAtRoot(ox, oy) : null);
          const target = trunk || stump;
          if (target) {
            const detailR = Math.max(0.01, target.r * TACKLE_DETAIL_HURTBOX_RADIUS_MULT);
            const rr = detailR + TACKLE_SWEEP_RADIUS_TILES;
            const ht = segmentCircleFirstHitT(px, py, ex, ey, target.cx, target.cy, rr);
            if (ht != null) {
              hits.push({
                type: 'formalTree',
                rootOx: ox,
                rootOy: oy,
                cx: target.cx,
                cy: target.cy,
                t: ht
              });
            }
          }
        }

        // Non-blockable scatter (flowers, shells, etc.) has no walkability collider:
        // still allow tackle to break/pick by testing a compact footprint-center circle.
        const oTile = getTileCached(ox, oy);
        if (!oTile) continue;
        if (
          !validScatterOriginMicro(ox, oy, seed, microWm, microHm, getTileCached, originMemo)
        ) {
          continue;
        }
        const items = BIOME_VEGETATION[oTile.biomeId] || [];
        if (!items.length) continue;
        const itemKey = items[Math.floor(seededHash(ox, oy, seed + 222) * items.length)];
        if (scatterItemKeyIsSolid(itemKey)) continue;
        const objSet = OBJECT_SETS[itemKey];
        if (!objSet) continue;
        const shape = parseShape(objSet.shape);
        const cx0 = ox + shape.cols * 0.5;
        const cy0 = oy + shape.rows * 0.5;
        const detailRBase = Math.max(0.26, Math.max(shape.cols, shape.rows) * 0.33);
        const detailR = detailRBase * TACKLE_DETAIL_HURTBOX_RADIUS_MULT;
        const rr = detailR + TACKLE_SWEEP_RADIUS_TILES;
        const ht = segmentCircleFirstHitT(px, py, ex, ey, cx0, cy0, rr);
        if (ht == null) continue;
        hits.push({
          type: 'worldDetail',
          rootOx: ox,
          rootOy: oy,
          itemKey: String(itemKey),
          cx: cx0,
          cy: cy0,
          t: ht
        });
      }
    }
  }
  if (hits.length === 0) return;
  hits.sort((a, b) => a.t - b.t);
  const consumedSpawned = new Set();
  const consumedWorld = new Set();

  for (const hit of hits) {
    if (hit.type === 'spawnedSmall') {
      if (consumedSpawned.has(hit.id)) continue;
      consumedSpawned.add(hit.id);
      const idx = activeSpawnedSmallCrystals.findIndex((c) => c.id === hit.id);
      if (idx < 0) continue;
      const c = activeSpawnedSmallCrystals[idx];
      const dynKey = `dyn:${c.id}`;
      markDetailHitHpBar(dynKey, c.x, c.y, 1, 1, 0, nowSec);
      markDetailHitShake(dynKey, nowSec);
      spawnDetailHitPulse(c.x, c.y);
      playRockSmashingSfx({ x: c.x, y: c.y });
      activeSpawnedSmallCrystals.splice(idx, 1);
      if (spawnedHitOnceSet) spawnedHitOnceSet.add(c.id);
      const cSet = OBJECT_SETS[c.itemKey];
      playCrystalClinkSfx({ x: c.x, y: c.y });
      spawnPickableCrystalDropAt(c.x, c.y, c.itemKey, countSpritesInObjectSet(cSet));
      spawnCrystalShards(Math.floor(c.x), Math.floor(c.y), c.itemKey, data);
      continue;
    }

    const worldKey =
      hit.type === 'formalTree'
        ? `formal:${hit.rootOx},${hit.rootOy}`
        : hit.type === 'charredScatterTree'
          ? `charredScatter:${hit.rootOx},${hit.rootOy}`
          : `${hit.rootOx},${hit.rootOy}`;
    if (consumedWorld.has(worldKey)) continue;
    consumedWorld.add(worldKey);
    if (worldHitOnceSet?.has(worldKey)) continue;
    if (hit.type === 'formalTree') {
      const bumpKey = `treeBump:${hit.rootOx},${hit.rootOy}`;
      if (isPlayFormalTreeRootDestroyed(hit.rootOx, hit.rootOy)) {
        if (allowChargedStumpHarvest) {
          if (hitSource === 'cut') {
            playTreeCutHitSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
          }
          if (hitSource === 'tackle') {
            playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
          }
          tryHarvestCharredFormalTreeAtRoot(hit.rootOx, hit.rootOy);
        } else {
          if (hitSource === 'tackle') {
            playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
          }
          markDetailHitShake(bumpKey, nowSec);
          spawnDetailHitPulse(hit.cx ?? hit.rootOx + 0.5, hit.cy ?? hit.rootOy + 0.5);
        }
        continue;
      }

      // Normalized Formal Tree HP
      const t0 = getMicroTile(hit.rootOx, hit.rootOy, data);
      const treeType = t0 ? getTreeType(t0.biomeId, hit.rootOx, hit.rootOy, data.seed) : 'broadleaf';
      const hitsMax = hitsForFormalTree(treeType);
      const st = getOrCreateDetailBreakState(hit.rootOx, hit.rootOy, `formal:${treeType}`, null, nowSec, hitsMax);
      
      const hpBefore = st.hitsRemaining;
      const amount = (hitSource === 'cut' || hitSource === 'tackle') ? 1 : 0; // Only cut/tackle deals damage here for now
      if (amount > 0) {
        st.hitsRemaining = Math.max(0, st.hitsRemaining - amount);
        markDetailHitHpBar(worldKey, hit.cx ?? hit.rootOx + 0.5, hit.cy ?? hit.rootOy + 0.5, st.hitsMax, hpBefore, st.hitsRemaining, nowSec);
      }
      
      markDetailHitShake(bumpKey, nowSec);
      spawnDetailHitPulse(hit.cx ?? hit.rootOx + 0.5, hit.cy ?? hit.rootOy + 0.5);
      
      if (hitSource === 'cut') {
        playTreeCutHitSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
      } else if (hitSource === 'tackle') {
        playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
      }

      if (st.hitsRemaining <= 0) {
        if (hitSource === 'cut') {
          playTreeCutHpZeroSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
        }
        registerDestroyedFormalTreeRoot(hit.rootOx, hit.rootOy, nowSec, 'cut', data);
      } else {
        if (hitSource === 'tackle') {
          tryApplyTreeTackleEffects(
            hit.cx ?? hit.rootOx + 1,
            hit.cy ?? hit.rootOy + 0.5,
            t0?.biomeId ?? 0,
            data.seed ?? 0,
            data
          );
        }
      }
      if (worldHitOnceSet) worldHitOnceSet.add(worldKey);
      continue;
    }
    if (hit.type === 'charredScatterTree') {
      if (allowChargedStumpHarvest) {
        if (hitSource === 'cut') {
          playTreeCutHitSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
        }
        if (hitSource === 'tackle') {
          playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
        }
        tryHarvestCharredScatterTreeAtOrigin(hit.rootOx, hit.rootOy, data);
      } else {
        const bumpKey = `treeBump:${hit.rootOx},${hit.rootOy}`;
        if (hitSource === 'tackle') {
          playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
        }
        markDetailHitShake(bumpKey, nowSec);
        spawnDetailHitPulse(hit.cx ?? hit.rootOx + 0.5, hit.cy ?? hit.rootOy + 0.5);
        const t0 = getMicroTile(hit.rootOx, hit.rootOy, data);
        tryApplyTreeTackleEffects(
          hit.cx ?? hit.rootOx + 0.5,
          hit.cy ?? hit.rootOy + 0.5,
          t0?.biomeId ?? 0,
          data.seed ?? 0,
          data
        );
      }
      if (worldHitOnceSet) worldHitOnceSet.add(worldKey);
      continue;
    }
    if (isPlayDetailScatterOriginDestroyed(hit.rootOx, hit.rootOy)) continue;
    const objSet = OBJECT_SETS[hit.itemKey];
    const shape = objSet ? parseShape(objSet.shape) : { rows: 1, cols: 1 };
    const st = getOrCreateDetailBreakState(hit.rootOx, hit.rootOy, hit.itemKey, objSet, nowSec);
    if (st.destroyed) continue;
    const hpBefore = st.hitsRemaining;
    const isTreeHit = scatterItemKeyIsTree(hit.itemKey);
    const hitX = hit.cx ?? hit.rootOx + 0.5;
    const hitY = hit.cy ?? hit.rootOy + 0.5;
    if (!isTreeHit) playRockSmashingSfx({ x: hitX, y: hitY });
    const treeDamage =
      isTreeHit && !(hitSource === 'cut' || hitSource === 'tackle') ? 0 : 1;
    st.hitsRemaining = Math.max(0, st.hitsRemaining - treeDamage);
    if (treeDamage > 0 || !isTreeHit) {
      markDetailHitHpBar(worldKey, hitX, hitY, st.hitsMax, hpBefore, st.hitsRemaining, nowSec);
    }
    if (isCrystalItemKey(hit.itemKey) && st.hitsRemaining < hpBefore) {
      playCrystalClinkSfx({ x: hitX, y: hitY });
    }
    markDetailHitShake(worldKey, nowSec);
    spawnDetailHitPulse(hitX, hitY);
    if (isTreeHit && treeDamage > 0) {
      if (hitSource === 'cut') {
        playTreeCutHitSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
      } else if (hitSource === 'tackle') {
        playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
      }
    }
    if (worldHitOnceSet) worldHitOnceSet.add(worldKey);
    if (st.hitsRemaining > 0) {
      if (treeDamage > 0 && hitSource === 'tackle' && isTreeHit) {
        const t0 = getMicroTile(hit.rootOx, hit.rootOy, data);
        tryApplyTreeTackleEffects(
          hit.cx ?? hit.rootOx + 1,
          hit.cy ?? hit.rootOy + 0.5,
          t0?.biomeId ?? 0,
          data.seed ?? 0,
          data
        );
      }
      continue;
    }

    if (hitSource === 'cut' && scatterItemKeyIsTree(hit.itemKey)) {
      playTreeCutHpZeroSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
    }

    markDestroyedDetailAndScheduleRegen(st, nowSec);
    burnedScatterTreeOrigins.delete(`${hit.rootOx},${hit.rootOy}`);
    harvestedBurnedScatterTreeOrigins.delete(`${hit.rootOx},${hit.rootOy}`);
    burningScatterTreeEndsAtSecByOrigin.delete(`${hit.rootOx},${hit.rootOy}`);
    scatterTreeBurnMeterByOrigin.delete(`${hit.rootOx},${hit.rootOy}`);
    if (!scatterItemKeyIsTree(hit.itemKey)) {
      const isCrystal = String(hit.itemKey || '').toLowerCase().includes('crystal');
      const isLargeCrystal = isCrystal && shape.cols >= 2 && shape.rows >= 2;
      if (isLargeCrystal) {
        spawnSmallCrystalChunksFromLarge(hit.rootOx, hit.rootOy, hit.itemKey);
      } else {
        spawnPickableCrystalDropAt(
          hit.cx ?? hit.rootOx + 0.5,
          hit.cy ?? hit.rootOy + 0.5,
          hit.itemKey,
          countSpritesInObjectSet(objSet)
        );
      }
      spawnCrystalShards(hit.rootOx, hit.rootOy, hit.itemKey, data);
    }
  }
}

/**
 * @param {number} dt
 */
export function updateCrystalShardParticles(dt) {
  if (activeCrystalShards.length === 0) return;
  const g = 9.2;
  const drag = 2.15;
  for (let i = activeCrystalShards.length - 1; i >= 0; i--) {
    const s = activeCrystalShards[i];
    s.age += dt;
    if (s.age >= s.maxAge) {
      activeCrystalShards.splice(i, 1);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += g * dt;
    const damp = Math.exp(-drag * dt);
    s.vx *= damp;
    s.vy *= damp;
  }
}

/**
 * Pick-up update for drops created from broken small crystals.
 * @param {number} dt
 * @param {{ x?: number, y?: number } | null | undefined} player
 */
export function updateCrystalDropsAndPickup(dt, player) {
  const px = Number(player?.x);
  const py = Number(player?.y);
  for (let i = activeCrystalDrops.length - 1; i >= 0; i--) {
    const d = activeCrystalDrops[i];
    d.age = (d.age || 0) + dt;
    if (d.maxAge && d.age >= d.maxAge) {
      activeCrystalDrops.splice(i, 1);
      continue;
    }
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const dx = px - d.x;
    const dy = py - d.y;
    if (d.collecting) {
      const dist = Math.hypot(dx, dy);
      const nx = dist > 1e-4 ? dx / dist : 0;
      const ny = dist > 1e-4 ? dy / dist : 0;
      const targetSp = Math.min(CRYSTAL_DROP_SUCTION_SPEED_TILES, 3.8 + dist * 7.5);
      const curVx = Number(d.vx) || 0;
      const curVy = Number(d.vy) || 0;
      d.vx = curVx + (nx * targetSp - curVx) * Math.min(1, dt * CRYSTAL_DROP_SUCTION_ACCEL);
      d.vy = curVy + (ny * targetSp - curVy) * Math.min(1, dt * CRYSTAL_DROP_SUCTION_ACCEL);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.collectShrink = Math.min(1, (d.collectShrink || 0) + dt * 5.5);
      if (dist <= CRYSTAL_DROP_SUCTION_FINISH_RADIUS) {
        const stack = Math.max(1, Number(d.stackCount) || 1);
        const key = String(d.itemKey || 'unknown');
        collectedDetailInventory.set(key, (collectedDetailInventory.get(key) || 0) + stack);
        if (isCrystalItemKey(key)) crystalLootCount += stack;
        playItemPickupSfx(player);
        activeCrystalDrops.splice(i, 1);
      }
      continue;
    }
    if (dx * dx + dy * dy <= (d.pickRadius || 1.1) * (d.pickRadius || 1.1)) {
      d.collecting = true;
      d.vx = Number(d.vx) || 0;
      d.vy = Number(d.vy) || 0;
      d.collectShrink = 0;
      continue;
    }
    if (Number(d.vx) || Number(d.vy)) {
      d.vx = (Number(d.vx) || 0) * Math.max(0, 1 - dt * 8);
      d.vy = (Number(d.vy) || 0) * Math.max(0, 1 - dt * 8);
    }
  }
}

/**
 * Incremental cleanup + regeneration of broken details.
 * Keeps memory bounded while restoring map determinism over time.
 * @param {number} dt
 * @param {object | null | undefined} data
 */
export function updateBreakableDetailRegeneration(dt, data) {
  if (!data) return;
  pruneTreeTopFalls(performance.now() * 0.001);
  if (burningFormalTreeEndsAtSecByRoot.size > 0) {
    const nowSec = performance.now() * 0.001;
    for (const [key, burnEnd] of burningFormalTreeEndsAtSecByRoot.entries()) {
      if (!Number.isFinite(burnEnd) || nowSec < burnEnd) continue;
      const [sx, sy] = key.split(',');
      const rootX = Number(sx);
      const my = Number(sy);
      if (!Number.isFinite(rootX) || !Number.isFinite(my)) {
        burningFormalTreeEndsAtSecByRoot.delete(key);
        continue;
      }
      registerDestroyedFormalTreeRoot(rootX, my, nowSec, 'burned');
    }
  }
  if (formalTreeBurnMeterByRoot.size > 0 && dt > 0) {
    const decay = FORMAL_TREE_BURN_METER_DECAY_PER_SEC * dt;
    for (const [key, meter] of formalTreeBurnMeterByRoot.entries()) {
      const next = meter - decay;
      if (next <= 0.001) {
        formalTreeBurnMeterByRoot.delete(key);
      } else {
        formalTreeBurnMeterByRoot.set(key, next);
      }
    }
  }
  if (burningScatterTreeEndsAtSecByOrigin.size > 0) {
    const nowSec = performance.now() * 0.001;
    for (const [key, burnEnd] of burningScatterTreeEndsAtSecByOrigin.entries()) {
      if (!Number.isFinite(burnEnd) || nowSec < burnEnd) continue;
      const [sx, sy] = key.split(',');
      const ox = Number(sx);
      const oy = Number(sy);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
        burningScatterTreeEndsAtSecByOrigin.delete(key);
        continue;
      }
      if (!markScatterTreeBurnedAndScheduleRegen(ox, oy, nowSec, data)) {
        burningScatterTreeEndsAtSecByOrigin.delete(key);
      }
    }
  }
  if (scatterTreeBurnMeterByOrigin.size > 0 && dt > 0) {
    const decay = FORMAL_TREE_BURN_METER_DECAY_PER_SEC * dt;
    for (const [key, meter] of scatterTreeBurnMeterByOrigin.entries()) {
      const next = meter - decay;
      if (next <= 0.001) {
        scatterTreeBurnMeterByOrigin.delete(key);
      } else {
        scatterTreeBurnMeterByOrigin.set(key, next);
      }
    }
  }
  const nowSec = performance.now() * 0.001;
  sweepDetailBreakState(data, nowSec);
  for (const [key, bar] of detailHitHpBars.entries()) {
    if (!bar || nowSec > bar.hideAtSec) detailHitHpBars.delete(key);
  }
  for (const [key, hitAt] of detailHitShakeAtSec.entries()) {
    if (!Number.isFinite(hitAt) || nowSec - hitAt >= DETAIL_HIT_SHAKE_SEC) {
      detailHitShakeAtSec.delete(key);
    }
  }
  for (let i = activeDetailHitPulses.length - 1; i >= 0; i--) {
    const p = activeDetailHitPulses[i];
    p.age += dt;
    if (p.age >= p.maxAge) activeDetailHitPulses.splice(i, 1);
  }
  for (const [key, regenAtSec] of destroyedFormalTreeRegenAtSecByRoot.entries()) {
    if (!Number.isFinite(regenAtSec) || nowSec >= regenAtSec) {
      const [sx, sy] = key.split(',');
      const rootX = Number(sx);
      const my = Number(sy);
      destroyedFormalTreeRegenAtSecByRoot.delete(key);
      destroyedFormalTreeRoots.delete(key);
      destroyedFormalTreeCauseByRoot.delete(key);
      formalTreeBurnMeterByRoot.delete(key);
      burningFormalTreeEndsAtSecByRoot.delete(key);
      harvestedBurnedFormalTreeRoots.delete(key);
      if (Number.isFinite(rootX) && Number.isFinite(my)) {
        enqueuePlayChunkBake(Math.floor(rootX / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
        enqueuePlayChunkBake(Math.floor((rootX + 1) / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
      }
    }
  }
}

export function getCrystalLootCount() {
  return crystalLootCount;
}

/**
 * Collected pickup totals in current play session.
 * @returns {Array<{ itemKey: string, count: number }>}
 */
export function getCollectedDetailInventorySnapshot() {
  const out = [];
  for (const [itemKey, count] of collectedDetailInventory.entries()) {
    out.push({ itemKey, count: Math.max(0, count | 0) });
  }
  out.sort((a, b) => b.count - a.count || a.itemKey.localeCompare(b.itemKey));
  return out;
}
