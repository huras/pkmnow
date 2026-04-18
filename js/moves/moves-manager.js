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
  castBubbleBeam,
  castPsybeam,
  castPrismaticLaser,
  castPoisonPowder,
  castIncinerate,
  castSilkShoot
} from './zelda-ported-moves.js';
import { resolveWildMoveIdForDex } from './wild-move-table.js';
import {
  spawnAlongHypotTowardGround,
  velocityFromToGroundWithHorizontalRangeFrom
} from './projectile-ground-hypot.js';
import { tryDamagePlayerFromProjectile, updatePlayerCombatTimers } from '../player.js';
import { isChargeStrongAttackEligible, getWeakPartialChargeT, getChargeLevel } from '../main/play-charge-levels.js';
import { playWildAttackCry } from '../pokemon/pokemon-cries.js';
import {
  grassFireTryExtinguishAt,
  grassFireTryIgniteAt,
  grassFireVisualPhaseAt,
  GRASS_FIRE_PARTICLE_SEC
} from '../play-grass-fire.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles,
  projectileZInPokemonHurtbox
} from '../pokemon/pokemon-combat-hurtbox.js';
import {
  getEffectiveWildBehavior,
  getWildAggressiveMoveCooldownMultiplier
} from '../wild-pokemon/wild-effective-behavior.js';
import { tryApplyFireHitToFormalTreesAt, tryBreakDetailsAlongSegment } from '../main/play-crystal-tackle.js';
import {
  buildWildSpatialIndex,
  queryWildSpatialIndexInAabb,
  applyWildKnockbackFromProjectile,
  checkDamageHitCircle,
  distPointToSegmentTiles,
  broadPhaseOk,
  isProjectileBlockedByTree,
  emitProjectileWorldReactionOnce,
  checkPlayerHit,
  spawnIncinerateShards,
  applySplashToWild
} from './moves-projectile-collision.js';
import { playFloorHit2Sfx } from '../audio/floor-hit-2-sfx.js';
import { scheduleThunderStrike, tickThunderStrikes } from './thunder-move.js';
import { castThundershock, THUNDERSHOCK_STREAM_INTERVAL_SEC } from './thunder-shock-move.js';
import { castRainDance, castSunnyDay } from './weather-moves.js';

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
/** Front cut sweep angle in degrees (requested configurable constant). */
export const FIELD_CUT_VINE_ARC_DEG = 120;
/** Psychic slash arc angle in degrees (can be tuned independently). */
export const FIELD_CUT_PSYCHIC_ARC_DEG = 120;

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
let playerBubbleBeamCooldown = 0;
let playerPsybeamCooldown = 0;
let playerPrismaticLaserCooldown = 0;
let playerPoisonPowderCooldown = 0;
let playerIncinerateCooldown = 0;
let playerSilkShootCooldown = 0;
let playerThunderCooldown = 0;
let playerThundershockCooldown = 0;
let playerRainDanceCooldown = 0;
let playerSunnyDayCooldown = 0;

/** Seconds between player flamethrower stream puffs (hold-to-spray). */
const FLAMETHROWER_STREAM_INTERVAL = 0.104;
/** Adaptive upper cadence under heavy projectile/particle load. */
const FLAMETHROWER_STREAM_INTERVAL_MAX = 0.176;
/** Collision cadence for flamethrower stream shots (render stays at full FPS). */
const FLAMETHROWER_STREAM_HIT_TICK_SEC = 1 / 30;
/** Water-gun stream cadence (hold-to-spray, like flamethrower). */
const WATER_GUN_STREAM_INTERVAL = 0.074;
/** Bubble-beam stream cadence (hold-to-spray, long-range water ring stream). */
const BUBBLE_BEAM_STREAM_INTERVAL = 0.078;

/** Player prismatic laser stream cadence (hold-to-spray rainbow beam). */
const PRISMATIC_STREAM_INTERVAL = 0.076;

/** Seconds between Thunder casts (covers cloud grow-in + bolt + settle). Default = Level 2 (tap / standard). */
const PLAYER_THUNDER_COOLDOWN_SEC = 0.95;
/**
 * Per-charge-level cooldowns. L1 fires faster (weak zap), L3 is the punishing mega strike.
 * Keys match the thunder-move.js level config; indices are (tap/L1), L2, L3.
 * UI max uses the L3 value so the cooldown clock never overflows when the heaviest tier lands.
 */
const PLAYER_THUNDER_COOLDOWN_BY_LEVEL = { 1: 0.55, 2: 0.95, 3: 1.55 };

/** Seconds between Rain Dance / Sunny Day casts. Long enough to make weather-swaps feel
 *  committed (no strobing clouds), short enough to let the player course-correct in a
 *  pinch — e.g. flipping to rain mid-fight to extinguish a spreading grass fire. */
const PLAYER_WEATHER_SWAP_COOLDOWN_SEC = 4.5;

function computeFlamethrowerStreamPressure01() {
  const projPressure = Math.max(0, activeProjectiles.length) / Math.max(1, MAX_PROJECTILES);
  const partPressure = Math.max(0, activeParticles.length) / Math.max(1, MAX_PARTICLES);
  // Projectiles are much more expensive than particles (collision checks per frame),
  // so they get the larger weight in the pressure estimate.
  return Math.max(0, Math.min(1, projPressure * 0.72 + partPressure * 0.28));
}

function pushProjectile(p) {
  // Drop new projectile when saturated: avoids O(n) `shift()` churn under stream spam.
  if (activeProjectiles.length >= MAX_PROJECTILES) return;
  activeProjectiles.push(p);
}

function pushParticle(p) {
  // Same policy as projectiles to prevent reindex storms at particle cap.
  if (activeParticles.length >= MAX_PARTICLES) return;
  activeParticles.push(p);
}

function pushFieldCutArcParticle(type, centerX, centerY, headingRad, opts = {}) {
  const life = Math.max(0.12, Number(opts.lifeSec) || 0.3);
  pushParticle({
    type,
    x: Number(centerX) || 0,
    y: Number(centerY) || 0,
    z: Math.max(0, Number(opts.z) || 0.08),
    vx: 0,
    vy: 0,
    vz: 0,
    life,
    maxLife: life,
    headingRad: Number(headingRad) || 0,
    arcDeg: Math.max(30, Number(opts.arcDeg) || 120),
    radiusTiles: Math.max(0.3, Number(opts.radiusTiles) || 1.25)
  });
}

export function spawnFieldCutVineSlashFx(centerX, centerY, headingRad, opts = {}) {
  pushFieldCutArcParticle('fieldCutVineArc', centerX, centerY, headingRad, {
    ...opts,
    arcDeg: opts.arcDeg ?? FIELD_CUT_VINE_ARC_DEG,
    radiusTiles: opts.radiusTiles ?? 1.55,
    lifeSec: opts.lifeSec ?? 0.36
  });
}

export function spawnFieldCutPsychicSlashFx(centerX, centerY, headingRad, opts = {}) {
  pushFieldCutArcParticle('fieldCutPsychicArc', centerX, centerY, headingRad, {
    ...opts,
    arcDeg: opts.arcDeg ?? FIELD_CUT_PSYCHIC_ARC_DEG,
    radiusTiles: opts.radiusTiles ?? 1.62,
    lifeSec: opts.lifeSec ?? 0.34
  });
}

export function spawnFieldCutSlashFx(centerX, centerY, headingRad, opts = {}) {
  pushFieldCutArcParticle('fieldCutSlashArc', centerX, centerY, headingRad, {
    ...opts,
    arcDeg: opts.arcDeg ?? 108,
    radiusTiles: opts.radiusTiles ?? 1.46,
    lifeSec: opts.lifeSec ?? 0.28
  });
}

export function spawnFieldSpinAttackFx(centerX, centerY, headingRad, opts = {}) {
  const life = Math.max(0.16, Number(opts.lifeSec) || 0.4);
  pushParticle({
    type: 'fieldSpinAttack',
    styleId: String(opts.styleId || 'slash'),
    windTex: !!opts.windTex,
    x: Number(centerX) || 0,
    y: Number(centerY) || 0,
    z: Math.max(0, Number(opts.z) || 0.08),
    vx: 0,
    vy: 0,
    vz: 0,
    life,
    maxLife: life,
    headingRad: Number(headingRad) || 0,
    radiusTiles: Math.max(0.6, Number(opts.radiusTiles) || 2)
  });
}

/**
 * Burst FX at the given world tile coords (sub-tile ok — matches projectile impact, not snapped to cell center).
 * `effectZ` is world height (tiles).
 */
export function spawnHitParticles(x, y, effectZ) {
  const zz = Number(effectZ) || 0;
  const budget = Math.min(8, MAX_PARTICLES - activeParticles.length);
  for (let i = 0; i < budget; i++) {
    const offA = Math.random() * Math.PI * 2;
    const velA = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    const life = 0.28 + Math.random() * 0.28;
    const r0 = Math.random() * 0.22;
    pushParticle({
      type: 'burst',
      x: x + Math.cos(offA) * r0,
      y: y + Math.sin(offA) * r0,
      vx: Math.cos(velA) * speed,
      vy: Math.sin(velA) * speed,
      z: zz + 0.5,
      vz: 4 + Math.random() * 3,
      life,
      maxLife: 0.56
    });
  }
}

/** @param {number} [baseZ] — match parent projectile z so trails align when casting from flight (projectiles use `sourceEntity.z`). */
function spawnTrailParticle(px, py, trailType, baseZ = 0) {
  const spread = 0.18;
  const bz = Number(baseZ) || 0;
  pushParticle({
    type: trailType,
    x: px + (Math.random() - 0.5) * spread,
    y: py + (Math.random() - 0.5) * spread,
    vx: (Math.random() - 0.5) * 1.6,
    vy: (Math.random() - 0.5) * 1.6,
    z: bz + 0.15 + Math.random() * 0.25,
    vz: 0.8 + Math.random() * 1.6,
    life: 0.42,
    maxLife: 0.42
  });
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
function resolveMoveRuntimeAlias(moveId) {
  switch (String(moveId || '')) {
    case 'absorb':
    case 'megaDrain':
      return 'bubbleBeam';
    case 'acid':
    case 'sludge':
      return 'poisonSting';
    case 'smog':
      return 'poisonPowder';
    case 'auroraBeam':
    case 'iceBeam':
      return 'bubbleBeam';
    case 'blizzard':
      return 'bubble';
    case 'dragonRage':
      return 'incinerate';
    case 'dreamEater':
    case 'nightShade':
      return 'confusion';
    case 'fireBlast':
      return 'incinerate';
    case 'fireSpin':
      return 'flamethrower';
    case 'gust':
    case 'razorWind':
      return 'silkShoot';
    case 'hydroPump':
      return 'waterGun';
    case 'hyperBeam':
      return 'prismaticLaser';
    case 'petalDance':
      return 'bubble';
    case 'psychic':
      return 'psybeam';
    case 'psywave':
      return 'confusion';
    case 'solarBeam':
      return 'prismaticLaser';
    case 'sonicBoom':
    case 'swift':
      return 'psybeam';
    case 'surf':
      return 'waterGun';
    case 'thunderbolt':
      return 'thunder';
    case 'triAttack':
      return 'prismaticLaser';
    default:
      return String(moveId || '');
  }
}

export function castMoveById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  moveId = resolveMoveRuntimeAlias(moveId);
  if (moveId === 'ember') return castEmber(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'flamethrower') return castFlamethrowerMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'confusion') return castConfusionMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'bubble') return castBubbleMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'waterBurst') return castWaterBurst(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'waterGun') return castWaterGunMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'bubbleBeam') return castBubbleBeamMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'psybeam') return castPsybeamMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'prismaticLaser') return castPrismaticLaserMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'poisonSting') return castPoisonSting(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'poisonPowder') return castPoisonPowderMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'incinerate') return castIncinerateMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'silkShoot') return castSilkShootMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'thunder') return castThunderMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'thunderShock') return castThundershockMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'rainDance') return castRainDanceMove(sourceEntity);
  if (moveId === 'sunnyDay') return castSunnyDayMove(sourceEntity);
  return false;
}

/**
 * Charged variant dispatch (falls back to normal if no dedicated charge impl).
 */
export function castMoveChargedById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  moveId = resolveMoveRuntimeAlias(moveId);
  if (moveId === 'ember') return castEmberCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'waterBurst') return castWaterCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'thunder') return castThunderCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  return castMoveById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity);
}

/**
 * True when the given move has a dedicated charged variant (mirrors the `castMoveChargedById`
 * dispatch). HUD uses this to decide whether to reveal the 3-segment charge meter while holding.
 * Keep in sync with the dispatch above.
 * @param {string} moveId
 */
export function moveSupportsChargedRelease(moveId) {
  const resolved = resolveMoveRuntimeAlias(moveId);
  return resolved === 'ember' || resolved === 'waterBurst' || resolved === 'thunder';
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

/**
 * One flamethrower stream puff toward floor aim (short cooldown). Used for hold-stream and hotkey taps.
 * @returns {boolean} true when a puff was spawned
 */
export function tryCastPlayerFlamethrowerStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerFlamethrowerCooldown > 0) return false;
  const pressure01 = computeFlamethrowerStreamPressure01();
  const streamCadence =
    FLAMETHROWER_STREAM_INTERVAL +
    (FLAMETHROWER_STREAM_INTERVAL_MAX - FLAMETHROWER_STREAM_INTERVAL) * pressure01;
  const streamQuality = 1 - pressure01 * 0.5;
  const streamTrailMul = 1 + pressure01 * 1.05;
  playerFlamethrowerCooldown = streamCadence;
  bumpPlayerMoveCastVisual(sourceEntity);
  castFlamethrower(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    streamPuff: true,
    streamQuality,
    streamTrailMul
  });
  return true;
}

/**
 * One prismatic laser stream puff (hold / hotkey). Same idea as flamethrower stream.
 * @returns {boolean} true when a puff was spawned
 */
export function tryCastPlayerPrismaticStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerPrismaticLaserCooldown > 0) return false;
  playerPrismaticLaserCooldown = PRISMATIC_STREAM_INTERVAL;
  bumpPlayerMoveCastVisual(sourceEntity);
  castPrismaticLaser(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    streamPuff: true
  });
  return true;
}

export function castFlamethrowerMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerFlamethrowerStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
}

/**
 * One water-gun stream puff toward floor aim (short cadence like flamethrower).
 * @returns {boolean} true when a puff was spawned
 */
export function tryCastPlayerWaterGunStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerWaterGunCooldown > 0) return false;
  playerWaterGunCooldown = WATER_GUN_STREAM_INTERVAL;
  bumpPlayerMoveCastVisual(sourceEntity);
  castWaterGun(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    streamPuff: true
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
  return tryCastPlayerWaterGunStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
}

/**
 * One bubble-beam stream puff toward floor aim (white hollow bubbles, long range).
 * @returns {boolean} true when a puff was spawned
 */
export function tryCastPlayerBubbleBeamStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerBubbleBeamCooldown > 0) return false;
  playerBubbleBeamCooldown = BUBBLE_BEAM_STREAM_INTERVAL;
  bumpPlayerMoveCastVisual(sourceEntity);
  castBubbleBeam(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    streamPuff: true
  });
  return true;
}

export function castBubbleBeamMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerBubbleBeamStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
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

/** Mouse / slot release after holding Psybeam (same gameplay as hotkey cast). */
export function tryReleasePlayerPsybeam(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return castPsybeamMove(sourceX, sourceY, targetX, targetY, sourceEntity);
}

export function castPrismaticLaserMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerPrismaticStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
}

/**
 * One Thundershock stream puff (hold / tap). Short cooldown so held input chains into a
 * near-continuous crackling yellow arc between user and aim. Mirrors the flamethrower /
 * prismatic-laser stream pattern.
 * @returns {boolean} true when a puff was spawned
 */
export function tryCastPlayerThundershockStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerThundershockCooldown > 0) return false;
  playerThundershockCooldown = THUNDERSHOCK_STREAM_INTERVAL_SEC;
  bumpPlayerMoveCastVisual(sourceEntity);
  castThundershock(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile
  });
  return true;
}

export function castThundershockMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerThundershockStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
}

/**
 * Rain Dance — instant-cast status move that queues a transition to the `rain` weather
 * preset. No projectile, no aim; the smoothing pass in main.js handles the visual fade.
 * Gated by its own cooldown so the player can't strobe weather on every frame.
 */
export function castRainDanceMove(sourceEntity = null) {
  if (playerRainDanceCooldown > 0) return false;
  playerRainDanceCooldown = PLAYER_WEATHER_SWAP_COOLDOWN_SEC;
  // Share cooldown with Sunny Day so the pair feels like a single "weather swap" tool —
  // spamming both back-to-back would otherwise bypass either's individual cooldown.
  playerSunnyDayCooldown = Math.max(playerSunnyDayCooldown, PLAYER_WEATHER_SWAP_COOLDOWN_SEC);
  bumpPlayerMoveCastVisual(sourceEntity);
  castRainDance();
  return true;
}

/**
 * Sunny Day — instant-cast status move that queues a transition to the `clear` weather
 * preset at max intensity (clears the sky). Mirrors `castRainDanceMove` in cooldown
 * behavior; they share the swap-cooldown to prevent ping-ponging.
 */
export function castSunnyDayMove(sourceEntity = null) {
  if (playerSunnyDayCooldown > 0) return false;
  playerSunnyDayCooldown = PLAYER_WEATHER_SWAP_COOLDOWN_SEC;
  playerRainDanceCooldown = Math.max(playerRainDanceCooldown, PLAYER_WEATHER_SWAP_COOLDOWN_SEC);
  bumpPlayerMoveCastVisual(sourceEntity);
  castSunnyDay();
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

/**
 * Thunder / Thunderbolt: summons a yellow storm cell at the cursor tile and drops a
 * yellow lightning bolt a beat later. Visual + ignition reuse the rain lightning
 * system; damage is applied when the bolt lands (see `thunder-move.js`).
 */
export function castThunderMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerThunderCooldown > 0) return false;
  // Tap (no charge) = weakest "zap" tier. Charged releases route through castThunderCharged.
  playerThunderCooldown = PLAYER_THUNDER_COOLDOWN_BY_LEVEL[1];
  bumpPlayerMoveCastVisual(sourceEntity);
  scheduleThunderStrike(targetX, targetY, sourceEntity, { fromWild: false, level: 1 });
  return true;
}

/**
 * Charged Thunder release. Maps `charge01` to one of three distinct takes:
 *   - below first full bar → tier 1 (quick zap)
 *   - first bar filled     → tier 2 (standard thunderbolt)
 *   - second bar or more   → tier 3 (triple-fork mega strike)
 */
export function castThunderCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerThunderCooldown > 0) return false;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  let level = 1;
  if (isChargeStrongAttackEligible(cp)) {
    // getChargeLevel returns 1|2|3 for eligible charges. Map directly to thunder tiers.
    const cl = getChargeLevel(cp);
    level = cl >= 3 ? 3 : cl >= 2 ? 2 : 2; // L1 charged-release still feels like tier 2
  }
  playerThunderCooldown = PLAYER_THUNDER_COOLDOWN_BY_LEVEL[level] ?? PLAYER_THUNDER_COOLDOWN_SEC;
  bumpPlayerMoveCastVisual(sourceEntity);
  scheduleThunderStrike(targetX, targetY, sourceEntity, { fromWild: false, level });
  return true;
}

export function castEmberCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerEmberCooldown > 0) return false;
  playerEmberCooldown = 0.48;
  bumpPlayerMoveCastVisual(sourceEntity);
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  const chargePower = isChargeStrongAttackEligible(cp)
    ? Math.max(0.12, cp)
    : Math.max(0.14, 0.18 + 0.48 * getWeakPartialChargeT(cp, 0));
  castEmberVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    chargePower
  });
  return true;
}

export function castWaterCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerWaterCooldown > 0) return false;
  playerWaterCooldown = 0.58;
  bumpPlayerMoveCastVisual(sourceEntity);
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  const chargePower = isChargeStrongAttackEligible(cp)
    ? Math.max(0.1, cp)
    : Math.max(0.12, 0.17 + 0.5 * getWeakPartialChargeT(cp, 0));
  castWaterBurstVolley(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    chargePower
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
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.02;
  const maxRing = 11;
  const n = 18;
  for (let i = 0; i < n; i++) {
    const ringA = (i / n) * Math.PI * 2;
    const a = ringA * 0.55 + aimA * 0.45;
    const speed = 11.5 + (i % 3) * 0.6;
    const rawTx = sourceX + Math.cos(a) * maxRing;
    const rawTy = sourceY + Math.sin(a) * maxRing;
    const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, rawTx, rawTy, 0.22);
    const { vx, vy, vz, timeToLive } = velocityFromToGroundWithHorizontalRangeFrom(
      sp.startX,
      sp.startY,
      sp.startZ,
      rawTx,
      rawTy,
      sourceX,
      sourceY,
      speed,
      maxRing,
      { ttlMargin: 1.08, ttlPad: 0.08 }
    );
    const isEmber = i % 2 === 0;
    pushProjectile({
      type: isEmber ? 'ember' : 'waterShot',
      x: sp.startX,
      y: sp.startY,
      vx,
      vy,
      vz,
      z: sp.startZ,
      radius: isEmber ? 0.36 : 0.3,
      timeToLive,
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
  const beh = getEffectiveWildBehavior(entity);
  if (beh.archetype !== 'aggressive') return;
  if (entity.aiState !== 'approach') return;
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
  entity.wildMoveCd = WILD_MOVE_COOLDOWN_DEFAULT * getWildAggressiveMoveCooldownMultiplier(entity);
  playWildAttackCry(entity);
}

/**
 * Max cooldown per move for HUD clock (use longest variant where applicable). Keep in sync with cast assignments.
 * @param {string} moveId
 */
export function getPlayerMoveCooldownUiMax(moveId) {
  if (String(moveId || '').startsWith('field:')) return 1;
  moveId = resolveMoveRuntimeAlias(moveId);
  switch (moveId) {
    case 'ember':
      return 0.48;
    case 'waterBurst':
      return 0.58;
    case 'poisonSting':
      return 0.45;
    case 'flamethrower':
      return FLAMETHROWER_STREAM_INTERVAL;
    case 'confusion':
      return 0.6;
    case 'bubble':
      return 0.55;
    case 'waterGun':
      return WATER_GUN_STREAM_INTERVAL;
    case 'bubbleBeam':
      return BUBBLE_BEAM_STREAM_INTERVAL;
    case 'psybeam':
      return 0.75;
    case 'prismaticLaser':
      return PRISMATIC_STREAM_INTERVAL;
    case 'poisonPowder':
      return 0.95;
    case 'incinerate':
      return 0.78;
    case 'silkShoot':
      return 0.72;
    case 'thunder':
      // Use heaviest tier so the HUD clock covers the max charged release.
      return PLAYER_THUNDER_COOLDOWN_BY_LEVEL[3];
    case 'thunderShock':
      return THUNDERSHOCK_STREAM_INTERVAL_SEC;
    case 'rainDance':
    case 'sunnyDay':
      return PLAYER_WEATHER_SWAP_COOLDOWN_SEC;
    case 'ultimate':
      return 7.5;
    default:
      return 1;
  }
}

/**
 * Remaining player cooldown (seconds) for a move id. Used by play HUD.
 * @param {string} moveId
 * @returns {number}
 */
export function getPlayerMoveCooldownRemaining(moveId) {
  if (String(moveId || '').startsWith('field:')) return 0;
  moveId = resolveMoveRuntimeAlias(moveId);
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
    case 'bubbleBeam':
      return playerBubbleBeamCooldown;
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
    case 'thunder':
      return playerThunderCooldown;
    case 'thunderShock':
      return playerThundershockCooldown;
    case 'rainDance':
      return playerRainDanceCooldown;
    case 'sunnyDay':
      return playerSunnyDayCooldown;
    case 'ultimate':
      return playerUltimateCooldown;
    default:
      return 0;
  }
}

/**
 * @param {number} dt
 * @param {Iterable<object>} wildPokemonList
 * @param {object | null} data map macro data (grass fire / terrain queries)
 * @param {import('../player.js').player} player
 */
export function updateMoves(dt, wildPokemonList, data, player) {
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
  playerBubbleBeamCooldown = Math.max(0, playerBubbleBeamCooldown - dt);
  playerPsybeamCooldown = Math.max(0, playerPsybeamCooldown - dt);
  playerPrismaticLaserCooldown = Math.max(0, playerPrismaticLaserCooldown - dt);
  playerPoisonPowderCooldown = Math.max(0, playerPoisonPowderCooldown - dt);
  playerIncinerateCooldown = Math.max(0, playerIncinerateCooldown - dt);
  playerSilkShootCooldown = Math.max(0, playerSilkShootCooldown - dt);
  playerThunderCooldown = Math.max(0, playerThunderCooldown - dt);
  playerThundershockCooldown = Math.max(0, playerThundershockCooldown - dt);
  playerRainDanceCooldown = Math.max(0, playerRainDanceCooldown - dt);
  playerSunnyDayCooldown = Math.max(0, playerSunnyDayCooldown - dt);

  const wildList = Array.isArray(wildPokemonList) ? wildPokemonList : [...wildPokemonList];
  const wildSpatial = buildWildSpatialIndex(wildList);

  // Thunder-move strikes: when a scheduled cloud's bolt delay elapses, fire the
  // yellow ground strike + splash-damage nearby wild pokemon.
  tickThunderStrikes(dt, wildList, data, wildSpatial);

  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      activeParticles.splice(i, 1);
      continue;
    }
    if (p.type === 'grassFire') {
      // Flames die with their tile: if the tile is no longer in `burning` phase
      // (extinguished by water or snuffed by rain), drop the particle immediately
      // so visible flames clear within one frame instead of riding out their full life.
      const mx = Math.floor(p.x);
      const my = Math.floor(p.y);
      if (grassFireVisualPhaseAt(mx, my) !== 'burning') {
        activeParticles.splice(i, 1);
        continue;
      }
      p.z = 0.08;
      continue;
    }
    if (
      p.type === 'fieldCutVineArc' ||
      p.type === 'fieldCutPsychicArc' ||
      p.type === 'fieldCutSlashArc' ||
      p.type === 'fieldSpinAttack' ||
      p.type === 'rainFootSplash'
    ) {
      continue;
    }
    const pzPrev = p.z;
    const vzParticle = p.vz;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.vz -= 30.0 * dt;
    if (p.z <= 0) {
      if (pzPrev > 0.03 && vzParticle < -0.22) {
        playFloorHit2Sfx({ x: p.x, y: p.y, z: 0 });
      }
      p.z = 0;
      p.vz = 0;
      p.vx *= 0.82;
      p.vy *= 0.82;
    }
  }

  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const proj = activeProjectiles[i];

    if (proj.type === 'psybeamBeam' || proj.type === 'thunderShockBeam') {
      proj.timeToLive -= dt;
      const sx0 = proj.beamStartX;
      const sy0 = proj.beamStartY;
      const sx1 = proj.beamEndX;
      const sy1 = proj.beamEndY;
      const halfW = proj.beamHalfWidth ?? 0.26;
      const zBeam = proj.z ?? 0;

      if (proj.trailAcc != null) {
        proj.trailAcc += dt;
        const interval = PSY_TRAIL_INTERVAL * 1.35;
        let budget = 4;
        while (proj.trailAcc >= interval && budget-- > 0) {
          proj.trailAcc -= interval;
          const u = Math.random();
          const px = sx0 + (sx1 - sx0) * u + (Math.random() - 0.5) * 0.06;
          const py = sy0 + (sy1 - sy0) * u + (Math.random() - 0.5) * 0.06;
          spawnTrailParticle(px, py, 'psyTrail', zBeam);
        }
      }

      if (proj.hitsPlayer && !proj.playerBeamHitDone) {
        const px = player.visualX ?? player.x;
        const py = player.visualY ?? player.y;
        const dex = player.dexId ?? 1;
        const { hx, hy } = getPokemonHurtboxCenterWorldXY(px, py, dex);
        if (projectileZInPokemonHurtbox(zBeam, dex, player.z ?? 0)) {
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (distPointToSegmentTiles(hx, hy, sx0, sy0, sx1, sy1) <= halfW + hurtR) {
            const poison = false;
            if (tryDamagePlayerFromProjectile(proj.damage, poison, data)) {
              spawnHitParticles(hx, hy, player.z ?? 0);
            }
            proj.playerBeamHitDone = true;
          }
        }
      }

      if (proj.hitsWild) {
        const set = proj.psyHitWild instanceof Set ? proj.psyHitWild : (proj.psyHitWild = new Set());
        const pad = COLLISION_BROAD_PHASE_TILES + 1.2;
        const minX = Math.min(sx0, sx1) - pad;
        const maxX = Math.max(sx0, sx1) + pad;
        const minY = Math.min(sy0, sy1) - pad;
        const maxY = Math.max(sy0, sy1) + pad;
        queryWildSpatialIndexInAabb(wildSpatial, minX, minY, maxX, maxY, ({ wild, hx, hy, dex, z }) => {
          if (wild === proj.sourceEntity) return;
          if (set.has(wild)) return;
          if (!projectileZInPokemonHurtbox(zBeam, dex, z)) return;
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (distPointToSegmentTiles(hx, hy, sx0, sy0, sx1, sy1) > halfW + hurtR) return;
          if (wild.takeDamage) wild.takeDamage(proj.damage);
          if (proj.hasTackleTrait) applyWildKnockbackFromProjectile(wild, proj);
          spawnHitParticles(hx, hy, z);
          set.add(wild);
        });
      }

      if (proj.hasTackleTrait && data) {
        const detailSet =
          proj.psyHitDetails instanceof Set ? proj.psyHitDetails : (proj.psyHitDetails = new Set());
        tryBreakDetailsAlongSegment(sx0, sy0, sx1, sy1, data, { worldHitOnceSet: detailSet, hitSource: 'tackle', pz: zBeam });
      }

      if (proj.timeToLive <= 0) {
        emitProjectileWorldReactionOnce(proj, data, (sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5);
        activeProjectiles.splice(i, 1);
      }
      continue;
    }

    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    if (Number.isFinite(proj.vz)) {
      const zPrev = Number(proj.z) || 0;
      proj.z += proj.vz * dt;
      if (zPrev > 0.006 && proj.z <= 0) {
        playFloorHit2Sfx({ x: proj.x, y: proj.y, z: 0 });
        proj.z = 0;
        proj.vz = 0;
      }
    }

    proj.timeToLive -= dt;
    if (proj.timeToLive <= 0) {
      emitProjectileWorldReactionOnce(proj, data, proj.x, proj.y);
      if (proj.type === 'incinerateCore') {
        spawnHitParticles(proj.x, proj.y, 0);
          applySplashToWild(proj, wildList, 0, wildSpatial);
        spawnIncinerateShards(proj, pushProjectile, 0);
      } else if (proj.type === 'confusionOrb') {
        spawnHitParticles(proj.x, proj.y, 0);
          applySplashToWild(proj, wildList, 0, wildSpatial);
      }
      if (data) {
        const zz = Math.max(0, Number(proj.z) || 0);
        if (grassFireTryIgniteAt(proj.x, proj.y, zz, proj.type, data)) {
          pushParticle({
            type: 'grassFire',
            x: proj.x,
            y: proj.y,
            vx: 0,
            vy: 0,
            z: 0.06,
            vz: 0,
            life: GRASS_FIRE_PARTICLE_SEC,
            maxLife: GRASS_FIRE_PARTICLE_SEC
          });
        }
        tryApplyFireHitToFormalTreesAt(proj.x, proj.y, zz, proj.type, data);
        grassFireTryExtinguishAt(proj.x, proj.y, zz, proj.type, data);
      }
      activeProjectiles.splice(i, 1);
      continue;
    }

    const trailType =
      proj.type === 'ember'
        ? 'emberTrail'
        : proj.type === 'waterShot' || proj.type === 'waterGunShot' || proj.type === 'bubbleShot' || proj.type === 'bubbleBeamShot'
          ? 'waterTrail'
          : proj.type === 'poisonPowderShot'
            ? 'powderTrail'
            : proj.type === 'silkShot'
              ? 'silkTrail'
              : proj.type === 'confusionOrb'
                ? 'psyTrail'
                : proj.type === 'prismaticShot'
                  ? 'laserTrail'
                  : proj.type === 'flamethrowerShot'
                    ? 'emberTrail'
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
      const effectiveInterval =
        trailType === 'emberTrail' && Number.isFinite(proj.trailIntervalMul)
          ? interval * Math.max(1, Number(proj.trailIntervalMul))
          : interval;
      let trailBudget = 2;
      while (proj.trailAcc >= effectiveInterval && trailBudget-- > 0) {
        proj.trailAcc -= effectiveInterval;
        spawnTrailParticle(proj.x, proj.y, trailType, proj.z);
      }
      if (trailBudget <= 0 && proj.trailAcc > effectiveInterval * 3) {
        // Prevent runaway catch-up after frame spikes.
        proj.trailAcc = effectiveInterval * 3;
      }
    }

    let runCollisionChecks = true;
    if (proj.type === 'flamethrowerShot' && proj.streamShot) {
      proj.hitTickAcc = (Number(proj.hitTickAcc) || 0) + dt;
      if (proj.hitTickAcc < FLAMETHROWER_STREAM_HIT_TICK_SEC) {
        runCollisionChecks = false;
      } else {
        proj.hitTickAcc = Math.min(
          proj.hitTickAcc - FLAMETHROWER_STREAM_HIT_TICK_SEC,
          FLAMETHROWER_STREAM_HIT_TICK_SEC
        );
      }
    }
    if (!runCollisionChecks) continue;

    if (data && isProjectileBlockedByTree(proj, data)) {
      emitProjectileWorldReactionOnce(proj, data, proj.x, proj.y);
      const impactZ = Math.max(0, Number(proj.z) || 0);
      spawnHitParticles(proj.x, proj.y, impactZ);
      tryApplyFireHitToFormalTreesAt(proj.x, proj.y, impactZ, proj.type, data);
      if (proj.type === 'incinerateCore') {
        applySplashToWild(proj, wildList, impactZ, wildSpatial);
        spawnIncinerateShards(proj, pushProjectile, impactZ);
      }
      activeProjectiles.splice(i, 1);
      continue;
    }

    let hit = false;

    if (proj.hitsPlayer && checkPlayerHit(proj, player)) {
      const poisonCapable = proj.type === 'poisonSting' || proj.type === 'poisonPowderShot';
      const poisonChance = proj.poisonChance != null ? proj.poisonChance : 0.22;
      const poison = poisonCapable && Math.random() < poisonChance;
      const pz = player.z ?? 0;
      if (tryDamagePlayerFromProjectile(proj.damage, poison, data)) {
        spawnHitParticles(proj.x, proj.y, pz);
      }
      if (proj.type === 'incinerateCore') {
        spawnIncinerateShards(proj, pushProjectile, pz);
      }
      hit = true;
    }

    if (!hit && proj.hitsWild) {
      const pad = COLLISION_BROAD_PHASE_TILES;
      queryWildSpatialIndexInAabb(
        wildSpatial,
        proj.x - pad,
        proj.y - pad,
        proj.x + pad,
        proj.y + pad,
        ({ wild, hx, hy, dex, z }) => {
          if (hit) return;
          if (wild === proj.sourceEntity) return;
          if (!broadPhaseOk(proj.x, proj.y, hx, hy)) return;
          if (!projectileZInPokemonHurtbox(proj.z, dex, z)) return;
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (!checkDamageHitCircle(proj.x, proj.y, proj.radius, hx, hy, hurtR)) return;
          if (wild.takeDamage) wild.takeDamage(proj.damage);
          if (proj.hasTackleTrait) applyWildKnockbackFromProjectile(wild, proj);
          spawnHitParticles(proj.x, proj.y, z);
          if (proj.type === 'incinerateCore' || proj.type === 'confusionOrb') {
            applySplashToWild(proj, wildList, undefined, wildSpatial);
          }
          if (proj.type === 'incinerateCore') {
            spawnIncinerateShards(proj, pushProjectile, z);
          }
          hit = true;
        }
      );
    }

    if (hit) {
      emitProjectileWorldReactionOnce(proj, data, proj.x, proj.y);
      activeProjectiles.splice(i, 1);
    }
  }
}
