import {
  EMBER_TRAIL_INTERVAL,
  FIRE_FRAME_H,
  FIRE_FRAME_W
} from './move-constants.js';

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
  const dx0 = targetX - sourceX;
  const dy0 = targetY - sourceY;
  const dist0 = Math.hypot(dx0, dy0);
  const dirX = dist0 > 1e-6 ? dx0 / dist0 : 0;
  const dirY = dist0 > 1e-6 ? dy0 / dist0 : 1;

  const maxRangeTiles = fromWild ? 9 : 12;
  let aimX = targetX;
  let aimY = targetY;
  if (dist0 > maxRangeTiles) {
    aimX = sourceX + dirX * maxRangeTiles;
    aimY = sourceY + dirY * maxRangeTiles;
  }

  const speed = (fromWild ? 13 : 15) * speedMul * (1 + 0.2 * cp);
  const spreadTiles = (fromWild ? 0.55 : 0.85) * spreadMul * (1 + 0.35 * cp);
  const count = countOverride ?? Math.round(6 + cp * 8);
  const spawnOff = 0.35;

  const startX = sourceX + dirX * spawnOff;
  const startY = sourceY + dirY * spawnOff;

  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * spreadTiles;
    const finalTx = aimX + Math.cos(ang) * rad;
    const finalTy = aimY + Math.sin(ang) * rad;

    const pdx = finalTx - startX;
    const pdy = finalTy - startY;
    const pDist = Math.hypot(pdx, pdy) || 1e-6;
    const vx = (pdx / pDist) * speed;
    const vy = (pdy / pDist) * speed;
    const travelTiles = pDist;
    const timeToLive = clamp01(travelTiles / speed) * 1.15 + 0.15;

    pushProjectile({
      type: 'ember',
      x: startX,
      y: startY,
      vx,
      vy,
      z: sourceEntity?.z || 0,
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
