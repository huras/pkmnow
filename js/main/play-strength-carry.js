import { MACRO_TILE_STRIDE } from '../chunking.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { parseShape } from '../tessellation-logic.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { scatterPhysicsCircleAtOrigin } from '../walkability.js';
import { scatterItemKeyIsTree } from '../scatter-pass2-debug.js';
import {
  isPlayScatterTreeOriginBurning,
  isPlayScatterTreeOriginCharred,
  isScatterDetailLiftableRockAt,
  tryStrengthLiftSolidScatterAt,
  strengthRelocateCarriedDetail,
  strengthRelocateCarriedDetailNear
} from './play-crystal-tackle.js';
import { getWildPokemonEntities, applyPlayerTackleEffectOnWildFromPoint } from '../wild-pokemon/wild-pokemon-manager.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles,
  projectileZInPokemonHurtbox
} from '../pokemon/pokemon-combat-hurtbox.js';
import { playCrystalClinkSfx } from '../audio/crystal-clink-sfx.js';

function strengthRockItemKeyAllowed(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  if (scatterItemKeyIsTree(itemKey)) return false;
  if (k.includes('crystal')) return true;
  return /boulder|rock|stone|geode|stalag|stalagmite|gravel|ore/i.test(k);
}

function maxWalkableCarryTierForDex(dex) {
  if (dex === 143) return 3;
  const cfg = getPokemonConfig(dex);
  if (!cfg) return 1;
  let t = 1;
  if (cfg.heightTiles >= 5.5) t = 3;
  else if (cfg.heightTiles >= 3.4) t = 2;
  const types = cfg.types || [];
  if (types.includes('fighting') || types.includes('ground')) t = Math.min(3, t + 1);
  if (types.includes('rock')) t = Math.min(3, t + 1);
  return t;
}

function computeCarryWeightTier(itemKey, cols, rows) {
  const k = String(itemKey || '').toLowerCase();
  const area = Math.max(1, cols * rows);
  if ((k.includes('crystal') && area >= 4) || area >= 5) return 3;
  if (area >= 2 || k.includes('crystal')) return 2;
  return 1;
}

export function strengthCarryBlocksWalk(player) {
  const c = player?._strengthCarry;
  if (!c) return false;
  const dex = Math.floor(Number(player?.dexId) || 0);
  return c.weightTier > maxWalkableCarryTierForDex(dex);
}

function findBestStrengthGrabOrigin(player, data) {
  if (!player || !data) return null;
  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const nLen = Math.hypot(nx, ny);
  const fx = nLen > 1e-4 ? nx / nLen : 0;
  const fy = nLen > 1e-4 ? ny / nLen : 1;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const R = 3;
  const originMemo = new Map();
  let bestOx = null;
  let bestOy = null;
  let bestScore = -Infinity;
  for (let oy = iy - R; oy <= iy + R; oy++) {
    for (let ox = ix - R; ox <= ix + R; ox++) {
      if (isPlayScatterTreeOriginCharred(ox, oy) || isPlayScatterTreeOriginBurning(ox, oy)) continue;
      const p = scatterPhysicsCircleAtOrigin(ox, oy, data, originMemo);
      if (!p || scatterItemKeyIsTree(String(p.itemKey))) continue;
      const itemKey = String(p.itemKey);
      if (!strengthRockItemKeyAllowed(itemKey)) continue;
      if (!isScatterDetailLiftableRockAt(ox, oy, itemKey)) continue;
      const ddx = p.cx - (px + 0.5);
      const ddy = p.cy - (py + 0.5);
      const dist2 = ddx * ddx + ddy * ddy;
      if (dist2 > 2.85 * 2.85) continue;
      const toward = ddx * fx + ddy * fy;
      const score = toward - dist2 * 0.045;
      if (score > bestScore) {
        bestScore = score;
        bestOx = ox;
        bestOy = oy;
      }
    }
  }
  if (bestOx == null || bestOy == null) return null;
  return { ox: bestOx, oy: bestOy };
}

function tryStrengthGrab(player, data, nowSec) {
  const cand = findBestStrengthGrabOrigin(player, data);
  if (!cand) return false;
  const p = scatterPhysicsCircleAtOrigin(cand.ox, cand.oy, data);
  if (!p) return false;
  const itemKey = String(p.itemKey);
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return false;
  const { cols, rows } = parseShape(objSet.shape || '[1x1]');
  if (!tryStrengthLiftSolidScatterAt(cand.ox, cand.oy, data, nowSec)) return false;
  const weightTier = computeCarryWeightTier(itemKey, cols, rows);
  player._strengthCarry = {
    liftOx: cand.ox,
    liftOy: cand.oy,
    itemKey,
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    weightTier
  };
  return true;
}

/** Match padding used in wild `tryPlayerTackleHitWild` sweep test. */
const THROW_WILD_SWEEP_PAD = 0.34;
const THROW_SPEED_TILES = 11.2;
const THROW_VZ0 = 5.65;
const THROW_Z_GRAV = 13.5;
const THROW_H_DRAG = 1.22;
const THROW_MAX_AGE_SEC = 3.15;
/** Ground slide after landing before the rock is written back into scatter. */
const THROW_ROLL_DRAG = 7.4;
const THROW_ROLL_STOP_SPEED = 0.12;
const THROW_ROLL_MAX_SEC = 2.05;

/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   z: number,
 *   vx: number,
 *   vy: number,
 *   vz: number,
 *   liftOx: number,
 *   liftOy: number,
 *   itemKey: string,
 *   cols: number,
 *   rows: number,
 *   age: number,
 *   phase: 'air' | 'roll',
 *   rollAge: number
 * }} StrengthThrowState
 */

/** @type {StrengthThrowState[]} */
const activeStrengthThrows = [];

const PREVIEW_DT = 1 / 90;

/**
 * Tile-space arc samples for aim UI (matches {@link beginStrengthThrowFromPointer} launch).
 * @param {import('../player.js').player | null | undefined} player
 * @param {object} data
 * @param {number} aimTx
 * @param {number} aimTy
 * @returns {{ points: Array<{ x: number, y: number, z: number }>, landX: number, landY: number } | null}
 */
export function sampleStrengthThrowAimArc(player, data, aimTx, aimTy) {
  if (!player || !data) return null;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const sx = (player.visualX ?? player.x) + 0.5;
  const sy = (player.visualY ?? player.y) + 0.5;
  const dx = Number(aimTx) - sx;
  const dy = Number(aimTy) - sy;
  const len = Math.hypot(dx, dy) || 1;
  let vx = (dx / len) * THROW_SPEED_TILES;
  let vy = (dy / len) * THROW_SPEED_TILES;
  let vz = THROW_VZ0;
  let x = sx;
  let y = sy;
  let z = 0.26;
  /** @type {Array<{ x: number, y: number, z: number }>} */
  const points = [{ x, y, z }];
  let phase = /** @type {'air' | 'roll'} */ ('air');
  let rollAge = 0;
  let t = 0;
  while (t < THROW_MAX_AGE_SEC + THROW_ROLL_MAX_SEC + 0.25) {
    t += PREVIEW_DT;
    if (phase === 'air') {
      const prevZ = z;
      const drag = Math.exp(-THROW_H_DRAG * PREVIEW_DT);
      vx *= drag;
      vy *= drag;
      vz -= THROW_Z_GRAV * PREVIEW_DT;
      x += vx * PREVIEW_DT;
      y += vy * PREVIEW_DT;
      z += vz * PREVIEW_DT;
      points.push({ x, y, z });
      const landed = t > 0.05 && z <= 0.02 && vz <= 0.15;
      const tunnel = prevZ > 0.04 && z < -0.08;
      if (landed || tunnel) {
        z = 0;
        vz = 0;
        phase = 'roll';
      }
    } else {
      rollAge += PREVIEW_DT;
      const rDrag = Math.exp(-THROW_ROLL_DRAG * PREVIEW_DT);
      vx *= rDrag;
      vy *= rDrag;
      x += vx * PREVIEW_DT;
      y += vy * PREVIEW_DT;
      z = 0;
      points.push({ x, y, z });
      const sp = Math.hypot(vx, vy);
      if (sp < THROW_ROLL_STOP_SPEED || rollAge > THROW_ROLL_MAX_SEC) break;
    }
    if (
      phase === 'air' &&
      (t > THROW_MAX_AGE_SEC || x < -2 || y < -2 || x > microW + 2 || y > microH + 2)
    ) {
      break;
    }
  }
  const lx = Math.max(0.5, Math.min(microW - 0.5, x));
  const ly = Math.max(0.5, Math.min(microH - 0.5, y));
  return { points, landX: lx, landY: ly };
}

function distPointSegmentSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  let t = abLen2 > 1e-8 ? (apx * abx + apy * aby) / abLen2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

function segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
  return distPointSegmentSq(cx, cy, ax, ay, bx, by) <= r * r;
}

function removeStrengthThrow(t) {
  const i = activeStrengthThrows.indexOf(t);
  if (i >= 0) activeStrengthThrows.splice(i, 1);
}

function finalizeStrengthThrowLand(t, data, landX, landY) {
  removeStrengthThrow(t);
  if (!data) return;
  const nowSec = performance.now() * 0.001;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const lx = Math.max(0.5, Math.min(microW - 0.5, landX));
  const ly = Math.max(0.5, Math.min(microH - 0.5, landY));
  if (
    !strengthRelocateCarriedDetailNear(
      t.liftOx,
      t.liftOy,
      lx,
      ly,
      t.itemKey,
      t.cols,
      t.rows,
      data,
      nowSec,
      12
    )
  ) {
    strengthRelocateCarriedDetailNear(
      t.liftOx,
      t.liftOy,
      lx,
      ly,
      t.itemKey,
      t.cols,
      t.rows,
      data,
      nowSec,
      32
    );
  }
}

function tryStrengthPlaceOrDrop(player, data, nowSec, charged) {
  const carry = player._strengthCarry;
  if (!carry) return false;
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const nLen = Math.hypot(nx, ny);
  const fx = nLen > 1e-4 ? nx / nLen : 0;
  const fy = nLen > 1e-4 ? ny / nLen : 1;
  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  const mul = charged ? 1.45 : 1;
  const dists = [1.05 * mul, 1.55 * mul, 2.05 * mul, 2.55 * mul];
  for (const d of dists) {
    const tx = px + fx * d;
    const ty = py + fy * d;
    if (
      strengthRelocateCarriedDetailNear(
        carry.liftOx,
        carry.liftOy,
        tx,
        ty,
        carry.itemKey,
        carry.cols,
        carry.rows,
        data,
        nowSec,
        6
      )
    ) {
      player._strengthCarry = null;
      return true;
    }
  }
  if (
    strengthRelocateCarriedDetailNear(
      carry.liftOx,
      carry.liftOy,
      px + 0.5,
      py + 0.5,
      carry.itemKey,
      carry.cols,
      carry.rows,
      data,
      nowSec,
      12
    )
  ) {
    player._strengthCarry = null;
    return true;
  }
  if (
    strengthRelocateCarriedDetailNear(
      carry.liftOx,
      carry.liftOy,
      px + 0.5,
      py + 0.5,
      carry.itemKey,
      carry.cols,
      carry.rows,
      data,
      nowSec,
      28
    )
  ) {
    player._strengthCarry = null;
    return true;
  }
  return false;
}

/**
 * Play key `E`: grab a nearby liftable rock, or place / drop when already carrying.
 * @returns {boolean} true if grab succeeded or a carry was cleared (place/drop)
 */
export function tryStrengthInteractKeyE(player, data) {
  if (!player || !data) return false;
  const nowSec = performance.now() * 0.001;
  if (player._strengthCarry) {
    tryStrengthPlaceOrDrop(player, data, nowSec, false);
    return true;
  }
  return tryStrengthGrab(player, data, nowSec);
}

/**
 * LMB release while carrying: throw toward cursor with a short arc; clears carry.
 * @returns {boolean} true if a throw was started
 */
export function beginStrengthThrowFromPointer(player, data, aimTx, aimTy) {
  if (!player?._strengthCarry || !data) return false;
  const carry = player._strengthCarry;
  const sx = (player.visualX ?? player.x) + 0.5;
  const sy = (player.visualY ?? player.y) + 0.5;
  const dx = Number(aimTx) - sx;
  const dy = Number(aimTy) - sy;
  const len = Math.hypot(dx, dy) || 1;
  activeStrengthThrows.push({
    x: sx,
    y: sy,
    z: 0.26,
    vx: (dx / len) * THROW_SPEED_TILES,
    vy: (dy / len) * THROW_SPEED_TILES,
    vz: THROW_VZ0,
    liftOx: carry.liftOx,
    liftOy: carry.liftOy,
    itemKey: carry.itemKey,
    cols: carry.cols,
    rows: carry.rows,
    age: 0,
    phase: 'air',
    rollAge: 0
  });
  if (String(carry.itemKey || '').toLowerCase().includes('crystal')) {
    playCrystalClinkSfx({ x: sx, y: sy });
  }
  player._strengthCarry = null;
  return true;
}

/**
 * @param {number} dt
 * @param {object | null | undefined} data
 */
export function updateStrengthThrows(dt, data) {
  if (!data || activeStrengthThrows.length === 0) return;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const airDrag = Math.exp(-THROW_H_DRAG * dt);
  const rollDrag = Math.exp(-THROW_ROLL_DRAG * dt);
  for (let i = activeStrengthThrows.length - 1; i >= 0; i--) {
    const t = activeStrengthThrows[i];
    t.age += dt;
    const prevX = t.x;
    const prevY = t.y;
    const prevZ = t.z;

    if (t.phase === 'roll') {
      t.rollAge += dt;
      t.vx *= rollDrag;
      t.vy *= rollDrag;
      t.vz = 0;
      t.z = 0;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
    } else {
      t.vx *= airDrag;
      t.vy *= airDrag;
      t.vz -= THROW_Z_GRAV * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.z += t.vz * dt;
    }

    let hitEntity = null;
    let bestD2 = Infinity;
    for (const e of getWildPokemonEntities()) {
      if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
      const dex = e.dexId ?? 1;
      if (!projectileZInPokemonHurtbox(t.z, dex, e.z ?? 0)) continue;
      const { hx, hy } = getPokemonHurtboxCenterWorldXY(e.x, e.y, dex);
      const r = getPokemonHurtboxRadiusTiles(dex) + THROW_WILD_SWEEP_PAD;
      if (!segmentHitsCircle(prevX, prevY, t.x, t.y, hx, hy, r)) continue;
      const d2 = (t.x - hx) * (t.x - hx) + (t.y - hy) * (t.y - hy);
      if (d2 < bestD2) {
        bestD2 = d2;
        hitEntity = e;
      }
    }
    if (hitEntity) {
      applyPlayerTackleEffectOnWildFromPoint(hitEntity, t.x, t.y);
      finalizeStrengthThrowLand(t, data, hitEntity.x, hitEntity.y);
      continue;
    }

    if (t.phase === 'roll') {
      const sp = Math.hypot(t.vx, t.vy);
      if (sp < THROW_ROLL_STOP_SPEED || t.rollAge > THROW_ROLL_MAX_SEC) {
        finalizeStrengthThrowLand(t, data, t.x, t.y);
        continue;
      }
      if (t.age > THROW_MAX_AGE_SEC + THROW_ROLL_MAX_SEC + 0.5 || t.x < -3 || t.y < -3 || t.x > microW + 3 || t.y > microH + 3) {
        finalizeStrengthThrowLand(t, data, t.x, t.y);
      }
      continue;
    }

    const airbornLongEnough = t.age > 0.05;
    if (airbornLongEnough && t.z <= 0.02 && t.vz <= 0.15) {
      t.z = 0;
      t.vz = 0;
      t.phase = 'roll';
      t.rollAge = 0;
      continue;
    }
    if (t.age > THROW_MAX_AGE_SEC || t.x < -3 || t.y < -3 || t.x > microW + 3 || t.y > microH + 3) {
      finalizeStrengthThrowLand(t, data, t.x, t.y);
    } else if (prevZ > 0.04 && t.z < -0.08) {
      t.z = 0;
      t.vz = 0;
      t.phase = 'roll';
      t.rollAge = 0;
    }
  }
}

/**
 * @param {Array<{ type?: string, sortY?: number }>} renderItems
 */
export function appendStrengthThrowRenderItems(renderItems) {
  for (const t of activeStrengthThrows) {
    renderItems.push({
      type: 'strengthThrowRock',
      sortY: t.y + 0.5,
      x: t.x,
      y: t.y,
      z: t.z,
      itemKey: t.itemKey,
      cols: t.cols,
      rows: t.rows
    });
  }
}
