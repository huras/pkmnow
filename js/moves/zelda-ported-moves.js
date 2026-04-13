import {
  EMBER_TRAIL_INTERVAL,
  WATER_TRAIL_INTERVAL,
  PSY_TRAIL_INTERVAL,
  POWDER_TRAIL_INTERVAL,
  SILK_TRAIL_INTERVAL,
  LASER_TRAIL_INTERVAL
} from './move-constants.js';

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function resolveAim(sourceX, sourceY, targetX, targetY, maxRange) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return { aimX: sourceX + 1, aimY: sourceY, dirX: 1, dirY: 0, dist: 1 };
  const dirX = dx / dist;
  const dirY = dy / dist;
  if (dist <= maxRange) return { aimX: targetX, aimY: targetY, dirX, dirY, dist };
  return { aimX: sourceX + dirX * maxRange, aimY: sourceY + dirY * maxRange, dirX, dirY, dist: maxRange };
}

function pushLinearProjectile(pushProjectile, spec) {
  pushProjectile(spec);
}

/**
 * Zelda Ember counterpart exists in `ember-move.js`; this file ports the rest.
 * Every cast is adapted to this project's tile-based projectile format.
 */
export function castFlamethrower(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 8.5 : 10);
  const count = 11;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.26;
    const a = Math.atan2(aim.dirY, aim.dirX) + spread;
    const speed = 16 + Math.random() * 2;
    pushLinearProjectile(pushProjectile, {
      type: 'flamethrowerShot',
      x: sourceX + aim.dirX * 0.35,
      y: sourceY + aim.dirY * 0.35,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      z: sourceEntity?.z || 0,
      radius: 0.25,
      timeToLive: 0.52 + Math.random() * 0.18,
      damage: fromWild ? 3 : 4,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: EMBER_TRAIL_INTERVAL * (i / count)
    });
  }
}

export function castBubble(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 8 : 10);
  const baseA = Math.atan2(aim.dirY, aim.dirX);
  const count = 4;
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) * 0.5) * 0.12;
    const a = baseA + spread;
    pushLinearProjectile(pushProjectile, {
      type: 'bubbleShot',
      x: sourceX + aim.dirX * 0.35,
      y: sourceY + aim.dirY * 0.35,
      vx: Math.cos(a) * 9.8,
      vy: Math.sin(a) * 9.8,
      z: sourceEntity?.z || 0,
      radius: 0.3,
      timeToLive: 1.1,
      damage: fromWild ? 4 : 6,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: WATER_TRAIL_INTERVAL * (i / count)
    });
  }
}

export function castWaterGun(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 9 : 11);
  const count = 8;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.16;
    const a = Math.atan2(aim.dirY, aim.dirX) + spread;
    pushLinearProjectile(pushProjectile, {
      type: 'waterGunShot',
      x: sourceX + aim.dirX * 0.33,
      y: sourceY + aim.dirY * 0.33,
      vx: Math.cos(a) * 14.5,
      vy: Math.sin(a) * 14.5,
      z: (sourceEntity?.z || 0) + 0.04,
      radius: 0.25,
      timeToLive: 0.9,
      damage: fromWild ? 3 : 5,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: WATER_TRAIL_INTERVAL * (i / count)
    });
  }
}

export function castConfusion(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 8 : 10);
  pushLinearProjectile(pushProjectile, {
    type: 'confusionOrb',
    x: sourceX + aim.dirX * 0.4,
    y: sourceY + aim.dirY * 0.4,
    vx: aim.dirX * 8.2,
    vy: aim.dirY * 8.2,
    z: sourceEntity?.z || 0,
    radius: 0.34,
    timeToLive: 1.45,
    damage: fromWild ? 6 : 9,
    splashDamage: fromWild ? 2 : 3,
    splashRadius: 1.25,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: PSY_TRAIL_INTERVAL
  });
}

export function castPsybeam(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 11 : 13);
  pushLinearProjectile(pushProjectile, {
    type: 'psybeamShot',
    x: sourceX + aim.dirX * 0.44,
    y: sourceY + aim.dirY * 0.44,
    vx: aim.dirX * 18,
    vy: aim.dirY * 18,
    z: sourceEntity?.z || 0,
    radius: 0.3,
    timeToLive: 0.78,
    damage: fromWild ? 7 : 12,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: PSY_TRAIL_INTERVAL * 0.8
  });
}

export function castPrismaticLaser(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 12 : 15);
  const count = 12;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.08;
    const a = Math.atan2(aim.dirY, aim.dirX) + spread;
    pushLinearProjectile(pushProjectile, {
      type: 'prismaticShot',
      x: sourceX + aim.dirX * 0.42,
      y: sourceY + aim.dirY * 0.42,
      vx: Math.cos(a) * 20,
      vy: Math.sin(a) * 20,
      z: sourceEntity?.z || 0,
      radius: 0.24,
      timeToLive: 0.7,
      damage: fromWild ? 4 : 6,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: LASER_TRAIL_INTERVAL * (i / count)
    });
  }
}

export function castPoisonPowder(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 8 : 10);
  const count = 24;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 1.7;
    const tx = aim.aimX + Math.cos(ang) * rad;
    const ty = aim.aimY + Math.sin(ang) * rad;
    const dx = tx - sourceX;
    const dy = ty - sourceY;
    const dist = Math.hypot(dx, dy) || 1;
    pushLinearProjectile(pushProjectile, {
      type: 'poisonPowderShot',
      x: sourceX + aim.dirX * 0.35,
      y: sourceY + aim.dirY * 0.35,
      vx: (dx / dist) * 7.6,
      vy: (dy / dist) * 7.6,
      z: sourceEntity?.z || 0,
      radius: 0.34,
      timeToLive: 1.2,
      damage: fromWild ? 1.5 : 2.5,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      poisonChance: 0.1,
      trailAcc: POWDER_TRAIL_INTERVAL * (i / count)
    });
  }
}

export function castIncinerate(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 9 : 11);
  pushLinearProjectile(pushProjectile, {
    type: 'incinerateCore',
    x: sourceX + aim.dirX * 0.35,
    y: sourceY + aim.dirY * 0.35,
    vx: aim.dirX * 12.8,
    vy: aim.dirY * 12.8,
    z: sourceEntity?.z || 0,
    radius: 0.33,
    timeToLive: 0.95,
    damage: fromWild ? 6 : 9,
    splashDamage: fromWild ? 2 : 3.5,
    splashRadius: 1.3,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: EMBER_TRAIL_INTERVAL
  });
}

export function castSilkShoot(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, fromWild ? 8.5 : 10);
  const count = 9;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.18;
    const a = Math.atan2(aim.dirY, aim.dirX) + spread;
    pushLinearProjectile(pushProjectile, {
      type: 'silkShot',
      x: sourceX + aim.dirX * 0.34,
      y: sourceY + aim.dirY * 0.34,
      vx: Math.cos(a) * 12,
      vy: Math.sin(a) * 12,
      z: sourceEntity?.z || 0,
      radius: 0.27,
      timeToLive: 0.82,
      damage: fromWild ? 2 : 3,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      slowSec: 0.8,
      trailAcc: SILK_TRAIL_INTERVAL * (i / count)
    });
  }
}

export function castPoisonStingAlias(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { pushProjectile, fromWild = false } = opts;
  const aim = resolveAim(sourceX, sourceY, targetX, targetY, 11);
  pushProjectile({
    type: 'poisonSting',
    x: sourceX + aim.dirX * 0.4,
    y: sourceY + aim.dirY * 0.4,
    vx: aim.dirX * 14,
    vy: aim.dirY * 14,
    z: sourceEntity?.z || 0,
    radius: 0.28,
    timeToLive: 1.0,
    damage: fromWild ? 10 : 14,
    stingAngle: Math.atan2(aim.dirY, aim.dirX),
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: 99
  });
}

export function castPoisonStringTypo(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  // Alias intentionally kept for user typo compatibility: "PoisonString".
  castPoisonStingAlias(sourceX, sourceY, targetX, targetY, sourceEntity, opts);
}
