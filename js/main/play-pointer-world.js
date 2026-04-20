import { playInputState } from './play-input-state.js';

let lastClientX = 0;
let lastClientY = 0;
/** @type {{ x: number, y: number } | null} */
let playHoverMicroTile = null;

export function recordPlayPointerClient(clientX, clientY) {
  lastClientX = clientX;
  lastClientY = clientY;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ mousePxX: number, mousePxY: number }}
 */
export function clientToCanvasPixels(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const mouseClientX = clientX - rect.left;
  const mouseClientY = clientY - rect.top;
  return {
    mousePxX: (mouseClientX / rect.width) * canvas.width,
    mousePxY: (mouseClientY / rect.height) * canvas.height
  };
}

/**
 * Inverse of the play-mode world→screen mapping (same `-0.5` convention as {@link computePlayViewState} framing).
 *
 * @param {number} mousePxX
 * @param {number} mousePxY
 * @param {{
 *   effTileW: number,
 *   effTileH: number,
 *   currentTransX: number,
 *   currentTransY: number,
 *   earthquakeOffXPx?: number,
 *   earthquakeOffYPx?: number
 * }} cam
 * @returns {{ worldX: number, worldY: number }}
 */
export function worldContinuousFromCanvasPixelsPlayCam(mousePxX, mousePxY, cam) {
  const W = cam.effTileW;
  const H = cam.effTileH;
  const eqx = Number(cam.earthquakeOffXPx) || 0;
  const eqy = Number(cam.earthquakeOffYPx) || 0;
  return {
    worldX: (mousePxX - cam.currentTransX - eqx) / W - 0.5,
    worldY: (mousePxY - cam.currentTransY - eqy) / H - 0.5
  };
}

/**
 * Reprojects the last recorded client position through **this frame's** play camera (must match `render()`).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ effTileW: number, effTileH: number, currentTransX: number, currentTransY: number }} playCam
 * @param {{ x?: number, y?: number }} [earthquakeShakePx] same offset applied to chunk draw + translate in `render()`
 */
export function applyPlayPointerWithPlayCam(canvas, playCam, earthquakeShakePx) {
  if (!canvas || !playCam) return;
  if (!playInputState.mouseValid) {
    playHoverMicroTile = null;
    return;
  }
  const eqx = Number(earthquakeShakePx?.x) || 0;
  const eqy = Number(earthquakeShakePx?.y) || 0;
  const camForPick =
    eqx !== 0 || eqy !== 0
      ? {
          ...playCam,
          earthquakeOffXPx: eqx,
          earthquakeOffYPx: eqy
        }
      : playCam;
  const { mousePxX, mousePxY } = clientToCanvasPixels(canvas, lastClientX, lastClientY);
  const { worldX, worldY } = worldContinuousFromCanvasPixelsPlayCam(mousePxX, mousePxY, camForPick);
  playInputState.mouseX = worldX;
  playInputState.mouseY = worldY;
  playHoverMicroTile = { x: Math.floor(worldX), y: Math.floor(worldY) };
}

/** Hover tile for play mode white outline; `null` if pointer invalid or off-canvas. */
export function getPlayHoverMicroTile() {
  return playHoverMicroTile;
}

export function invalidatePlayPointerHover() {
  playHoverMicroTile = null;
}
