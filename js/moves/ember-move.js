import {
  EMBER_TRAIL_INTERVAL,
  FIRE_FRAME_H,
  FIRE_FRAME_W
} from './move-constants.js';
import {
  spawnAlongHypotTowardGround,
  velocityFromToGroundWithHorizontalRangeFrom
} from './projectile-ground-hypot.js';

/** @param {number} n */
function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} targetX
 * @param {number} targetY
 * @param {object | null} sourceEntity
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void, chargePower?: number, count?: number, spreadMul?: number, speedMul?: number, damageMul?: number }} opts — `pushProjectile` enforces global cap; `chargePower` 0–1 scales charged shots.
 */
export function castEmberVolley(
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceEntity,
  opts
) {
  const {
    fromWild = false,
    pushProjectile,
    chargePower = 0,
    count: countOverride,
    spreadMul = 1,
    speedMul = 1,
    damageMul = 1
  } = opts;
  const cp = clamp01(chargePower);

  const maxRangeTiles = fromWild ? 9 : 12;

  const speed = (fromWild ? 13 : 15) * speedMul * (1 + 0.2 * cp);
  const spreadTiles = (fromWild ? 0.55 : 0.85) * spreadMul * (1 + 0.35 * cp);
  const count = countOverride ?? Math.round(6 + cp * 8);
  const spawnOff = 0.35;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);

  const aimCenter = spawnAlongHypotTowardGround(sourceX, sourceY, z0, targetX, targetY, spawnOff);

  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * spreadTiles;
    const rawFx = targetX + Math.cos(ang) * rad;
    const rawFy = targetY + Math.sin(ang) * rad;

    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      aimCenter.startX,
      aimCenter.startY,
      aimCenter.startZ,
      rawFx,
      rawFy,
      sourceX,
      sourceY,
      speed,
      maxRangeTiles,
      { ttlMargin: 1.15, ttlPad: 0.15 }
    );

    pushProjectile({
      type: 'ember',
      x: aimCenter.startX,
      y: aimCenter.startY,
      vx,
      vy,
      vz,
      z: aimCenter.startZ,
      radius: 0.38,
      timeToLive,
      damage: (fromWild ? 8 : 12) * damageMul * (1 + 0.5 * cp),
      sourceEntity,
      fromWild,
      hitsWild: !fromWild,
      hitsPlayer: !!fromWild,
      trailAcc: EMBER_TRAIL_INTERVAL * (i / count),
      sheetFrameW: FIRE_FRAME_W,
      sheetFrameH: FIRE_FRAME_H,
      sheetFrames: 4
    });
  }
}
