/**
 * Play-mode input bits shared between the game loop and `updatePlayer`
 * (avoids circular imports with `game-loop.js`).
 */
export const playInputState = {
  /** Either Shift held — dig (Ground types). */
  shiftLeftHeld: false,
  shiftRightHeld: false
};

export function isShiftDigHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.shiftRightHeld);
}
