import { WATER_TRAIL_INTERVAL, FIRE_FRAME_W, FIRE_FRAME_H } from './move-constants.js';
import {
  spawnAlongHypotTowardGround,
  velocityFromToGroundWithHorizontalRangeFrom
} from './projectile-ground-hypot.js';

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} targetX
 * @param {number} targetY
 * @param {object | null} sourceEntity
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void, chargePower?: number, count?: number, spreadMul?: number, speedMul?: number, damageMul?: number }} opts
 */
export function castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const {
    fromWild = false,
    pushProjectile,
    chargePower = 0,
    count: countOverride,
    spreadMul = 1,
    speedMul = 1,
    damageMul = 1
  } = opts;

  const maxRangeTiles = fromWild ? 8 : 10;

  const cp = clamp01(chargePower);
  const speed = 19 * speedMul * (1 + 0.22 * cp);
  const count = countOverride ?? Math.round(7 + cp * 8);
  const spread = 0.35 * spreadMul * (1 + 0.4 * cp);
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.05;

  const aimCenter = spawnAlongHypotTowardGround(sourceX, sourceY, z0, targetX, targetY, 0.3);

  for (let i = 0; i < count; i++) {
    const spreadA = (Math.random() - 0.5) * spread;
    const baseA = Math.atan2(targetY - aimCenter.startY, targetX - aimCenter.startX);
    const finalA = baseA + spreadA;
    const reach = Math.hypot(targetX - aimCenter.startX, targetY - aimCenter.startY) + 0.01;
    const rawTx = aimCenter.startX + Math.cos(finalA) * reach;
    const rawTy = aimCenter.startY + Math.sin(finalA) * reach;

    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      aimCenter.startX,
      aimCenter.startY,
      aimCenter.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      speed,
      maxRangeTiles,
      { ttlMargin: 0.95, ttlPad: 0.2 }
    );

    pushProjectile({
      type: 'waterShot',
      x: aimCenter.startX,
      y: aimCenter.startY,
      vx,
      vy,
      vz,
      z: aimCenter.startZ,
      radius: 0.32,
      timeToLive,
      damage: (fromWild ? 6 : 9) * damageMul * (1 + 0.45 * cp),
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: WATER_TRAIL_INTERVAL * (i / count),
      sheetFrameW: FIRE_FRAME_W,
      sheetFrameH: FIRE_FRAME_H,
      sheetFrames: 1
    });
  }
}
