import { tryJumpPlayer, togglePlayerCreativeFlight } from '../player.js';
import { playInputState } from './play-input-state.js';
import { tryStrengthInteractKeyE } from './play-strength-carry.js';
import { samplePlayGamepadFrame, dpadEdgeToBindingSlot } from './play-gamepad-poll.js';
import { attackWheel } from '../ui/attack-wheel.js';
import { dualBindWheel } from '../ui/dual-bind-wheel.js';
import {
  dismissAttackWheelIfOpen,
  handleGamepadBindWheelSlotPress
} from './play-mouse-combat.js';

/**
 * @param {{
 *   getAppMode: () => string,
 *   getCurrentData: () => object | null,
 *   player: import('../player.js').player,
 *   refreshPlayModeInfoBar: (force?: boolean) => void,
 *   onEscapePlay?: () => void,
 *   keyboardMoveX: number,
 *   keyboardMoveY: number
 * }} api
 * @returns {{ inX: number, inY: number }}
 */
export function tickPlayGamepadFrame(api) {
  const {
    getAppMode,
    getCurrentData,
    player,
    refreshPlayModeInfoBar,
    onEscapePlay,
    keyboardMoveX,
    keyboardMoveY
  } = api;

  if (getAppMode() !== 'play') {
    playInputState.gamepadSpaceHeld = false;
    playInputState.gamepadLbHeld = false;
    playInputState.gamepadWheelAimActive = false;
    playInputState.gamepadRunHeld = false;
    playInputState.gamepadFieldLmbHeld = false;
    return { inX: keyboardMoveX, inY: keyboardMoveY };
  }

  const sm = samplePlayGamepadFrame();
  playInputState.gamepadSpaceHeld = !!sm.heldA;
  playInputState.gamepadLbHeld = !!sm.heldLB;
  playInputState.gamepadWheelAimActive = false;

  if (dualBindWheel.isOpen) {
    const lm = Math.hypot(sm.moveX, sm.moveY);
    if (lm >= 0.12) dualBindWheel.updateLeftAnalog(sm.moveX, sm.moveY);
    const rm = Math.hypot(sm.rightRx, sm.rightRy);
    if (rm >= 0.12) dualBindWheel.updateRightAnalog(sm.rightRx, sm.rightRy);
    playInputState.gamepadWheelAimActive = lm >= 0.12 || rm >= 0.12;

    if (sm.risingB) dualBindWheel.confirmFromGamepadCircle();
    if (sm.risingX || sm.risingY) {
      window.dispatchEvent(new CustomEvent('attack-wheel-dismiss'));
    }
  } else {
    if (sm.risingY && !attackWheel.isOpen) {
      tryJumpPlayer(getCurrentData());
    }
    if (sm.risingL3 && !attackWheel.isOpen) {
      togglePlayerCreativeFlight();
      if (getCurrentData()) refreshPlayModeInfoBar(true);
    }

    if (sm.dpadSlotEdge >= 0) {
      handleGamepadBindWheelSlotPress(dpadEdgeToBindingSlot(sm.dpadSlotEdge));
    }
    if (sm.risingR3) {
      handleGamepadBindWheelSlotPress(4);
    }

    if (attackWheel.isOpen) {
      const rm = Math.hypot(sm.rightRx, sm.rightRy);
      if (rm >= 0.12) {
        playInputState.gamepadWheelAimActive = true;
        attackWheel.updateAnalogAim(sm.rightRx, sm.rightRy);
      }
    }

    if (sm.risingX) {
      if (attackWheel.isOpen) dismissAttackWheelIfOpen();
      else {
        const data = getCurrentData();
        if (data) tryStrengthInteractKeyE(player, data);
      }
    }

    if (sm.risingB && attackWheel.isOpen) {
      attackWheel.confirmFromGamepadCircle();
    }
  }

  // PS "X" (Cross) = standard gamepad **A** (index 0), not API button "X" (Square / index 2).
  playInputState.gamepadRunHeld =
    !!sm.connected && !!sm.heldA && !dualBindWheel.isOpen;
  // PS Square = standard **X** (index 2) — same slot as mouse LMB / Digit1 bind wheel.
  playInputState.gamepadFieldLmbHeld =
    !!sm.connected && !!sm.heldX && !dualBindWheel.isOpen;

  if (sm.risingStart || sm.risingBack) {
    if (dualBindWheel.isOpen) {
      window.dispatchEvent(new CustomEvent('attack-wheel-dismiss'));
    } else {
      onEscapePlay?.();
    }
  }

  const gm = Math.hypot(sm.moveX, sm.moveY);
  let inX = keyboardMoveX;
  let inY = keyboardMoveY;
  if (gm > 0.001) {
    inX = sm.moveX;
    inY = sm.moveY;
  }

  return { inX, inY };
}
