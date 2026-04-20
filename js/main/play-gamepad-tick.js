import { tryJumpPlayer, togglePlayerCreativeFlight } from '../player.js';
import { playInputState } from './play-input-state.js';
import { tryStrengthInteractKeyE } from './play-strength-carry.js';
import { samplePlayGamepadFrame, dpadEdgeToBindingSlot } from './play-gamepad-poll.js';
import { attackWheel } from '../ui/attack-wheel.js';
import { dualBindWheel } from '../ui/dual-bind-wheel.js';
import {
  dismissAttackWheelIfOpen,
  handleGamepadBindWheelSlotPress,
  tryGamepadWheelBindCastFromFacing
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
 * @returns {{ inX: number, inY: number, gamepadAnalogMove: boolean }}
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
    playInputState.gamepadFieldRmbHeld = false;
    playInputState.gamepadFieldMmbHeld = false;
    playInputState.gamepadThrowHeld = false;
    playInputState.gamepadAimMag01 = 0;
    playInputState.gamepadAimActive = false;
    playInputState.throwAimInputMode = 'mouse';
    return { inX: keyboardMoveX, inY: keyboardMoveY, gamepadAnalogMove: false };
  }

  const sm = samplePlayGamepadFrame();
  const rightMag = Math.hypot(sm.rightRx, sm.rightRy);
  if (rightMag >= 0.16) {
    const inv = 1 / Math.max(1e-6, rightMag);
    playInputState.gamepadAimNx = sm.rightRx * inv;
    playInputState.gamepadAimNy = sm.rightRy * inv;
    playInputState.gamepadAimMag01 = Math.max(0, Math.min(1, (rightMag - 0.16) / (1 - 0.16)));
    playInputState.gamepadAimActive = true;
    playInputState.throwAimInputMode = 'gamepad';
  } else {
    playInputState.gamepadAimMag01 = 0;
    playInputState.gamepadAimActive = false;
  }
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
    if (sm.risingA && !attackWheel.isOpen && !sm.heldLB) {
      window.dispatchEvent(new CustomEvent('play-toggle-item-hud'));
    }
    if (sm.risingY && !attackWheel.isOpen && !sm.heldLB) {
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

    // PS Square (API "X"): dismiss single bind wheel only — not grab (grab is Circle).
    if (sm.risingX && attackWheel.isOpen) {
      dismissAttackWheelIfOpen();
    } else if (sm.heldLB && sm.risingX && !dualBindWheel.isOpen) {
      tryGamepadWheelBindCastFromFacing(player, getCurrentData(), 'up');
    }
    if (sm.heldLB && sm.risingY && !dualBindWheel.isOpen && !attackWheel.isOpen) {
      tryGamepadWheelBindCastFromFacing(player, getCurrentData(), 'down');
    }

    // PS Circle (API "B"): confirm single bind wheel, else Strength/interact (same role as Key E).
    if (sm.risingB) {
      if (attackWheel.isOpen) {
        attackWheel.confirmFromGamepadCircle();
      } else {
        const data = getCurrentData();
        if (data) tryStrengthInteractKeyE(player, data);
      }
    }
  }

  // PS "X" (Cross) = standard gamepad **A** (index 0), not API button "X" (Square / index 2).
  playInputState.gamepadRunHeld =
    !!sm.connected && !!sm.heldA && !dualBindWheel.isOpen;
  // PS Square = standard **X** (index 2) — same slot as mouse LMB / Digit1 bind wheel.
  // LB+L1 held: Square is reserved for wheel-up bind (slot 4), not LMB slot 1.
  playInputState.gamepadFieldLmbHeld =
    !!sm.connected && !!sm.heldX && !sm.heldLB && !dualBindWheel.isOpen;
  playInputState.gamepadFieldRmbHeld = !!sm.connected && !!sm.heldRT && !dualBindWheel.isOpen;
  playInputState.gamepadFieldMmbHeld = !!sm.connected && !!sm.heldLT && !dualBindWheel.isOpen;
  // Dedicated throw button while carrying Strength props.
  playInputState.gamepadThrowHeld = !!sm.connected && !!sm.heldRB && !dualBindWheel.isOpen;

  if (sm.risingStart || sm.risingBack) {
    if (dualBindWheel.isOpen) {
      window.dispatchEvent(new CustomEvent('attack-wheel-dismiss'));
    } else {
      onEscapePlay?.();
    }
  }

  const gm = Math.hypot(sm.moveX, sm.moveY);
  const gamepadAnalogMove = !!sm.connected && gm > 0.001;
  let inX = keyboardMoveX;
  let inY = keyboardMoveY;
  if (gamepadAnalogMove) {
    inX = sm.moveX;
    inY = sm.moveY;
  }

  return { inX, inY, gamepadAnalogMove };
}
