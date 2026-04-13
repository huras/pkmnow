import { playInputState } from './play-input-state.js';
import {
  castEmber,
  castWaterBurst,
  castEmberCharged,
  castWaterCharged,
  castCounterAttack1,
  castCounterAttack2,
  castUltimate
} from '../moves/moves-manager.js';

const TAP_MS = 220;
const CHARGE_MAX_SEC = 1.12;

let leftHeld = false;
let rightHeld = false;
let leftDownAt = 0;
let rightDownAt = 0;
/** Shift held when primary/secondary button went down (locks “no charge build” for that press). */
let leftShiftAtDown = false;
let rightShiftAtDown = false;

function shiftHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.shiftRightHeld);
}

function aimAtCursor(player) {
  const tx = playInputState.mouseX || (player.x + 1);
  const ty = playInputState.mouseY || player.y;
  return { tx, ty, sx: player.x, sy: player.y };
}

/**
 * @param {number} dt
 * @param {import('../player.js').player} player
 */
export function updatePlayPointerCombat(dt, player) {
  if (leftHeld && !shiftHeld()) {
    playInputState.chargeLeft01 = Math.min(1, (playInputState.chargeLeft01 || 0) + dt / CHARGE_MAX_SEC);
  }
  if (rightHeld && !shiftHeld()) {
    playInputState.chargeRight01 = Math.min(1, (playInputState.chargeRight01 || 0) + dt / CHARGE_MAX_SEC);
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
      const sh = shiftHeld();

      if (e.button === 0) {
        e.preventDefault();
        leftHeld = true;
        leftDownAt = performance.now();
        leftShiftAtDown = sh;
        playInputState.chargeLeft01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 2) {
        e.preventDefault();
        rightHeld = true;
        rightDownAt = performance.now();
        rightShiftAtDown = sh;
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
    const shUp = shiftHeld();

    if (e.button === 0 && leftHeld) {
      leftHeld = false;
      const heldMs = now - leftDownAt;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      if (leftShiftAtDown || shUp) {
        castCounterAttack1(sx, sy, tx, ty, player);
      } else if (heldMs < TAP_MS) {
        castEmber(sx, sy, tx, ty, player);
      } else {
        castEmberCharged(sx, sy, tx, ty, player, playInputState.chargeLeft01 || 0);
      }
      playInputState.chargeLeft01 = 0;
    }
    if (e.button === 2 && rightHeld) {
      rightHeld = false;
      const heldMs = now - rightDownAt;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      if (rightShiftAtDown || shUp) {
        castCounterAttack2(sx, sy, tx, ty, player);
      } else if (heldMs < TAP_MS) {
        castWaterBurst(sx, sy, tx, ty, player);
      } else {
        castWaterCharged(sx, sy, tx, ty, player, playInputState.chargeRight01 || 0);
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
  });
}
