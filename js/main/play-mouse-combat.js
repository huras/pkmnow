import { playInputState } from './play-input-state.js';
import { setPlayerFacingFromWorldAimDelta } from '../player.js';
import {
  castMoveById,
  castMoveChargedById,
  castUltimate,
  tryCastPlayerFlamethrowerStreamPuff,
  tryCastPlayerPrismaticStreamPuff
} from '../moves/moves-manager.js';
import { getPokemonMoveset } from '../moves/pokemon-moveset-config.js';

const TAP_MS = 220;
const CHARGE_MAX_SEC = 1.12;

function applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty) {
  setPlayerFacingFromWorldAimDelta(player, tx - sx, ty - sy);
}

let leftHeld = false;
let rightHeld = false;
let leftDownAt = 0;
let rightDownAt = 0;
/** Left Ctrl held when primary/secondary button went down (locks “no charge build” for that press). */
let leftShiftAtDown = false;
let rightShiftAtDown = false;
/** True after at least one flamethrower puff this LMB press (hold-stream). */
let leftFlameStreamedThisPress = false;
let rightFlameStreamedThisPress = false;
/** True after at least one prismatic laser stream puff this press. */
let leftPrismaticStreamedThisPress = false;
let rightPrismaticStreamedThisPress = false;

function isHoldStreamMoveId(moveId) {
  return moveId === 'flamethrower' || moveId === 'prismaticLaser';
}

function combatModifierHeld() {
  return !!playInputState.ctrlLeftHeld;
}

/** World aim for LMB/RMB / hotkeys / debug — continuous sub-tile coords (matches screen→world). */
export function aimAtCursor(player) {
  if (!playInputState.mouseValid) {
    return { tx: player.x + 1, ty: player.y, sx: player.x, sy: player.y };
  }
  const wx = playInputState.mouseX;
  const wy = playInputState.mouseY;
  return { tx: wx, ty: wy, sx: player.x, sy: player.y };
}

/** @type {Record<string, string>} */
const HOTKEY_TO_MOVE_ID = {
  Digit1: 'ember',
  Digit2: 'flamethrower',
  Digit3: 'confusion',
  Digit4: 'bubble',
  Digit5: 'waterGun',
  Digit6: 'psybeam',
  Digit7: 'prismaticLaser',
  Digit8: 'poisonSting',
  Digit9: 'poisonPowder',
  Digit0: 'incinerate',
  Minus: 'silkShoot'
};

/**
 * Keyboard quick-cast for all Zelda-ported moves.
 * 1 Ember, 2 Flamethrower, 3 Confusion, 4 Bubble, 5 Water Gun,
 * 6 Psybeam, 7 Prismatic Laser, 8 Poison Sting, 9 Poison Powder,
 * 0 Incinerate, - Silk Shoot.
 * @returns {boolean} true when a hotkey was consumed.
 */
export function castMappedMoveByHotkey(code, player) {
  const moveId = HOTKEY_TO_MOVE_ID[code];
  if (!moveId || !player) return false;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  if (moveId === 'flamethrower' || moveId === 'prismaticLaser') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
  }
  castMoveById(moveId, sx, sy, tx, ty, player);
  return true;
}

function resolveSlots(player) {
  const moves = getPokemonMoveset(player?.dexId || 1);
  return {
    leftTap: moves[0],
    rightTap: moves[1],
    leftShift: moves[2],
    rightShift: moves[3]
  };
}

/**
 * @param {number} dt
 * @param {import('../player.js').player} player
 */
export function updatePlayPointerCombat(dt, player) {
  if (!player) return;
  const slots = resolveSlots(player);
  const mod = combatModifierHeld();
  if (leftHeld && !mod && !isHoldStreamMoveId(slots.leftTap)) {
    playInputState.chargeLeft01 = Math.min(1, (playInputState.chargeLeft01 || 0) + dt / CHARGE_MAX_SEC);
  }
  if (rightHeld && !mod && !isHoldStreamMoveId(slots.rightTap)) {
    playInputState.chargeRight01 = Math.min(1, (playInputState.chargeRight01 || 0) + dt / CHARGE_MAX_SEC);
  }
  const { sx, sy, tx, ty } = aimAtCursor(player);
  if (leftHeld && !mod && slots.leftTap === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) leftFlameStreamedThisPress = true;
  }
  if (rightHeld && !mod && slots.rightTap === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) rightFlameStreamedThisPress = true;
  }
  if (leftHeld && !mod && slots.leftTap === 'prismaticLaser') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) leftPrismaticStreamedThisPress = true;
  }
  if (rightHeld && !mod && slots.rightTap === 'prismaticLaser') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) rightPrismaticStreamedThisPress = true;
  }
}

/**
 * @param {{ canvas: HTMLCanvasElement, getAppMode: () => string, getPlayer: () => import('../player.js').player }} deps
 */
export function installPlayPointerCombat(deps) {
  const { canvas, getAppMode, getPlayer } = deps;

  canvas.addEventListener('contextmenu', (e) => {
    if (getAppMode() === 'play' && !e.ctrlKey) e.preventDefault();
  });

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (getAppMode() !== 'play') return;
      if (e.target !== canvas) return;
      const player = getPlayer();
      const sh = combatModifierHeld();

      if (e.button === 0) {
        e.preventDefault();
        leftHeld = true;
        leftDownAt = performance.now();
        leftShiftAtDown = sh;
        leftFlameStreamedThisPress = false;
        leftPrismaticStreamedThisPress = false;
        playInputState.chargeLeft01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 2) {
        e.preventDefault();
        rightHeld = true;
        rightDownAt = performance.now();
        rightShiftAtDown = sh;
        rightFlameStreamedThisPress = false;
        rightPrismaticStreamedThisPress = false;
        playInputState.chargeRight01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 1) {
        e.preventDefault();
        const { sx, sy, tx, ty } = aimAtCursor(player);
        castUltimate(sx, sy, tx, ty, player);
      }
    },
    { passive: false }
  );

  const onPointerUp = (e) => {
    if (getAppMode() !== 'play') return;
    const player = getPlayer();
    const now = performance.now();
    const shUp = combatModifierHeld();

    if (e.button === 0 && leftHeld) {
      leftHeld = false;
      const heldMs = now - leftDownAt;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      const slots = resolveSlots(player);
      if (leftShiftAtDown || shUp) {
        castMoveById(slots.leftShift, sx, sy, tx, ty, player);
      } else if (slots.leftTap === 'flamethrower') {
        if (!leftFlameStreamedThisPress) {
          applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
          tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player);
        }
      } else if (slots.leftTap === 'prismaticLaser') {
        if (!leftPrismaticStreamedThisPress) {
          applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
          tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player);
        }
      } else if (heldMs < TAP_MS) {
        castMoveById(slots.leftTap, sx, sy, tx, ty, player);
      } else {
        castMoveChargedById(slots.leftTap, sx, sy, tx, ty, player, playInputState.chargeLeft01 || 0);
      }
      playInputState.chargeLeft01 = 0;
    }
    if (e.button === 2 && rightHeld) {
      rightHeld = false;
      const heldMs = now - rightDownAt;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      const slots = resolveSlots(player);
      if (rightShiftAtDown || shUp) {
        castMoveById(slots.rightShift, sx, sy, tx, ty, player);
      } else if (slots.rightTap === 'flamethrower') {
        if (!rightFlameStreamedThisPress) {
          applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
          tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player);
        }
      } else if (slots.rightTap === 'prismaticLaser') {
        if (!rightPrismaticStreamedThisPress) {
          applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
          tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player);
        }
      } else if (heldMs < TAP_MS) {
        castMoveById(slots.rightTap, sx, sy, tx, ty, player);
      } else {
        castMoveChargedById(slots.rightTap, sx, sy, tx, ty, player, playInputState.chargeRight01 || 0);
      }
      playInputState.chargeRight01 = 0;
    }
  };

  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  canvas.addEventListener('pointerleave', () => {
    if (getAppMode() !== 'play') return;
    leftHeld = false;
    rightHeld = false;
    playInputState.chargeLeft01 = 0;
    playInputState.chargeRight01 = 0;
    playInputState.mouseValid = false;
  });
}
