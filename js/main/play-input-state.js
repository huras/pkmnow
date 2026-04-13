/**
 * Play-mode input bits shared between the game loop and `updatePlayer`
 * (avoids circular imports with `game-loop.js`).
 */
export const playInputState = {
  /** Left = dig / burrow in play; Right tracked for possible future use. */
  shiftLeftHeld: false,
  shiftRightHeld: false,
  /** Space held — vertical flight up while in creative flight mode. */
  spaceHeld: false
};

export function isShiftDigHeld() {
  return !!(playInputState.shiftLeftHeld || playInputState.shiftRightHeld);
}
