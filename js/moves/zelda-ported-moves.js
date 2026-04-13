import {
  EMBER_TRAIL_INTERVAL,
  WATER_TRAIL_INTERVAL,
  PSY_TRAIL_INTERVAL,
  POWDER_TRAIL_INTERVAL,
  SILK_TRAIL_INTERVAL,
  LASER_TRAIL_INTERVAL
} from './move-constants.js';
import {
  spawnAlongHypotTowardGround,
  velocityFromToGroundWithHorizontalRangeFrom
} from './projectile-ground-hypot.js';

function pushLinearProjectile(pushProjectile, spec) {
  pushProjectile(spec);
}

/**
 * Zelda Ember counterpart exists in `ember-move.js`; this file ports the rest.
 * Every cast is adapted to this project's tile-based projectile format.
 */
export function castFlamethrower(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const maxR = fromWild ? 8.5 : 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const count = 11;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.26;
    const a = Math.atan2(targetY - sourceY, targetX - sourceX) + spread;
    const speed = 16 + Math.random() * 2;
    const reach = 5.0;
    const rawTx = sourceX + Math.cos(a) * reach;
    const rawTy = sourceY + Math.sin(a) * reach;
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, rawTx, rawTy, 0.35);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      speed,
      maxR,
      { ttlMargin: 1.05, ttlPad: 0.1 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'flamethrowerShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.25,
      timeToLive,
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
  const maxR = fromWild ? 8 : 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const count = 4;
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) * 0.5) * 0.12;
    const a = Math.atan2(targetY - sourceY, targetX - sourceX) + spread;
    const reach = 3.6;
    const rawTx = sourceX + Math.cos(a) * reach;
    const rawTy = sourceY + Math.sin(a) * reach;
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, rawTx, rawTy, 0.35);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      9.8,
      maxR,
      { ttlMargin: 1.08, ttlPad: 0.08 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'bubbleShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.3,
      timeToLive,
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
  const maxR = fromWild ? 9 : 11;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.04;
  const count = 8;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.16;
    const a = Math.atan2(targetY - sourceY, targetX - sourceX) + spread;
    const reach = 4.8;
    const rawTx = sourceX + Math.cos(a) * reach;
    const rawTy = sourceY + Math.sin(a) * reach;
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, rawTx, rawTy, 0.33);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      14.5,
      maxR,
      { ttlMargin: 1.05, ttlPad: 0.08 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'waterGunShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.25,
      timeToLive,
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
  const maxR = fromWild ? 8 : 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, targetX, targetY, 0.4);
  const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
    sp.startX,
    sp.startY,
    sp.startZ,
    targetX,
    targetY,
    sourceX,
    sourceY,
    8.2,
    maxR,
    { ttlMargin: 1.12, ttlPad: 0.12 }
  );
  pushLinearProjectile(pushProjectile, {
    type: 'confusionOrb',
    x: sp.startX,
    y: sp.startY,
    vx,
    vy,
    vz,
    z: sp.startZ,
    radius: 0.34,
    timeToLive,
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
  const maxR = fromWild ? 11 : 13;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, targetX, targetY, 0.44);
  const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
    sp.startX,
    sp.startY,
    sp.startZ,
    targetX,
    targetY,
    sourceX,
    sourceY,
    18,
    maxR,
    { ttlMargin: 1.05, ttlPad: 0.06 }
  );
  pushLinearProjectile(pushProjectile, {
    type: 'psybeamShot',
    x: sp.startX,
    y: sp.startY,
    vx,
    vy,
    vz,
    z: sp.startZ,
    radius: 0.3,
    timeToLive,
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
  const maxR = fromWild ? 12 : 15;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const count = 12;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.08;
    const a = Math.atan2(targetY - sourceY, targetX - sourceX) + spread;
    const reach = 5.5;
    const rawTx = sourceX + Math.cos(a) * reach;
    const rawTy = sourceY + Math.sin(a) * reach;
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, rawTx, rawTy, 0.42);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      20,
      maxR,
      { ttlMargin: 1.02, ttlPad: 0.06 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'prismaticShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.24,
      timeToLive,
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
  const maxR = fromWild ? 8 : 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, targetX, targetY, 0.35);
  const count = 24;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 1.7;
    const rawTx = targetX + Math.cos(ang) * rad;
    const rawTy = targetY + Math.sin(ang) * rad;
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      7.6,
      maxR,
      { ttlMargin: 1.08, ttlPad: 0.1 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'poisonPowderShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.34,
      timeToLive,
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
  const maxR = fromWild ? 9 : 11;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, targetX, targetY, 0.35);
  const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
    sp.startX,
    sp.startY,
    sp.startZ,
    targetX,
    targetY,
    sourceX,
    sourceY,
    12.8,
    maxR,
    { ttlMargin: 1.06, ttlPad: 0.08 }
  );
  pushLinearProjectile(pushProjectile, {
    type: 'incinerateCore',
    x: sp.startX,
    y: sp.startY,
    vx,
    vy,
    vz,
    z: sp.startZ,
    radius: 0.33,
    timeToLive,
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
  const maxR = fromWild ? 8.5 : 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const count = 9;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.18;
    const a = Math.atan2(targetY - sourceY, targetX - sourceX) + spread;
    const reach = 4.6;
    const rawTx = sourceX + Math.cos(a) * reach;
    const rawTy = sourceY + Math.sin(a) * reach;
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, rawTx, rawTy, 0.34);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      12,
      maxR,
      { ttlMargin: 1.04, ttlPad: 0.08 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'silkShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.27,
      timeToLive,
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
  const maxR = 11;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, targetX, targetY, 0.4);
  const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
    sp.startX,
    sp.startY,
    sp.startZ,
    targetX,
    targetY,
    sourceX,
    sourceY,
    14,
    maxR,
    { ttlMargin: 1.05, ttlPad: 0.1 }
  );
  pushProjectile({
    type: 'poisonSting',
    x: sp.startX,
    y: sp.startY,
    vx,
    vy,
    vz,
    z: sp.startZ,
    radius: 0.28,
    timeToLive,
    damage: fromWild ? 10 : 14,
    stingAngle: Math.atan2(vy, vx),
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: 99
  });
}

export function castPoisonStringTypo(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  castPoisonStingAlias(sourceX, sourceY, targetX, targetY, sourceEntity, opts);
}
