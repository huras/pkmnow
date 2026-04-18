import { computePlayViewState } from './play-view-camera.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { POKEMON_HEIGHTS } from '../pokemon/pokemon-heights.js';

/**
 * Last camera used for play render — screen→world picking must use this so it matches
 * what is drawn (and so `mousemove` does not call `computePlayViewState` extra times
 * and advance smoothing out of sync with the frame).
 * @type {{ effTileW: number, effTileH: number, currentTransX: number, currentTransY: number, cw: number, ch: number } | null}
 */
let lastSnapshot = null;

export function setPlayCameraSnapshot(cam) {
  lastSnapshot = {
    effTileW: cam.effTileW,
    effTileH: cam.effTileH,
    currentTransX: cam.currentTransX,
    currentTransY: cam.currentTransY,
    cw: cam.cw,
    ch: cam.ch
  };
}

export function getPlayCameraSnapshot() {
  return lastSnapshot;
}

export function clearPlayCameraSnapshot() {
  lastSnapshot = null;
}

/**
 * Whether a world point (continuous tile coords, same as lightning impact / `player.visualX`)
 * lies inside the last play canvas bounds. Uses the same mapping as
 * {@link playScreenPixelsToWorldTileCoords} with `worldTile = mouseWorld + 0.5`.
 *
 * @param {number} worldX
 * @param {number} worldY
 * @returns {boolean | null} `true` / `false` if snapshot matches; `null` if no snapshot.
 */
export function isWorldTileOnPlayCanvas(worldX, worldY) {
  const snap = lastSnapshot;
  if (!snap || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  const { effTileW: W, effTileH: H, currentTransX: tx, currentTransY: ty, cw, ch } = snap;
  if (!(W > 0) || !(H > 0) || !(cw > 0) || !(ch > 0)) return null;
  const minX = (0 - tx) / W;
  const maxX = (cw - tx) / W;
  const minY = (0 - ty) / H;
  const maxY = (ch - ty) / H;
  return worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY;
}

/**
 * Same inverse as render play pass: canvas pixel → continuous world tile coords (ground plane).
 * Prefers the snapshot from the last `render()` play frame; falls back if missing/size mismatch.
 */
export function playScreenPixelsToWorldTileCoords(canvasW, canvasH, mousePxX, mousePxY, player) {
  const snap = lastSnapshot;
  if (snap && snap.cw === canvasW && snap.ch === canvasH) {
    return {
      worldX: (mousePxX - snap.currentTransX) / snap.effTileW - 0.5,
      worldY: (mousePxY - snap.currentTransY) / snap.effTileH - 0.5
    };
  }
  const vx = player.visualX ?? player.x;
  const vy = player.visualY ?? player.y;
  const dex = player.dexId || 94;
  const cfg = getPokemonConfig(dex);
  const playCam = computePlayViewState({
    cw: canvasW,
    ch: canvasH,
    vx,
    vy,
    playerZ: player.z ?? 0,
    flightActive: !!player.flightActive,
    framingHeightTiles: cfg?.heightTiles ?? POKEMON_HEIGHTS[dex ?? 94] ?? 1.1
  });
  return {
    worldX: (mousePxX - playCam.currentTransX) / playCam.effTileW - 0.5,
    worldY: (mousePxY - playCam.currentTransY) / playCam.effTileH - 0.5
  };
}
