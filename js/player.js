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
  endWalkProbeCache
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
import { playInputState } from './main/play-input-state.js';
import { clampPlayerToPlayColliderBoundsIfActive } from './main/play-collider-overlay-cache.js';
import { resolvePivotWithFeetVsTreeTrunks } from './circle-tree-trunk-resolve.js';
import { PMD_DEFAULT_MON_ANIMS } from './pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from './pokemon/pmd-anim-metadata.js';
import { imageCache } from './image-cache.js';
import { getPmdFeetDeltaWorldTiles, worldFeetFromPivotCell } from './pokemon/pmd-layout-metrics.js';
import { WILD_EMOTION_NONPERSIST_CLEAR_SEC } from './pokemon/emotion-display-timing.js';

const MAX_SPEED = 3.2;
const ACCEL = 32.0;
const FRICTION = 20.0;
const GRAVITY = 45.0;
const JUMP_IMPULSE = 14.5;
const GROUND_R = 0.32; // Raio de colisão

/** Creative flight: Space up / Shift down. Winged Flying-types = snappier; Mewtwo/Mew = smoother levitation + walk cycle aloft. */
/** Creative flight ceiling (world tile units); HUD / UI may import this. */
export const PLAYER_FLIGHT_MAX_Z_TILES = 28;
const FLIGHT_MAX_Z = PLAYER_FLIGHT_MAX_Z_TILES;
/** Winged Flying-type: snappier / “flappy” feel. */
const FLIGHT_WINGED_VERT_SPEED = 3;
/** Horizontal speed cap while flying (× `MAX_SPEED`); tuned vs ground. */
const FLIGHT_WINGED_MAX_SPEED_MULT = 2.15 * 3;
const FLIGHT_WINGED_FRICTION_MULT = 0.42;
/** Mewtwo / Mew levitation: calmer horizontal + vertical (see `speciesHasSmoothLevitationFlight`). */
const FLIGHT_LEVITATION_VERT_SPEED = 7.2;
const FLIGHT_LEVITATION_MAX_SPEED_MULT = 1.38 * 3;
const FLIGHT_LEVITATION_FRICTION_MULT = 0.19;
/** Horizontal input acceleration while in creative flight (ground uses full `ACCEL`). */
const FLIGHT_ACCEL_MULT = 0.45;

/** Sprint: double-tap the same direction (WASD / arrows); clears when movement stops. */
const RUN_SPEED_CAP_MULT = 2;

/** Dig animation advance when stationary (world-units/sec equivalent feel). */
const DIG_IDLE_ANIM_SPEED = 2.8;

/** Ground dig (non-Ghost): hold Left Shift to fill charge, then latch burrow until leave ground / jump. */
const DIG_CHARGE_SEC = 0.88;
const DIG_CHARGE_DECAY = 2.2;

const SAVED_DEX_KEY = 'pkmn_player_dex_id';
const initialDex = parseInt(localStorage.getItem(SAVED_DEX_KEY)) || 94;

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
  /** Seconds remaining: ignore projectile damage while > 0. */
  projIFrameSec: 0,
  /** HUD-only poison indicator after Poison Sting. */
  poisonVisualSec: 0,
  /** Seconds remaining: play `shoot` PMD slice after a successful player cast (if asset exists). */
  moveShootAnimSec: 0,
  /** Social emoji balloon rendered above the player. */
  socialEmotionType: null,
  socialEmotionAge: 0,
  socialEmotionPortraitSlug: null
};

export function setPlayerSpecies(dexId) {
  player.dexId = dexId;
  player.runMode = false;
  if (!speciesHasFlyingType(dexId)) player.flightActive = false;
  localStorage.setItem(SAVED_DEX_KEY, dexId);
  if (speciesUsesBorrowedDiglettDigVisual(dexId) || speciesHasGroundType(dexId)) {
    void ensurePokemonSheetsLoaded(imageCache, getBorrowDigPlaceholderDex(dexId));
  }
  player.digBurrowMode = false;
  player.digCharge01 = 0;
  player.hp = player.maxHp ?? 100;
  player.projIFrameSec = 0;
  player.moveShootAnimSec = 0;
  player._shootAnimTick = 0;
  player._chargeAnimTick = 0;
  player.socialEmotionType = null;
  player.socialEmotionAge = 0;
  player.socialEmotionPortraitSlug = null;
}

export function setPlayerPos(x, y) {
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
  player.totalDistMoved = 0;
  player.animFrame = 0;
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;
  player.runMode = false;
  player.ghostPhaseAlpha = 1;
  player.flightActive = false;
  player.digBurrowMode = false;
  player.digCharge01 = 0;
  player.hp = player.maxHp ?? 100;
  player.projIFrameSec = 0;
  player.poisonVisualSec = 0;
  player.socialEmotionType = null;
  player.socialEmotionAge = 0;
  player.socialEmotionPortraitSlug = null;
}

/**
 * @param {{ balloonType?: number, portraitSlug?: string | null } | null | undefined} action
 */
export function showPlayerSocialEmotion(action) {
  const balloonType = Number(action?.balloonType);
  if (!Number.isFinite(balloonType)) return;
  player.socialEmotionType = Math.max(0, Math.min(9, Math.floor(balloonType)));
  player.socialEmotionAge = 0;
  player.socialEmotionPortraitSlug = action?.portraitSlug ? String(action.portraitSlug) : null;
}

/**
 * @param {number} amount
 * @param {boolean} [applyPoisonVisual]
 * @returns {boolean} true if damage was applied (not blocked by iframes)
 */
export function tryDamagePlayerFromProjectile(amount, applyPoisonVisual = false) {
  if (player.projIFrameSec > 0) return false;
  const maxH = player.maxHp ?? 100;
  const cur = player.hp ?? maxH;
  player.hp = Math.max(0, cur - amount);
  player.projIFrameSec = 0.55;
  if (applyPoisonVisual) player.poisonVisualSec = 3;
  return true;
}

/** @param {number} dt */
export function updatePlayerCombatTimers(dt) {
  if (player.projIFrameSec > 0) player.projIFrameSec = Math.max(0, player.projIFrameSec - dt);
  if (player.poisonVisualSec > 0) player.poisonVisualSec = Math.max(0, player.poisonVisualSec - dt);
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

function pickPmdSeqFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return Math.max(0, seq.length - 1);
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
export function tryJumpPlayer(data) {
  const canFly = speciesHasFlyingType(player.dexId ?? 0);
  if (canFly && player.flightActive) return false;

  // Double jump (Flying): second Space while airborne starts creative flight.
  if (canFly && !player.flightActive && !player.grounded && (player.jumping || player.z > 0.05)) {
    player.flightActive = true;
    player.jumping = false;
    player.vz = 0;
    return true;
  }

  if (!player.grounded) return false;
  if (isGroundDigLatchEligible()) {
    player.digBurrowMode = false;
    player.digCharge01 = 0;
  }
  player.vz = JUMP_IMPULSE;
  player.grounded = false;
  player.jumping = true;
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
export function updatePlayer(dt, data) {
  const canFlySpecies = speciesHasFlyingType(player.dexId ?? 0);
  const flightMove = canFlySpecies && player.flightActive;
  const smoothLevitationFlight = speciesHasSmoothLevitationFlight(player.dexId ?? 0);
  const isAirborne = player.jumping || player.z > 0.05 || flightMove;
  const gr = speciesHasGroundType(player.dexId ?? 0);
  const gh = isGhostPhaseShiftBurrowEligibleDex(player.dexId ?? 0);

  if (!isGroundDigLatchEligible() || flightMove) {
    player.digBurrowMode = false;
    player.digCharge01 = 0;
  } else if (!player.grounded || isAirborne) {
    player.digBurrowMode = false;
    player.digCharge01 = 0;
  } else if (player.digBurrowMode) {
    /* latched: stay dug until leave ground / jump */
  } else if (playInputState.shiftLeftHeld) {
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
  player.digActive = !!player.grounded && (groundDigVisual || (gh && !!playInputState.shiftLeftHeld));

  // 1. Horizontal Input & Physics
  if (player.inputX !== 0 || player.inputY !== 0) {
    // Determine facing
    if (player.inputX === 0 && player.inputY < 0) player.facing = 'up';
    else if (player.inputX === 0 && player.inputY > 0) player.facing = 'down';
    else if (player.inputX < 0 && player.inputY === 0) player.facing = 'left';
    else if (player.inputX > 0 && player.inputY === 0) player.facing = 'right';
    else if (player.inputX > 0 && player.inputY < 0) player.facing = 'up-right';
    else if (player.inputX < 0 && player.inputY < 0) player.facing = 'up-left';
    else if (player.inputX > 0 && player.inputY > 0) player.facing = 'down-right';
    else if (player.inputX < 0 && player.inputY > 0) player.facing = 'down-left';

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
  const runMul = player.runMode ? RUN_SPEED_CAP_MULT : 1;
  const flightMul = flightMove
    ? smoothLevitationFlight
      ? FLIGHT_LEVITATION_MAX_SPEED_MULT
      : FLIGHT_WINGED_MAX_SPEED_MULT
    : 1;
  const currentMaxSpeed = MAX_SPEED * Math.max(1.0, inputMag) * runMul * terrainSlowMul * flightMul;
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
    player.x = r.x;
    player.y = r.y;
    player.vx = r.vx;
    player.vy = r.vy;
  }

  clampPlayerToPlayColliderBoundsIfActive(player);

  // 3. Vertical — creative flight (Flying) or jump / gravity
  if (flightMove) {
    const vSp = smoothLevitationFlight ? FLIGHT_LEVITATION_VERT_SPEED : FLIGHT_WINGED_VERT_SPEED;
    const up = playInputState.spaceHeld ? vSp : 0;
    const down = playInputState.shiftLeftHeld ? vSp : 0;
    const dz = (up - down) * dt;
    player.z = Math.min(FLIGHT_MAX_Z, Math.max(0, player.z + dz));
    player.vz = 0;
    player.jumping = false;
    if (player.z <= 1e-4) {
      player.z = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }
  } else if (!player.grounded) {
    player.vz -= GRAVITY * dt;
    player.z += player.vz * dt;

    if (player.z <= 0) {
      player.z = 0;
      player.vz = 0;
      player.grounded = true;
      player.jumping = false;
    }
  }

  // 4. Update Visual and Animation
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
    (playInputState.chargeLeft01 > 0.02 || playInputState.chargeRight01 > 0.02) &&
    !playInputState.ctrlLeftHeld;

  const shootRemain0 = player.moveShootAnimSec || 0;
  const shootPlaying = shootRemain0 > 0 && hasShootAsset && pmdMeta?.shoot?.durations?.length;

  if (shootPlaying) {
    const seq = pmdMeta.shoot.durations;
    const total = seq.reduce((a, b) => a + b, 0);
    player._shootAnimTick = (player._shootAnimTick || 0) + dt * 60;
    const t = Math.min(player._shootAnimTick, Math.max(0.0001, total - 0.0001));
    player.animFrame = pickPmdSeqFrame(seq, t);
    player.idleTimer = 0;
    player.totalDistMoved = 0;
  } else if (inCombatCharge && pmdMeta?.charge?.durations?.length) {
    player._shootAnimTick = 0;
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

    const useWalkLikeAnim =
      (!!player.grounded && (spd > 0.1 || !!player.digActive)) ||
      (flightMove &&
        smoothLevitationFlight &&
        (spd > 0.1 ||
          !!playInputState.spaceHeld ||
          !!playInputState.shiftLeftHeld ||
          player.z > 0.02));

    if (useWalkLikeAnim) {
      const animSpd = spd > 0.1 ? spd : DIG_IDLE_ANIM_SPEED;
      player.totalDistMoved += animSpd * dt;
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

      player.idleTimer += dt * 60;
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

  if (player.socialEmotionType !== null) {
    player.socialEmotionAge = (player.socialEmotionAge || 0) + dt;
    if (player.socialEmotionAge > WILD_EMOTION_NONPERSIST_CLEAR_SEC) {
      player.socialEmotionType = null;
      player.socialEmotionAge = 0;
      player.socialEmotionPortraitSlug = null;
    }
  }
}
