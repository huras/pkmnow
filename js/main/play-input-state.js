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
  /** Unused (LMB is melee pose only). Cleared on pointer leave. */
  psybeamLeftHold: /** @type {{ pulse: number } | null} */ (null),
  /** Psybeam: RMB held with Psybeam in secondary slot. */
  psybeamRightHold: /** @type {{ pulse: number } | null} */ (null)
};

export function isShiftDigHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.shiftRightHeld);
}
