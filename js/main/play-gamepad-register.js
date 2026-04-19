/**
 * Ensures Chrome/Chromium will populate `navigator.getGamepads()` after a pad is used.
 * No-op handlers are enough; actual polling lives in `play-gamepad-poll.js`.
 */
export function registerPlayGamepadListeners() {
  window.addEventListener('gamepadconnected', () => {});
  window.addEventListener('gamepaddisconnected', () => {});
}
