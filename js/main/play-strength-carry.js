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
  strengthDropCarriedAsPickup
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
    const nox = Math.floor(tx);
    const noy = Math.floor(ty);
    if (
      strengthRelocateCarriedDetail(
        carry.liftOx,
        carry.liftOy,
        nox,
        noy,
        carry.itemKey,
        carry.cols,
        carry.rows,
        data,
        nowSec
      )
    ) {
      player._strengthCarry = null;
      return true;
    }
  }
  strengthDropCarriedAsPickup(
    carry.liftOx,
    carry.liftOy,
    carry.cols,
    carry.rows,
    carry.itemKey,
    px + 0.5,
    py + 0.5
  );
  player._strengthCarry = null;
  return true;
}

/**
 * LMB field skill when Strength is selected: grab nearby rock/crystal, or place / drop if already carrying.
 * @returns {boolean} true if a grab or place/drop was attempted (even if grab missed)
 */
export function tryStrengthFieldSkillPress(player, data, charged = false) {
  if (!player || !data) return false;
  const nowSec = performance.now() * 0.001;
  if (player._strengthCarry) {
    tryStrengthPlaceOrDrop(player, data, nowSec, charged);
    return true;
  }
  tryStrengthGrab(player, data, nowSec);
  return true;
}
