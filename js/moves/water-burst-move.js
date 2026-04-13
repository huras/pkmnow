import { WATER_TRAIL_INTERVAL, FIRE_FRAME_W, FIRE_FRAME_H } from './move-constants.js';

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
  const dx0 = targetX - sourceX;
  const dy0 = targetY - sourceY;
  const dist0 = Math.hypot(dx0, dy0);
  const dirX = dist0 > 1e-6 ? dx0 / dist0 : 0;
  const dirY = dist0 > 1e-6 ? dy0 / dist0 : 1;

  const maxRangeTiles = fromWild ? 8 : 10;
  let aimX = targetX;
  let aimY = targetY;
  if (dist0 > maxRangeTiles) {
    aimX = sourceX + dirX * maxRangeTiles;
    aimY = sourceY + dirY * maxRangeTiles;
  }

  const cp = clamp01(chargePower);
  const speed = 19 * speedMul * (1 + 0.22 * cp);
  const count = countOverride ?? Math.round(7 + cp * 8);
  const spread = 0.35 * spreadMul * (1 + 0.4 * cp);
  const startX = sourceX + dirX * 0.3;
  const startY = sourceY + dirY * 0.3;

  for (let i = 0; i < count; i++) {
    const spreadA = (Math.random() - 0.5) * spread;
    const baseA = Math.atan2(aimY - startY, aimX - startX);
    const finalA = baseA + spreadA;
    const vx = Math.cos(finalA) * speed;
    const vy = Math.sin(finalA) * speed;
    const travelTiles = Math.hypot(aimX - startX, aimY - startY) || 1;
    const timeToLive = clamp01(travelTiles / speed) * 0.95 + 0.2;

    pushProjectile({
      type: 'waterShot',
      x: startX,
      y: startY,
      vx,
      vy,
      z: (sourceEntity?.z || 0) + 0.05,
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
