import {
  MAX_PARTICLES,
  MAX_PROJECTILES,
  EMBER_TRAIL_INTERVAL,
  WATER_TRAIL_INTERVAL,
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
  castHydroPump,
  castBubbleBeam,
  castPsybeam,
  castPrismaticLaser,
  computePrismaticPlayerStreamGeometry,
  castSteelBeam,
  computeSteelBeamPlayerStreamGeometry,
  castWaterCannon,
  computeWaterCannonPlayerStreamGeometry,
  castPoisonPowder,
  castIncinerate,
  castSilkShoot
} from './zelda-ported-moves.js';
import { castFireBlast, PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL } from './fire-blast-move.js';
import {
  beginPlayerFlameCharge,
  tickPlayerFlameChargeDash,
  PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL
} from './flame-charge-move.js';
import {
  resetFireSpinChannel,
  tickFireSpinHold,
  spawnFireSpinReleaseBurst,
  fireSpinTierFromCharge01,
  PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL
} from './fire-spin-move.js';
import { castAbsorbMove } from './absorb-move.js';
import {
  spawnAlongHypotTowardGround,
  velocityFromToGroundWithHorizontalRangeFrom
} from './projectile-ground-hypot.js';
import { updatePlayerCombatTimers, tryDamagePlayerFromProjectile, tryJumpPlayer } from '../player.js';
import { strengthCarryBlocksWalk } from '../main/play-strength-carry.js';
import {
  isChargeStrongAttackEligible,
  getWeakPartialChargeT,
  getChargeLevel,
  getEarthquakeChargeLevel,
  CHARGE_FIELD_RELEASE_MIN_01
} from '../main/play-charge-levels.js';
import { playWildAttackCry } from '../pokemon/pokemon-cries.js';
import {
  grassFireTryExtinguishAt,
  grassFireTryIgniteAt,
  grassFireVisualPhaseAt,
  GRASS_FIRE_PARTICLE_SEC
} from '../play-grass-fire.js';
import {
  getEffectiveWildBehavior,
  getWildAggressiveMoveCooldownMultiplier
} from '../wild-pokemon/wild-effective-behavior.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';
import { buildWildSpatialIndex } from './moves-projectile-collision.js';
import { playFloorHit2Sfx } from '../audio/floor-hit-2-sfx.js';
import { scheduleThunderStrike, tickThunderStrikes } from './thunder-move.js';
import { castThundershock, THUNDERSHOCK_STREAM_INTERVAL_SEC } from './thunder-shock-move.js';
import {
  castThunderboltAtLevel,
  tickThunderboltChains,
  PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL
} from './thunderbolt-move.js';
import { castRainDance, castSunnyDay, castBlizzard } from './weather-moves.js';
import { tickActiveProjectiles } from './moves-projectiles-tick.js';
import { PluginRegistry } from '../core/plugin-registry.js';
import {
  MOVE_CAST_VIS_SEC,
  FLAMETHROWER_STREAM_INTERVAL,
  FLAMETHROWER_STREAM_INTERVAL_MAX,
  HYDRO_PUMP_STREAM_INTERVAL,
  BUBBLE_BEAM_STREAM_INTERVAL,
  PLAYER_WATER_GUN_COOLDOWN_BY_LEVEL,
  PRISMATIC_STREAM_INTERVAL,
  STEEL_BEAM_STREAM_INTERVAL,
  WATER_CANNON_STREAM_INTERVAL,
  PLAYER_THUNDER_COOLDOWN_SEC,
  PLAYER_THUNDER_COOLDOWN_BY_LEVEL,
  PLAYER_WEATHER_SWAP_COOLDOWN_SEC
} from './moves-player-config.js';

/** Cooldown after Earthquake, by charge level (5-bar meter on play HUD). */
const PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL = Object.freeze({
  1: 0.92,
  2: 1.12,
  3: 1.38,
  4: 1.68,
  5: 2.02
});

const EARTHQUAKE_JUMP_SCALE_BY_LEVEL = Object.freeze([1, 1.08, 1.2, 1.38, 1.56]);

/** Latest `data` from `updateMoves` — used when enqueuing Thunderbolt L4 chain hops (tree search). */
let lastMovesTickData = null;

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
let playerHydroPumpCooldown = 0;
let playerBubbleBeamCooldown = 0;
let playerPsybeamCooldown = 0;
let playerPrismaticLaserCooldown = 0;
/** Single merged gradient beam while Prismatic Laser is held (see `updatePlayerPrismaticMergedBeamVisual`). */
let playerPrismaticMergedBeam = null;
let playerSteelBeamCooldown = 0;
/** Merged hold beam for Steel Beam (silver). */
let playerSteelBeamMergedBeam = null;
let playerWaterCannonCooldown = 0;
let playerWaterCannonMergedBeam = null;
let playerPoisonPowderCooldown = 0;
let playerIncinerateCooldown = 0;
let playerFireBlastCooldown = 0;
let playerFlameChargeCooldown = 0;
let playerFireSpinCooldown = 0;
let playerEarthquakeCooldown = 0;
let playerSilkShootCooldown = 0;
let playerThunderCooldown = 0;
let playerThundershockCooldown = 0;
let playerThunderboltCooldown = 0;
let playerAbsorbCooldown = 0;
/** Shared gate for Rain Dance / Sunny Day / Blizzard so weather cannot be spam-strobed. */
let playerWeatherSwapCooldown = 0;

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

export function pushParticle(p) {
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
    arcDeg: opts.arcDeg ?? FIELD_CUT_VINE_ARC_DEG
  });
}

export function spawnFieldCutPsychicSlashFx(centerX, centerY, headingRad, opts = {}) {
  pushFieldCutArcParticle('fieldCutPsychicArc', centerX, centerY, headingRad, {
    ...opts,
    arcDeg: opts.arcDeg ?? FIELD_CUT_PSYCHIC_ARC_DEG
  });
}

export function spawnFieldCutScratchFx(centerX, centerY, headingRad, opts = {}) {
  pushFieldCutArcParticle('fieldCutScratchArc', centerX, centerY, headingRad, {
    ...opts,
    arcDeg: opts.arcDeg ?? 100
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
    case 'acid':
    case 'sludge':
      return 'poisonSting';
    case 'smog':
      return 'poisonPowder';
    case 'auroraBeam':
    case 'iceBeam':
      return 'bubbleBeam';
    case 'dragonRage':
      return 'incinerate';
    case 'dreamEater':
    case 'nightShade':
      return 'confusion';
    case 'gust':
    case 'razorWind':
      return 'silkShoot';
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
    case 'triAttack':
      return 'prismaticLaser';
    default:
      return String(moveId || '');
  }
}

export function castMoveById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  moveId = resolveMoveRuntimeAlias(moveId);
  if (PluginRegistry.hasMove(moveId)) {
    if (PluginRegistry.getCooldown(moveId) > 0) return false;
    const mod = PluginRegistry.getMove(moveId);
    PluginRegistry.setCooldown(moveId, mod.cooldownSec || 0.5);
    bumpPlayerMoveCastVisual(sourceEntity);
    if (mod.cast) mod.cast(sourceX, sourceY, targetX, targetY, sourceEntity, { pushProjectile, pushParticle });
    return true;
  }
  if (moveId === 'ember') return castEmber(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'absorb' || moveId === 'megaDrain') return castAbsorbMoveWrapped(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'flamethrower') return castFlamethrowerMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'confusion') return castConfusionMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'bubble') return castBubbleMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'waterBurst') return castWaterBurst(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'waterGun') return castWaterGunMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'hydroPump') return castHydroPumpMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'bubbleBeam') return castBubbleBeamMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'psybeam') return castPsybeamMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'prismaticLaser') return castPrismaticLaserMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'steelBeam') return castSteelBeamMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'waterCannon') return castWaterCannonMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'poisonSting') return castPoisonSting(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'poisonPowder') return castPoisonPowderMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'incinerate') return castIncinerateMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'fireBlast') return castFireBlastMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'flameCharge') return castFlameChargeMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'fireSpin') return castFireSpinMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'earthquake') return castEarthquakeMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'silkShoot') return castSilkShootMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'thunder') return castThunderMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'thunderShock') return castThundershockMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'thunderbolt') return castThunderboltMove(sourceX, sourceY, targetX, targetY, sourceEntity);
  if (moveId === 'rainDance') return castRainDanceMove(sourceEntity);
  if (moveId === 'sunnyDay') return castSunnyDayMove(sourceEntity);
  if (moveId === 'blizzard') return castBlizzardMove(sourceEntity);
  return false;
}

/**
 * Charged variant dispatch (falls back to normal if no dedicated charge impl).
 */
export function castMoveChargedById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  moveId = resolveMoveRuntimeAlias(moveId);
  if (PluginRegistry.hasMove(moveId)) {
    const mod = PluginRegistry.getMove(moveId);
    if (mod.supportsCharge && mod.castCharged) {
      if (PluginRegistry.getCooldown(moveId) > 0) return false;
      PluginRegistry.setCooldown(moveId, mod.cooldownSec || 0.5);
      bumpPlayerMoveCastVisual(sourceEntity);
      mod.castCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01, { pushProjectile, pushParticle });
      return true;
    }
    return castMoveById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity);
  }
  if (moveId === 'ember') return castEmberCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'waterBurst') return castWaterCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'thunder') return castThunderCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'thunderbolt') return castThunderboltCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'fireBlast') return castFireBlastCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'flameCharge') return castFlameChargeCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'fireSpin') return castFireSpinCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'earthquake') return castEarthquakeCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  if (moveId === 'waterGun') return castWaterGunCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01);
  return castMoveById(moveId, sourceX, sourceY, targetX, targetY, sourceEntity);
}

/**
 * True when the given move has a dedicated charged variant (mirrors the `castMoveChargedById`
 * dispatch). HUD uses this to decide whether to reveal the 4-segment charge meter while holding.
 * Keep in sync with the dispatch above (`castMoveChargedById` + charged field skills).
 * @param {string} moveId
 */
export function moveSupportsChargedRelease(moveId) {
  const resolved = resolveMoveRuntimeAlias(moveId);
  if (PluginRegistry.hasMove(resolved)) {
    return !!PluginRegistry.getMove(resolved).supportsCharge;
  }
  return (
    resolved === 'ember' ||
    resolved === 'waterBurst' ||
    resolved === 'thunder' ||
    resolved === 'thunderbolt' ||
    resolved === 'fireBlast' ||
    resolved === 'flameCharge' ||
    resolved === 'fireSpin' ||
    resolved === 'earthquake' ||
    resolved === 'waterGun'
  );
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

export function tryCastPlayerAbsorbStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null, data = null) {
  if (playerAbsorbCooldown > 0) return false;
  playerAbsorbCooldown = 0.15;
  bumpPlayerMoveCastVisual(sourceEntity);
  castAbsorbMove(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    streamPuff: true,
    data
  });
  return true;
}

export function castAbsorbMoveWrapped(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerAbsorbStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity, null);
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
 * Updates the one merged Prismatic Laser beam visual (cursor → mouth) while `active`.
 * Clears when the player releases the bound button or switches away.
 */
export function updatePlayerPrismaticMergedBeamVisual(
  active,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceEntity = null
) {
  if (!active) {
    playerPrismaticMergedBeam = null;
    return;
  }
  const geo = computePrismaticPlayerStreamGeometry(sourceX, sourceY, targetX, targetY, sourceEntity);
  const prevHue = playerPrismaticMergedBeam?.rainbowHue0;
  const rainbowHue0 = Number.isFinite(prevHue) ? prevHue : (sourceX * 17 + sourceY * 13) % 360;
  const { sp, aimX, aimY } = geo;
  playerPrismaticMergedBeam = {
    laserBeamSx: sp.startX,
    laserBeamSy: sp.startY,
    laserBeamSz: sp.startZ,
    laserBeamEx: aimX,
    laserBeamEy: aimY,
    laserBeamEz: 0,
    rainbowHue0
  };
}

/** @returns {null | { laserBeamSx: number, laserBeamSy: number, laserBeamSz: number, laserBeamEx: number, laserBeamEy: number, laserBeamEz: number, rainbowHue0: number }} */
export function getPlayerPrismaticMergedBeamVisual() {
  return playerPrismaticMergedBeam;
}

/**
 * Updates merged Steel Beam preview while the bound mouse button is held.
 */
export function updatePlayerSteelBeamMergedBeamVisual(active, sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (!active) {
    playerSteelBeamMergedBeam = null;
    return;
  }
  const geo = computeSteelBeamPlayerStreamGeometry(sourceX, sourceY, targetX, targetY, sourceEntity);
  const { sp, aimX, aimY } = geo;
  playerSteelBeamMergedBeam = {
    laserBeamSx: sp.startX,
    laserBeamSy: sp.startY,
    laserBeamSz: sp.startZ,
    laserBeamEx: aimX,
    laserBeamEy: aimY,
    laserBeamEz: 0
  };
}

export function getPlayerSteelBeamMergedBeamVisual() {
  return playerSteelBeamMergedBeam;
}

export function updatePlayerWaterCannonMergedBeamVisual(active, sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (!active) {
    playerWaterCannonMergedBeam = null;
    return;
  }
  const geo = computeWaterCannonPlayerStreamGeometry(sourceX, sourceY, targetX, targetY, sourceEntity);
  const { sp, aimX, aimY } = geo;
  playerWaterCannonMergedBeam = {
    laserBeamSx: sp.startX,
    laserBeamSy: sp.startY,
    laserBeamSz: sp.startZ,
    laserBeamEx: aimX,
    laserBeamEy: aimY,
    laserBeamEz: 0
  };
}

export function getPlayerWaterCannonMergedBeamVisual() {
  return playerWaterCannonMergedBeam;
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
    pushParticle,
    streamPuff: true
  });
  return true;
}

/** @returns {boolean} true when a puff was spawned */
export function tryCastPlayerSteelBeamStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerSteelBeamCooldown > 0) return false;
  playerSteelBeamCooldown = STEEL_BEAM_STREAM_INTERVAL;
  bumpPlayerMoveCastVisual(sourceEntity);
  castSteelBeam(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    pushParticle,
    streamPuff: true
  });
  return true;
}

export function castSteelBeamMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerSteelBeamStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
}

/** @returns {boolean} true when a puff was spawned */
export function tryCastPlayerWaterCannonStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerWaterCannonCooldown > 0) return false;
  playerWaterCannonCooldown = WATER_CANNON_STREAM_INTERVAL;
  bumpPlayerMoveCastVisual(sourceEntity);
  castWaterCannon(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    pushParticle,
    streamPuff: true
  });
  return true;
}

export function castWaterCannonMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerWaterCannonStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
}

export function castFlamethrowerMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerFlamethrowerStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
}

/**
 * One hydro-pump stream puff (hold). Water Gun uses {@link castWaterGunMove} / {@link castWaterGunCharged}.
 * @returns {boolean} true when a puff was spawned
 */
export function tryCastPlayerHydroPumpStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerHydroPumpCooldown > 0) return false;
  playerHydroPumpCooldown = HYDRO_PUMP_STREAM_INTERVAL;
  bumpPlayerMoveCastVisual(sourceEntity);
  castHydroPump(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    streamPuff: true
  });
  return true;
}

export function castHydroPumpMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  return tryCastPlayerHydroPumpStreamPuff(sourceX, sourceY, targetX, targetY, sourceEntity);
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
  playerWaterGunCooldown = PLAYER_WATER_GUN_COOLDOWN_BY_LEVEL[1];
  bumpPlayerMoveCastVisual(sourceEntity);
  castWaterGun(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    waterGunTier: 1
  });
  return true;
}

/**
 * Charged Water Gun: tier 1 weak partial / tap-equivalent, tier 2 first strong segment, tier 3 two+ segments.
 */
export function castWaterGunCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerWaterGunCooldown > 0) return false;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  let tier = 1;
  if (isChargeStrongAttackEligible(cp)) {
    const cl = getChargeLevel(cp);
    tier = cl >= 3 ? 3 : 2;
  }
  playerWaterGunCooldown = PLAYER_WATER_GUN_COOLDOWN_BY_LEVEL[tier] ?? PLAYER_WATER_GUN_COOLDOWN_BY_LEVEL[2];
  bumpPlayerMoveCastVisual(sourceEntity);
  castWaterGun(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    waterGunTier: tier
  });
  return true;
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
 * Thunderbolt tap — tier **1** (short arc). Charged releases use {@link castThunderboltCharged}.
 */
export function castThunderboltMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerThunderboltCooldown > 0) return false;
  playerThunderboltCooldown = PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL[1];
  bumpPlayerMoveCastVisual(sourceEntity);
  castThunderboltAtLevel(sourceX, sourceY, targetX, targetY, sourceEntity, {
    level: 1,
    fromWild: false,
    pushProjectile,
    data: lastMovesTickData
  });
  return true;
}

/**
 * Charged Thunderbolt — maps the 4-segment meter to tiers **2–4** (see `thunderbolt-move.js`).
 * Weak partial charge (held but below first bar) bumps toward tier 2 like ember/water.
 */
export function castThunderboltCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerThunderboltCooldown > 0) return false;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  let level = 1;
  if (isChargeStrongAttackEligible(cp)) {
    level = getChargeLevel(cp);
  } else {
    const w = getWeakPartialChargeT(cp, 0);
    level = w >= 0.5 ? 2 : 1;
  }
  level = Math.max(1, Math.min(4, level));
  playerThunderboltCooldown =
    PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL[level] ?? PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL[2];
  bumpPlayerMoveCastVisual(sourceEntity);
  castThunderboltAtLevel(sourceX, sourceY, targetX, targetY, sourceEntity, {
    level,
    fromWild: false,
    pushProjectile,
    data: lastMovesTickData
  });
  return true;
}

/**
 * Rain Dance — instant-cast status move that queues a transition to the `rain` weather
 * preset. No projectile, no aim; the smoothing pass in main.js handles the visual fade.
 * Gated by its own cooldown so the player can't strobe weather on every frame.
 */
export function castRainDanceMove(sourceEntity = null) {
  if (playerWeatherSwapCooldown > 0) return false;
  playerWeatherSwapCooldown = PLAYER_WEATHER_SWAP_COOLDOWN_SEC;
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
  if (playerWeatherSwapCooldown > 0) return false;
  playerWeatherSwapCooldown = PLAYER_WEATHER_SWAP_COOLDOWN_SEC;
  bumpPlayerMoveCastVisual(sourceEntity);
  castSunnyDay();
  return true;
}

/**
 * Blizzard — instant-cast status move that queues the `blizzard` weather preset
 * (dense clouds, strong wind, heavy precip + icy tint).
 */
export function castBlizzardMove(sourceEntity = null) {
  if (playerWeatherSwapCooldown > 0) return false;
  playerWeatherSwapCooldown = PLAYER_WEATHER_SWAP_COOLDOWN_SEC;
  bumpPlayerMoveCastVisual(sourceEntity);
  castBlizzard();
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

/**
 * Fire Blast tap — tier **1** (quick puff). Charged releases use {@link castFireBlastCharged}.
 */
export function castFireBlastMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerFireBlastCooldown > 0) return false;
  playerFireBlastCooldown = PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL[1];
  bumpPlayerMoveCastVisual(sourceEntity);
  castFireBlast(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    tier: 1
  });
  return true;
}

/**
 * Charged Fire Blast. Same 3-tier ladder as Thunder: weak tap → standard → heavy (plus tier-3 ★ companions).
 */
export function castFireBlastCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerFireBlastCooldown > 0) return false;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  let tier = 1;
  if (isChargeStrongAttackEligible(cp)) {
    const cl = getChargeLevel(cp);
    tier = cl >= 3 ? 3 : 2;
  }
  playerFireBlastCooldown = PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL[tier] ?? PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL[2];
  bumpPlayerMoveCastVisual(sourceEntity);
  castFireBlast(sourceX, sourceY, targetX, targetY, sourceEntity, {
    fromWild: false,
    pushProjectile,
    tier
  });
  return true;
}

/**
 * Flame Charge tap — tier **1** (short comet hop). Charged releases use {@link castFlameChargeCharged}.
 */
export function castFlameChargeMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerFlameChargeCooldown > 0) return false;
  if (!sourceEntity || strengthCarryBlocksWalk(sourceEntity)) return false;
  if (!beginPlayerFlameCharge(sourceEntity, 1, sourceX, sourceY, targetX, targetY)) return false;
  playerFlameChargeCooldown = PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL[1];
  bumpPlayerMoveCastVisual(sourceEntity);
  return true;
}

/**
 * Charged Flame Charge — 3 tiers: short roll → sustained comet → long inferno run with head bursts + side wisps.
 */
export function castFlameChargeCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerFlameChargeCooldown > 0) return false;
  if (!sourceEntity || strengthCarryBlocksWalk(sourceEntity)) return false;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  let tier = 1;
  if (isChargeStrongAttackEligible(cp)) {
    const cl = getChargeLevel(cp);
    tier = cl >= 3 ? 3 : 2;
  }
  if (!beginPlayerFlameCharge(sourceEntity, tier, sourceX, sourceY, targetX, targetY)) return false;
  playerFlameChargeCooldown =
    PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL[tier] ?? PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL[2];
  bumpPlayerMoveCastVisual(sourceEntity);
  return true;
}

function fireSpinAimUnit(sourceX, sourceY, targetX, targetY) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: dx / len, ny: dy / len };
}

/** Fire Spin tap — small outward burst (tier 1). */
export function castFireSpinMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerFireSpinCooldown > 0) return false;
  if (!sourceEntity || strengthCarryBlocksWalk(sourceEntity)) return false;
  const ch = Number(sourceEntity.fireSpinChannelSec) || 0;
  const cx = (sourceEntity.visualX ?? sourceEntity.x ?? sourceX) + 0.5;
  const cy = (sourceEntity.visualY ?? sourceEntity.y ?? sourceY) + 0.5;
  const { nx, ny } = fireSpinAimUnit(sourceX, sourceY, targetX, targetY);
  spawnFireSpinReleaseBurst(pushProjectile, sourceEntity, cx, cy, nx, ny, 1, ch);
  resetFireSpinChannel(sourceEntity);
  playerFireSpinCooldown = PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL[1];
  bumpPlayerMoveCastVisual(sourceEntity);
  return true;
}

/** Charged Fire Spin release — 3 tiers; burst size / send speed scale with channel time + tier. */
export function castFireSpinCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerFireSpinCooldown > 0) return false;
  if (!sourceEntity || strengthCarryBlocksWalk(sourceEntity)) return false;
  const tier = fireSpinTierFromCharge01(charge01);
  const ch = Number(sourceEntity.fireSpinChannelSec) || 0;
  const cx = (sourceEntity.visualX ?? sourceEntity.x ?? sourceX) + 0.5;
  const cy = (sourceEntity.visualY ?? sourceEntity.y ?? sourceY) + 0.5;
  const { nx, ny } = fireSpinAimUnit(sourceX, sourceY, targetX, targetY);
  spawnFireSpinReleaseBurst(pushProjectile, sourceEntity, cx, cy, nx, ny, tier, ch);
  resetFireSpinChannel(sourceEntity);
  playerFireSpinCooldown =
    PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL[tier] ?? PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL[2];
  bumpPlayerMoveCastVisual(sourceEntity);
  return true;
}

function tryBeginPlayerEarthquakeJump(sourceEntity, charge01) {
  if (!sourceEntity || strengthCarryBlocksWalk(sourceEntity)) return false;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  const level = Math.max(1, Math.min(5, getEarthquakeChargeLevel(cp) || 1));
  const scale = EARTHQUAKE_JUMP_SCALE_BY_LEVEL[level - 1] ?? 1;
  if (!tryJumpPlayer(null, { vzScale: scale })) return false;
  sourceEntity.earthquakeAwaitingLand = true;
  sourceEntity.earthquakeStoredCharge01 = cp;
  return true;
}

/** Earthquake tap — tier 1 jump; impact on landing. */
export function castEarthquakeMove(sourceX, sourceY, targetX, targetY, sourceEntity = null) {
  if (playerEarthquakeCooldown > 0) return false;
  const cp = Math.max(CHARGE_FIELD_RELEASE_MIN_01, 0);
  if (!tryBeginPlayerEarthquakeJump(sourceEntity, cp)) return false;
  playerEarthquakeCooldown = PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[1];
  bumpPlayerMoveCastVisual(sourceEntity);
  return true;
}

/** Charged Earthquake — jump height scales with 5-bar level; landing radius + aftershocks scale with charge. */
export function castEarthquakeCharged(sourceX, sourceY, targetX, targetY, sourceEntity, charge01) {
  if (playerEarthquakeCooldown > 0) return false;
  const cp = Math.max(CHARGE_FIELD_RELEASE_MIN_01, Math.min(1, charge01 || 0));
  if (!tryBeginPlayerEarthquakeJump(sourceEntity, cp)) return false;
  const level = Math.max(1, Math.min(5, getEarthquakeChargeLevel(cp) || 1));
  playerEarthquakeCooldown =
    PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[level] ?? PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[5];
  bumpPlayerMoveCastVisual(sourceEntity);
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
 * Thunder: summons a yellow storm cell at the cursor tile and drops a
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
    // 4 global charge bars → `getChargeLevel` is 2..4 when past the first full segment.
    // Thunder stays a 3-tier move: map the top two segments to the heaviest storm strike.
    const cl = getChargeLevel(cp);
    level = cl >= 3 ? 3 : 2;
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
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} dt
 * @param {object | null} [targetEntity]
 * @param {boolean} [forceWarAttack]
 */
export function tryCastWildMove(entity, targetX, targetY, dt, targetEntity = null, forceWarAttack = false) {
  if (!entity || entity.isDespawning || (entity.spawnPhase ?? 1) < 0.5) return;
  const beh = getEffectiveWildBehavior(entity);
  if (beh.archetype !== 'aggressive' && !forceWarAttack) return;
  if (entity.aiState !== 'approach') return;
  const dx = entity.x - targetX;
  const dy = entity.y - targetY;
  const distP = Math.hypot(dx, dy);
  const stop = beh.stopDist ?? 1.2;
  if (distP > stop + 0.7) return;

  entity.wildMoveCd = (entity.wildMoveCd ?? 0) - dt;
  if (entity.wildMoveCd > 0) return;

  // Temporary test mode: all wild aggro uses melee Cut only.
  const ang = Math.atan2(targetY - entity.y, targetX - entity.x);
  spawnFieldCutSlashFx(entity.x, entity.y, ang, { radiusTiles: 1.28, lifeSec: 0.24, z: 0.06 });
  if (distP <= 1.7) {
    if (targetEntity && typeof targetEntity.takeDamage === 'function') {
      targetEntity.takeDamage(8, entity);
    } else {
      tryDamagePlayerFromProjectile(8, false, null);
      const fx = Math.cos(ang);
      const fy = Math.sin(ang);
      let bestOtherWild = null;
      let bestScore = Infinity;
      for (const other of entitiesByKey.values()) {
        if (!other || other === entity) continue;
        if (other.isDespawning || other.deadState || (other.spawnPhase ?? 1) < 0.5) continue;
        if (typeof other.takeDamage !== 'function') continue;
        const ox = (Number(other.x) || 0) - (Number(entity.x) || 0);
        const oy = (Number(other.y) || 0) - (Number(entity.y) || 0);
        const d = Math.hypot(ox, oy);
        if (d < 0.15 || d > 1.9) continue;
        const dot = (ox * fx + oy * fy) / d;
        if (dot < 0.18) continue;
        const score = d + (1 - dot) * 0.6;
        if (score < bestScore) {
          bestScore = score;
          bestOtherWild = other;
        }
      }
      if (bestOtherWild) bestOtherWild.takeDamage(8, entity);
    }
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
      return Math.max(
        PLAYER_WATER_GUN_COOLDOWN_BY_LEVEL[1],
        PLAYER_WATER_GUN_COOLDOWN_BY_LEVEL[2],
        PLAYER_WATER_GUN_COOLDOWN_BY_LEVEL[3]
      );
    case 'hydroPump':
      return HYDRO_PUMP_STREAM_INTERVAL;
    case 'bubbleBeam':
      return BUBBLE_BEAM_STREAM_INTERVAL;
    case 'psybeam':
      return 0.75;
    case 'prismaticLaser':
      return PRISMATIC_STREAM_INTERVAL;
    case 'steelBeam':
      return STEEL_BEAM_STREAM_INTERVAL;
    case 'waterCannon':
      return WATER_CANNON_STREAM_INTERVAL;
    case 'poisonPowder':
      return 0.95;
    case 'incinerate':
      return 0.78;
    case 'fireBlast':
      return Math.max(
        PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL[1],
        PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL[2],
        PLAYER_FIRE_BLAST_COOLDOWN_BY_LEVEL[3]
      );
    case 'flameCharge':
      return Math.max(
        PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL[1],
        PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL[2],
        PLAYER_FLAME_CHARGE_COOLDOWN_BY_LEVEL[3]
      );
    case 'fireSpin':
      return Math.max(
        PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL[1],
        PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL[2],
        PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL[3]
      );
    case 'earthquake':
      return Math.max(
        PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[1],
        PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[2],
        PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[3],
        PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[4],
        PLAYER_EARTHQUAKE_COOLDOWN_BY_LEVEL[5]
      );
    case 'silkShoot':
      return 0.72;
    case 'thunder':
      // Use heaviest tier so the HUD clock covers the max charged release.
      return PLAYER_THUNDER_COOLDOWN_BY_LEVEL[3];
    case 'thunderShock':
      return THUNDERSHOCK_STREAM_INTERVAL_SEC;
    case 'thunderbolt':
      return Math.max(
        PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL[1],
        PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL[2],
        PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL[3],
        PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL[4]
      );
    case 'rainDance':
    case 'sunnyDay':
    case 'blizzard':
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
  if (PluginRegistry.hasMove(moveId)) {
    return PluginRegistry.getCooldown(moveId);
  }
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
    case 'hydroPump':
      return playerHydroPumpCooldown;
    case 'bubbleBeam':
      return playerBubbleBeamCooldown;
    case 'psybeam':
      return playerPsybeamCooldown;
    case 'prismaticLaser':
      return playerPrismaticLaserCooldown;
    case 'steelBeam':
      return playerSteelBeamCooldown;
    case 'waterCannon':
      return playerWaterCannonCooldown;
    case 'poisonPowder':
      return playerPoisonPowderCooldown;
    case 'incinerate':
      return playerIncinerateCooldown;
    case 'fireBlast':
      return playerFireBlastCooldown;
    case 'flameCharge':
      return playerFlameChargeCooldown;
    case 'fireSpin':
      return playerFireSpinCooldown;
    case 'earthquake':
      return playerEarthquakeCooldown;
    case 'silkShoot':
      return playerSilkShootCooldown;
    case 'thunder':
      return playerThunderCooldown;
    case 'thunderShock':
      return playerThundershockCooldown;
    case 'thunderbolt':
      return playerThunderboltCooldown;
    case 'rainDance':
    case 'sunnyDay':
    case 'blizzard':
      return playerWeatherSwapCooldown;
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
  lastMovesTickData = data;
  updatePlayerCombatTimers(dt);
  for (const key of PluginRegistry.cooldowns.keys()) {
    const current = PluginRegistry.getCooldown(key);
    if (current > 0) PluginRegistry.setCooldown(key, Math.max(0, current - dt));
  }
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
  playerHydroPumpCooldown = Math.max(0, playerHydroPumpCooldown - dt);
  playerBubbleBeamCooldown = Math.max(0, playerBubbleBeamCooldown - dt);
  playerPsybeamCooldown = Math.max(0, playerPsybeamCooldown - dt);
  playerPrismaticLaserCooldown = Math.max(0, playerPrismaticLaserCooldown - dt);
  playerSteelBeamCooldown = Math.max(0, playerSteelBeamCooldown - dt);
  playerWaterCannonCooldown = Math.max(0, playerWaterCannonCooldown - dt);
  playerPoisonPowderCooldown = Math.max(0, playerPoisonPowderCooldown - dt);
  playerIncinerateCooldown = Math.max(0, playerIncinerateCooldown - dt);
  playerFireBlastCooldown = Math.max(0, playerFireBlastCooldown - dt);
  playerFlameChargeCooldown = Math.max(0, playerFlameChargeCooldown - dt);
  playerFireSpinCooldown = Math.max(0, playerFireSpinCooldown - dt);
  playerEarthquakeCooldown = Math.max(0, playerEarthquakeCooldown - dt);
  playerSilkShootCooldown = Math.max(0, playerSilkShootCooldown - dt);
  playerThunderCooldown = Math.max(0, playerThunderCooldown - dt);
  playerThundershockCooldown = Math.max(0, playerThundershockCooldown - dt);
  playerThunderboltCooldown = Math.max(0, playerThunderboltCooldown - dt);
  playerWeatherSwapCooldown = Math.max(0, playerWeatherSwapCooldown - dt);

  const wildList = Array.isArray(wildPokemonList) ? wildPokemonList : [...wildPokemonList];
  const wildSpatial = buildWildSpatialIndex(wildList, data);

  // Thunder-move strikes: when a scheduled cloud's bolt delay elapses, fire the
  // yellow ground strike + splash-damage nearby wild pokemon.
  tickThunderStrikes(dt, wildList, data, wildSpatial, (wx, wy) => {
    pushParticle({
      type: 'grassFire',
      x: wx,
      y: wy,
      vx: 0,
      vy: 0,
      z: 0.06,
      vz: 0,
      life: GRASS_FIRE_PARTICLE_SEC,
      maxLife: GRASS_FIRE_PARTICLE_SEC
    });
  });
  tickThunderboltChains(wildList, data, player);

  if (player && data) {
    tickPlayerFlameChargeDash(player, dt, data, pushParticle);
  }

  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      activeParticles.splice(i, 1);
      continue;
    }
    if (p.type === 'waterCannonBubble') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.vz += 0.55 * dt;
      p.vz -= 5.5 * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz = Math.abs(p.vz) * 0.2;
      }
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
      p.type === 'fieldCutScratchArc' ||
      p.type === 'fieldSpinAttack' ||
      p.type === 'rainFootSplash' ||
      p.type === 'prismaticWindArc' ||
      p.type === 'steelWindArc' ||
      p.type === 'waterGunWaveRing'
    ) {
      continue;
    }
    const pzPrev = p.z;
    const vzParticle = p.vz;
    
    // Previous tile height for elevation snapping/delta
    const prevH = p.heightStep || 0;
    
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    
    // Update terrain height for 2.5D awareness
    if (data) {
      const mx = Math.floor(p.x);
      const my = Math.floor(p.y);
      const tile = data.getMicroTile?.(mx, my);
      const curH = Number(tile?.heightStep) || 0;
      p.heightStep = curH;
      
      // If we moved to a lower tile, "drop" the particle's Z so it doesn't visually snap
      if (curH < prevH) {
        p.z += (prevH - curH);
      } else if (curH > prevH) {
        // If we hit a cliff, we could either "climb" it or hit it.
        // For particles, we usually want them to just pop up to the new height or die.
        // Let's pop up for now to keep them "floating" over terrain.
        p.z = Math.max(0, p.z - (curH - prevH));
      }
    }

    // Gravity only for non-absorb particles
    if (p.type !== 'absorbChargeParticle') {
      p.vz -= 30.0 * dt;
    }
    
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

  tickActiveProjectiles({
    dt,
    wildSpatial,
    wildList,
    data,
    player,
    projectiles: activeProjectiles,
    pushParticle,
    pushProjectile,
    spawnTrailParticle,
    spawnHitParticles
  });
}
