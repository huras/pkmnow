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
  /** World tile coordinates of the mouse */
  mouseX: 0,
  mouseY: 0,
  /** 0–1 while holding LMB (no Shift) — charged fire shot. */
  chargeLeft01: 0,
  /** 0–1 while holding RMB (no Shift) — charged water shot. */
  chargeRight01: 0
};

export function isShiftDigHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.shiftRightHeld);
}
