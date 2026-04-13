import {
  MAX_PARTICLES,
  MAX_PROJECTILES,
  EMBER_TRAIL_INTERVAL,
  WATER_TRAIL_INTERVAL,
  PSY_TRAIL_INTERVAL,
  POWDER_TRAIL_INTERVAL,
  SILK_TRAIL_INTERVAL,
  LASER_TRAIL_INTERVAL,
  COLLISION_BROAD_PHASE_TILES,
  WILD_MOVE_COOLDOWN_DEFAULT,
  FIRE_FRAME_W,
  FIRE_FRAME_H
} from './move-constants.js';
import { castEmberVolley } from './ember-move.js';
import { castWaterBurstVolley } from './water-burst-move.js';
import { castPoisonStingOnce, castPoisonStingFan } from './poison-sting-move.js';
import {
  castFlamethrower,
  castConfusion,
  castBubble,
  castWaterGun,
  castPsybeam,
  castPrismaticLaser,
  castPoisonPowder,
  castIncinerate,
  castSilkShoot
} from './zelda-ported-moves.js';
import { resolveWildMoveIdForDex } from './wild-move-table.js';
import { tryDamagePlayerFromProjectile, updatePlayerCombatTimers } from '../player.js';

/** Visual window for optional `shoot` PMD slice after a successful player cast. */
const MOVE_CAST_VIS_SEC = 0.48;

function bumpPlayerMoveCastVisual(sourceEntity) {
  if (sourceEntity && sourceEntity.dexId != null) {
    sourceEntity.moveShootAnimSec = Math.max(sourceEntity.moveShootAnimSec || 0, MOVE_CAST_VIS_SEC);
    sourceEntity._shootAnimTick = 0;
  }
}

export const activeProjectiles = [];
export const activeParticles = [];

let playerEmberCooldown = 0;
let playerWaterCooldown = 0;
let playerPoisonCooldown = 0;
let playerUltimateCooldown = 0;
let playerCounter1Cooldown = 0;
let playerCounter2Cooldown = 0;
let playerFlamethrowerCooldown = 0;
let playerConfusionCooldown = 0;
let playerBubbleCooldown = 0;
let playerWaterGunCooldown = 0;
let playerPsybeamCooldown = 0;
let playerPrismaticLaserCooldown = 0;
let playerPoisonPowderCooldown = 0;
let playerIncinerateCooldown = 0;
let playerSilkShootCooldown = 0;

function pushProjectile(p) {
  while (activeProjectiles.length >= MAX_PROJECTILES) activeProjectiles.shift();
  activeProjectiles.push(p);
}

function pushParticle(p) {
  while (activeParticles.length >= MAX_PARTICLES) activeParticles.shift();
  activeParticles.push(p);
}

export function spawnHitParticles(x, y, z) {
  const budget = Math.min(8, MAX_PARTICLES - activeParticles.length);
  for (let i = 0; i < budget; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    const life = 0.28 + Math.random() * 0.28;
    pushParticle({
      type: 'burst',
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      z: z + 0.5,
      vz: 4 + Math.random() * 3,
      life,
      maxLife: 0.56
    });
  }
}

function spawnTrailParticle(px, py, trailType) {
  const spread = 0.18;
  pushParticle({
    type: trailType,
    x: px + (Math.random() - 0.5) * spread,
    y: py + (Math.random() - 0.5) * spread,
    vx: (Math.random() - 0.5) * 1.6,
    vy: (Math.random() - 0.5) * 1.6,
    z: 0.15 + Math.random() * 0.25,
    vz: 0.8 + Math.random() * 1.6,
    life: 0.42,
    maxLife: 0.42
  });
}

function checkCollision(px, py, pr, target) {
  const targetR = 0.5;
  const dist = Math.hypot(target.x - px, target.y - py);
  return dist < pr + targetR;
}

function broadPhaseOk(px, py, tx, ty) {
  return Math.hypot(tx - px, ty - py) <= COLLISION_BROAD_PHASE_TILES;
}

/**
 * @param {import('../player.js').player} player
 */
function checkPlayerHit(proj, player) {
  if (!proj.hitsPlayer) return false;
  const px = player.visualX ?? player.x;
  const py = player.visualY ?? player.y;
  if (!broadPhaseOk(proj.x, proj.y, px, py)) return false;
  return checkCollision(proj.x, proj.y, proj.radius, { x: px, y: py });
}

function spawnIncinerateShards(proj, pushProjectileRef) {
  const count = 10;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const speed = 8.8 + Math.random() * 1.8;
    pushProjectileRef({
      type: 'incinerateShard',
      x: proj.x,
      y: proj.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      z: proj.z || 0,
      radius: 0.2,
      timeToLive: 0.42 + Math.random() * 0.18,
      damage: (proj.splashDamage || 2) * 0.8,
      sourceEntity: proj.sourceEntity,
      fromWild: proj.fromWild,
      hitsWild: proj.hitsWild,
      hitsPlayer: proj.hitsPlayer,
      trailAcc: EMBER_TRAIL_INTERVAL * (i / count)
    });
  }
}

function applySplashToWild(proj, wildList) {
  const r = proj.splashRadius || 0;
  const d = proj.splashDamage || 0;
  if (r <= 0 || d <= 0) return;
  for (const wild of wildList) {
    if (wild === proj.sourceEntity || wild.isDespawning || (wild.hp !== undefined && wild.hp <= 0)) continue;
    if (Math.hypot(wild.x - proj.x, wild.y - proj.y) <= r) {
      if (wild.takeDamage) wild.takeDamage(d);
    }
  }
}

/**
 * Cast by move id (used by configurable movesets in UI/controls).
 * @param {string} moveId
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} targetX
 * @param {number} targetY
 * @param {object | null} sourceEntity
 */
export function castMoveById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (moveId === 'ember') return castEmber(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'flamethrower') return castFlamethrowerMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'confusion') return castConfusionMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'bubble') return castBubbleMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'waterBurst') return castWaterBurst(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'waterGun') return castWaterGunMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'psybeam') return castPsybeamMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'prismaticLaser') return castPrismaticLaserMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'poisonSting') return castPoisonSting(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'poisonPowder') return castPoisonPowderMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'incinerate') return castIncinerateMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'silkShoot') return castSilkShootMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  return false;
}

/**
 * Charged variant dispatch (falls back to normal if no dedicated charge impl).
 */
export function castMoveChargedById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (moveId === 'ember') return castEmberCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'waterBurst') return castWaterCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  return castMoveById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity);
}

export function castEmber(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerEmberCooldown > 0) return false;
  playerEmberCooldown = 0.2;
  bumpPlayerMoveCastVisual(sourceEntity);
  castEmberVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castWaterBurst(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerWaterCooldown > 0) return false;
  playerWaterCooldown = 0.35;
  bumpPlayerMoveCastVisual(sourceEntity);
  castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castPoisonSting(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerPoisonCooldown > 0) return false;
  playerPoisonCooldown = 0.45;
  bumpPlayerMoveCastVisual(sourceEntity);
  castPoisonStingOnce(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castFlamethrowerMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerFlamethrowerCooldown > 0) return false;
  playerFlamethrowerCooldown = 0.7;
  bumpPlayerMoveCastVisual(sourceEntity);
  castFlamethrower(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castConfusionMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerConfusionCooldown > 0) return false;
  playerConfusionCooldown = 0.6;
  bumpPlayerMoveCastVisual(sourceEntity);
  castConfusion(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castBubbleMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerBubbleCooldown > 0) return false;
  playerBubbleCooldown = 0.55;
  bumpPlayerMoveCastVisual(sourceEntity);
  castBubble(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castWaterGunMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerWaterGunCooldown > 0) return false;
  playerWaterGunCooldown = 0.65;
  bumpPlayerMoveCastVisual(sourceEntity);
  castWaterGun(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castPsybeamMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerPsybeamCooldown > 0) return false;
  playerPsybeamCooldown = 0.75;
  bumpPlayerMoveCastVisual(sourceEntity);
  castPsybeam(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castPrismaticLaserMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerPrismaticLaserCooldown > 0) return false;
  playerPrismaticLaserCooldown = 1.45;
  bumpPlayerMoveCastVisual(sourceEntity);
  castPrismaticLaser(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castPoisonPowderMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerPoisonPowderCooldown > 0) return false;
  playerPoisonPowderCooldown = 0.95;
  bumpPlayerMoveCastVisual(sourceEntity);
  castPoisonPowder(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castIncinerateMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerIncinerateCooldown > 0) return false;
  playerIncinerateCooldown = 0.78;
  bumpPlayerMoveCastVisual(sourceEntity);
  castIncinerate(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castSilkShootMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerSilkShootCooldown > 0) return false;
  playerSilkShootCooldown = 0.72;
  bumpPlayerMoveCastVisual(sourceEntity);
  castSilkShoot(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castEmberCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerEmberCooldown > 0) return false;
  playerEmberCooldown = 0.48;
  bumpPlayerMoveCastVisual(sourceEntity);
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  castEmberVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    chargePower: Math.max(0.12, cp)
  });
  return true;
}

export function castWaterCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerWaterCooldown > 0) return false;
  playerWaterCooldown = 0.58;
  bumpPlayerMoveCastVisual(sourceEntity);
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    chargePower: Math.max(0.1, cp)
  });
  return true;
}

/** Shift + LMB — fan of poison stings. */
export function castCounterAttack1(sourceX, sourceY, targetX, targetY, sourceEntity) {
  if (playerCounter1Cooldown > 0) return false;
  playerCounter1Cooldown = 0.82;
  bumpPlayerMoveCastVisual(sourceEntity);
  castPoisonStingFan(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceEntity,
    { fromWild: false, pushProjectile },
    0.17
  );
  return true;
}

/** Shift + RMB — wide high-pressure water burst. */
export function castCounterAttack2(sourceX, sourceY, targetX, targetY, sourceEntity) {
  if (playerCounter2Cooldown > 0) return false;
  playerCounter2Cooldown = 0.82;
  bumpPlayerMoveCastVisual(sourceEntity);
  castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    count: 12,
    spreadMul: 1.55,
    speedMul: 1.12,
    damageMul: 1.2,
    chargePower: 0.25
  });
  return true;
}

/**
 * MMB — nova ring (fire + water) toward cursor bias.
 * @param {number} targetX
 * @param {number} targetY
 */
export function castUltimate(sourceX, sourceY, targetX, targetY, sourceEntity) {
  if (playerUltimateCooldown > 0) return false;
  playerUltimateCooldown = 7.5;
  bumpPlayerMoveCastVisual(sourceEntity);
  const aimA = Math.atan2(targetY - sourceY, targetX - sourceX);
  const n = 18;
  for (let i = 0; i < n; i++) {
    const ringA = (i / n) * Math.PI * 2;
    const a = ringA * 0.55 + aimA * 0.45;
    const sp = 11.5 + (i % 3) * 0.6;
    const vx = Math.cos(a) * sp;
    const vy = Math.sin(a) * sp;
    const isEmber = i % 2 === 0;
    pushProjectile({
      type: isEmber ? 'ember' : 'waterShot',
      x: sourceX + Math.cos(a) * 0.22,
      y: sourceY + Math.sin(a) * 0.22,
      vx,
      vy,
      z: (sourceEntity?.z || 0) + 0.02,
      radius: isEmber ? 0.36 : 0.3,
      timeToLive: isEmber ? 1.35 : 1.05,
      damage: isEmber ? 7 : 6,
      sourceEntity,
      fromWild: false,
      hitsWild: true,
      hitsPlayer: false,
      trailAcc: (isEmber ? EMBER_TRAIL_INTERVAL : WATER_TRAIL_INTERVAL) * (i / n),
      sheetFrameW: FIRE_FRAME_W,
      sheetFrameH: FIRE_FRAME_H,
      sheetFrames: isEmber ? 4 : 1
    });
  }
  return true;
}

/**
 * Wild aggressive Pokémon attack when in melee range.
 * @param {object} entity
 * @param {number} playerX
 * @param {number} playerY
 * @param {number} dt
 */
export function tryCastWildMove(entity, playerX, playerY, dt) {
  if (!entity || entity.isDespawning || (entity.spawnPhase ?? 1) < 0.5) return;
  if (entity.behavior?.archetype !== 'aggressive') return;
  if (entity.aiState !== 'approach') return;
  const beh = entity.behavior;
  const dx = entity.x - playerX;
  const dy = entity.y - playerY;
  const distP = Math.hypot(dx, dy);
  const stop = beh.stopDist ?? 1.2;
  if (distP > stop + 0.7) return;

  entity.wildMoveCd = (entity.wildMoveCd ?? 0) - dt;
  if (entity.wildMoveCd > 0) return;

  const moveId = resolveWildMoveIdForDex(entity.dexId ?? 1);
  const opts = { fromWild: true, pushProjectile };
  if (moveId === 'ember') {
    castEmberVolley(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'waterBurst') {
    castWaterBurstVolley(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'flamethrower') {
    castFlamethrower(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'confusion') {
    castConfusion(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'bubble') {
    castBubble(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'waterGun') {
    castWaterGun(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'psybeam') {
    castPsybeam(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'prismaticLaser') {
    castPrismaticLaser(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'poisonPowder') {
    castPoisonPowder(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'incinerate') {
    castIncinerate(entity.x, entity.y, playerX, playerY, entity, opts);
  } else if (moveId === 'silkShoot') {
    castSilkShoot(entity.x, entity.y, playerX, playerY, entity, opts);
  } else {
    castPoisonStingOnce(entity.x, entity.y, playerX, playerY, entity, opts);
  }
  entity.wildMoveCd = WILD_MOVE_COOLDOWN_DEFAULT;
}

/**
 * @param {number} dt
 * @param {Iterable<object>} wildPokemonList
 * @param {object | null} _data reserved for terrain/water queries (ground embers, etc.)
 * @param {import('../player.js').player} player
 */
/**
 * Remaining player cooldown (seconds) for a move id. Used by play HUD chips.
 * @param {string} moveId
 * @returns {number}
 */
export function getPlayerMoveCooldownRemaining(moveId) {
  switch (moveId) {
    case 'ember':
      return playerEmberCooldown;
    case 'waterBurst':
      return playerWaterCooldown;
    case 'poisonSting':
      return playerPoisonCooldown;
    case 'flamethrower':
      return playerFlamethrowerCooldown;
    case 'confusion':
      return playerConfusionCooldown;
    case 'bubble':
      return playerBubbleCooldown;
    case 'waterGun':
      return playerWaterGunCooldown;
    case 'psybeam':
      return playerPsybeamCooldown;
    case 'prismaticLaser':
      return playerPrismaticLaserCooldown;
    case 'poisonPowder':
      return playerPoisonPowderCooldown;
    case 'incinerate':
      return playerIncinerateCooldown;
    case 'silkShoot':
      return playerSilkShootCooldown;
    case 'ultimate':
      return playerUltimateCooldown;
    default:
      return 0;
  }
}

export function updateMoves(dt, wildPokemonList, _data, player) {
  updatePlayerCombatTimers(dt);
  playerEmberCooldown = Math.max(0, playerEmberCooldown - dt);
  playerWaterCooldown = Math.max(0, playerWaterCooldown - dt);
  playerPoisonCooldown = Math.max(0, playerPoisonCooldown - dt);
  playerUltimateCooldown = Math.max(0, playerUltimateCooldown - dt);
  playerCounter1Cooldown = Math.max(0, playerCounter1Cooldown - dt);
  playerCounter2Cooldown = Math.max(0, playerCounter2Cooldown - dt);
  playerFlamethrowerCooldown = Math.max(0, playerFlamethrowerCooldown - dt);
  playerConfusionCooldown = Math.max(0, playerConfusionCooldown - dt);
  playerBubbleCooldown = Math.max(0, playerBubbleCooldown - dt);
  playerWaterGunCooldown = Math.max(0, playerWaterGunCooldown - dt);
  playerPsybeamCooldown = Math.max(0, playerPsybeamCooldown - dt);
  playerPrismaticLaserCooldown = Math.max(0, playerPrismaticLaserCooldown - dt);
  playerPoisonPowderCooldown = Math.max(0, playerPoisonPowderCooldown - dt);
  playerIncinerateCooldown = Math.max(0, playerIncinerateCooldown - dt);
  playerSilkShootCooldown = Math.max(0, playerSilkShootCooldown - dt);

  const wildList = Array.isArray(wildPokemonList) ? wildPokemonList : [...wildPokemonList];

  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      activeParticles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.vz -= 30.0 * dt;
    if (p.z <= 0) {
      p.z = 0;
      p.vz = 0;
      p.vx *= 0.82;
      p.vy *= 0.82;
    }
  }

  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const proj = activeProjectiles[i];
    proj.timeToLive -= dt;
    if (proj.timeToLive <= 0) {
      if (proj.type === 'incinerateCore') {
        spawnHitParticles(proj.x, proj.y, proj.z || 0);
        applySplashToWild(proj, wildList);
        spawnIncinerateShards(proj, pushProjectile);
      } else if (proj.type === 'confusionOrb') {
        spawnHitParticles(proj.x, proj.y, proj.z || 0);
        applySplashToWild(proj, wildList);
      }
      activeProjectiles.splice(i, 1);
      continue;
    }

    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    const trailType =
      proj.type === 'ember'
        ? 'emberTrail'
        : proj.type === 'waterShot' || proj.type === 'waterGunShot' || proj.type === 'bubbleShot'
          ? 'waterTrail'
          : proj.type === 'poisonPowderShot'
            ? 'powderTrail'
            : proj.type === 'silkShot'
              ? 'silkTrail'
              : proj.type === 'confusionOrb' || proj.type === 'psybeamShot'
                ? 'psyTrail'
                : proj.type === 'prismaticShot'
                  ? 'laserTrail'
          : null;
    if (trailType && proj.trailAcc != null) {
      proj.trailAcc += dt;
      const interval =
        trailType === 'waterTrail'
          ? WATER_TRAIL_INTERVAL
          : trailType === 'psyTrail'
            ? PSY_TRAIL_INTERVAL
            : trailType === 'powderTrail'
              ? POWDER_TRAIL_INTERVAL
              : trailType === 'silkTrail'
                ? SILK_TRAIL_INTERVAL
                : trailType === 'laserTrail'
                  ? LASER_TRAIL_INTERVAL
                  : EMBER_TRAIL_INTERVAL;
      while (proj.trailAcc >= interval) {
        proj.trailAcc -= interval;
        spawnTrailParticle(proj.x, proj.y, trailType);
      }
    }

    let hit = false;

    if (proj.hitsPlayer && checkPlayerHit(proj, player)) {
      const poisonCapable = proj.type === 'poisonSting' || proj.type === 'poisonPowderShot';
      const poisonChance = proj.poisonChance != null ? proj.poisonChance : 0.22;
      const poison = poisonCapable && Math.random() < poisonChance;
      if (tryDamagePlayerFromProjectile(proj.damage, poison)) {
        spawnHitParticles(proj.x, proj.y, proj.z);
      }
      if (proj.type === 'incinerateCore') {
        spawnIncinerateShards(proj, pushProjectile);
      }
      hit = true;
    }

    if (!hit && proj.hitsWild) {
      for (const wild of wildList) {
        if (wild === proj.sourceEntity || wild.isDespawning || (wild.hp !== undefined && wild.hp <= 0)) {
          continue;
        }
        if (!broadPhaseOk(proj.x, proj.y, wild.x, wild.y)) continue;
        if (checkCollision(proj.x, proj.y, proj.radius, wild)) {
          if (wild.takeDamage) wild.takeDamage(proj.damage);
          spawnHitParticles(proj.x, proj.y, proj.z);
          if (proj.type === 'incinerateCore' || proj.type === 'confusionOrb') {
            applySplashToWild(proj, wildList);
          }
          if (proj.type === 'incinerateCore') {
            spawnIncinerateShards(proj, pushProjectile);
          }
          hit = true;
          break;
        }
      }
    }

    if (hit) activeProjectiles.splice(i, 1);
  }
}
