/** Cooldown after player Fire Blast, by charge tier (matches `castFireBlastCharged` mapping). */
export const PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL = Object.freeze({
  1: 0.62,
  2: 0.84,
  3: 1.05
});

/**
 * Fire Blast — charge-tiered big fireball (3 takes, same ladder as Thunder on the 4-segment meter).
 *
 *   - **Tier 1 (tap / below first full bar):** compact blast, shorter reach, modest splash.
 *   - **Tier 2 (first bar filled):** classic “big” Fire Blast — wide core + meaty AoE.
 *   - **Tier 3 (second bar+):** main inferno plus **four angled companion bolts** in a loose ★
 *     so the read matches the classic move without spawning a second full collision pass on the same line.
 */

import {
  clampFloorAimToMaxRange,
  spawnAlongHypotTowardGround,
  velocityFromToGroundWithHorizontalRangeFrom
} from './projectile-ground-hypot.js';
import { EMBER_TRAIL_INTERVAL } from './move-constants.js';

/** @typedef {1 | 2 | 3} FireBlastTier */

/**
 * @param {number} n
 * @returns {FireBlastTier}
 */
export function clampFireBlastTier(n) {
  const v = Math.floor(Number(n) || 1);
  if (v <= 1) return 1;
  if (v >= 3) return 3;
  return 2;
}

/**
 * @type {Record<FireBlastTier, {
 *   maxR: number,
 *   radius: number,
 *   damage: number,
 *   splashDamage: number,
 *   splashRadius: number,
 *   gravity: number,
 *   trailIntervalMul: number,
 *   burstShards: number
 * }>}
 */
const FIRE_BLAST_TIER = {
  1: {
    maxR: 9.35,
    radius: 0.54,
    damage: 22,
    splashDamage: 5.4,
    splashRadius: 1.32,
    gravity: 12.0,
    trailIntervalMul: 1.02,
    burstShards: 12
  },
  2: {
    maxR: 11.35,
    radius: 0.76,
    damage: 36,
    splashDamage: 9.2,
    splashRadius: 1.92,
    gravity: 12.6,
    trailIntervalMul: 0.55,
    burstShards: 20
  },
  3: {
    maxR: 13.2,
    radius: 0.98,
    damage: 52,
    splashDamage: 14,
    splashRadius: 2.65,
    gravity: 13.1,
    trailIntervalMul: 0.38,
    burstShards: 30
  }
};

function pushOneFireBlastCore(
  pushProjectile,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceEntity,
  fromWild,
  tier,
  maxRMul = 1
) {
  const cfg = FIRE_BLAST_TIER[tier];
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const maxR = fromWild ? Math.min(9.6, cfg.maxR * maxRMul) : cfg.maxR * maxRMul;
  const { aimX, aimY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const maxHorizForTtl = Math.max(0.15, Math.min(maxR, dist0));
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.36);
  const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
    sp.startX,
    sp.startY,
    sp.startZ,
    aimX,
    aimY,
    sourceX,
    sourceY,
    cfg.gravity,
    maxHorizForTtl,
    { ttlMargin: 1.07, ttlPad: 0.08 }
  );
  pushProjectile({
    type: 'fireBlastCore',
    blastTier: tier,
    x: sp.startX,
    y: sp.startY,
    vx,
    vy,
    vz,
    z: sp.startZ,
    radius: cfg.radius,
    timeToLive,
    damage: fromWild ? cfg.damage * 0.72 : cfg.damage,
    splashDamage: fromWild ? cfg.splashDamage * 0.7 : cfg.splashDamage,
    splashRadius: cfg.splashRadius,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: EMBER_TRAIL_INTERVAL,
    trailIntervalMul: cfg.trailIntervalMul,
    fireBlastBurstShards: cfg.burstShards
  });
}

/**
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} targetX
 * @param {number} targetY
 * @param {object | null} sourceEntity
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void, tier?: FireBlastTier }} opts
 */
export function castFireBlast(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const tier = clampFireBlastTier(opts.tier ?? 2);

  pushOneFireBlastCore(pushProjectile, sourceX, sourceY, targetX, targetY, sourceEntity, fromWild, tier, 1);

  if (!fromWild && tier === 3) {
    const base = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, FIRE_BLAST_TIER[3].maxR);
    const ang = Math.atan2(base.aimY - sourceY, base.aimX - sourceX);
    const reach = Math.min(FIRE_BLAST_TIER[3].maxR * 0.92, Math.hypot(base.aimX - sourceX, base.aimY - sourceY) + 0.01);
    const hubX = sourceX + Math.cos(ang) * reach * 0.88;
    const hubY = sourceY + Math.sin(ang) * reach * 0.88;
    const spreads = [0.52, -0.52, 0.28, -0.28];
    for (const da of spreads) {
      const tx = hubX + Math.cos(ang + da) * 1.1;
      const ty = hubY + Math.sin(ang + da) * 1.1;
      // Companion jets: same family read as the big hit, but lighter stats so total DPS stays fair.
      pushOneFireBlastCore(pushProjectile, sourceX, sourceY, tx, ty, sourceEntity, fromWild, 1, 0.58);
    }
  }
}
