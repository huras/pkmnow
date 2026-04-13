import {
  MAX_PARTICLES,
  MAX_PROJECTILES,
  EMBER_TRAIL_INTERVAL,
  WATER_TRAIL_INTERVAL,
  COLLISION_BROAD_PHASE_TILES,
  WILD_MOVE_COOLDOWN_DEFAULT,
  FIRE_FRAME_W,
  FIRE_FRAME_H
} from './move-constants.js';
import { castEmberVolley } from './ember-move.js';
import { castWaterBurstVolley } from './water-burst-move.js';
import { castPoisonStingOnce, castPoisonStingFan } from './poison-sting-move.js';
import { resolveWildMoveIdForDex } from './wild-move-table.js';
import { tryDamagePlayerFromProjectile, updatePlayerCombatTimers } from '../player.js';

export const activeProjectiles = [];
export const activeParticles = [];

let playerEmberCooldown = 0;
let playerWaterCooldown = 0;
let playerPoisonCooldown = 0;
let playerUltimateCooldown = 0;
let playerCounter1Cooldown = 0;
let playerCounter2Cooldown = 0;

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

export function castEmber(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerEmberCooldown > 0) return;
  playerEmberCooldown = 0.2;
  castEmberVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
}

export function castWaterBurst(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerWaterCooldown > 0) return;
  playerWaterCooldown = 0.35;
  castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
}

export function castPoisonSting(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerPoisonCooldown > 0) return;
  playerPoisonCooldown = 0.45;
  castPoisonStingOnce(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
}

export function castEmberCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerEmberCooldown > 0) return;
  playerEmberCooldown = 0.48;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  castEmberVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    chargePower: Math.max(0.12, cp)
  });
}

export function castWaterCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerWaterCooldown > 0) return;
  playerWaterCooldown = 0.58;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    chargePower: Math.max(0.1, cp)
  });
}

/** Shift + LMB — fan of poison stings. */
export function castCounterAttack1(sourceX, sourceY, targetX, targetY, sourceEntity) {
  if (playerCounter1Cooldown > 0) return;
  playerCounter1Cooldown = 0.82;
  castPoisonStingFan(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceEntity,
    { fromWild: false, pushProjectile },
    0.17
  );
}

/** Shift + RMB — wide high-pressure water burst. */
export function castCounterAttack2(sourceX, sourceY, targetX, targetY, sourceEntity) {
  if (playerCounter2Cooldown > 0) return;
  playerCounter2Cooldown = 0.82;
  castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    count: 12,
    spreadMul: 1.55,
    speedMul: 1.12,
    damageMul: 1.2,
    chargePower: 0.25
  });
}

/**
 * MMB — nova ring (fire + water) toward cursor bias.
 * @param {number} targetX
 * @param {number} targetY
 */
export function castUltimate(sourceX, sourceY, targetX, targetY, sourceEntity) {
  if (playerUltimateCooldown > 0) return;
  playerUltimateCooldown = 7.5;
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
export function updateMoves(dt, wildPokemonList, _data, player) {
  updatePlayerCombatTimers(dt);
  playerEmberCooldown = Math.max(0, playerEmberCooldown - dt);
  playerWaterCooldown = Math.max(0, playerWaterCooldown - dt);
  playerPoisonCooldown = Math.max(0, playerPoisonCooldown - dt);
  playerUltimateCooldown = Math.max(0, playerUltimateCooldown - dt);
  playerCounter1Cooldown = Math.max(0, playerCounter1Cooldown - dt);
  playerCounter2Cooldown = Math.max(0, playerCounter2Cooldown - dt);

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
      activeProjectiles.splice(i, 1);
      continue;
    }

    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    const trailType =
      proj.type === 'ember'
        ? 'emberTrail'
        : proj.type === 'waterShot'
          ? 'waterTrail'
          : null;
    if (trailType && proj.trailAcc != null) {
      proj.trailAcc += dt;
      const interval = proj.type === 'waterShot' ? WATER_TRAIL_INTERVAL : EMBER_TRAIL_INTERVAL;
      while (proj.trailAcc >= interval) {
        proj.trailAcc -= interval;
        spawnTrailParticle(proj.x, proj.y, trailType);
      }
    }

    let hit = false;

    if (proj.hitsPlayer && checkPlayerHit(proj, player)) {
      const poison = proj.type === 'poisonSting' && Math.random() < 0.22;
      if (tryDamagePlayerFromProjectile(proj.damage, poison)) {
        spawnHitParticles(proj.x, proj.y, proj.z);
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
          hit = true;
          break;
        }
      }
    }

    if (hit) activeProjectiles.splice(i, 1);
  }
}
