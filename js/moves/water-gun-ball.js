/**
 * Water Gun — charged 3-tier ball: long-range arcing shot, pierces along path, impact splash.
 * Hydro Pump keeps the legacy stream droplets in {@link castHydroPump} (`zelda-ported-moves.js`).
 */

import {
  clampFloorAimToMaxRange,
  spawnAlongHypotTowardGround,
  velocityFromToGroundWithHorizontalRangeFrom
} from './projectile-ground-hypot.js';

/** @typedef {1 | 2 | 3} WaterGunTier */

const WG_TIER = {
  1: {
    maxRange: 24,
    speed: 15.2,
    radius: 0.46,
    damage: 5.2,
    splashR: 2.05,
    splashD: 2.2,
    rings: 2
  },
  2: {
    maxRange: 32,
    speed: 17,
    radius: 0.62,
    damage: 8.4,
    splashR: 2.85,
    splashD: 3.8,
    rings: 3
  },
  3: {
    maxRange: 42,
    speed: 18.8,
    radius: 0.82,
    damage: 12.5,
    splashR: 3.75,
    splashD: 5.4,
    rings: 4
  }
};

/**
 * Expanding wind-texture rings (additive, blue-tinted) at splash center.
 * @param {(p: object) => void} pushParticle
 */
export function spawnWaterGunImpactWaveParticles(pushParticle, x, y, z, tier) {
  const t = WG_TIER[Math.max(1, Math.min(3, tier))] || WG_TIER[2];
  const ringCount = t.rings;
  const maxLife = 0.5 + ringCount * 0.065;
  for (let r = 0; r < ringCount; r++) {
    pushParticle({
      type: 'waterGunWaveRing',
      x,
      y,
      z: z ?? 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: maxLife,
      maxLife,
      ringIndex: r,
      ringCount,
      wgTier: tier,
      rot0: Math.random() * Math.PI * 2,
      maxSpanTiles: 2.35 + tier * 1.05 + r * 0.42
    });
  }
}

/**
 * @param {{
 *   fromWild?: boolean,
 *   pushProjectile: (p: object) => void,
 *   waterGunTier?: number
 * }} opts
 */
export function castWaterGun(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile, waterGunTier = 2 } = opts;
  const tier = Math.max(1, Math.min(3, Math.floor(Number(waterGunTier)) || 2));
  const spec = WG_TIER[tier];
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.05;
  const maxR = fromWild ? Math.min(36, spec.maxRange) : spec.maxRange;
  const { aimX, aimY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.38);
  const maxHorizForTtl = Math.max(0.28, Math.min(maxR, dist0 + 0.65));
  const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
    sp.startX,
    sp.startY,
    sp.startZ,
    aimX,
    aimY,
    sourceX,
    sourceY,
    spec.speed,
    maxHorizForTtl,
    { ttlMargin: 1.05, ttlPad: 0.06 }
  );
  const dmg = fromWild ? spec.damage * 0.7 : spec.damage;
  const splashD = fromWild ? spec.splashD * 0.72 : spec.splashD;
  pushProjectile({
    type: 'waterGunBall',
    x: sp.startX,
    y: sp.startY,
    vx,
    vy,
    vz,
    z: sp.startZ,
    radius: spec.radius,
    timeToLive,
    damage: dmg,
    splashRadius: spec.splashR,
    splashDamage: splashD,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: 0,
    wgTier: tier,
    playerWgPierceDone: false,
    wgHitWild: new Set()
  });
}
