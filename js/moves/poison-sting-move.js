function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Single tall-hitbox sting (Zelda-style triangle drawn in Canvas).
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} targetX
 * @param {number} targetY
 * @param {object | null} sourceEntity
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void }} opts
 */
/**
 * Three stings in a narrow fan (counter attack).
 * @param {number} spreadRad half-angle between outer stings
 */
export function castPoisonStingFan(sourceX, sourceY, targetX, targetY, sourceEntity, opts, spreadRad = 0.14) {
  const base = Math.atan2(targetY - sourceY, targetX - sourceX);
  const reach = Math.min(12, Math.hypot(targetX - sourceX, targetY - sourceY) || 6);
  for (let i = -1; i <= 1; i++) {
    const a = base + i * spreadRad;
    castPoisonStingOnce(
      sourceX,
      sourceY,
      sourceX + Math.cos(a) * reach,
      sourceY + Math.sin(a) * reach,
      sourceEntity,
      opts
    );
  }
}

export function castPoisonStingOnce(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return;
  const dirX = dx / dist;
  const dirY = dy / dist;

  const maxRange = fromWild ? 10 : 11;
  let tx = targetX;
  let ty = targetY;
  if (dist > maxRange) {
    tx = sourceX + dirX * maxRange;
    ty = sourceY + dirY * maxRange;
  }

  const speed = 14;
  const startX = sourceX + dirX * 0.4;
  const startY = sourceY + dirY * 0.4;
  const pdx = tx - startX;
  const pdy = ty - startY;
  const pDist = Math.hypot(pdx, pdy) || 1e-6;
  const vx = (pdx / pDist) * speed;
  const vy = (pdy / pDist) * speed;
  const timeToLive = clamp01(pDist / speed) * 1.05 + 0.12;
  const angle = Math.atan2(vy, vx);

  pushProjectile({
    type: 'poisonSting',
    x: startX,
    y: startY,
    vx,
    vy,
    z: sourceEntity?.z || 0,
    radius: 0.28,
    timeToLive,
    damage: fromWild ? 10 : 14,
    stingAngle: angle,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    trailAcc: 999
  });
}
