/**
 * Play-mode input bits shared between the game loop and `updatePlayer`
 * (avoids circular imports with `game-loop.js`).
 */
export const playInputState = {
  /** Left = dig / burrow in play; Right tracked for possible future use. */
  shiftLeftHeld: false,
  shiftRightHeld: false,
  /** Gamepad LB held — mirrors left-shift dig / flight-down for this frame (set in `play-gamepad-tick.js`). */
  gamepadLbHeld: false,
  /** Space held — vertical flight up while in creative flight mode. */
  spaceHeld: false,
  /** Gamepad A held — mirrors Space ascend while in flight (`play-gamepad-tick.js`). */
  gamepadSpaceHeld: false,
  /** Gamepad A / Cross (PS “X”, standard index 0) held — run while moving (`play-gamepad-tick.js` + `game-loop.js`). */
  gamepadRunHeld: false,
  /** Gamepad X / Square (standard index 2) held — mirrors LMB field slot (`play-gamepad-tick.js` + `play-mouse-combat.js`). */
  gamepadFieldLmbHeld: false,
  /** RT / ZR held — mirrors RMB field slot (bind slot 2). */
  gamepadFieldRmbHeld: false,
  /** LT / ZL held — mirrors MMB field slot (bind slot 3). */
  gamepadFieldMmbHeld: false,
  /**
   * True while the move bind wheel is driven by the right stick this frame
   * (skips mouse-based hover in `updateBindWheelHover`).
   */
  gamepadWheelAimActive: false,
  /** When the dual gamepad bind wheels are open: world sim runs at 5% speed (UI/canvas still real-time). */
  dualBindWheelSlowMo: false,
  /** Left Ctrl held — combat modifier (counter slots). */
  ctrlLeftHeld: false,
  /** World tile coordinates of the mouse (ground plane; see `playScreenPixelsToWorldTileCoords`). */
  mouseX: 0,
  mouseY: 0,
  /** False until first `mousemove` in play on the canvas (avoids (0,0) aim before hover). */
  mouseValid: false,
  /** 0-1 while holding LMB in play (field-move charge). */
  chargeLeft01: 0,
  /** 0–1 while holding RMB (no Shift) — charged water shot. */
  chargeRight01: 0,
  /** 0–1 while holding MMB (no Shift) — same idea as RMB for bound move. */
  chargeMmb01: 0,
  /** Psybeam with LMB when psybeam is bound to LMB. */
  psybeamLeftHold: /** @type {{ pulse: number } | null} */ (null),
  /** Psybeam: RMB held with psybeam bound to RMB. */
  psybeamRightHold: /** @type {{ pulse: number } | null} */ (null),
  /** Psybeam: MMB held. */
  psybeamMiddleHold: /** @type {{ pulse: number } | null} */ (null),
  /** LMB held while carrying a Strength rock — show throw arc preview. */
  strengthCarryLmbAim: false,
  /**
   * Field move charge UI (play combat): which bind is filling the charge meter this frame (4 bars, or 5 for Earthquake).
   * Rendered on the play canvas; cleared when binds release or play exits.
   * @type {{ moveId: string, charge01: number, slot: 'l' | 'r' | 'm' } | null}
   */
  fieldChargeUiActive: null
};

export function isShiftDigHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.shiftRightHeld || playInputState.gamepadLbHeld);
}

export function isPlaySpaceAscendHeld() {
  return !!(playInputState.spaceHeld || playInputState.gamepadSpaceHeld);
}

/** Ground dig / ghost phase / flight-down: left Shift or gamepad LB (same as keyboard dig side). */
export function isPlayGroundDigShiftHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.gamepadLbHeld);
}
