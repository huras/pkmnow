import { clearScatterSolidBlockCache } from '../scatter-pass2-debug.js';
import { BIOME_VEGETATION, getTreeType, TREE_TILES, tileSurfaceAllowsScatterVegetation } from '../biome-tiles.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape, seededHash } from '../tessellation-logic.js';
import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import { PLAY_CHUNK_SIZE } from '../render/render-constants.js';
import { enqueuePlayChunkBake } from '../render/play-chunk-cache.js';
import { invalidateStaticEntityCache } from '../render/static-entity-cache.js';
import { didFormalTreeSpawnAtRoot, getFormalTreeTrunkCircle, scatterPhysicsCircleAtOrigin } from '../walkability.js';
import { scatterItemKeyIsSolid, scatterItemKeyIsTree, validScatterOriginMicro } from '../scatter-pass2-debug.js';
import { harvestBerryTree, getBerryTreeState } from './berry-tree-system.js';
import {
  setScatterItemKeyOverride,
  clearScatterItemKeyOverrides,
  SCATTER_ITEM_KEY_OVERRIDE_EMPTY
} from './scatter-item-override.js';
import { FORMAL_TRUNK_BASE_WIDTH_TILES, TRUNK_STRIP_WIDTH_FRAC, TREE_MOVE_HITBOX_RADIUS_MULT } from '../scatter-collider-config.js';
import { playTreeTackleSfx } from '../audio/tree-tackle-sfx.js';
import { getRainFireSnuffSeconds } from './weather-state.js';
import { GRASS_FIRE_SPREAD_INTERVAL_SEC, GRASS_FIRE_SPREAD_BASE_CHANCE } from '../play-grass-fire.js';
import {
  pushVegetationDissolveFromSt,
  pushFormalTreeTopFall,
  pruneTreeTopFalls,
  clearTreeTopFallState
} from './play-tree-top-fall.js';
import {
  activeCrystalShards,
  activeSpawnedSmallCrystals,
  activeCrystalDrops,
  clearCrystalDropPickupState,
  isCrystalItemKey,
  countSpritesInObjectSet,
  spawnPickableCrystalDropAt,
  spawnCrystalShards,
  spawnSmallCrystalChunksFromLarge,
  updateCrystalShardParticles,
  updateCrystalDropsAndPickup,
  getCrystalLootCount,
  getCollectedDetailInventorySnapshot,
  PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE,
  refundOneInventoryUnitFromGroundDrop,
  trySpendOneInventoryUnitForGroundDrop
} from './play-crystal-drops.js';
export {
  activeCrystalShards,
  activeSpawnedSmallCrystals,
  activeCrystalDrops,
  updateCrystalShardParticles,
  updateCrystalDropsAndPickup,
  spawnPickableCrystalDropAt,
  getCrystalLootCount,
  getCollectedDetailInventorySnapshot,
  PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE,
  refundOneInventoryUnitFromGroundDrop,
  trySpendOneInventoryUnitForGroundDrop
} from './play-crystal-drops.js';
export { appendTreeTopFallRenderItems } from './play-tree-top-fall.js';
import { playTreeCutHpZeroSfx } from '../audio/tree-cut-sfx.js';
import { playTreeCutHitSfx } from '../audio/tree-cut-hit-sfx.js';
import { playCrystalClinkSfx } from '../audio/crystal-clink-sfx.js';
import { playRockSmashingSfx, playRockSmashingBreakSfx } from '../audio/rock-smashing-sfx.js';
import { getChargeLevel } from './play-charge-levels.js';
import { rumblePlayerGamepadDetailImpact } from './play-gamepad-rumble.js';

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
/** Formal tree root `rootX,my` -> fade-in start (sec) after regen; chunk base omitted until fade ends. */
const formalTreeRegrowFadeStartSecByRoot = new Map();
/** Scatter tree origin `ox,oy` -> fade-in start + footprint (invalidate after fade). */
const scatterTreeRegrowFadeByOrigin = new Map();
/** Scatter tree roots burned to charcoal stumps (still present until regen or harvested). */
const burnedScatterTreeOrigins = new Set();
/** Burned scatter stump already tackled and converted into charcoal pickup. */
const harvestedBurnedScatterTreeOrigins = new Set();
/** Formal tree root `rootX,my` → fire spread depth (0 = ignited by projectile; +1 per neighbor hop). */
const formalTreeFireSpreadDepthByRoot = new Map();
/** Scatter tree origin `ox,oy` → fire spread depth (same semantics as grass). */
const scatterTreeFireSpreadDepthByOrigin = new Map();
let treeFireSpreadAccSec = 0;
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
/** After a wild Pokémon spawns from tree tackle, block another for this many seconds. */
const TREE_TACKLE_WILD_SPAWN_COOLDOWN_SEC = 5;
let treeTackleWildSpawnBlockedUntilSec = 0;
const DETAIL_REGEN_AFTER_BREAK_SEC = 80;
const FORMAL_TREE_REGEN_AFTER_BREAK_SEC = 80;
/** Formal + scatter tree trunk/canopy and grass regrow use the same short alpha ramp (cheap quad easing in callers). */
export const VEG_REGROW_FADE_IN_SEC = 0.48;
const FORMAL_TREE_BURN_METER_MAX = 100;
const FORMAL_TREE_BURN_METER_DECAY_PER_SEC = 4.5;
const FORMAL_TREE_BURN_GROUND_Z_MAX = 0.55;
// Fire-impact radius on trees is now unified with Cut / Thunder / etc. via
// `TREE_MOVE_HITBOX_RADIUS_MULT` — see `scatter-collider-config.js`.
const FORMAL_TREE_BURNING_VISUAL_SEC = 5;
const FORMAL_TREE_BURN_ADD_BY_PROJECTILE = Object.freeze({
  ember: 34,
  flamethrowerShot: 16,
  incinerateShard: 28,
  incinerateCore: 54,
  fireBlastShard: 30,
  fireBlastCore: 78,
  fireSpinBurst: 24,
  // Lightning is a finisher: instant ignition regardless of prior damage.
  lightningStrike: 150,
  thunderShockBeam: 38,
  thunderBoltArc: 46,
  /** Prismatic Laser: same meter as fire, but completion skips the torch “burning” phase (see add*BurnMeter). */
  prismaticShot: 20,
  steelBeamShot: 18
});
const DETAIL_PARTIAL_DAMAGE_FORGET_SEC = 22;
/** Strength-relocated rock: drop override + detail state after no hits / grabs (frees override map memory). */
const DETAIL_SWEEP_STEP = 96;
const DETAIL_SWEEP_INTERVAL_SEC = 0.5;
const DETAIL_HIT_BAR_ANIM_SEC = 0.16;
const DETAIL_HIT_BAR_LINGER_SEC = 1.05;
const DETAIL_HIT_SHAKE_SEC = 0.18;

const chunkRebakeBatchKeys = new Set();
let chunkRebakeBatchDepth = 0;
let _scatterCacheDirtyInBatch = false;

function beginChunkRebakeBatch() {
  chunkRebakeBatchDepth++;
}

function endChunkRebakeBatch() {
  if (chunkRebakeBatchDepth <= 0) return;
  chunkRebakeBatchDepth--;
  if (chunkRebakeBatchDepth > 0) return;
  if (_scatterCacheDirtyInBatch) {
    _scatterCacheDirtyInBatch = false;
    clearScatterSolidBlockCache();
  }
  if (chunkRebakeBatchKeys.size === 0) return;
  for (const key of chunkRebakeBatchKeys) {
    const [sx, sy] = key.split(',');
    const cx = Number(sx);
    const cy = Number(sy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    enqueuePlayChunkBake(cx, cy, true);
  }
  chunkRebakeBatchKeys.clear();
}

function queuePlayChunkRebake(cx, cy, forceRebake = true) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
  if (chunkRebakeBatchDepth > 0) {
    chunkRebakeBatchKeys.add(`${Math.floor(cx)},${Math.floor(cy)}`);
    return;
  }
  enqueuePlayChunkBake(Math.floor(cx), Math.floor(cy), forceRebake);
}

/** Hit probe is slightly inside the peak lunge to avoid edge jitter exactly on tile borders. */
const TACKLE_HIT_PROBE_BACKOFF_TILES = 0.05;
/** Player tackle uses a capsule-like sweep (segment + this radius), not per-tile checks. */
const TACKLE_SWEEP_RADIUS_TILES = 0.32;
/** Tackle hurtbox scale over each detail's physical collider radius. */
const TACKLE_DETAIL_HURTBOX_RADIUS_MULT = 2;
/** Sampling only drives candidate origin lookup window; collision is exact segment-vs-circle. */
const TACKLE_ORIGIN_SCAN_STEP_TILES = 0.2;
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

export function isBerryTreeKey(itemKey) {
  return String(itemKey || '').toLowerCase().includes('berry-tree');
}

export function isPlayFormalTreeRootDestroyed(rootX, my) {
  return destroyedFormalTreeRoots.has(`${rootX},${my}`);
}

/**
 * Multiplies formal tree draw alpha during post-regen fade-in (1 when inactive).
 * @param {number} rootX
 * @param {number} my
 * @param {number} [nowSec]
 */
export function getFormalTreeRegrowVisualAlpha01(rootX, my, nowSec = performance.now() * 0.001) {
  const start = formalTreeRegrowFadeStartSecByRoot.get(`${rootX},${my}`);
  if (start == null || !Number.isFinite(start)) return 1;
  const u = Math.max(0, Math.min(1, (nowSec - start) / VEG_REGROW_FADE_IN_SEC));
  return u * u;
}

/**
 * Multiplies scatter tree draw alpha during post-regen fade-in (1 when inactive).
 * @param {number} ox
 * @param {number} oy
 * @param {number} [nowSec]
 */
export function getScatterTreeRegrowVisualAlpha01(ox, oy, nowSec = performance.now() * 0.001) {
  const rec = scatterTreeRegrowFadeByOrigin.get(`${ox},${oy}`);
  if (!rec || !Number.isFinite(rec.startSec)) return 1;
  const u = Math.max(0, Math.min(1, (nowSec - rec.startSec) / VEG_REGROW_FADE_IN_SEC));
  return u * u;
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

/**
 * Lists every currently-burning tree (formal + scatter) with its world-center position and
 * ignition time. Used by the looped fire SFX to assign audio voices on tree torches.
 *
 * `burnEnd` is the wall-clock second when the visual burn phase ends (charred marker appears);
 * we derive `startedAtMs` by subtracting the known burn duration so loops fade in from the
 * moment of ignition, not from re-broadcast.
 * @param {object} data
 * @returns {Array<{ id: string, x: number, y: number, startedAtMs: number }>}
 */
export function listActiveBurningTreeSources(data) {
  const out = [];
  if (!data) return out;
  const burnMs = FORMAL_TREE_BURNING_VISUAL_SEC * 1000;
  for (const [key, burnEnd] of burningFormalTreeEndsAtSecByRoot) {
    if (!Number.isFinite(burnEnd)) continue;
    const [sx, sy] = key.split(',');
    const rootX = Number(sx);
    const my = Number(sy);
    if (!Number.isFinite(rootX) || !Number.isFinite(my)) continue;
    const trunk = getFormalTreeTrunkCircle(rootX, my, data);
    if (!trunk) continue;
    out.push({
      id: `tree:f:${key}`,
      x: trunk.cx,
      y: trunk.cy,
      startedAtMs: burnEnd * 1000 - burnMs
    });
  }
  const scatterMemo = new Map();
  for (const [key, burnEnd] of burningScatterTreeEndsAtSecByOrigin) {
    if (!Number.isFinite(burnEnd)) continue;
    const [sx, sy] = key.split(',');
    const ox = Number(sx);
    const oy = Number(sy);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
    const spec = scatterTreeSpecAtOrigin(ox, oy, data, null, scatterMemo);
    if (!spec) continue;
    out.push({
      id: `tree:s:${key}`,
      x: spec.cx,
      y: spec.cy,
      startedAtMs: burnEnd * 1000 - burnMs
    });
  }
  return out;
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
  formalTreeFireSpreadDepthByRoot.clear();
  harvestedBurnedFormalTreeRoots.clear();
  scatterTreeBurnMeterByOrigin.clear();
  burningScatterTreeEndsAtSecByOrigin.clear();
  scatterTreeFireSpreadDepthByOrigin.clear();
  burnedScatterTreeOrigins.clear();
  harvestedBurnedScatterTreeOrigins.clear();
  formalTreeRegrowFadeStartSecByRoot.clear();
  scatterTreeRegrowFadeByOrigin.clear();
  detailBreakStateByOrigin.clear();
  detailBreakSweepIter = null;
  detailBreakSweepCooldownSec = 0;
  treeTackleWildSpawnBlockedUntilSec = 0;
  detailHitHpBars.clear();
  detailHitShakeAtSec.clear();
  activeDetailHitPulses.length = 0;
  clearCrystalDropPickupState();
  clearTreeTopFallState();
  treeFireSpreadAccSec = 0;
  invalidateStaticEntityCache();
}

function registerDestroyedCrystalOrigin(rootOx, rootOy) {
  destroyedCrystalScatterOrigins.add(`${rootOx},${rootOy}`);
  if (chunkRebakeBatchDepth > 0) { _scatterCacheDirtyInBatch = true; }
  else { clearScatterSolidBlockCache(); }
}

function registerDestroyedFormalTreeRoot(rootX, my, nowSec, cause = 'cut', data = null) {
  const key = `${rootX},${my}`;
  burningFormalTreeEndsAtSecByRoot.delete(key);
  formalTreeFireSpreadDepthByRoot.delete(key);
  destroyedFormalTreeRoots.add(key);
  destroyedFormalTreeRegenAtSecByRoot.set(key, nowSec + FORMAL_TREE_REGEN_AFTER_BREAK_SEC);
  destroyedFormalTreeCauseByRoot.set(key, cause === 'burned' ? 'burned' : 'cut');
  formalTreeBurnMeterByRoot.delete(key);
  if (cause !== 'burned' && data) {
    const t = getMicroTile(rootX, my, data);
    const treeType = t ? getTreeType(t.biomeId, rootX, my, data.seed) : null;
    if (treeType) pushFormalTreeTopFall(rootX, my, treeType, nowSec);
  }
  queuePlayChunkRebake(Math.floor(rootX / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
  queuePlayChunkRebake(Math.floor((rootX + 1) / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
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
    queuePlayChunkRebake(cx, cy, true);
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
  scatterTreeFireSpreadDepthByOrigin.delete(key);
  return true;
}

/** Max trunk-center distance (tiles) for fire to jump formal → formal tree. */
const FORMAL_TREE_FIRE_NEIGHBOR_DIST = 2.98;
/** Max canopy-center distance for fire to jump scatter → scatter tree. */
const SCATTER_TREE_FIRE_NEIGHBOR_DIST = 3.15;

function treeFireSpreadChance01(sourceSpreadDepth) {
  const d = Math.max(0, Math.floor(Number(sourceSpreadDepth)) || 0);
  return GRASS_FIRE_SPREAD_BASE_CHANCE * Math.pow(0.5, d);
}

/**
 * @param {(rx: number, ry: number, neighborKey: string) => void} cb
 */
function forEachNeighborFormalTreeRoot(rootX, my, data, trunk, cb) {
  if (!trunk) return;
  const seen = new Set();
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (dx === 0 && dy === 0) continue;
      const rx = rootX + dx;
      const ry = my + dy;
      const nk = `${rx},${ry}`;
      if (seen.has(nk)) continue;
      if (!didFormalTreeSpawnAtRoot(rx, ry, data)) continue;
      const t2 = getFormalTreeTrunkCircle(rx, ry, data);
      if (!t2) continue;
      const dist = Math.hypot(t2.cx - trunk.cx, t2.cy - trunk.cy);
      if (dist > FORMAL_TREE_FIRE_NEIGHBOR_DIST) continue;
      seen.add(nk);
      cb(rx, ry, nk);
    }
  }
}

function tryIgniteFormalTreeFromNeighborFire(rootX, my, nowSec, data, spreadDepth) {
  const key = `${rootX},${my}`;
  if (isPlayFormalTreeRootDestroyed(rootX, my)) return false;
  if (burningFormalTreeEndsAtSecByRoot.has(key)) return false;
  formalTreeBurnMeterByRoot.delete(key);
  burningFormalTreeEndsAtSecByRoot.set(key, nowSec + FORMAL_TREE_BURNING_VISUAL_SEC);
  formalTreeFireSpreadDepthByRoot.set(key, Math.max(0, Math.floor(Number(spreadDepth)) || 0));
  queuePlayChunkRebake(Math.floor(rootX / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
  queuePlayChunkRebake(Math.floor((rootX + 1) / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
  return true;
}

/**
 * @param {(nx: number, ny: number, neighborKey: string) => void} cb
 */
function forEachNeighborScatterTreeOrigin(ox, oy, data, spec, scatterMemo, cb) {
  if (!spec) return;
  const seen = new Set([`${ox},${oy}`]);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = ox + dx;
      const ny = oy + dy;
      const nk = `${nx},${ny}`;
      if (seen.has(nk)) continue;
      const sp = scatterTreeSpecAtOrigin(nx, ny, data, null, scatterMemo);
      if (!sp) continue;
      const dist = Math.hypot(sp.cx - spec.cx, sp.cy - spec.cy);
      if (dist > SCATTER_TREE_FIRE_NEIGHBOR_DIST) continue;
      seen.add(nk);
      cb(nx, ny, nk);
    }
  }
}

function tryIgniteScatterTreeFromNeighborFire(ox, oy, nowSec, data, spreadDepth) {
  const key = `${ox},${oy}`;
  if (isPlayDetailScatterOriginDestroyed(ox, oy)) return false;
  if (burningScatterTreeEndsAtSecByOrigin.has(key)) return false;
  const spec = scatterTreeSpecAtOrigin(ox, oy, data);
  if (!spec) return false;
  scatterTreeBurnMeterByOrigin.delete(key);
  burningScatterTreeEndsAtSecByOrigin.set(key, nowSec + FORMAL_TREE_BURNING_VISUAL_SEC);
  scatterTreeFireSpreadDepthByOrigin.set(key, Math.max(0, Math.floor(Number(spreadDepth)) || 0));
  burnedScatterTreeOrigins.delete(key);
  harvestedBurnedScatterTreeOrigins.delete(key);
  queueChunkRebakeOverlappingFootprint(spec.ox, spec.oy, spec.cols, spec.rows);
  return true;
}

function tickTreeFireSpreadToNeighbors(dt, data) {
  if (!data || dt <= 0) return;
  treeFireSpreadAccSec += dt;
  if (treeFireSpreadAccSec < GRASS_FIRE_SPREAD_INTERVAL_SEC) return;
  treeFireSpreadAccSec = 0;
  const nowSec = performance.now() * 0.001;
  if (burningFormalTreeEndsAtSecByRoot.size > 0) {
    const formalKeys = [...burningFormalTreeEndsAtSecByRoot.keys()];
    for (let i = 0; i < formalKeys.length; i++) {
      const key = formalKeys[i];
      const burnEnd = burningFormalTreeEndsAtSecByRoot.get(key);
      if (!Number.isFinite(burnEnd) || nowSec >= burnEnd) continue;
      const depth = formalTreeFireSpreadDepthByRoot.get(key) ?? 0;
      const p = treeFireSpreadChance01(depth);
      const c = key.indexOf(',');
      const rootX = Number(key.slice(0, c));
      const my = Number(key.slice(c + 1));
      if (!Number.isFinite(rootX) || !Number.isFinite(my)) continue;
      const trunk = getFormalTreeTrunkCircle(rootX, my, data);
      if (!trunk) continue;
      forEachNeighborFormalTreeRoot(rootX, my, data, trunk, (rx, ry) => {
        if (Math.random() >= p) return;
        tryIgniteFormalTreeFromNeighborFire(rx, ry, nowSec, data, depth + 1);
      });
    }
  }
  if (burningScatterTreeEndsAtSecByOrigin.size > 0) {
    const scatterKeys = [...burningScatterTreeEndsAtSecByOrigin.keys()];
    const scatterMemo = new Map();
    for (let i = 0; i < scatterKeys.length; i++) {
      const key = scatterKeys[i];
      const burnEnd = burningScatterTreeEndsAtSecByOrigin.get(key);
      if (!Number.isFinite(burnEnd) || nowSec >= burnEnd) continue;
      const depth = scatterTreeFireSpreadDepthByOrigin.get(key) ?? 0;
      const p = treeFireSpreadChance01(depth);
      const c = key.indexOf(',');
      const ox = Number(key.slice(0, c));
      const oy = Number(key.slice(c + 1));
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const spec = scatterTreeSpecAtOrigin(ox, oy, data, null, scatterMemo);
      if (!spec) continue;
      forEachNeighborScatterTreeOrigin(ox, oy, data, spec, scatterMemo, (nx, ny) => {
        if (Math.random() >= p) return;
        tryIgniteScatterTreeFromNeighborFire(nx, ny, nowSec, data, depth + 1);
      });
    }
  }
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
    if (projType === 'prismaticShot' || projType === 'steelBeamShot') {
      registerDestroyedFormalTreeRoot(rootX, my, nowSec, 'burned', data);
    } else {
      burningFormalTreeEndsAtSecByRoot.set(key, nowSec + FORMAL_TREE_BURNING_VISUAL_SEC);
      formalTreeFireSpreadDepthByRoot.set(key, 0);
    }
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
    if (projType === 'prismaticShot' || projType === 'steelBeamShot') {
      markScatterTreeBurnedAndScheduleRegen(ox, oy, nowSec, data);
    } else {
      burningScatterTreeEndsAtSecByOrigin.set(key, nowSec + FORMAL_TREE_BURNING_VISUAL_SEC);
      scatterTreeFireSpreadDepthByOrigin.set(key, 0);
      burnedScatterTreeOrigins.delete(key);
      harvestedBurnedScatterTreeOrigins.delete(key);
    }
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
  beginChunkRebakeBatch();
  const ix = Math.floor(worldX);
  const iy = Math.floor(worldY);
  const nowSec = performance.now() * 0.001;
  let anyApplied = false;
  for (let my = iy - 1; my <= iy + 1; my++) {
    for (let rootX = ix - 1; rootX <= ix; rootX++) {
      if (!didFormalTreeSpawnAtRoot(rootX, my, data)) continue;
      const trunk = getFormalTreeTrunkCircle(rootX, my, data);
      if (!trunk) continue;
      const rr = trunk.r * TREE_MOVE_HITBOX_RADIUS_MULT;
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
      const rr = spec.r * TREE_MOVE_HITBOX_RADIUS_MULT;
      const dx = worldX - spec.cx;
      const dy = worldY - spec.cy;
      if (dx * dx + dy * dy > rr * rr) continue;
      addScatterTreeBurnMeterAndMaybeDestroy(ox, oy, projType, nowSec, data);
      anyApplied = true;
    }
  }
  endChunkRebakeBatch();
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
  queuePlayChunkRebake(Math.floor(rootX / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
  queuePlayChunkRebake(Math.floor((rootX + 1) / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
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
  if (chunkRebakeBatchDepth > 0) { _scatterCacheDirtyInBatch = true; }
  else { clearScatterSolidBlockCache(); }
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

/**
 * Shows the current HP bar of a breakable detail at an origin (useful as feedback when interaction is denied).
 * @returns {boolean} true if a detail with break-state HP was found and shown
 */
export function showBreakableDetailHpAtOrigin(ox, oy, data) {
  if (!data) return false;
  const key = `${ox},${oy}`;
  const st = detailBreakStateByOrigin.get(key);
  if (!st || st.destroyed) return false;
  const hpMax = Math.max(1, Math.floor(Number(st.hitsMax) || 1));
  const hpNow = Math.max(0, Math.min(hpMax, Math.floor(Number(st.hitsRemaining) || hpMax)));
  const p = scatterPhysicsCircleAtOrigin(ox, oy, data, null, null, { ignoreDestroyed: true });
  const cx = Number.isFinite(p?.cx) ? p.cx : st.ox + Math.max(1, st.cols || 1) * 0.5;
  const cy = Number.isFinite(p?.cy) ? p.cy : st.oy + Math.max(1, st.rows || 1) * 0.5;
  const nowSec = performance.now() * 0.001;
  markDetailHitHpBar(key, cx, cy, hpMax, hpNow, hpNow, nowSec);
  return true;
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
    queuePlayChunkRebake(cx, cy, true);
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
  invalidateStaticEntityCache();
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
 * Places one inventory item back into the world as a scatter detail (not pickup drop).
 * Resulting detail is breakable again via normal map-detail combat flow.
 * @param {number} landX
 * @param {number} landY
 * @param {string} itemKey
 * @param {object | null | undefined} data
 * @param {number} [chebRadius]
 * @returns {boolean}
 */
export function placeInventoryItemAsScatterDetailNear(landX, landY, itemKey, data, chebRadius = 8) {
  if (!data) return false;
  const resolvedItemKey = String(itemKey || '');
  if (!resolvedItemKey) return false;
  const objSet = OBJECT_SETS[resolvedItemKey];
  if (!objSet) return false;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const cx = Math.max(0.5, Math.min(microW - 0.5, Number(landX) || 0.5));
  const cy = Math.max(0.5, Math.min(microH - 0.5, Number(landY) || 0.5));
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  const R = Math.max(0, Math.floor(Number(chebRadius) || 0));
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
  const nowSec = performance.now() * 0.001;
  for (const c of cand) {
    const tile = getMicroTile(c.ox, c.oy, data);
    if (!tile || !tileSurfaceAllowsScatterVegetation(tile)) continue;
    if (isPlayScatterTreeOriginCharred(c.ox, c.oy) || isPlayScatterTreeOriginBurning(c.ox, c.oy)) continue;
    if (scatterPhysicsCircleAtOrigin(c.ox, c.oy, data)) continue;
    const key = `${c.ox},${c.oy}`;
    const exSt = detailBreakStateByOrigin.get(key);
    if (exSt && !exSt.destroyed) continue;
    strengthCarriedBlockRegenKeys.delete(key);
    detailBreakStateByOrigin.delete(key);
    detailHitHpBars.delete(key);
    detailHitShakeAtSec.delete(key);
    unregisterDestroyedDetailOrigin(c.ox, c.oy);
    burnedScatterTreeOrigins.delete(key);
    harvestedBurnedScatterTreeOrigins.delete(key);
    burningScatterTreeEndsAtSecByOrigin.delete(key);
    scatterTreeBurnMeterByOrigin.delete(key);
    scatterTreeFireSpreadDepthByOrigin.delete(key);
    const st = getOrCreateDetailBreakState(c.ox, c.oy, resolvedItemKey, objSet, nowSec);
    st.hitsRemaining = Math.max(1, Math.floor(Number(st.hitsMax) || 1));
    st.destroyed = false;
    st.regenAtSec = 0;
    st.lastHitAtSec = nowSec;
    st.strengthReloPlaced = true;
    destroyedCrystalScatterOrigins.delete(key);
    setScatterItemKeyOverride(c.ox, c.oy, resolvedItemKey);
    invalidateChunksOverlappingFootprint(c.ox, c.oy, st.cols, st.rows);
    clearScatterSolidBlockCache();
    invalidateStaticEntityCache();
    return true;
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
  invalidateStaticEntityCache();
}

/** Decorative grass scatter tiles only — skipped by Earthquake radial breaks. */
function scatterItemKeyIsPureGrassDecoration(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  return (
    k.includes('grass [1x1]') ||
    k.includes('small-grass') ||
    k.includes('sand-grass') ||
    k.includes('snow-grass')
  );
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
        if (scatterItemKeyIsTree(st.itemKey)) {
          scatterTreeRegrowFadeByOrigin.set(key, {
            startSec: nowSec,
            ox: st.ox,
            oy: st.oy,
            cols: st.cols,
            rows: st.rows
          });
        } else {
          invalidateChunksOverlappingFootprint(st.ox, st.oy, st.cols, st.rows);
        }
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

/** @param {{ gamepadRumblePlayer?: boolean }} opts */
/** @param {'tree' | 'rock' | 'crystal'} profile */
function tryPlayerGamepadRumbleForHit(opts, profile) {
  if (!opts?.gamepadRumblePlayer || !profile) return;
  rumblePlayerGamepadDetailImpact(profile);
}

/**
 * Extra break ticks from held melee charge (bars 2–3): +0 / +1 / +2 vs map details.
 * @param {'tackle' | 'cut' | 'other'} hitSource
 * @param {number | null | undefined} detailCharge01
 */
function detailChargeBonusHits(hitSource, detailCharge01) {
  if (hitSource !== 'cut' && hitSource !== 'tackle') return 0;
  if (detailCharge01 == null || !Number.isFinite(detailCharge01)) return 0;
  const p = Math.max(0, Math.min(1, detailCharge01));
  if (p < 0.16) return 0;
  // With 4 charge bars `getChargeLevel` can reach 4; cap bonus hits so crystal detail
  // scaling stays in the same band as the original 3-bar design (+0 / +1 / +2).
  return Math.min(2, Math.max(0, getChargeLevel(p) - 1));
}

/**
 * If the tackled cell holds a crystal scatter, remove it and spawn shard particles.
 * @param {import('../player.js').player} player
 * @param {object | null | undefined} data
 * @param {number | null | undefined} [detailCharge01] when set (charged release), scales detail break damage
 */
export function tryBreakCrystalOnPlayerTackle(player, data, detailCharge01 = null) {
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
  const pz = Number(player.z ?? 0);
  const reach = Math.max(0.2, Number(player._tackleReachTiles) || 1);
  const probeReach = Math.max(0.2, reach - TACKLE_HIT_PROBE_BACKOFF_TILES);
  const ex = px + nx * probeReach;
  const ey = py + ny * probeReach;
  const dc =
    detailCharge01 != null && Number.isFinite(detailCharge01)
      ? Math.max(0, Math.min(1, detailCharge01))
      : null;
  tryBreakDetailsAlongSegment(px, py, ex, ey, data, {
    hitSource: 'tackle',
    pz,
    gamepadRumblePlayer: true,
    ...(dc != null ? { detailCharge01: dc } : {})
  });
}

function tryApplyTreeTackleEffects(cx, cy, biomeId, seed, data) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !data) return;
  const salt = Math.floor((seed ?? 0) + biomeId * 131 + cx * 17 + cy * 23);
  const branch = seededHash(Math.floor(cx * 10), Math.floor(cy * 10), salt + 77111);
  if (branch < 0.07) {
    const nowSec = performance.now() * 0.001;
    if (nowSec >= treeTackleWildSpawnBlockedUntilSec) {
      const pool = getEncounters(biomeId);
      if (pool?.length) {
        const pick = pool[Math.floor(seededHash(Math.floor(cx), Math.floor(cy), salt + 77133) * pool.length)];
        const dex = encounterNameToDex(pick);
        if (dex != null) {
          treeTackleWildSpawnBlockedUntilSec = nowSec + TREE_TACKLE_WILD_SPAWN_COOLDOWN_SEC;
          void import('../wild-pokemon/index.js').then((m) => {
            if (m?.summonDebugWildPokemon) m.summonDebugWildPokemon(dex, data, cx, cy);
          });
        }
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
 * Shared apply pass for segment / disk detail sweeps (must run inside one chunk-rebake batch).
 * @param {any[]} hits
 * @param {object} data
 * @param {{
 *   worldHitOnceSet?: Set<string>,
 *   spawnedHitOnceSet?: Set<number>,
 *   hitSource?: 'tackle' | 'cut' | 'other',
 *   detailCharge01?: number | null,
 *   treeDemolishOneShot?: boolean,
 *   excludePureGrassScatterHits?: boolean,
 *   gamepadRumblePlayer?: boolean
 * }} opts
 * @param {number} nowSec
 * @param {Set<string>} consumedWorld
 * @param {Set<number>} consumedSpawned
 */
function applySortedDetailHits(hits, data, opts, nowSec, consumedWorld, consumedSpawned) {
  const hitSource = opts.hitSource === 'cut' ? 'cut' : opts.hitSource === 'other' ? 'other' : 'tackle';
  const bonusHits = detailChargeBonusHits(
    hitSource,
    opts.detailCharge01 != null && Number.isFinite(opts.detailCharge01) ? opts.detailCharge01 : null
  );
  const treeDemolishOneShot = opts.treeDemolishOneShot === true;
  const allowChargedStumpHarvest = hitSource === 'cut' || hitSource === 'tackle';
  const worldHitOnceSet = opts.worldHitOnceSet instanceof Set ? opts.worldHitOnceSet : null;
  const spawnedHitOnceSet = opts.spawnedHitOnceSet instanceof Set ? opts.spawnedHitOnceSet : null;

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
      tryPlayerGamepadRumbleForHit(opts, 'crystal');
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
          if (hitSource === 'cut' || hitSource === 'tackle') {
            tryPlayerGamepadRumbleForHit(opts, 'tree');
          }
        } else {
          if (hitSource === 'tackle') {
            playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
            tryPlayerGamepadRumbleForHit(opts, 'tree');
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
      const baseAmt = hitSource === 'cut' || hitSource === 'tackle' ? 1 : 0;
      let amount = baseAmt > 0 ? baseAmt + bonusHits : 0;
      if (treeDemolishOneShot && amount > 0) {
        amount = st.hitsRemaining;
      }
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
      if (amount > 0 && (hitSource === 'cut' || hitSource === 'tackle')) {
        tryPlayerGamepadRumbleForHit(opts, 'tree');
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
        if (hitSource === 'cut' || hitSource === 'tackle') {
          tryPlayerGamepadRumbleForHit(opts, 'tree');
        }
      } else {
        const bumpKey = `treeBump:${hit.rootOx},${hit.rootOy}`;
        if (hitSource === 'tackle') {
          playTreeTackleSfx({ x: hit.cx ?? hit.rootOx + 0.5, y: hit.cy ?? hit.rootOy + 0.5 });
          tryPlayerGamepadRumbleForHit(opts, 'tree');
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
    const baseTreeDmg =
      isTreeHit && !(hitSource === 'cut' || hitSource === 'tackle') ? 0 : 1;
    let treeDamage = baseTreeDmg > 0 ? baseTreeDmg + bonusHits : 0;
    if (treeDemolishOneShot && isTreeHit && treeDamage > 0) {
      treeDamage = st.hitsRemaining;
    }
    st.hitsRemaining = Math.max(0, st.hitsRemaining - treeDamage);
    if (!isTreeHit) {
      if (treeDamage > 0 && st.hitsRemaining <= 0) {
        playRockSmashingBreakSfx({ x: hitX, y: hitY });
      } else {
        playRockSmashingSfx({ x: hitX, y: hitY });
      }
    }
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

    if (isBerryTreeKey(hit.itemKey) && (hitSource === 'cut' || hitSource === 'tackle')) {
      const harvestedCount = harvestBerryTree(hit.rootOx, hit.rootOy, null, data, hit.itemKey);
      if (harvestedCount > 0) {
        // Berry trees don't get "destroyed" in the traditional sense, they just reset to stage 0.
        // We can add some visual feedback here if needed.
        if (worldHitOnceSet) worldHitOnceSet.add(worldKey);
        continue;
      }
    }

    if (opts.gamepadRumblePlayer && !scatterItemKeyIsPureGrassDecoration(hit.itemKey)) {
      if (isTreeHit && treeDamage > 0 && (hitSource === 'cut' || hitSource === 'tackle')) {
        tryPlayerGamepadRumbleForHit(opts, 'tree');
      } else if (!isTreeHit && st.hitsRemaining < hpBefore) {
        tryPlayerGamepadRumbleForHit(opts, isCrystalItemKey(hit.itemKey) ? 'crystal' : 'rock');
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
 * Collects tackle-style hits for an omnidirectional ground disk (Earthquake, etc.).
 * Uses circle–circle reach vs the old many-ray segment union (same rebake batching at call site).
 */
function collectDetailHitsInDisk(px, py, radiusTiles, data, opts) {
  const R = Math.max(0.08, Number(radiusTiles) || 0);
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const microWm = microW;
  const microHm = microH;
  const seed = data.seed ?? 0;
  const originMemo = new Map();
  const tileMemo = new Map();
  const getTileCached = (x, y) => {
    if (x < 0 || y < 0 || x >= microWm || y >= microHm) return null;
    const key = `${x},${y}`;
    if (tileMemo.has(key)) return tileMemo.get(key);
    const t = getMicroTile(x, y, data);
    tileMemo.set(key, t || null);
    return t || null;
  };
  /** @type {any[]} */
  const hits = [];
  const sweep = TACKLE_SWEEP_RADIUS_TILES;

  for (const sc of activeSpawnedSmallCrystals) {
    const detailR = Math.max(0.01, (sc.radius || 0.3) * TACKLE_DETAIL_HURTBOX_RADIUS_MULT);
    const rr = detailR + sweep;
    const dx = sc.x - px;
    const dy = sc.y - py;
    if (dx * dx + dy * dy > (R + rr) * (R + rr)) continue;
    const dist = Math.sqrt(dx * dx + dy * dy);
    hits.push({ type: 'spawnedSmall', id: sc.id, itemKey: sc.itemKey, x: sc.x, y: sc.y, t: dist / Math.max(0.001, R) });
  }

  const minOx = Math.max(0, Math.floor(px - R) - 8);
  const maxOx = Math.min(microW - 1, Math.ceil(px + R) + 2);
  const minOy = Math.max(0, Math.floor(py - R) - 5);
  const maxOy = Math.min(microH - 1, Math.ceil(py + R) + 2);

  for (let oy = minOy; oy <= maxOy; oy++) {
    for (let ox = minOx; ox <= maxOx; ox++) {
      if (isPlayScatterTreeOriginCharred(ox, oy)) {
        const spec = scatterTreeSpecAtOrigin(ox, oy, data, getTileCached, originMemo);
        if (spec) {
          const detailR = Math.max(0.01, spec.r * TREE_MOVE_HITBOX_RADIUS_MULT);
          const rr = detailR + sweep;
          const dx = spec.cx - px;
          const dy = spec.cy - py;
          if (dx * dx + dy * dy > (R + rr) * (R + rr)) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          hits.push({
            type: 'charredScatterTree',
            rootOx: ox,
            rootOy: oy,
            cx: spec.cx,
            cy: spec.cy,
            t: dist / Math.max(0.001, R)
          });
        }
      }
      const p = scatterPhysicsCircleAtOrigin(ox, oy, data, originMemo);
      if (isPlayDetailScatterOriginDestroyed(ox, oy)) continue;
      if (p) {
        const detailR = Math.max(0.01, p.radius * TACKLE_DETAIL_HURTBOX_RADIUS_MULT);
        const rr = detailR + sweep;
        const dx = p.cx - px;
        const dy = p.cy - py;
        if (dx * dx + dy * dy > (R + rr) * (R + rr)) continue;
        if (opts.excludePureGrassScatterHits && scatterItemKeyIsPureGrassDecoration(p.itemKey)) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        hits.push({
          type: 'worldDetail',
          rootOx: ox,
          rootOy: oy,
          itemKey: String(p.itemKey),
          cx: p.cx,
          cy: p.cy,
          t: dist / Math.max(0.001, R)
        });
        continue;
      }
      const charred = isPlayFormalTreeRootCharred(ox, oy);
      if (charred || (!isPlayFormalTreeRootDestroyed(ox, oy) && didFormalTreeSpawnAtRoot(ox, oy, data))) {
        const trunk = getFormalTreeTrunkCircle(ox, oy, data);
        const stump = trunk || (charred ? formalTreeStumpCircleAtRoot(ox, oy) : null);
        const target = trunk || stump;
        if (target) {
          const detailR = Math.max(0.01, target.r * TREE_MOVE_HITBOX_RADIUS_MULT);
          const rr = detailR + sweep;
          const dx = target.cx - px;
          const dy = target.cy - py;
          if (dx * dx + dy * dy > (R + rr) * (R + rr)) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          hits.push({
            type: 'formalTree',
            rootOx: ox,
            rootOy: oy,
            cx: target.cx,
            cy: target.cy,
            t: dist / Math.max(0.001, R)
          });
        }
      }

      const oTile = getTileCached(ox, oy);
      if (!oTile) continue;
      if (!validScatterOriginMicro(ox, oy, seed, microWm, microHm, getTileCached, originMemo)) {
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
      const rr = detailR + sweep;
      const dx = cx0 - px;
      const dy = cy0 - py;
      if (dx * dx + dy * dy > (R + rr) * (R + rr)) continue;
      if (opts.excludePureGrassScatterHits && scatterItemKeyIsPureGrassDecoration(itemKey)) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      hits.push({
        type: 'worldDetail',
        rootOx: ox,
        rootOy: oy,
        itemKey: String(itemKey),
        cx: cx0,
        cy: cy0,
        t: dist / Math.max(0.001, R)
      });
    }
  }
  return hits;
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
 *   hitSource?: 'tackle' | 'cut' | 'other',
 *   detailCharge01?: number | null,
 *   treeDemolishOneShot?: boolean,
 *   excludePureGrassScatterHits?: boolean,
 *   reusedConsumedWorld?: Set<string>,
 *   reusedConsumedSpawned?: Set<number>,
 *   originScanStepTiles?: number,
 *   gamepadRumblePlayer?: boolean
 * }} [opts]
 */
export function tryBreakDetailsAlongSegment(ax, ay, bx, by, data, opts = {}) {
  if (!data) return;
  const pz = Number(opts.pz) || 0;
  // If we are too high in the air, we can't tackle ground-level trees/rocks.
  if (Math.abs(pz) > 2.0) return;
  
  const nowSec = performance.now() * 0.001;
  const worldHitOnceSet = opts.worldHitOnceSet instanceof Set ? opts.worldHitOnceSet : null;
  const spawnedHitOnceSet = opts.spawnedHitOnceSet instanceof Set ? opts.spawnedHitOnceSet : null;
  const px = Number(ax);
  const py = Number(ay);
  const ex = Number(bx);
  const ey = Number(by);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(ex) || !Number.isFinite(ey)) return;
  const segLen = Math.hypot(ex - px, ey - py);
  if (!Number.isFinite(segLen) || segLen <= 1e-6) return;
  beginChunkRebakeBatch();
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  /** @type {Array<any>} */
  const hits = [];
  const stepTiles =
    Number.isFinite(opts.originScanStepTiles) && opts.originScanStepTiles > 0.08
      ? opts.originScanStepTiles
      : TACKLE_ORIGIN_SCAN_STEP_TILES;
  const steps = Math.max(2, Math.ceil(segLen / stepTiles));
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
            // Trees share a single "move hitbox" multiplier across Cut / fire / lightning.
            const detailR = Math.max(0.01, spec.r * TREE_MOVE_HITBOX_RADIUS_MULT);
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
          if (opts.excludePureGrassScatterHits && scatterItemKeyIsPureGrassDecoration(p.itemKey)) continue;
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
            // Trees share a single "move hitbox" multiplier across Cut / fire / lightning.
            const detailR = Math.max(0.01, target.r * TREE_MOVE_HITBOX_RADIUS_MULT);
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
        if (opts.excludePureGrassScatterHits && scatterItemKeyIsPureGrassDecoration(itemKey)) continue;
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
  if (hits.length === 0) {
    endChunkRebakeBatch();
    return;
  }
  hits.sort((a, b) => a.t - b.t);
  const consumedSpawned =
    opts.reusedConsumedSpawned instanceof Set ? opts.reusedConsumedSpawned : new Set();
  const consumedWorld = opts.reusedConsumedWorld instanceof Set ? opts.reusedConsumedWorld : new Set();

  applySortedDetailHits(hits, data, opts, nowSec, consumedWorld, consumedSpawned);
  endChunkRebakeBatch();
}

/**
 * Circular ground shock: single bbox pass over the disk (vs dozens of tackle sweeps) so large
 * Earthquakes do not hitch the main thread. Shares one chunk-rebake batch with apply pass.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} radiusTiles
 * @param {object | null | undefined} data
 * @param {Parameters<typeof tryBreakDetailsAlongSegment>[5]} [opts]
 */
export function tryBreakDetailsInCircle(cx, cy, radiusTiles, data, opts = {}) {
  if (!data) return;
  const px = Number(cx);
  const py = Number(cy);
  const R = Math.max(0.08, Number(radiusTiles) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(R)) return;
  const pz = Number(opts.pz) || 0;
  if (Math.abs(pz) > 2.0) return;
  const consumedWorld = new Set();
  const consumedSpawned = new Set();
  beginChunkRebakeBatch();
  try {
    const hits = collectDetailHitsInDisk(px, py, R, data, opts);
    if (hits.length === 0) return;
    hits.sort((a, b) => a.t - b.t);
    const nowSec = performance.now() * 0.001;
    applySortedDetailHits(hits, data, opts, nowSec, consumedWorld, consumedSpawned);
  } finally {
    endChunkRebakeBatch();
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
  beginChunkRebakeBatch();
  pruneTreeTopFalls(performance.now() * 0.001);
  tickTreeFireSpreadToNeighbors(dt, data);
  if (burningFormalTreeEndsAtSecByRoot.size > 0) {
    const nowSec = performance.now() * 0.001;
    // Rain-scaled snuff: weak rain drags the burn out, strong rain snuffs almost instantly.
    // Returns Infinity when rain is below the extinguish threshold (no dampening at all).
    const rainSnuffSec = getRainFireSnuffSeconds();
    const rainSnuffing = Number.isFinite(rainSnuffSec);
    for (const [key, burnEnd] of burningFormalTreeEndsAtSecByRoot.entries()) {
      if (!Number.isFinite(burnEnd)) {
        burningFormalTreeEndsAtSecByRoot.delete(key);
        formalTreeFireSpreadDepthByRoot.delete(key);
        continue;
      }
      // Rain puts out trees once they've been burning long enough for the current rain
      // intensity, sparing them from becoming burned stumps.
      if (rainSnuffing) {
        const startedSec = burnEnd - FORMAL_TREE_BURNING_VISUAL_SEC;
        if (nowSec - startedSec >= rainSnuffSec) {
          burningFormalTreeEndsAtSecByRoot.delete(key);
          formalTreeBurnMeterByRoot.delete(key);
          formalTreeFireSpreadDepthByRoot.delete(key);
          continue;
        }
      }
      if (nowSec < burnEnd) continue;
      const [sx, sy] = key.split(',');
      const rootX = Number(sx);
      const my = Number(sy);
      if (!Number.isFinite(rootX) || !Number.isFinite(my)) {
        burningFormalTreeEndsAtSecByRoot.delete(key);
        formalTreeFireSpreadDepthByRoot.delete(key);
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
    const rainSnuffSec = getRainFireSnuffSeconds();
    const rainSnuffing = Number.isFinite(rainSnuffSec);
    for (const [key, burnEnd] of burningScatterTreeEndsAtSecByOrigin.entries()) {
      if (!Number.isFinite(burnEnd)) {
        burningScatterTreeEndsAtSecByOrigin.delete(key);
        scatterTreeFireSpreadDepthByOrigin.delete(key);
        continue;
      }
      if (rainSnuffing) {
        const startedSec = burnEnd - FORMAL_TREE_BURNING_VISUAL_SEC;
        if (nowSec - startedSec >= rainSnuffSec) {
          burningScatterTreeEndsAtSecByOrigin.delete(key);
          scatterTreeBurnMeterByOrigin.delete(key);
          scatterTreeFireSpreadDepthByOrigin.delete(key);
          continue;
        }
      }
      if (nowSec < burnEnd) continue;
      const [sx, sy] = key.split(',');
      const ox = Number(sx);
      const oy = Number(sy);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
        burningScatterTreeEndsAtSecByOrigin.delete(key);
        scatterTreeFireSpreadDepthByOrigin.delete(key);
        continue;
      }
      if (!markScatterTreeBurnedAndScheduleRegen(ox, oy, nowSec, data)) {
        burningScatterTreeEndsAtSecByOrigin.delete(key);
        scatterTreeFireSpreadDepthByOrigin.delete(key);
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
        formalTreeRegrowFadeStartSecByRoot.set(key, nowSec);
      }
    }
  }
  for (const [key, startSec] of [...formalTreeRegrowFadeStartSecByRoot.entries()]) {
    if (!Number.isFinite(startSec) || nowSec < startSec + VEG_REGROW_FADE_IN_SEC) continue;
    formalTreeRegrowFadeStartSecByRoot.delete(key);
    const [sx, sy] = key.split(',');
    const rootX = Number(sx);
    const my = Number(sy);
    if (Number.isFinite(rootX) && Number.isFinite(my)) {
      queuePlayChunkRebake(Math.floor(rootX / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
      queuePlayChunkRebake(Math.floor((rootX + 1) / PLAY_CHUNK_SIZE), Math.floor(my / PLAY_CHUNK_SIZE), true);
    }
  }
  for (const [key, rec] of [...scatterTreeRegrowFadeByOrigin.entries()]) {
    if (!rec || !Number.isFinite(rec.startSec) || nowSec < rec.startSec + VEG_REGROW_FADE_IN_SEC) continue;
    scatterTreeRegrowFadeByOrigin.delete(key);
    invalidateChunksOverlappingFootprint(rec.ox, rec.oy, rec.cols, rec.rows);
  }
  endChunkRebakeBatch();
}
