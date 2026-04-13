import {
  clampFloorAimToMaxRange,
  spawnAlongHypotTowardGround,
  velocityFromToGround
} from './projectile-ground-hypot.js';

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
  const maxRange = fromWild ? 10 : 11;
  const aim = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxRange);

  const speed = 14;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0);
  const spawn = spawnAlongHypotTowardGround(sourceX, sourceY, z0, aim.aimX, aim.aimY, 0.4);

  const { vx, vy, vz, timeToLive } = velocityFromToGround(
    spawn.startX,
    spawn.startY,
    spawn.startZ,
    aim.aimX,
    aim.aimY,
    speed,
    { ttlMargin: 1.05, ttlPad: 0.12 }
  );
  const angle = Math.atan2(vy, vx);

  pushProjectile({
    type: 'poisonSting',
    x: spawn.startX,
    y: spawn.startY,
    vx,
    vy,
    vz,
    z: spawn.startZ,
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
