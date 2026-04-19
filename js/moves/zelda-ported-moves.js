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
import { spawnPrismaticLaserStreamFx } from './prismatic-laser-fx.js';
import { spawnSteelBeamStreamFx } from './steel-beam-fx.js';

function pushLinearProjectile(pushProjectile, spec) {
  pushProjectile(spec);
}

/**
 * Zelda Ember counterpart exists in `ember-move.js`; this file ports the rest.
 * Every cast is adapted to this project's tile-based projectile format.
 */
/**
 * @param {{
 *   fromWild?: boolean,
 *   pushProjectile: (p: object) => void,
 *   streamPuff?: boolean,
 *   streamQuality?: number,
 *   streamTrailMul?: number
 * }} opts
 * — `streamPuff`: short burst for held-stream cadence (player); false = wider volley (e.g. wild).
 */
export function castFlamethrower(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const {
    fromWild = false,
    pushProjectile,
    streamPuff = false,
    streamQuality = 1,
    streamTrailMul = 1
  } = opts;
  const maxR = fromWild ? 8.5 : 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const base = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const baseA = Math.atan2(base.aimY - sourceY, base.aimX - sourceX);
  const quality01 = Math.max(0.35, Math.min(1, Number(streamQuality) || 1));
  const count = streamPuff ? Math.max(1, Math.round(2 * quality01)) : 11;
  const spreadMag = streamPuff ? 0.16 : 0.26;
  const dmg = streamPuff ? (fromWild ? 3 : 6.2) : fromWild ? 3 : 4;
  const trailMul = Math.max(1, Number(streamTrailMul) || 1);
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * spreadMag;
    const a = baseA + spread;
    const dist = Math.max(0.15, base.dist0) * (0.9 + Math.random() * 0.2);
    const rawTx = sourceX + Math.cos(a) * dist;
    const rawTy = sourceY + Math.sin(a) * dist;
    const { aimX, aimY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, rawTx, rawTy, maxR);
    const maxHorizForTtl = Math.max(
      0.12,
      Math.min(maxR, streamPuff ? dist0 * (0.76 + 0.2 * quality01) : dist0)
    );
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
      trailAcc: EMBER_TRAIL_INTERVAL * (i / count),
      trailIntervalMul: trailMul,
      streamShot: !!streamPuff,
      hitTickAcc: streamPuff ? (i / Math.max(1, count)) * (1 / 30) : 0
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
  const { fromWild = false, pushProjectile, streamPuff = false } = opts;
  const maxR = fromWild ? 9 : 11;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.04;
  const count = streamPuff ? 4 : 8;
  const spreadMag = streamPuff ? 0.12 : 0.16;
  const dmg = streamPuff ? (fromWild ? 2.3 : 2.7) : fromWild ? 3 : 5;
  const speedBase = streamPuff ? 16.2 : 14.5;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * spreadMag;
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
      speedBase + Math.random() * (streamPuff ? 1.4 : 0.8),
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
      radius: streamPuff ? 0.22 : 0.25,
      timeToLive,
      damage: dmg,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: WATER_TRAIL_INTERVAL * (i / count)
    });
  }
}

/**
 * Bubble Beam: same hold-stream feel as Water Gun, but with bigger range and hollow bubble-ring visuals.
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void, streamPuff?: boolean }} opts
 */
export function castBubbleBeam(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile, streamPuff = false } = opts;
  const maxR = fromWild ? 12 : 15;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.05;
  const count = streamPuff ? 4 : 8;
  const spreadMag = streamPuff ? 0.11 : 0.15;
  const dmg = streamPuff ? (fromWild ? 2.5 : 3) : fromWild ? 3.5 : 5.5;
  const speedBase = streamPuff ? 17.2 : 15.4;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * spreadMag;
    const a = Math.atan2(targetY - sourceY, targetX - sourceX) + spread;
    const reach = 6.9;
    const rawTx = sourceX + Math.cos(a) * reach;
    const rawTy = sourceY + Math.sin(a) * reach;
    const { aimX, aimY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, rawTx, rawTy, maxR);
    const maxHorizForTtl = Math.max(0.2, Math.min(maxR, dist0));
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.35);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      aimX,
      aimY,
      sourceX,
      sourceY,
      speedBase + Math.random() * (streamPuff ? 1.5 : 1.0),
      maxHorizForTtl,
      { ttlMargin: 1.06, ttlPad: 0.08 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'bubbleBeamShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: streamPuff ? 0.22 : 0.27,
      timeToLive,
      damage: dmg,
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
 * @param {{
 *   fromWild?: boolean,
 *   pushProjectile: (p: object) => void,
 *   pushParticle?: (p: object) => void,
 *   streamPuff?: boolean
 * }} opts
 */
/**
 * Player prismatic stream: shared mouth→aim geometry for cast + merged beam visual.
 * @returns {{ aimX: number, aimY: number, dist0: number, sp: { startX: number, startY: number, startZ: number }, maxHorizForTtl: number }}
 */
export function computePrismaticPlayerStreamGeometry(sourceX, sourceY, targetX, targetY, sourceEntity) {
  const maxR = 10;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const base = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const aimX = base.aimX;
  const aimY = base.aimY;
  const dist0 = base.dist0;
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.42);
  const maxHorizForTtl = Math.max(0.12, Math.min(maxR, dist0));
  return { aimX, aimY, dist0, sp, maxHorizForTtl };
}

/** Steel Beam stream: same mouth→aim clamp as Prismatic; slightly shorter max range reads “heavier”. */
export function computeSteelBeamPlayerStreamGeometry(sourceX, sourceY, targetX, targetY, sourceEntity) {
  const maxR = 9.25;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const base = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  const aimX = base.aimX;
  const aimY = base.aimY;
  const dist0 = base.dist0;
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aimX, aimY, 0.42);
  const maxHorizForTtl = Math.max(0.12, Math.min(maxR, dist0));
  return { aimX, aimY, dist0, sp, maxHorizForTtl };
}

export function castPrismaticLaser(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile, pushParticle, streamPuff = false } = opts;
  const maxR = fromWild ? 12 : streamPuff ? 10 : 15;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);

  if (streamPuff && !fromWild) {
    const geo = computePrismaticPlayerStreamGeometry(sourceX, sourceY, targetX, targetY, sourceEntity);
    const { aimX, aimY, sp, maxHorizForTtl } = geo;
    const cx = Number(sourceEntity?.visualX ?? sourceEntity?.x) + 0.5;
    const cy = Number(sourceEntity?.visualY ?? sourceEntity?.y) + 0.5;
    const cz = Math.max(0, Number(sourceEntity?.z) || 0);
    const speed = 19 + Math.random() * 2.8;
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
    // One puff = one hitbox; visuals are a single full-length gradient beam (not stacked segments).
    const dmg = 2.35 * 5;
    pushLinearProjectile(pushProjectile, {
      type: 'prismaticShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.2,
      timeToLive,
      damage: dmg,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: 0,
      laserStream: true,
      laserBeamGradient: true,
      laserStreamHidePerProjectileBeam: true,
      laserBeamSx: sp.startX,
      laserBeamSy: sp.startY,
      laserBeamSz: sp.startZ,
      laserBeamEx: aimX,
      laserBeamEy: aimY,
      laserBeamEz: 0,
      laserHitSx: cx,
      laserHitSy: cy,
      laserHitSz: cz,
      laserHitEx: aimX,
      laserHitEy: aimY,
      laserHitEz: 0,
      laserHitHalfWidth: 0.28,
      hasTackleTrait: true,
      tackleKnockback: 3.25,
      tackleKnockbackLockSec: 0.32,
      psyHitWild: new Set(),
      psyHitDetails: new Set(),
      playerBeamHitDone: false,
      rainbowHue0: (sourceX * 17 + sourceY * 13) % 360
    });
    if (pushParticle) {
      spawnPrismaticLaserStreamFx(pushParticle, sp.startX, sp.startY, aimX, aimY, sp.startZ);
    }
    return;
  }

  const count = fromWild ? 10 : 12;
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
      trailAcc: LASER_TRAIL_INTERVAL * (i / count),
      laserStream: false,
      rainbowHue0: (i * 41) % 360
    });
  }
}

/**
 * Steel Beam — thick silver hold-stream (optic-blast style). Wild = tight volley like Prismatic volley.
 * @param {{
 *   fromWild?: boolean,
 *   pushProjectile: (p: object) => void,
 *   pushParticle?: (p: object) => void,
 *   streamPuff?: boolean
 * }} opts
 */
export function castSteelBeam(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile, pushParticle, streamPuff = false } = opts;
  const maxR = fromWild ? 11 : streamPuff ? 9.25 : 14;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);

  if (streamPuff && !fromWild) {
    const geo = computeSteelBeamPlayerStreamGeometry(sourceX, sourceY, targetX, targetY, sourceEntity);
    const { aimX, aimY, sp, maxHorizForTtl } = geo;
    const cx = Number(sourceEntity?.visualX ?? sourceEntity?.x) + 0.5;
    const cy = Number(sourceEntity?.visualY ?? sourceEntity?.y) + 0.5;
    const cz = Math.max(0, Number(sourceEntity?.z) || 0);
    const speed = 17.5 + Math.random() * 2.2;
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
    const dmg = 2.45 * 5;
    pushLinearProjectile(pushProjectile, {
      type: 'steelBeamShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.24,
      timeToLive,
      damage: dmg,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: 0,
      laserStream: true,
      laserBeamGradient: true,
      laserStreamHidePerProjectileBeam: true,
      laserBeamSx: sp.startX,
      laserBeamSy: sp.startY,
      laserBeamSz: sp.startZ,
      laserBeamEx: aimX,
      laserBeamEy: aimY,
      laserBeamEz: 0,
      laserHitSx: cx,
      laserHitSy: cy,
      laserHitSz: cz,
      laserHitEx: aimX,
      laserHitEy: aimY,
      laserHitEz: 0,
      laserHitHalfWidth: 3.08,
      hasTackleTrait: true,
      tackleKnockback: 3.15,
      tackleKnockbackLockSec: 0.32,
      psyHitWild: new Set(),
      psyHitDetails: new Set(),
      playerBeamHitDone: false
    });
    if (pushParticle) {
      spawnSteelBeamStreamFx(pushParticle, sp.startX, sp.startY, aimX, aimY, sp.startZ);
    }
    return;
  }

  const count = fromWild ? 9 : 11;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.07;
    const a = Math.atan2(targetY - sourceY, targetX - sourceX) + spread;
    const reach = 5.2;
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
      18.5,
      maxR,
      { ttlMargin: 1.02, ttlPad: 0.06 }
    );
    pushLinearProjectile(pushProjectile, {
      type: 'steelBeamShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: 0.22,
      timeToLive,
      damage: fromWild ? 4.2 : 6.2,
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: LASER_TRAIL_INTERVAL * (i / count),
      laserStream: false
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
