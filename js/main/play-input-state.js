/**
 * Play-mode input bits shared between the game loop and `updatePlayer`
 * (avoids circular imports with `game-loop.js`).
 */
export const playInputState = {
  /** Left = dig / burrow in play; Right tracked for possible future use. */
  shiftLeftHeld: false,
  shiftRightHeld: false,
  /** Space held — vertical flight up while in creative flight mode. */
  spaceHeld: false,
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
   * Field move charge UI (play combat): which bind is filling the 4-bar meter this frame.
   * Rendered on the play canvas; cleared when binds release or play exits.
   * @type {{ moveId: string, charge01: number, slot: 'l' | 'r' | 'm' } | null}
   */
  fieldChargeUiActive: null
};

export function isShiftDigHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.shiftRightHeld);
}
