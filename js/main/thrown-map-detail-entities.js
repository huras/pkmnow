/**
 * In-flight map details (scatter props) that leave the static grid until they embed again.
 * Same lifecycle idea as wild Pokémon: simulate each frame, render as world entities, then despawn.
 * Currently only Strength-thrown rocks/crystals; `kind` leaves room for other airborne details.
 */

import { MACRO_TILE_STRIDE } from '../chunking.js';
import { strengthRelocateCarriedDetailNear } from './play-crystal-tackle.js';
import {
  getWildPokemonEntities,
  applyPlayerTackleEffectOnWildFromPoint,
  restoreCarriedFaintedWildNear
} from '../wild-pokemon/index.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles,
  projectileZInPokemonHurtbox
} from '../pokemon/pokemon-combat-hurtbox.js';
import { playCrystalClinkSfx } from '../audio/crystal-clink-sfx.js';
import { playRockSmashingSfx } from '../audio/rock-smashing-sfx.js';

/** @typedef {'strengthRock' | 'faintedWild'} ThrownMapDetailKind */

/**
 * @typedef {{
 *   id: number,
 *   kind: ThrownMapDetailKind,
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
 *   wildEntity: object | null,
 *   wildDexId: number,
 *   hitsRemaining: number,
 *   hitsMax: number,
 *   age: number,
 *   phase: 'air' | 'roll',
 *   rollAge: number
 * }} ThrownMapDetailEntity
 */

/** Match padding used in wild `tryPlayerTackleHitWild` sweep test. */
const THROW_WILD_SWEEP_PAD = 0.34;
/** Max horizontal speed (tiles/s) when aim is far — full-power throw. */
const THROW_SPEED_TILES = 11.2;
/** Min horizontal speed for a short lob (aim cursor close to the Pokémon). */
const THROW_SPEED_MIN = 2.05;
const THROW_AIM_CLOSE_TILES = 0.5;
const THROW_AIM_FAR_TILES = 5.4;
const THROW_POWER_FLOOR = 0.16;
const THROW_VZ0 = 5.65;
const THROW_Z_GRAV = 13.5;
const THROW_H_DRAG = 1.22;
const THROW_MAX_AGE_SEC = 3.15;
const THROW_ROLL_DRAG = 7.4;
const THROW_ROLL_STOP_SPEED = 0.12;
const THROW_ROLL_MAX_SEC = 2.05;
const THROW_ROLL_DRAG_FAINTED_WILD = 4.35;
const THROW_ROLL_STOP_SPEED_FAINTED_WILD = 0.055;
const THROW_ROLL_MAX_SEC_FAINTED_WILD = 3.25;

/** @type {ThrownMapDetailEntity[]} */
const activeThrownMapDetails = [];
let nextThrownMapDetailId = 1;

const PREVIEW_DT = 1 / 90;

/**
 * Clears all airborne / rolling map-detail props (new map / regenerate).
 */
export function resetThrownMapDetailEntities() {
  activeThrownMapDetails.length = 0;
  nextThrownMapDetailId = 1;
}

/**
 * Snapshot for gameplay systems (collision, AI, debug). Do not mutate entities in place.
 * @returns {ThrownMapDetailEntity[]}
 */
export function getThrownMapDetailEntities() {
  return activeThrownMapDetails.slice();
}

/**
 * @param {import('../player.js').player | null | undefined} player
 * @param {number} aimTx
 * @param {number} aimTy
 * @returns {{ sx: number, sy: number, vx: number, vy: number, vz: number }}
 */
function computeStrengthThrowLaunch(player, aimTx, aimTy) {
  const sx = (player.visualX ?? player.x) + 0.5;
  const sy = (player.visualY ?? player.y) + 0.5;
  const dx = Number(aimTx) - sx;
  const dy = Number(aimTy) - sy;
  const rawLen = Math.hypot(dx, dy);
  let ndx;
  let ndy;
  if (rawLen > 0.1) {
    ndx = dx / rawLen;
    ndy = dy / rawLen;
  } else {
    const fnx = Number(player.tackleDirNx) || 0;
    const fny = Number(player.tackleDirNy) || 1;
    const fl = Math.hypot(fnx, fny) || 1;
    ndx = fnx / fl;
    ndy = fny / fl;
  }
  const distForPower = rawLen > 0.1 ? rawLen : THROW_AIM_CLOSE_TILES * 0.65;
  const span = THROW_AIM_FAR_TILES - THROW_AIM_CLOSE_TILES;
  const tLin = span > 1e-6 ? (distForPower - THROW_AIM_CLOSE_TILES) / span : 0;
  const power = Math.min(1, Math.max(THROW_POWER_FLOOR, tLin));
  const speed = THROW_SPEED_MIN + power * (THROW_SPEED_TILES - THROW_SPEED_MIN);
  const vz = THROW_VZ0 * (0.52 + 0.48 * power);
  return { sx, sy, vx: ndx * speed, vy: ndy * speed, vz };
}

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
  const faintedCarry = player?._strengthCarry?.kind === 'faintedWild';
  const rollDragK = faintedCarry ? THROW_ROLL_DRAG_FAINTED_WILD : THROW_ROLL_DRAG;
  const rollStop = faintedCarry ? THROW_ROLL_STOP_SPEED_FAINTED_WILD : THROW_ROLL_STOP_SPEED;
  const rollMax = faintedCarry ? THROW_ROLL_MAX_SEC_FAINTED_WILD : THROW_ROLL_MAX_SEC;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const { sx, sy, vx: vx0, vy: vy0, vz: vz0 } = computeStrengthThrowLaunch(player, aimTx, aimTy);
  let vx = vx0;
  let vy = vy0;
  let vz = vz0;
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
      const rDrag = Math.exp(-rollDragK * PREVIEW_DT);
      vx *= rDrag;
      vy *= rDrag;
      x += vx * PREVIEW_DT;
      y += vy * PREVIEW_DT;
      z = 0;
      points.push({ x, y, z });
      const sp = Math.hypot(vx, vy);
      if (sp < rollStop || rollAge > rollMax) break;
    }
    if (phase === 'air' && (t > THROW_MAX_AGE_SEC || x < -2 || y < -2 || x > microW + 2 || y > microH + 2)) {
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
  let u = abLen2 > 1e-8 ? (apx * abx + apy * aby) / abLen2 : 0;
  u = Math.max(0, Math.min(1, u));
  const cx = ax + u * abx;
  const cy = ay + u * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

function segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
  return distPointSegmentSq(cx, cy, ax, ay, bx, by) <= r * r;
}

function removeThrownMapDetail(t) {
  const i = activeThrownMapDetails.indexOf(t);
  if (i >= 0) activeThrownMapDetails.splice(i, 1);
}

function finalizeStrengthRockLand(t, data, landX, landY) {
  removeThrownMapDetail(t);
  if (!data) return;
  const nowSec = performance.now() * 0.001;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const lx = Math.max(0.5, Math.min(microW - 0.5, landX));
  const ly = Math.max(0.5, Math.min(microH - 0.5, landY));
  if (t.kind === 'faintedWild') {
    if (t.wildEntity) restoreCarriedFaintedWildNear(t.wildEntity, lx, ly, data, 14);
    return;
  }
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
      12,
      t.hitsRemaining,
      t.hitsMax
    )
  ) {
    if (
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
        32,
        t.hitsRemaining,
        t.hitsMax
      )
    ) {
      return;
    }
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
      64,
      t.hitsRemaining,
      t.hitsMax
    );
  }
}

/**
 * LMB release while carrying: throw toward cursor with a short arc; clears carry.
 * @returns {boolean} true if a throw was started
 */
export function beginStrengthThrowFromPointer(player, data, aimTx, aimTy) {
  if (!player?._strengthCarry || !data) return false;
  const carry = player._strengthCarry;
  const { sx, sy, vx, vy, vz } = computeStrengthThrowLaunch(player, aimTx, aimTy);
  activeThrownMapDetails.push({
    id: nextThrownMapDetailId++,
    kind: carry.kind === 'faintedWild' ? 'faintedWild' : 'strengthRock',
    x: sx,
    y: sy,
    z: 0.26,
    vx,
    vy,
    vz,
    liftOx: carry.liftOx,
    liftOy: carry.liftOy,
    itemKey: carry.itemKey || '',
    cols: Math.max(1, Number(carry.cols) || 1),
    rows: Math.max(1, Number(carry.rows) || 1),
    wildEntity: carry.kind === 'faintedWild' ? (carry.wildEntity || null) : null,
    wildDexId: Math.max(1, Math.floor(Number(carry.wildDexId) || Number(carry.wildEntity?.dexId) || 1)),
    hitsRemaining: Math.max(1, Math.floor(Number(carry.hitsRemaining) || 1)),
    hitsMax: Math.max(1, Math.floor(Number(carry.hitsMax) || 1)),
    age: 0,
    phase: 'air',
    rollAge: 0
  });
  if (carry.kind !== 'faintedWild' && String(carry.itemKey || '').toLowerCase().includes('crystal')) {
    playCrystalClinkSfx({ x: sx, y: sy });
  }
  player._strengthCarry = null;
  player._strengthCarryHitStreak = 0;
  return true;
}

/**
 * @param {number} dt
 * @param {object | null | undefined} data
 */
export function updateThrownMapDetailEntities(dt, data) {
  if (!data || activeThrownMapDetails.length === 0) return;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const airDrag = Math.exp(-THROW_H_DRAG * dt);
  for (let i = activeThrownMapDetails.length - 1; i >= 0; i--) {
    const t = activeThrownMapDetails[i];
    const isFaintedWild = t.kind === 'faintedWild';
    const rollDrag = Math.exp(-(isFaintedWild ? THROW_ROLL_DRAG_FAINTED_WILD : THROW_ROLL_DRAG) * dt);
    const rollStopSpeed = isFaintedWild ? THROW_ROLL_STOP_SPEED_FAINTED_WILD : THROW_ROLL_STOP_SPEED;
    const rollMaxSec = isFaintedWild ? THROW_ROLL_MAX_SEC_FAINTED_WILD : THROW_ROLL_MAX_SEC;
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
      playRockSmashingSfx({ x: t.x, y: t.y, z: t.z });
      finalizeStrengthRockLand(t, data, hitEntity.x, hitEntity.y);
      continue;
    }

    if (t.phase === 'roll') {
      const sp = Math.hypot(t.vx, t.vy);
      if (sp < rollStopSpeed || t.rollAge > rollMaxSec) {
        finalizeStrengthRockLand(t, data, t.x, t.y);
        continue;
      }
      if (t.age > THROW_MAX_AGE_SEC + rollMaxSec + 0.5 || t.x < -3 || t.y < -3 || t.x > microW + 3 || t.y > microH + 3) {
        finalizeStrengthRockLand(t, data, t.x, t.y);
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
      finalizeStrengthRockLand(t, data, t.x, t.y);
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
  for (const t of activeThrownMapDetails) {
    if (t.kind === 'faintedWild') {
      renderItems.push({
        type: 'strengthThrowFaintedWild',
        sortY: t.y + 0.5,
        x: t.x,
        y: t.y,
        z: t.z,
        dexId: t.wildDexId,
        phase: t.phase,
        age: t.age,
        rollAge: t.rollAge
      });
    } else {
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
}
