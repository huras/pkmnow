/**
 * Flame Charge — player becomes a short rolling fire dash toward aim (comet trail).
 * Three charge tiers (same ladder as Fire Blast / Thunder on the 4-segment meter):
 *   - Tier 1: quick shoulder bash distance, modest speed, sparse trail.
 *   - Tier 2: longer dash, faster, denser trail + stronger melee along path.
 *   - Tier 3: longest comet run; extra forward "head" sparks + side wisps + wide end swipe.
 */

import { tryBreakDetailsAlongSegment } from '../main/play-crystal-tackle.js';
import {
  tryPlayerFlameChargeHitWildAlongSegment,
  tryPlayerCutHitWildCircle
} from '../wild-pokemon/wild-player-interactions.js';
import { setPlayerFacingFromWorldAimDelta } from '../player.js';

/** @typedef {1 | 2 | 3} FlameChargeTier */

/** Cooldown after Flame Charge, by tier (matches charged mapping). */
export const PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL = Object.freeze({
  1: 0.58,
  2: 0.78,
  3: 0.98
});

/**
 * @param {number} n
 * @returns {FlameChargeTier}
 */
export function clampFlameChargeTier(n) {
  const v = Math.floor(Number(n) || 1);
  if (v <= 1) return 1;
  if (v >= 3) return 3;
  return 2;
}

/**
 * @type {Record<FlameChargeTier, {
 *   dashSec: number,
 *   speedTilesPerSec: number,
 *   trailInterval: number,
 *   wildDamage: number,
 *   wildKnockback: number,
 *   detailCharge01: number,
 *   headBurstEverySec: number
 * }>}
 */
const FLAME_CHARGE_TIER = {
  1: {
    dashSec: 0.26,
    speedTilesPerSec: 5.6,
    trailInterval: 0.038,
    wildDamage: 11,
    wildKnockback: 3.35,
    detailCharge01: 0.22,
    headBurstEverySec: 0
  },
  2: {
    dashSec: 0.4,
    speedTilesPerSec: 7.4,
    trailInterval: 0.026,
    wildDamage: 17,
    wildKnockback: 4.05,
    detailCharge01: 0.42,
    headBurstEverySec: 0
  },
  3: {
    dashSec: 0.56,
    speedTilesPerSec: 9.1,
    trailInterval: 0.018,
    wildDamage: 24,
    wildKnockback: 4.85,
    detailCharge01: 0.62,
    headBurstEverySec: 0.07
  }
};

/**
 * @param {object | null} p
 * @param {FlameChargeTier} tier
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} targetX
 * @param {number} targetY
 * @returns {boolean}
 */
export function beginPlayerFlameCharge(p, tier, sourceX, sourceY, targetX, targetY) {
  if (!p || !p.grounded) return false;
  if ((p.flameChargeDashSec || 0) > 1e-5) return false;
  const t = clampFlameChargeTier(tier);
  const cfg = FLAME_CHARGE_TIER[t];
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-4) return false;
  const nx = dx / len;
  const ny = dy / len;
  p.flameChargeDashSec = cfg.dashSec;
  p.flameChargeTier = t;
  p.flameChargeNx = nx;
  p.flameChargeNy = ny;
  p.flameChargeSpeedCapTilesPerSec = cfg.speedTilesPerSec;
  p.flameChargeTrailAcc = 0;
  p.flameChargeHeadAcc = 0;
  p._flameChargeSegPrevX = Number(p.x) || 0;
  p._flameChargeSegPrevY = Number(p.y) || 0;
  p.tackleDirNx = nx;
  p.tackleDirNy = ny;
  setPlayerFacingFromWorldAimDelta(p, nx, ny);
  const vis = Math.max(Number(p.moveShootAnimSec) || 0, cfg.dashSec + 0.12);
  p.moveShootAnimSec = vis;
  return true;
}

function pushFlameChargeTrail(pushParticle, x, y, z, tier, behindNx, behindNy) {
  const spread = tier === 3 ? 0.14 : tier === 2 ? 0.09 : 0.05;
  const a = Math.atan2(behindNy, behindNx) + (Math.random() - 0.5) * spread;
  const sp = 0.35 + Math.random() * (tier === 3 ? 1.1 : tier === 2 ? 0.85 : 0.55);
  const life = tier === 3 ? 0.38 + Math.random() * 0.14 : tier === 2 ? 0.32 + Math.random() * 0.1 : 0.26 + Math.random() * 0.08;
  pushParticle({
    type: 'flameChargeTrail',
    x: x + (Math.random() - 0.5) * 0.12,
    y: y + (Math.random() - 0.5) * 0.12,
    z: Math.max(0.04, z * 0.85 + 0.02),
    vx: Math.cos(a) * sp,
    vy: Math.sin(a) * sp,
    vz: 0.55 + Math.random() * 0.35,
    life,
    maxLife: life,
    tier
  });
}

function pushCometHeadBurst(pushParticle, hx, hy, hz, nx, ny, tier) {
  const n = tier === 3 ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const da = (Math.random() - 0.5) * 0.55 + (i / n - 0.5) * 0.35;
    const ang = Math.atan2(ny, nx) + da;
    const sp = 1.8 + Math.random() * 1.6;
    const life = 0.22 + Math.random() * 0.12;
    pushParticle({
      type: 'flameChargeHead',
      x: hx + nx * 0.15,
      y: hy + ny * 0.15,
      z: hz + 0.06,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      vz: 0.9 + Math.random() * 0.5,
      life,
      maxLife: life,
      tier
    });
  }
}

/**
 * Per-frame while the dash is active: segment hits, map details, comet trail, tier-3 extras.
 * Call from `updateMoves` after the player step (so `player.x/y` are current).
 *
 * @param {import('../player.js').player} player
 * @param {number} dt
 * @param {object | null} data
 * @param {(p: object) => void} pushParticle
 */
export function tickPlayerFlameChargeDash(player, dt, data, pushParticle) {
  if (!player || (player.flameChargeDashSec || 0) <= 1e-5) return;
  const tier = clampFlameChargeTier(Number(player.flameChargeTier) || 1);
  const cfg = FLAME_CHARGE_TIER[tier];
  const ax = Number(player._flameChargeSegPrevX);
  const ay = Number(player._flameChargeSegPrevY);
  const bx = Number(player.x) || 0;
  const by = Number(player.y) || 0;
  const pz = Number(player.z) || 0;
  const nx = Number(player.flameChargeNx) || 0;
  const ny = Number(player.flameChargeNy) || 1;

  const segLen = Math.hypot(bx - ax, by - ay);
  if (segLen > 0.02 && data) {
    tryPlayerFlameChargeHitWildAlongSegment(player, data, ax, ay, bx, by, {
      damage: cfg.wildDamage,
      knockback: cfg.wildKnockback
    });
    tryBreakDetailsAlongSegment(ax, ay, bx, by, data, {
      hitSource: 'tackle',
      pz,
      detailCharge01: cfg.detailCharge01
    });
  }

  player.flameChargeTrailAcc = (player.flameChargeTrailAcc || 0) + dt;
  while ((player.flameChargeTrailAcc || 0) >= cfg.trailInterval) {
    player.flameChargeTrailAcc -= cfg.trailInterval;
    pushFlameChargeTrail(pushParticle, bx, by, pz, tier, -nx, -ny);
    if (tier === 3) {
      const ortho = Math.atan2(ny, nx) + Math.PI * 0.5;
      pushFlameChargeTrail(
        pushParticle,
        bx + Math.cos(ortho) * 0.22,
        by + Math.sin(ortho) * 0.22,
        pz,
        tier,
        -nx,
        -ny
      );
      pushFlameChargeTrail(
        pushParticle,
        bx - Math.cos(ortho) * 0.22,
        by - Math.sin(ortho) * 0.22,
        pz,
        tier,
        -nx,
        -ny
      );
    }
  }

  if (tier === 3 && cfg.headBurstEverySec > 0) {
    player.flameChargeHeadAcc = (player.flameChargeHeadAcc || 0) + dt;
    if (player.flameChargeHeadAcc >= cfg.headBurstEverySec) {
      player.flameChargeHeadAcc -= cfg.headBurstEverySec;
      pushCometHeadBurst(pushParticle, bx, by, pz, nx, ny, tier);
    }
  }

  player._flameChargeSegPrevX = bx;
  player._flameChargeSegPrevY = by;
  const remBefore = player.flameChargeDashSec || 0;
  player.flameChargeDashSec = Math.max(0, remBefore - dt);
  if (remBefore > 1e-5 && player.flameChargeDashSec <= 1e-5) {
    player.flameChargeDashSec = 0;
    if (tier === 3 && data) {
      tryPlayerCutHitWildCircle(player, data, bx, by, 1.05, {
        damage: 14,
        knockback: 4.2
      });
    }
  }
}
