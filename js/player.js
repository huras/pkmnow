import { MACRO_TILE_STRIDE, getMicroTile } from './chunking.js';
import {
  getBorrowDigPlaceholderDex,
  isPlayerUndergroundBurrowWalkActive,
  speciesUsesBorrowedDiglettDigVisual
} from './wild-pokemon/underground-burrow.js';
import { ensurePokemonSheetsLoaded, getPokemonSheetPaths } from './pokemon/pokemon-asset-loader.js';
import {
  canWalkMicroTile,
  pivotCellHeightTraversalOk,
  beginWalkProbeCache,
  endWalkProbeCache,
  syncEntityZWithTerrain
} from './walkability.js';
import { resolveTerrainWalkSpeedCapMultiplier } from './pokemon/player-terrain-walk-modifiers.js';
import {
  computeGhostPhaseShiftDrawAlpha,
  isGhostPhaseShiftBurrowEligibleDex
} from './wild-pokemon/ghost-phase-shift.js';
import {
  speciesHasFlyingType,
  speciesHasGroundType,
  speciesHasSmoothLevitationFlight
} from './pokemon/pokemon-type-helpers.js';
import { playInputState, isPlayGroundDigShiftHeld, isPlaySpaceAscendHeld } from './main/play-input-state.js';
import {
  strengthCarryBlocksWalk,
  onStrengthCarrierDamaged,
  getStrengthCarryMoveSpeedMultiplier
} from './main/play-strength-carry.js';
import { strengthDropCarriedAsPickup } from './main/play-crystal-tackle.js';
import { clampPlayerToPlayColliderBoundsIfActive } from './main/play-collider-overlay-cache.js';
import { WORLD_MAX_WALK_SPEED_TILES_PER_SEC } from './world-movement-constants.js';
import {
  ENTITY_STAMINA_MAX,
  ensureEntityStamina,
  canEntityStartSprint,
  tickEntityStamina
} from './entity-stamina.js';
import { resolvePivotWithFeetVsTreeTrunks } from './circle-tree-trunk-resolve.js';
import { PMD_DEFAULT_MON_ANIMS } from './pokemon/pmd-default-timing.js';
import { getDexAnimMeta, getDexAnimSlice } from './pokemon/pmd-anim-metadata.js';
import { NATIONAL_DEX_MAX } from './pokemon/gen1-name-to-dex.js';
import { imageCache } from './image-cache.js';
import { getPmdFeetDeltaWorldTiles, worldFeetFromPivotCell } from './pokemon/pmd-layout-metrics.js';
import { WILD_EMOTION_NONPERSIST_CLEAR_SEC } from './pokemon/emotion-display-timing.js';
import { advancePlayerSpeechBubble, setPlayerSpeechBubble } from './social/speech-bubble-state.js';
import { playJumpSfx } from './audio/jump-sfx.js';
import { advanceFootFloorStepsForDistance } from './audio/foot-floor-sfx.js';
import { playFloorHit2Sfx } from './audio/floor-hit-2-sfx.js';
import { advanceRainFootstepFxForDistance } from './weather/rain-footstep-fx.js';
import { onPlayerEarthquakeLanding } from './moves/earthquake-move.js';
import { rumblePlayerGamepadPokemonHitTaken } from './main/play-gamepad-rumble.js';

const MAX_SPEED = WORLD_MAX_WALK_SPEED_TILES_PER_SEC;
const ACCEL = 32.0;
const FRICTION = 20.0;
const GRAVITY = 9.8;
const JUMP_IMPULSE = 4.5;
const GROUND_R = 0.32; // Raio de colisão
const PLAYER_BASE_MAX_JUMPS = 2;
const PLAYER_FLYING_MAX_JUMPS = 6;

/** Creative flight: Space up / Shift down. Winged Flying-types = snappier; Mewtwo/Mew = smoother levitation + walk cycle aloft. */
/** Creative flight ceiling (world tile units); HUD / UI may import this. */
export const PLAYER_FLIGHT_MAX_Z_TILES = 28;
const FLIGHT_MAX_Z = PLAYER_FLIGHT_MAX_Z_TILES;
/** Winged Flying-type: snappier / “flappy” feel. */
const FLIGHT_WINGED_VERT_SPEED = 3;
/** Horizontal speed cap while flying (× `MAX_SPEED`); tuned vs ground. */
const FLIGHT_WINGED_MAX_SPEED_MULT = 2.15 * 1.25;
const FLIGHT_WINGED_FRICTION_MULT = 0.82;
/** Mewtwo / Mew levitation: calmer horizontal + vertical (see `speciesHasSmoothLevitationFlight`). */
const FLIGHT_LEVITATION_VERT_SPEED = 4.2;
const FLIGHT_LEVITATION_MAX_SPEED_MULT = 1.38 * 1.25;
const FLIGHT_LEVITATION_FRICTION_MULT = 0.69;
/** Horizontal input acceleration while in creative flight (ground uses full `ACCEL`). */
const FLIGHT_ACCEL_MULT = 0.85;
/** Walk / idle PMD cycle advances faster only while actually gaining altitude in creative flight. */
const FLIGHT_RAISE_HEIGHT_ANIM_MULT = 2.5;
/** Horizontal flight cap multiplier while moving (WASD); not stacked while actively gaining altitude. */
const FLIGHT_HORIZONTAL_MOVE_SPEED_MULT = 1.5;
/** Hover-idle in creative flight: every this many seconds the tether blinks for `FLIGHT_TETHER_IDLE_BLINK_SEC`. */
const FLIGHT_TETHER_IDLE_CYCLE_SEC = 4;
/** Last segment of each cycle: tether toggles on/off (strobe) for this long. */
const FLIGHT_TETHER_IDLE_BLINK_SEC = 1;
/** Half-periods per second during the blink window (even = ~50% duty). */
const FLIGHT_TETHER_IDLE_BLINK_HZ = 6;

/** Sprint: double-tap the same direction (WASD / arrows); clears when movement stops. */
const RUN_SPEED_CAP_MULT = 2;
/** Hold-LMB combat charge: movement stays possible but slower. */
const LMB_COMBAT_CHARGE_SPEED_MUL = 0.46;
/**
 * Walk facing: gamepad vectors are rarely axis-aligned. When the smaller axis magnitude
 * is at most this fraction of the larger, treat facing as pure N/S/E/W (same as keyboard zeros).
 */
const FACING_CARDINAL_AXIS_SLIP_RATIO = 0.32;

/** Dig animation advance when stationary (world-units/sec equivalent feel). */
const DIG_IDLE_ANIM_SPEED = 2.8;

/** Ground dig (non-Ghost): hold Left Shift to fill charge, then latch burrow until leave ground / jump. */
const DIG_CHARGE_SEC = 0.88;
const DIG_CHARGE_DECAY = 2.2;
/** Fixed real-time length for one tackle window (seconds). */
const TACKLE_DURATION_SEC = 0.5;
/** Tackle visual reach in tile units (sprite-only lunge; gameplay body stays in place). Field tackle charges 1..3. */
const TACKLE_REACH_TILES = 1;
/** Tackle lunge curve profile (`sin` = symmetric out/back, `easeOut` = snappier hit then settle). */
const TACKLE_LUNGE_CURVE = 'sin';
/** PMD-ish depth foreshortening for tackle sprite offset on world Y (visual only). */
const TACKLE_VISUAL_DEPTH_Y_SCALE = 0.72;

const SAVED_DEX_KEY = 'pkmn_player_dex_id';
/** Default species when nothing valid is stored (Charmander). */
const DEFAULT_PLAYER_DEX_ID = 4;
const _savedDex = parseInt(localStorage.getItem(SAVED_DEX_KEY), 10);
const initialDex =
  Number.isFinite(_savedDex) && _savedDex >= 1 && _savedDex <= NATIONAL_DEX_MAX
    ? _savedDex
    : DEFAULT_PLAYER_DEX_ID;

export const player = {
  x: 0,
  y: 0,
  visualX: 0,
  visualY: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  z: 0,
  inputX: 0,
  inputY: 0,
  facing: 'down',
  animRow: 0,
  animFrame: 0,
  idleTimer: 0,
  totalDistMoved: 0,
  dexId: initialDex,
  jumping: false,
  /** Air hops used since last grounded state. */
  jumpsUsed: 0,
  /** Monotonic counter; increments on every hop for render FX triggers. */
  jumpSerial: 0,
  grounded: true,
  /** Sprint until all direction keys released (set from play keyboard). */
  runMode: false,
  /** Visual dig: Ground-type while moving or Left Shift; Ghost idem for phase/dig anim. */
  digActive: false,
  /** Ghost + Left Shift (or moving): alpha from `computeGhostPhaseShiftDrawAlpha`. */
  ghostPhaseAlpha: 1,
  /** Flying-type only: F toggles; Space/Left Shift move vertically while active. */
  flightActive: false,
  /** Ground (non-Ghost): latched underground walk after dig charge completes. */
  digBurrowMode: false,
  /** Ground dig charge 0..1 while holding Shift before latch (resets if released early). */
  digCharge01: 0,
  /** Play mode: HP when hit by wild projectiles. */
  hp: 100,
  maxHp: 100,
  /** Sprint / wild sprint-speed drain; regens when not draining. */
  stamina: ENTITY_STAMINA_MAX,
  maxStamina: ENTITY_STAMINA_MAX,
  /** Seconds remaining: ignore projectile damage while > 0. */
  projIFrameSec: 0,
  /** HUD-only poison indicator after Poison Sting. */
  poisonVisualSec: 0,
  /** Seconds remaining: play `shoot` PMD slice after a successful player cast (if asset exists). */
  moveShootAnimSec: 0,
  /** Seconds remaining: LMB melee “attack” pose (shoot → charge → walk slice). */
  lmbAttackAnimSec: 0,
  /** Unit vector (world micro tiles) for tackle aim — logical position does not move. */
  tackleDirNx: 0,
  tackleDirNy: 1,
  /** Duration (s) of the current LMB tackle window (for lunge easing). */
  _tackleDurSec: 0,
  /** Peak visual tackle reach in tile units (sprite only). */
  _tackleReachTiles: TACKLE_REACH_TILES,
  /** Visual lunge offset in tile units (sprite only; collision uses x,y). */
  _tackleLungeDx: 0,
  _tackleLungeDy: 0,
  /** Classic emotion balloon (when not using Sims-style `speechBubble`). */
  socialEmotionType: null,
  socialEmotionAge: 0,
  socialEmotionPortraitSlug: null,
  /** @type {null | { segments: unknown[], ageSec: number, durationSec: number, kind: string }} */
  speechBubble: null,
  /** Creative flight: dashed feet↔sprite tether allowed this frame (render / debug overlay). */
  flightGroundTetherVisible: false,
  /**
   * Strength grab: lifted scatter rock/crystal (world origin while carried is “broken” until placed/dropped).
   * `hitsRemaining/hitsMax` preserve breakable HP while carried/thrown.
   * @type {null | {
   *   liftOx: number, liftOy: number, itemKey: string, cols: number, rows: number, weightTier: number,
   *   hitsRemaining?: number, hitsMax?: number
   * }}
   */
  _strengthCarry: null,
  /** Consecutive hits absorbed while carrying a lifted detail. */
  _strengthCarryHitStreak: 0,
  /**
   * Strength pick-up channel in progress.
   * @type {null | {
   *   ox: number, oy: number, itemKey: string, cols: number, rows: number, weightTier: number,
   *   durationSec: number, elapsedSec: number, startX: number, startY: number, startedAtSec: number
   * }}
   */
  _strengthGrabAction: null,
  /** Cut combo 3rd hit: movement locked (seconds). */
  cutThirdHitLockoutSec: 0,
  /** Flame Charge: remaining dash time (s); velocity override while > 0. */
  flameChargeDashSec: 0,
  /** @type {1|2|3} */
  flameChargeTier: 1,
  flameChargeNx: 0,
  flameChargeNy: 1,
  flameChargeSpeedCapTilesPerSec: 0,
  flameChargeTrailAcc: 0,
  flameChargeHeadAcc: 0,
  _flameChargeSegPrevX: 0,
  _flameChargeSegPrevY: 0,
  /** Fire Spin: seconds held this channel (caps in move module). */
  fireSpinChannelSec: 0,
  fireSpinOrbitAngle: 0,
  fireSpinParticleAcc: 0,
  /** Earthquake move: waiting for landing to apply ring damage + quake pulse. */
  earthquakeAwaitingLand: false,
  earthquakeStoredCharge01: 0
};

export function setPlayerSpecies(dexId) {
  const d = Math.floor(Number(dexId)) || DEFAULT_PLAYER_DEX_ID;
  player.dexId = Math.max(1, Math.min(NATIONAL_DEX_MAX, d));
  player.runMode = false;
  if (!speciesHasFlyingType(player.dexId)) player.flightActive = false;
  localStorage.setItem(SAVED_DEX_KEY, String(player.dexId));
  if (speciesUsesBorrowedDiglettDigVisual(player.dexId) || speciesHasGroundType(player.dexId)) {
    void ensurePokemonSheetsLoaded(imageCache, getBorrowDigPlaceholderDex(player.dexId));
  }
  player.digBurrowMode = false;
  player.digCharge01 = 0;
  player.hp = player.maxHp ?? 100;
  ensureEntityStamina(player);
  player.stamina = player.maxStamina;
  player.projIFrameSec = 0;
  player.moveShootAnimSec = 0;
  player._shootAnimTick = 0;
  player._chargeAnimTick = 0;
  player.lmbAttackAnimSec = 0;
  player._lmbAttackAnimTick = 0;
  player.tackleDirNx = 0;
  player.tackleDirNy = 1;
  player._tackleDurSec = 0;
  player._tackleReachTiles = TACKLE_REACH_TILES;
  player._tackleLungeDx = 0;
  player._tackleLungeDy = 0;
  player.socialEmotionType = null;
  player.socialEmotionAge = 0;
  player.socialEmotionPortraitSlug = null;
  player.speechBubble = null;
  player._flightIdleCycleSec = 0;
  player.flightGroundTetherVisible = false;
  player.jumpsUsed = 0;
  player.jumpSerial = 0;
  player._strengthCarry = null;
  player._strengthCarryHitStreak = 0;
  player._strengthGrabAction = null;
  player.cutThirdHitLockoutSec = 0;
  player.flameChargeDashSec = 0;
  player.flameChargeTier = 1;
  player.flameChargeNx = 0;
  player.flameChargeNy = 1;
  player.flameChargeSpeedCapTilesPerSec = 0;
  player.flameChargeTrailAcc = 0;
  player.flameChargeHeadAcc = 0;
  player._flameChargeSegPrevX = 0;
  player._flameChargeSegPrevY = 0;
  player.fireSpinChannelSec = 0;
  player.fireSpinOrbitAngle = 0;
  player.fireSpinParticleAcc = 0;
  player.earthquakeAwaitingLand = false;
  player.earthquakeStoredCharge01 = 0;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pkmn-player-species-changed', { detail: { dexId: player.dexId } })
    );
  }
}

/**
 * Sets world position after a resume save (no Strength-drop side effects, no full stat reset).
 * @param {number} x
 * @param {number} y
 * @param {number} [z=0]
 */
export function applyPlayerWorldResumePosition(x, y, z = 0) {
  const xf = Number(x);
  const yf = Number(y);
  const zf = Math.max(0, Number(z) || 0);
  if (!Number.isFinite(xf) || !Number.isFinite(yf)) return;
  player.x = xf;
  player.y = yf;
  player.visualX = xf;
  player.visualY = yf;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.z = zf;
  player.grounded = zf <= 1e-4;
  if (player.grounded) {
    player.jumping = false;
    player.jumpsUsed = 0;
  }
}

export function setPlayerPos(x, y) {
  player._strengthGrabAction = null;
  player._strengthCarryHitStreak = 0;
  const carry = player._strengthCarry;
  if (carry) {
    strengthDropCarriedAsPickup(
      carry.liftOx,
      carry.liftOy,
      carry.cols,
      carry.rows,
      carry.itemKey,
      x + 0.5,
      y + 0.5
    );
    player._strengthCarry = null;
  }
  player.x = x;
  player.y = y;
  player.visualX = x;
  player.visualY = y;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.z = 0;
  player.grounded = true;
  player.jumping = false;
  player.jumpsUsed = 0;
  player.jumpSerial = 0;
  player.totalDistMoved = 0;
  player.animFrame = 0;
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;
  player.runMode = false;
  player.ghostPhaseAlpha = 1;
  player.flightActive = false;
  player.digBurrowMode = false;
  player.digCharge01 = 0;
  player.hp = player.maxHp ?? 100;
  ensureEntityStamina(player);
  player.stamina = player.maxStamina;
  player.projIFrameSec = 0;
  player.poisonVisualSec = 0;
  player.socialEmotionType = null;
  player.socialEmotionAge = 0;
  player.socialEmotionPortraitSlug = null;
  player.speechBubble = null;
  player._flightIdleCycleSec = 0;
  player.flightGroundTetherVisible = false;
  player.lmbAttackAnimSec = 0;
  player._lmbAttackAnimTick = 0;
  player.tackleDirNx = 0;
  player.tackleDirNy = 1;
  player._tackleDurSec = 0;
  player._tackleReachTiles = TACKLE_REACH_TILES;
  player._tackleLungeDx = 0;
  player._tackleLungeDy = 0;
  player.cutThirdHitLockoutSec = 0;
  player.flameChargeDashSec = 0;
  player.flameChargeTier = 1;
  player.flameChargeNx = 0;
  player.flameChargeNy = 1;
  player.flameChargeSpeedCapTilesPerSec = 0;
  player.flameChargeTrailAcc = 0;
  player.flameChargeHeadAcc = 0;
  player._flameChargeSegPrevX = 0;
  player._flameChargeSegPrevY = 0;
  player.fireSpinChannelSec = 0;
  player.fireSpinOrbitAngle = 0;
  player.fireSpinParticleAcc = 0;
  player.earthquakeAwaitingLand = false;
  player.earthquakeStoredCharge01 = 0;
}

/**
 * Numpad social: Sims-style bubble (SpriteCollab portrait when available; emoji fallback only if portrait missing).
 * @param {{ emoji?: string, label?: string, portraitSlug?: string } | null | undefined} action
 */
export function showPlayerSocialEmotion(action) {
  if (!action) return;
  const emoji = String(action.emoji || '💬');
  const label = String(action.label || '').trim();
  const slugRaw = String(action.portraitSlug || 'Normal').trim() || 'Normal';
  const slug = slugRaw.replace(/[^\w.-]/g, '') || 'Normal';
  /** @type {{ kind: string, text?: string, slug?: string, fallbackEmoji?: string }[]} */
  const segs = [{ kind: 'portrait', slug, fallbackEmoji: emoji }];
  if (label) segs.push({ kind: 'text', text: label });
  setPlayerSpeechBubble(player, segs, { durationSec: 2.75, kind: 'say' });
}

/**
 * @param {number} amount
 * @param {boolean} [applyPoisonVisual]
 * @returns {boolean} true if damage was applied (not blocked by iframes)
 */
export function tryDamagePlayerFromProjectile(amount, applyPoisonVisual = false, data = null) {
  if (player.projIFrameSec > 0) return false;
  const maxH = player.maxHp ?? 100;
  const cur = player.hp ?? maxH;
  player.hp = Math.max(0, cur - amount);
  rumblePlayerGamepadPokemonHitTaken();
  player.projIFrameSec = 0.55;
  if (applyPoisonVisual) player.poisonVisualSec = 3;
  const extraCarryDropDamage = onStrengthCarrierDamaged(player, data);
  if (extraCarryDropDamage > 0) {
    player.hp = Math.max(0, (player.hp ?? maxH) - extraCarryDropDamage);
  }
  return true;
}

/** @param {number} dt */
export function updatePlayerCombatTimers(dt) {
  if (player.projIFrameSec > 0) player.projIFrameSec = Math.max(0, player.projIFrameSec - dt);
  if (player.poisonVisualSec > 0) player.poisonVisualSec = Math.max(0, player.poisonVisualSec - dt);
  if (player.cutThirdHitLockoutSec > 0) {
    player.cutThirdHitLockoutSec = Math.max(0, player.cutThirdHitLockoutSec - dt);
  }
}

/** Toggle creative flight (Flying-type species only). Called from play keyboard (e.g. KeyF). */
export function togglePlayerCreativeFlight() {
  if (!speciesHasFlyingType(player.dexId ?? 0)) return;
  player.flightActive = !player.flightActive;
  if (player.flightActive) {
    player.jumping = false;
    player.vz = 0;
    player.digBurrowMode = false;
    player.digCharge01 = 0;
    player.jumpsUsed = 0;
  }
}

export function isGroundDigLatchEligible() {
  const d = player.dexId ?? 0;
  return speciesHasGroundType(d) && !isGhostPhaseShiftBurrowEligibleDex(d);
}

function playerFeetDeltaTiles() {
  const isMoving =
    (!!player.grounded && Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1) || !!player.digActive;
  return getPmdFeetDeltaWorldTiles(imageCache, player.dexId || 94, isMoving);
}

/** Feet tile exists (burrow path); same criterion as wild underground walk. */
function burrowFeetTileExists(pivotX, pivotY, data) {
  if (!data) return false;
  const { x: fx, y: fy } = worldFeetFromPivotCell(pivotX, pivotY, imageCache, player.dexId || 94, true);
  const mx = Math.floor(fx);
  const my = Math.floor(fy);
  const gw = data.width * MACRO_TILE_STRIDE;
  const gh = data.height * MACRO_TILE_STRIDE;
  if (mx < 0 || mx >= gw || my < 0 || my >= gh) return false;
  return getMicroTile(mx, my, data) != null;
}

export function canWalk(x, y, data, srcX, srcY, isAirborne = false, ignoreTreeTrunks = false) {
  if (!data) return false;

  const isMoving = !!player.grounded && Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1;
  const burrowWalk =
    !isAirborne &&
    isPlayerUndergroundBurrowWalkActive(player.dexId ?? 0, {
      isAirborne,
      grounded: !!player.grounded,
      isMoving,
      digBurrowMode: !!player.digBurrowMode
    });

  if (burrowWalk) {
    return burrowFeetTileExists(x, y, data);
  }

  const { x: fx, y: fy } = worldFeetFromPivotCell(x, y, imageCache, player.dexId || 94, isMoving);
  let sfx;
  let sfy;
  if (srcX !== undefined && srcY !== undefined) {
    const s = worldFeetFromPivotCell(srcX, srcY, imageCache, player.dexId || 94, isMoving);
    sfx = s.x;
    sfy = s.y;
  }

  // 1. LOGICAL TRAVERSAL (The "Feet"):
  // Se estiver no ar, o centro pode ignorar clifs.
  // Se estiver no chão, o centro DEVE obedecer às regras de altura (escadas, mesma altura, etc).
  // Probes usam deslocamento PMD (pivot → pés) alinhado ao render.
  if (!isAirborne) {
    if (!canWalkMicroTile(fx, fy, data, sfx, sfy, undefined, isAirborne, ignoreTreeTrunks)) {
      return false;
    }
    // Pivot pode entrar no tile ao norte antes dos pés saírem do platô (offset PMD para sul).
    if (!pivotCellHeightTraversalOk(x, y, srcX, srcY, data)) {
      return false;
    }
  } else {
    // No ar, verificamos apenas se o centro não bateu em algo sólido (prop horizontal).
    // canWalkMicroTile sem srcX/Y pula o check de altura.
    if (!canWalkMicroTile(fx, fy, data, undefined, undefined, undefined, isAirborne, ignoreTreeTrunks)) {
      return false;
    }
  }

  // 2. PHYSICAL BODY (The "Corners"):
  // O corpo físico só pára por obstáculos REAIS (paredes, árvores, casas).
  // Ele NÃO liga para altura do chão (heightStep).
  const points = [
    { x: fx - GROUND_R, y: fy - GROUND_R },
    { x: fx + GROUND_R, y: fy - GROUND_R },
    { x: fx - GROUND_R, y: fy + GROUND_R },
    { x: fx + GROUND_R, y: fy + GROUND_R }
  ];

  for (const p of points) {
    const mx = Math.floor(p.x);
    const my = Math.floor(p.y);
    if (mx < 0 || my < 0 || mx >= data.width * MACRO_TILE_STRIDE || my >= data.height * MACRO_TILE_STRIDE) return false;

    // Chamamos canWalkMicroTile SEM srcX/srcY para ignorar o check de "heightStepMismatch".
    // Isso permite que um ombro do player sobreponha um tile de altura diferente sem travar.
    if (!canWalkMicroTile(p.x, p.y, data, undefined, undefined, undefined, isAirborne, ignoreTreeTrunks)) {
      return false;
    }
  }

  return true;
}

const DIRECTION_ROW_MAP = {
  down: 0,
  'down-right': 1,
  right: 2,
  'up-right': 3,
  up: 4,
  'up-left': 5,
  left: 6,
  'down-left': 7
};

/** atan2(+y down): sector index 0 = right, … 7 = up-right (matches `DIRECTION_ROW_MAP` / PMD rows). */
const AIM_SECTOR_TO_FACING = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];

/**
 * Sets `facing` + `animRow` from a world-space aim vector (e.g. stream moves toward cursor).
 * Call after `updatePlayer` in the same frame so the renderer sees the correct row immediately.
 */
export function setPlayerFacingFromWorldAimDelta(player, dx, dy) {
  if (!player) return;
  if (dx * dx + dy * dy < 1e-6) return;
  const a = Math.atan2(dy, dx);
  const t = (a + Math.PI * 2) % (Math.PI * 2);
  const sector = Math.floor((t + Math.PI / 8) / (Math.PI / 4)) % 8;
  const key = AIM_SECTOR_TO_FACING[sector];
  player.facing = key;
  player.animRow = DIRECTION_ROW_MAP[key] || 0;
}

/** Tackle direction from 8-way facing when aim vector is omitted. */
const FACING_TO_TACKLE_UNIT = {
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0],
  'down-left': [-0.70710678, 0.70710678],
  'down-right': [0.70710678, 0.70710678],
  'up-left': [-0.70710678, -0.70710678],
  'up-right': [0.70710678, -0.70710678]
};

/**
 * Normalized world aim from the player's current 8-way facing (tackle / cut when mouse aim is off).
 * @param {{ facing?: string } | null | undefined} p
 */
export function getTackleDirUnitFromFacing(p) {
  if (!p) return { nx: 0, ny: 1 };
  const q = FACING_TO_TACKLE_UNIT[p.facing] || FACING_TO_TACKLE_UNIT.down;
  return { nx: q[0], ny: q[1] };
}

/**
 * @param {number} ix
 * @param {number} iy
 */
function setPlayerFacingFromWalkInput(ix, iy) {
  const ax = Math.abs(ix);
  const ay = Math.abs(iy);
  const major = Math.max(ax, ay, 1e-6);
  const slip = FACING_CARDINAL_AXIS_SLIP_RATIO;
  if (ax <= slip * major) {
    if (iy < 0) player.facing = 'up';
    else if (iy > 0) player.facing = 'down';
    return;
  }
  if (ay <= slip * major) {
    if (ix < 0) player.facing = 'left';
    else if (ix > 0) player.facing = 'right';
    return;
  }
  if (ix > 0 && iy < 0) player.facing = 'up-right';
  else if (ix < 0 && iy < 0) player.facing = 'up-left';
  else if (ix > 0 && iy > 0) player.facing = 'down-right';
  else if (ix < 0 && iy > 0) player.facing = 'down-left';
}

/**
 * Starts the LMB melee pose window (`getDexAnimSlice(dex, 'attack')` timings) + tackle direction for lunge / crystal hit.
 * @param {{ dexId?: number, lmbAttackAnimSec?: number, _lmbAttackAnimTick?: number, facing?: string, tackleDirNx?: number, tackleDirNy?: number, _tackleDurSec?: number } | null | undefined} p
 * @param {number} [dirNx] Optional free-aim X (used when player is not pressing movement input).
 * @param {number} [dirNy] Optional free-aim Y (used when player is not pressing movement input).
 */
export function triggerPlayerLmbAttack(p, dirNx, dirNy) {
  if (!p) return;
  const dex = p.dexId ?? 94;
  const atk = getDexAnimSlice(dex, 'attack');
  const seq = atk?.durations;
  if (!seq?.length) return;
  const sec = TACKLE_DURATION_SEC;
  p.lmbAttackAnimSec = sec;
  p._lmbAttackAnimTick = 0;
  p._tackleDurSec = sec;
  p._tackleReachTiles = TACKLE_REACH_TILES;

  const nx = Number(dirNx);
  const ny = Number(dirNy);
  const nLen = Math.hypot(nx, ny);
  if (Number.isFinite(nLen) && nLen > 1e-4) {
    // Mouse-guided free vector (not quantized to 8 directions) while idle.
    p.tackleDirNx = nx / nLen;
    p.tackleDirNy = ny / nLen;
    setPlayerFacingFromWorldAimDelta(p, p.tackleDirNx, p.tackleDirNy);
  } else {
    // Keyboard movement keeps tackle in the current 8-way facing.
    const q = FACING_TO_TACKLE_UNIT[p.facing] || FACING_TO_TACKLE_UNIT.down;
    p.tackleDirNx = q[0];
    p.tackleDirNy = q[1];
  }
}

function pickPmdSeqFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return Math.max(0, seq.length - 1);
}

/**
 * @param {number} progress normalized tackle phase 0..1
 * @returns {number} normalized lunge amount 0..1..0
 */
function resolveTackleLunge01(progress) {
  const t = Math.min(1, Math.max(0, progress));
  if (TACKLE_LUNGE_CURVE === 'easeOut') {
    const out = 1 - Math.pow(1 - t, 2.2);
    const back = t < 0.5 ? out : 1 - Math.pow((t - 0.5) * 2, 1.35);
    return Math.max(0, Math.min(1, back));
  }
  return Math.sin(t * Math.PI);
}

// tryMovePlayer is now handled directly by inputX/Y in the gameLoop
export function tryMovePlayer(dx, dy, data) {
  return false;
}

/** 
 * Tenta pular. 
 * - Se estiver de frente para um degrau de 1 nível (subida ou descida) que é uma "Ledge" andável: pula 1 tile.
 * - Se estiver de frente para um "Muro" (EDGE_S, EDGE_W, EDGE_E), tenta saltar por cima: pula 2 tiles.
 * - Se estiver no plano, faz apenas um pulinho (hop) no lugar para feedback visual.
 */
/**
 * @param {object} [_data] reserved / parity with callers that pass map data
 * @param {{ vzScale?: number }} [opts]
 */
export function tryJumpPlayer(_data, opts = {}) {
  if ((player.cutThirdHitLockoutSec || 0) > 0) return false;
  const canFly = speciesHasFlyingType(player.dexId ?? 0);
  if (canFly && player.flightActive) return false;
  const maxJumps = canFly ? PLAYER_FLYING_MAX_JUMPS : PLAYER_BASE_MAX_JUMPS;
  if (player.grounded || player.z <= 0.001) player.jumpsUsed = 0;
  if ((player.jumpsUsed || 0) >= maxJumps) return false;
  if (isGroundDigLatchEligible()) {
    player.digBurrowMode = false;
    player.digCharge01 = 0;
  }
  const vzScale = Math.max(0.35, Math.min(2.5, Number(opts?.vzScale) || 1));
  player.vz = JUMP_IMPULSE * vzScale;
  player.grounded = false;
  player.jumping = true;
  player.jumpsUsed = (player.jumpsUsed || 0) + 1;
  player.jumpSerial = (player.jumpSerial || 0) + 1;
  playJumpSfx(player);
  return true;
}

/** Idle column index for the long “waiting” pose (frame 0 — first entry in Idle sequence). Used e.g. for grass-in-front overlay. */
export const PLAYER_IDLE_WAITING_FRAME_INDEX = 0;

export function isPlayerIdleOnWaitingFrame() {
  return player.grounded && player.vx === 0 && player.vy === 0 && player.animFrame === PLAYER_IDLE_WAITING_FRAME_INDEX;
}

/**
 * Atualiza a posição visual e animação do player por frame.
 * @param {number} dt - delta time em segundos
 * @param {number} multiplier - multiplicador de velocidade (não afeta o tempo da animação interna do PMD)
 */
export function updatePlayer(dt, data, gameTimeSec) {
  const canFlySpecies = speciesHasFlyingType(player.dexId ?? 0);
  const flightMove = canFlySpecies && player.flightActive;
  const smoothLevitationFlight = speciesHasSmoothLevitationFlight(player.dexId ?? 0);
  const isAirborne = player.jumping || player.z > 0.05 || flightMove;
  const gr = speciesHasGroundType(player.dexId ?? 0);
  const gh = isGhostPhaseShiftBurrowEligibleDex(player.dexId ?? 0);

  if ((player.flameChargeDashSec || 0) > 1e-5 && (flightMove || isAirborne || player.digBurrowMode)) {
    player.flameChargeDashSec = 0;
  }

  if (!isGroundDigLatchEligible() || flightMove) {
    player.digBurrowMode = false;
    player.digCharge01 = 0;
  } else if (!player.grounded || isAirborne) {
    player.digBurrowMode = false;
    player.digCharge01 = 0;
  } else if (player.digBurrowMode) {
    /* latched: stay dug until leave ground / jump */
  } else if (isPlayGroundDigShiftHeld()) {
    player.digCharge01 = Math.min(1, player.digCharge01 + dt / DIG_CHARGE_SEC);
    if (player.digCharge01 >= 1) {
      player.digBurrowMode = true;
      player.digCharge01 = 0;
    }
  } else {
    player.digCharge01 = Math.max(0, player.digCharge01 - dt * DIG_CHARGE_DECAY);
  }

  const groundDigVisual =
    isGroundDigLatchEligible() && !!player.grounded && !isAirborne && (player.digCharge01 > 0 || player.digBurrowMode);
  player.digActive = !!player.grounded && (groundDigVisual || (gh && !!isPlayGroundDigShiftHeld()));

  const raisingHeightOnFlight =
    flightMove &&
    isPlaySpaceAscendHeld() &&
    !isPlayGroundDigShiftHeld() &&
    player.z < FLIGHT_MAX_Z - 1e-4;
  const flightHorizontalMoveBoost =
    flightMove &&
    (player.inputX !== 0 || player.inputY !== 0) &&
    !raisingHeightOnFlight
      ? FLIGHT_HORIZONTAL_MOVE_SPEED_MULT
      : 1;

  const carryBlocksWalk = strengthCarryBlocksWalk(player);
  const blockedTurnInputX = carryBlocksWalk ? Number(player.inputX) || 0 : 0;
  const blockedTurnInputY = carryBlocksWalk ? Number(player.inputY) || 0 : 0;
  if (carryBlocksWalk) {
    player.runMode = false;
    player.flameChargeDashSec = 0;
  }

  if ((player.cutThirdHitLockoutSec || 0) > 0) {
    player.inputX = 0;
    player.inputY = 0;
    player.runMode = false;
    player.vx = 0;
    player.vy = 0;
    player.flameChargeDashSec = 0;
  }

  const flameChargeActive =
    (player.flameChargeDashSec || 0) > 1e-5 &&
    player.grounded &&
    !flightMove &&
    !player.digBurrowMode;

  // 1. Horizontal Input & Physics
  if (carryBlocksWalk) {
    // Heavy carry can block translation, but still allow facing/rotation in place.
    if (blockedTurnInputX !== 0 || blockedTurnInputY !== 0) {
      setPlayerFacingFromWalkInput(blockedTurnInputX, blockedTurnInputY);
    }
    player.inputX = 0;
    player.inputY = 0;
    player.vx = 0;
    player.vy = 0;
  } else if (flameChargeActive) {
    player.inputX = 0;
    player.inputY = 0;
    player.runMode = false;
    const nx = Number(player.flameChargeNx) || 0;
    const ny = Number(player.flameChargeNy) || 1;
    const nLen = Math.hypot(nx, ny);
    const ux = nLen > 1e-5 ? nx / nLen : 0;
    const uy = nLen > 1e-5 ? ny / nLen : 1;
    const cap = Math.max(4.5, Number(player.flameChargeSpeedCapTilesPerSec) || 6);
    player.vx = ux * cap;
    player.vy = uy * cap;
    setPlayerFacingFromWorldAimDelta(player, ux, uy);
  } else if (player.inputX !== 0 || player.inputY !== 0) {
    setPlayerFacingFromWalkInput(player.inputX, player.inputY);

    // Accelerate (flight: gentler horizontal accel than on foot)
    const accelMul = flightMove ? FLIGHT_ACCEL_MULT : 1;
    player.vx += player.inputX * ACCEL * accelMul * dt;
    player.vy += player.inputY * ACCEL * accelMul * dt;
  } else {
    // Friction
    const spd = Math.hypot(player.vx, player.vy);
    if (spd > 0) {
      const flightFric = flightMove
        ? smoothLevitationFlight
          ? FLIGHT_LEVITATION_FRICTION_MULT
          : FLIGHT_WINGED_FRICTION_MULT
        : 1;
      const fr = FRICTION * flightFric;
      const drop = fr * dt;
      const newSpd = Math.max(0, spd - drop);
      player.vx *= newSpd / spd;
      player.vy *= newSpd / spd;
    }
  }

  // Winged flight only: horizontal drag while thrusting (levitation keeps friction on release only).
  if (flightMove && !smoothLevitationFlight && (player.inputX !== 0 || player.inputY !== 0)) {
    const spdW = Math.hypot(player.vx, player.vy);
    if (spdW > 0) {
      const fr = FRICTION * FLIGHT_WINGED_FRICTION_MULT;
      const drop = fr * dt;
      const newSpd = Math.max(0, spdW - drop);
      player.vx *= newSpd / spdW;
      player.vy *= newSpd / spdW;
    }
  }

  // Clamp Speed (underground cliff crossing caps Diglett/Dugtrio much lower)
  const inputMag = Math.hypot(player.inputX, player.inputY);
  const spdPreClamp = Math.hypot(player.vx, player.vy);
  const burrowFeetWalkActive =
    player.grounded &&
    !isAirborne &&
    spdPreClamp > 0.1 &&
    isPlayerUndergroundBurrowWalkActive(player.dexId ?? 0, {
      isAirborne,
      grounded: !!player.grounded,
      isMoving: true,
      digBurrowMode: !!player.digBurrowMode
    });
  let terrainSlowMul = 1;
  if (burrowFeetWalkActive && data) {
    const tx = player.x + player.vx * dt;
    const ty = player.y + player.vy * dt;
    terrainSlowMul = resolveTerrainWalkSpeedCapMultiplier({
      dexId: player.dexId ?? 0,
      grounded: !!player.grounded,
      airborne: isAirborne,
      spd: spdPreClamp,
      data,
      ox: player.x,
      oy: player.y,
      tx,
      ty,
      burrowFeetWalkActive,
      burrowFeetTileExists
    });
  }
  const sprintEligible =
    !!player.runMode &&
    canEntityStartSprint(player) &&
    !carryBlocksWalk &&
    !flameChargeActive &&
    !flightMove &&
    !player.digBurrowMode;
  const runMul = sprintEligible ? RUN_SPEED_CAP_MULT : 1;
  const flightMul = flightMove
    ? smoothLevitationFlight
      ? FLIGHT_LEVITATION_MAX_SPEED_MULT
      : FLIGHT_WINGED_MAX_SPEED_MULT
    : 1;
  const combatChargeSlowMul =
    (playInputState.chargeLeft01 > 0.02 ||
      playInputState.chargeRight01 > 0.02 ||
      playInputState.chargeMmb01 > 0.02) &&
    !playInputState.ctrlLeftHeld
      ? LMB_COMBAT_CHARGE_SPEED_MUL
      : 1;
  let currentMaxSpeed =
    MAX_SPEED *
    Math.max(1.0, inputMag) *
    runMul *
    terrainSlowMul *
    flightMul *
    flightHorizontalMoveBoost *
    getStrengthCarryMoveSpeedMultiplier(player) *
    combatChargeSlowMul;
  if (flameChargeActive) {
    const fcCap = Number(player.flameChargeSpeedCapTilesPerSec) || MAX_SPEED * 2.4;
    currentMaxSpeed = Math.max(currentMaxSpeed, fcCap);
  }
  const spd = Math.hypot(player.vx, player.vy);
  if (spd > currentMaxSpeed) {
     player.vx *= currentMaxSpeed / spd;
     player.vy *= currentMaxSpeed / spd;
  }

  // 2. Tile / prop movement (ignore tree trunk circles here; trunks resolved like 25D demo: separate + slide on normal).
  const ox = player.x;
  const oy = player.y;
  const ax = player.vx * dt;
  const ay = player.vy * dt;
  const stepMag2 = ax * ax + ay * ay;
  const ig = true;

  beginWalkProbeCache();
  try {
    if (stepMag2 < 1e-14) {
      // no displacement
    } else if (canWalk(ox + ax, oy + ay, data, ox, oy, isAirborne, ig)) {
      player.x = ox + ax;
      player.y = oy + ay;
    } else {
      let px = ox;
      let py = oy;
      let moved = false;

      if (canWalk(ox, oy, data, ox, oy, isAirborne, ig)) {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) * 0.5;
          if (canWalk(ox + ax * mid, oy + ay * mid, data, ox, oy, isAirborne, ig)) lo = mid;
          else hi = mid;
        }
        const t = lo;
        px = ox + ax * t;
        py = oy + ay * t;
        if (t > 1e-7) moved = true;

        const rax = ax * (1 - t);
        const ray = ay * (1 - t);
        if (Math.abs(rax) >= Math.abs(ray)) {
          if (Math.abs(rax) > 1e-6 && canWalk(px + rax, py, data, px, py, isAirborne, ig)) {
            px += rax;
            moved = true;
          } else if (Math.abs(ray) > 1e-6 && canWalk(px, py + ray, data, px, py, isAirborne, ig)) {
            py += ray;
            moved = true;
          }
        } else {
          if (Math.abs(ray) > 1e-6 && canWalk(px, py + ray, data, px, py, isAirborne, ig)) {
            py += ray;
            moved = true;
          } else if (Math.abs(rax) > 1e-6 && canWalk(px + rax, py, data, px, py, isAirborne, ig)) {
            px += rax;
            moved = true;
          }
        }
      }

      if (moved) {
        player.x = px;
        player.y = py;
      } else if (canWalk(ox + ax, oy, data, ox, oy, isAirborne, ig)) {
        player.x = ox + ax;
        player.vy = 0;
      } else if (canWalk(ox, oy + ay, data, ox, oy, isAirborne, ig)) {
        player.y = oy + ay;
        player.vx = 0;
      } else {
        player.vx = 0;
        player.vy = 0;
      }
    }
  } finally {
    endWalkProbeCache();
  }

  const spdPostMove = Math.hypot(player.vx ?? 0, player.vy ?? 0);
  const playerBurrowWalkActive = isPlayerUndergroundBurrowWalkActive(player.dexId ?? 0, {
    isAirborne,
    grounded: !!player.grounded,
    isMoving: spdPostMove > 0.1,
    digBurrowMode: !!player.digBurrowMode
  });

  if (player.grounded && !isAirborne && data && !playerBurrowWalkActive) {
    const fd = playerFeetDeltaTiles();
    const r = resolvePivotWithFeetVsTreeTrunks(player.x, player.y, fd.dx, fd.dy, GROUND_R, player.vx, player.vy, data);
    
    syncEntityZWithTerrain(player, player.x, player.y, r.x, r.y, data);

    player.x = r.x;
    player.y = r.y;
    player.vx = r.vx;
    player.vy = r.vy;
  }

  clampPlayerToPlayColliderBoundsIfActive(player);

  const movedWorldTiles = Math.hypot(player.x - ox, player.y - oy);
  const wantFootFloorSfx =
    !!player.grounded && !isAirborne && !player.digBurrowMode && !playerBurrowWalkActive;
  advanceFootFloorStepsForDistance(player, movedWorldTiles, wantFootFloorSfx, player);

  // Rain footprints: splashes dropped at the PMD feet anchor while walking during rain
  // (the fx module itself gates on rain intensity, so off-weather is free here).
  const feetForFx = worldFeetFromPivotCell(player.x, player.y, imageCache, player.dexId || 94, true);
  advanceRainFootstepFxForDistance(player, movedWorldTiles, wantFootFloorSfx, feetForFx.x, feetForFx.y);

  // 3. Vertical — creative flight (Flying) or jump / gravity
  if (flightMove) {
    const zFlightPrev = player.z;
    const vSp = smoothLevitationFlight ? FLIGHT_LEVITATION_VERT_SPEED : FLIGHT_WINGED_VERT_SPEED;
    const cutLock = (player.cutThirdHitLockoutSec || 0) > 0;
    const up = cutLock ? 0 : isPlaySpaceAscendHeld() ? vSp : 0;
    const down = cutLock ? 0 : isPlayGroundDigShiftHeld() ? vSp : 0;
    const dz = (up - down) * dt;
    player.z = Math.min(FLIGHT_MAX_Z, Math.max(0, player.z + dz));
    player.vz = 0;
    player.jumping = false;
    if (player.z <= 1e-4) {
      player.z = 0;
      player.grounded = true;
      player.jumpsUsed = 0;
      if (zFlightPrev > 0.14) playFloorHit2Sfx(player);
    } else {
      player.grounded = false;
    }
  } else if (!player.grounded) {
    const zJumpPrev = player.z;
    player.vz -= GRAVITY * dt;
    /** Used by Earthquake: high falls can cross z=0 in one step from z < 0.04 (tunneling). */
    const vzBeforePositionStep = player.vz;
    player.z += player.vz * dt;

    if (player.z <= 0) {
      player.z = 0;
      player.vz = 0;
      player.grounded = true;
      player.jumping = false;
      player.jumpsUsed = 0;
      if (zJumpPrev > 0.04) playFloorHit2Sfx(player);
      const gt =
        gameTimeSec != null && Number.isFinite(gameTimeSec)
          ? gameTimeSec
          : typeof performance !== 'undefined'
            ? performance.now() * 0.001
            : 0;
      onPlayerEarthquakeLanding(player, data, zJumpPrev, gt, vzBeforePositionStep);
    }
  }

  // 4. Update Visual and Animation
  const raisingFlightAnimMul = raisingHeightOnFlight ? FLIGHT_RAISE_HEIGHT_ANIM_MULT : 1;

  player.visualX = player.x;
  player.visualY = player.y;
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;

  player.ghostPhaseAlpha = computeGhostPhaseShiftDrawAlpha({
    grounded: !!player.grounded,
    dexId: player.dexId ?? 94
  });

  const metaDex = player.dexId ?? 94;
  const pmdMeta = getDexAnimMeta(metaDex);
  const sheetPaths = getPokemonSheetPaths(metaDex);
  const hasChargeAsset = !!(
    pmdMeta?.charge &&
    (imageCache.get(sheetPaths.charge)?.naturalWidth || imageCache.get(sheetPaths.charge)?.width)
  );
  const hasShootAsset = !!(
    pmdMeta?.shoot &&
    (imageCache.get(sheetPaths.shoot)?.naturalWidth || imageCache.get(sheetPaths.shoot)?.width)
  );

  const inCombatCharge =
    hasChargeAsset &&
    !player.digBurrowMode &&
    (playInputState.chargeLeft01 > 0.02 ||
      playInputState.chargeRight01 > 0.02 ||
      playInputState.chargeMmb01 > 0.02) &&
    !playInputState.ctrlLeftHeld;

  const shootRemain0 = player.moveShootAnimSec || 0;
  const shootPlaying = shootRemain0 > 0 && hasShootAsset && pmdMeta?.shoot?.durations?.length;

  const lmbRemain0 = player.lmbAttackAnimSec || 0;
  const atkSliceMeta = getDexAnimSlice(metaDex, 'attack');
  const lmbAttackPlaying =
    lmbRemain0 > 0 && !!atkSliceMeta?.durations?.length && !shootPlaying;

  if (shootPlaying) {
    const seq = pmdMeta.shoot.durations;
    const total = seq.reduce((a, b) => a + b, 0);
    player._shootAnimTick = (player._shootAnimTick || 0) + dt * 60;
    const t = Math.min(player._shootAnimTick, Math.max(0.0001, total - 0.0001));
    player.animFrame = pickPmdSeqFrame(seq, t);
    player.idleTimer = 0;
    player.totalDistMoved = 0;
  } else if (lmbAttackPlaying) {
    player._shootAnimTick = 0;
    player._chargeAnimTick = 0;
    const seq = atkSliceMeta.durations;
    const total = seq.reduce((a, b) => a + b, 0);
    player._lmbAttackAnimTick = (player._lmbAttackAnimTick || 0) + dt * 60;
    const t = Math.min(player._lmbAttackAnimTick, Math.max(0.0001, total - 0.0001));
    player.animFrame = pickPmdSeqFrame(seq, t);
    player.idleTimer = 0;
    player.totalDistMoved = 0;
  } else if (inCombatCharge && pmdMeta?.charge?.durations?.length) {
    player._shootAnimTick = 0;
    player._lmbAttackAnimTick = 0;
    const seq = pmdMeta.charge.durations;
    const total = seq.reduce((a, b) => a + b, 0);
    player._chargeAnimTick = (player._chargeAnimTick || 0) + dt * 60;
    const loopTick = player._chargeAnimTick % total;
    player.animFrame = pickPmdSeqFrame(seq, loopTick);
    player.idleTimer = 0;
    player.totalDistMoved = 0;
  } else {
    player._shootAnimTick = 0;
    player._chargeAnimTick = 0;
    player._lmbAttackAnimTick = 0;

    const useWalkLikeAnim =
      (!!player.grounded && (spd > 0.1 || !!player.digActive)) ||
      (flightMove &&
        smoothLevitationFlight &&
        (spd > 0.1 ||
          isPlaySpaceAscendHeld() ||
          isPlayGroundDigShiftHeld() ||
          player.z > 0.02));

    if (useWalkLikeAnim) {
      const animSpd = spd > 0.1 ? spd : DIG_IDLE_ANIM_SPEED;
      player.totalDistMoved += animSpd * dt * raisingFlightAnimMul;
      const pmdDexForWalkLike =
        player.digActive &&
        speciesUsesBorrowedDiglettDigVisual(player.dexId ?? 0) &&
        player.digBurrowMode
          ? getBorrowDigPlaceholderDex(player.dexId ?? 0)
          : player.dexId ?? 94;
      const meta = getDexAnimMeta(pmdDexForWalkLike);
      const seq = player.digActive
        ? meta?.dig?.durations || meta?.walk?.durations || PMD_DEFAULT_MON_ANIMS.Walk
        : meta?.walk?.durations || PMD_DEFAULT_MON_ANIMS.Walk;
      const totalTicks = seq.reduce((a, b) => a + b, 0);

      const walkDistanceCycle = 3.5;
      const animT = (player.totalDistMoved % walkDistanceCycle) / walkDistanceCycle;
      const currentTick = animT * totalTicks;

      let accumulated = 0;
      player.animFrame = 0;
      for (let i = 0; i < seq.length; i++) {
        accumulated += seq[i];
        if (currentTick <= accumulated) {
          player.animFrame = i;
          break;
        }
      }
      player.idleTimer = 0;
    } else {
      const meta = getDexAnimMeta(player.dexId);
      const seq = meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle;
      const totalTicks = seq.reduce((a, b) => a + b, 0);

      player.idleTimer += dt * 60 * raisingFlightAnimMul;
      const loopTick = player.idleTimer % totalTicks;

      let accumulated = 0;
      player.animFrame = 0;
      for (let i = 0; i < seq.length; i++) {
        accumulated += seq[i];
        if (loopTick <= accumulated) {
          player.animFrame = i;
          break;
        }
      }
    }
  }

  if (shootRemain0 > 0) {
    player.moveShootAnimSec = Math.max(0, shootRemain0 - dt);
  }
  if (lmbRemain0 > 0) {
    player.lmbAttackAnimSec = Math.max(0, lmbRemain0 - dt);
  }

  const tackleDur = player._tackleDurSec || 0;
  const tackleRem = player.lmbAttackAnimSec || 0;
  if (tackleRem > 0 && tackleDur > 1e-6) {
    const progress = 1 - tackleRem / tackleDur;
    const reach = Math.max(0, Number(player._tackleReachTiles) || TACKLE_REACH_TILES);
    const lunge = resolveTackleLunge01(progress) * reach;
    player._tackleLungeDx = (player.tackleDirNx ?? 0) * lunge;
    player._tackleLungeDy = (player.tackleDirNy ?? 0) * lunge * TACKLE_VISUAL_DEPTH_Y_SCALE;
  } else {
    player._tackleLungeDx = 0;
    player._tackleLungeDy = 0;
  }

  if (player.socialEmotionType !== null) {
    player.socialEmotionAge = (player.socialEmotionAge || 0) + dt;
    if (player.socialEmotionAge > WILD_EMOTION_NONPERSIST_CLEAR_SEC) {
      player.socialEmotionType = null;
      player.socialEmotionAge = 0;
      player.socialEmotionPortraitSlug = null;
    }
  }
  advancePlayerSpeechBubble(player, dt);

  // Ground ↔ air tether: while changing height in flight, or each 4s hover-idle the last 1s blinks on/off.
  if (flightMove) {
    const raisingHeightDraw =
      isPlaySpaceAscendHeld() &&
      !isPlayGroundDigShiftHeld() &&
      player.z < FLIGHT_MAX_Z - 1e-4;
    const loweringHeightDraw =
      isPlayGroundDigShiftHeld() &&
      !isPlaySpaceAscendHeld() &&
      player.z > 1e-4;
    const verticalFlightAdjust = raisingHeightDraw || loweringHeightDraw;
    const horizBusy =
      player.inputX !== 0 ||
      player.inputY !== 0 ||
      spdPostMove > 0.12;
    const tetherBusyFlight = verticalFlightAdjust || horizBusy;

    if (tetherBusyFlight) {
      player._flightIdleCycleSec = 0;
    } else {
      player._flightIdleCycleSec = (player._flightIdleCycleSec || 0) + dt;
    }

    const c = FLIGHT_TETHER_IDLE_CYCLE_SEC;
    const b = FLIGHT_TETHER_IDLE_BLINK_SEC;
    const t = (player._flightIdleCycleSec || 0) % c;
    const inBlinkWindow = t >= c - b;
    let idleTetherBlink = false;
    if (inBlinkWindow && b > 1e-6) {
      const local01 = (t - (c - b)) / b;
      const slices = Math.max(2, Math.round(FLIGHT_TETHER_IDLE_BLINK_HZ * 2 * b));
      idleTetherBlink = Math.floor(local01 * slices) % 2 === 0;
    }

    player.flightGroundTetherVisible = verticalFlightAdjust || idleTetherBlink;
  } else {
    player._flightIdleCycleSec = 0;
    player.flightGroundTetherVisible = false;
  }

  ensureEntityStamina(player);
  const runningCostsStamina =
    !!sprintEligible &&
    !!player.grounded &&
    !isAirborne &&
    (player.inputX !== 0 || player.inputY !== 0);
  tickEntityStamina(player, dt, runningCostsStamina);
}
