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
  strengthRelocateCarriedDetailNear
} from './play-crystal-tackle.js';

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

function countSpritesInObjectSet(objSet) {
  if (!objSet?.parts?.length) return 1;
  let n = 0;
  for (const part of objSet.parts) n += Array.isArray(part.ids) ? part.ids.length : 0;
  return Math.max(1, n);
}

function strengthPowerScoreForDex(dex) {
  const tier = maxWalkableCarryTierForDex(dex);
  const cfg = getPokemonConfig(dex);
  const h = Number(cfg?.heightTiles) || 1.2;
  return Math.max(1, tier + Math.min(1.2, h / 5.5));
}

function computeStrengthGrabDurationSec(dex, spriteCount, weightTier) {
  const sp = Math.max(1, spriteCount | 0);
  const power = strengthPowerScoreForDex(dex);
  const base = 0.24 + sp * 0.045;
  const weightMul = 0.85 + Math.max(1, weightTier | 0) * 0.22;
  return Math.max(0.18, Math.min(2.1, (base * weightMul) / (0.72 + power * 0.55)));
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
  const weightTier = computeCarryWeightTier(itemKey, cols, rows);
  const dex = Math.floor(Number(player?.dexId) || 0);
  const durationSec = computeStrengthGrabDurationSec(dex, countSpritesInObjectSet(objSet), weightTier);
  player._strengthGrabAction = {
    ox: cand.ox,
    oy: cand.oy,
    itemKey,
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    weightTier,
    durationSec,
    elapsedSec: 0,
    startX: Number(player.x) || 0,
    startY: Number(player.y) || 0,
    originCx: Number(p.cx) || cand.ox + 0.5,
    originCy: Number(p.cy) || cand.oy + 0.5,
    startedAtSec: nowSec
  };
  return true;
}

function finalizeStrengthGrab(player, data, nowSec, action) {
  if (!action || !data) return false;
  const liftState = tryStrengthLiftSolidScatterAt(action.ox, action.oy, data, nowSec);
  if (!liftState) return false;
  player._strengthCarry = {
    liftOx: action.ox,
    liftOy: action.oy,
    itemKey: action.itemKey,
    cols: Math.max(1, action.cols),
    rows: Math.max(1, action.rows),
    weightTier: action.weightTier,
    hitsRemaining: Math.max(1, Math.floor(Number(liftState.hitsRemaining) || 1)),
    hitsMax: Math.max(1, Math.floor(Number(liftState.hitsMax) || 1))
  };
  player._strengthCarryHitStreak = 0;
  return true;
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
        6,
        carry.hitsRemaining,
        carry.hitsMax
      )
    ) {
      player._strengthCarry = null;
      player._strengthCarryHitStreak = 0;
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
      12,
      carry.hitsRemaining,
      carry.hitsMax
    )
  ) {
    player._strengthCarry = null;
    player._strengthCarryHitStreak = 0;
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
      28,
      carry.hitsRemaining,
      carry.hitsMax
    )
  ) {
    player._strengthCarry = null;
    player._strengthCarryHitStreak = 0;
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
    player._strengthGrabAction = null;
    tryStrengthPlaceOrDrop(player, data, nowSec, false);
    return true;
  }
  if (player._strengthGrabAction) return true;
  return tryStrengthGrab(player, data, nowSec);
}

/**
 * Advances Strength grab-channel action (`E` hold-to-lift feel).
 * Cancels if player moves away / target becomes invalid.
 */
export function updateStrengthCarryInteraction(dt, player, data) {
  if (!player || !data) return;
  const action = player._strengthGrabAction;
  if (!action) return;
  if (player._strengthCarry) {
    player._strengthGrabAction = null;
    return;
  }
  if (player.jumping || player.digBurrowMode) {
    player._strengthGrabAction = null;
    return;
  }
  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  if (Math.hypot(px - action.startX, py - action.startY) > 0.38) {
    player._strengthGrabAction = null;
    return;
  }
  if (isPlayScatterTreeOriginCharred(action.ox, action.oy) || isPlayScatterTreeOriginBurning(action.ox, action.oy)) {
    player._strengthGrabAction = null;
    return;
  }
  const p = scatterPhysicsCircleAtOrigin(action.ox, action.oy, data);
  if (!p || String(p.itemKey) !== String(action.itemKey)) {
    player._strengthGrabAction = null;
    return;
  }
  if (!isScatterDetailLiftableRockAt(action.ox, action.oy, action.itemKey)) {
    player._strengthGrabAction = null;
    return;
  }
  action.elapsedSec = Math.min(action.durationSec, action.elapsedSec + Math.max(0, dt));
  if (action.elapsedSec + 1e-6 < action.durationSec) return;
  const nowSec = performance.now() * 0.001;
  finalizeStrengthGrab(player, data, nowSec, action);
  player._strengthGrabAction = null;
}

/**
 * Player got hit while interacting with Strength carry mechanics.
 * - Interrupts current lift initialization.
 * - While carrying, every hit adds stagger; at 3 hits, carried detail falls nearby and hurts the carrier.
 * @returns {number} extra self-damage from dropped detail (0 when none).
 */
export function onStrengthCarrierDamaged(player, data) {
  if (!player || !data) return 0;
  if (player._strengthGrabAction) {
    player._strengthGrabAction = null;
    return 0;
  }
  const carry = player._strengthCarry;
  if (!carry) return 0;
  const nextHits = Math.max(0, Number(player._strengthCarryHitStreak) || 0) + 1;
  player._strengthCarryHitStreak = nextHits;
  if (nextHits < 3) return 0;
  const nowSec = performance.now() * 0.001;
  const px = (Number(player.x) || 0) + 0.5;
  const py = (Number(player.y) || 0) + 0.5;
  let placed = strengthRelocateCarriedDetailNear(
    carry.liftOx,
    carry.liftOy,
    px,
    py,
    carry.itemKey,
    carry.cols,
    carry.rows,
    data,
    nowSec,
    12,
    carry.hitsRemaining,
    carry.hitsMax
  );
  if (!placed) {
    placed = strengthRelocateCarriedDetailNear(
      carry.liftOx,
      carry.liftOy,
      px,
      py,
      carry.itemKey,
      carry.cols,
      carry.rows,
      data,
      nowSec,
      28,
      carry.hitsRemaining,
      carry.hitsMax
    );
  }
  if (!placed) {
    strengthRelocateCarriedDetailNear(
      carry.liftOx,
      carry.liftOy,
      px,
      py,
      carry.itemKey,
      carry.cols,
      carry.rows,
      data,
      nowSec,
      52,
      carry.hitsRemaining,
      carry.hitsMax
    );
  }
  player._strengthCarry = null;
  player._strengthCarryHitStreak = 0;
  return 7;
}
