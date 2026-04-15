import {
  EMBER_TRAIL_INTERVAL,
  WATER_TRAIL_INTERVAL,
  PSY_TRAIL_INTERVAL,
  POWDER_TRAIL_INTERVAL,
  SILK_TRAIL_INTERVAL,
  LASER_TRAIL_INTERVAL
} from './move-constants.js';
import {
  clampFloorAimToMaxRange,
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
/**
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void, streamPuff?: boolean }} opts
 * — `streamPuff`: short burst for held-stream cadence (player); false = wider volley (e.g. wild).
 */
export function castFlamethrower(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile, streamPuff = false } = opts;
  const maxR = fromWild ? 8.5 : 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const base = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const baseA = Math.atan2(base.aimY - sourceY, base.aimX - sourceX);
  const count = streamPuff ? 4 : 11;
  const spreadMag = streamPuff ? 0.16 : 0.26;
  const dmg = streamPuff ? (fromWild ? 2 : 2.5) : fromWild ? 3 : 4;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * spreadMag;
    const a = baseA + spread;
    const dist = Math.max(0.15, base.dist0) * (0.9 + Math.random() * 0.2);
    const rawTx = sourceX + Math.cos(a) * dist;
    const rawTy = sourceY + Math.sin(a) * dist;
    const { aimX, aimY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, rawTx, rawTy, maxR);
    const maxHorizForTtl = Math.max(0.12, Math.min(maxR, dist0));
    const speed = 16 + Math.random() * 2;
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.35);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      aimX,
      aimY,
      sourceX,
      sourceY,
      speed,
      maxHorizForTtl,
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
      radius: streamPuff ? 0.22 : 0.25,
      timeToLive,
      damage: dmg,
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
  const baseAngle = Math.atan2(targetY - sourceY, targetX - sourceX);
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) * 0.5) * 0.12;
    const a = baseAngle + spread;
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
  const baseAngle = Math.atan2(targetY - sourceY, targetX - sourceX);
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.16;
    const a = baseAngle + spread;
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
  const maxR = fromWild ? 12 : 14;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.04;
  const { aimX, aimY, dirX, dirY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.44);
  const beamEndX = sourceX + dirX * dist0;
  const beamEndY = sourceY + dirY * dist0;
  const ttl = fromWild ? 0.2 : 0.28;
  pushLinearProjectile(pushProjectile, {
    type: 'psybeamBeam',
    x: (sp.startX + beamEndX) * 0.5,
    y: (sp.startY + beamEndY) * 0.5,
    vx: 0,
    vy: 0,
    vz: 0,
    z: sp.startZ,
    radius: 0.28,
    beamStartX: sp.startX,
    beamStartY: sp.startY,
    beamEndX,
    beamEndY,
    beamHalfWidth: fromWild ? 0.24 : 0.28,
    timeToLive: ttl,
    beamTtlMax: ttl,
    damage: fromWild ? 7 : 12,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    hasTackleTrait: true,
    tackleKnockback: fromWild ? 2.7 : 3.25,
    tackleKnockbackLockSec: fromWild ? 0.24 : 0.32,
    trailAcc: 0,
    psyHitWild: new Set(),
    psyHitDetails: new Set(),
    playerBeamHitDone: false
  });
}

/**
 * Rainbow laser: player hold-stream uses `streamPuff` (short bursts like flamethrower); wild = wide volley.
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void, streamPuff?: boolean }} opts
 */
export function castPrismaticLaser(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile, streamPuff = false } = opts;
  const maxR = fromWild ? 12 : streamPuff ? 10 : 15;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);

  if (streamPuff && !fromWild) {
    const base = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
    const baseA = Math.atan2(base.aimY - sourceY, base.aimX - sourceX);
    const count = 5;
    const spreadMag = 0.11;
    const dmg = 2.35;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * spreadMag;
      const a = baseA + spread;
      const dist = Math.max(0.15, base.dist0) * (0.9 + Math.random() * 0.2);
      const rawTx = sourceX + Math.cos(a) * dist;
      const rawTy = sourceY + Math.sin(a) * dist;
      const { aimX, aimY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, rawTx, rawTy, maxR);
      const maxHorizForTtl = Math.max(0.12, Math.min(maxR, dist0));
      const speed = 19 + Math.random() * 2.8;
      const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.42);
      const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
        sp.startX,
        sp.startY,
        sp.startZ,
        aimX,
        aimY,
        sourceX,
        sourceY,
        speed,
        maxHorizForTtl,
        { ttlMargin: 1.05, ttlPad: 0.08 }
      );
      pushLinearProjectile(pushProjectile, {
        type: 'prismaticShot',
        x: sp.startX,
        y: sp.startY,
        vx,
        vy,
        vz,
        z: sp.startZ,
        radius: 0.18,
        timeToLive,
        damage: dmg,
        sourceEntity,
        fromWild,
        hitsWild: !fromWild,
        hitsPlayer: !!fromWild,
        trailAcc: LASER_TRAIL_INTERVAL * (i / count),
        laserStream: true,
        rainbowHue0: (i * 61 + sourceX * 17 + sourceY * 13) % 360
      });
    }
    return;
  }

  const count = fromWild ? 10 : 12;
  const baseAngle = Math.atan2(targetY - sourceY, targetX - sourceX);
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.08;
    const a = baseAngle + spread;
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
      trailAcc: LASER_TRAIL_INTERVAL * (i / count),
      laserStream: false,
      rainbowHue0: (i * 41) % 360
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
  const { aimX, aimY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const maxHorizForTtl = Math.max(0.15, Math.min(maxR, dist0));
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.35);
  const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
    sp.startX,
    sp.startY,
    sp.startZ,
    aimX,
    aimY,
    sourceX,
    sourceY,
    12.8,
    maxHorizForTtl,
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
