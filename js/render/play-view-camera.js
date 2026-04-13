import { PLAY_BAKE_TILE_PX, PLAY_CAMERA_Z_REF } from './render-constants.js';

/** Hard floor on zoom (world units shrink below this scale). */
const VIEW_SCALE_MIN = 0.48;
/** Smoothing rate toward target scale (1/s-ish). */
const VIEW_SCALE_LAMBDA = 11;

/** Keep shadow + sprite band inside this fraction of canvas height (Smash-style). */
const FRAMED_VERTICAL_FRAC = 0.86;

let smoothedViewScale = 1;
let lastPerfMs = 0;
/** @type {0|1|2} */
let lodDetail = 0;

/** Last play LOD from `computePlayViewState` (0 = full detail, vegetation animates). */
export function getPlayLodDetail() {
  return lodDetail;
}

/**
 * Vertical span in "tile row units" × effTileH = pixels, for shadow (ground cell) + airborne sprite.
 * @param {number} z
 * @param {number} framingHeightTiles — species visual height (tiles), from `POKEMON_HEIGHTS`
 * @param {number} vy — player pivot Y in world tiles (continuous)
 */
function verticalFramingSpanCoeff(z, framingHeightTiles, vy) {
  const vc = vy + 0.5;
  const zClamped = Math.max(0, z);
  const H = Math.max(0.6, framingHeightTiles);
  const wShadowLo = vc - 0.18;
  const wShadowHi = vc + 0.18;
  const wFeet = vc - zClamped;
  const wHead = wFeet - H;
  const wFeetHi = wFeet + 0.1;
  const yLoC = Math.min(wShadowLo, wHead, wFeet);
  const yHiC = Math.max(wShadowHi, wHead, wFeet, wFeetHi);
  return Math.max(0.08, yHiC - yLoC);
}

/**
 * World-space Y bounds (pixels) for the same framing, given effTileH.
 */
function verticalFramingWorldYBounds(effTileH, z, framingHeightTiles, vy) {
  const vc = vy + 0.5;
  const zClamped = Math.max(0, z);
  const H = Math.max(0.6, framingHeightTiles);
  const wShadowLo = (vc - 0.18) * effTileH;
  const wShadowHi = (vc + 0.18) * effTileH;
  const wFeet = (vc - zClamped) * effTileH;
  const wHead = wFeet - H * effTileH;
  const wFeetHi = wFeet + 0.1 * effTileH;
  const yLo = Math.min(wShadowLo, wHead, wFeet);
  const yHi = Math.max(wShadowHi, wHead, wFeet, wFeetHi);
  return { yLo, yHi };
}

/**
 * @param {{
 *   cw: number,
 *   ch: number,
 *   vx: number,
 *   vy: number,
 *   playerZ: number,
 *   flightActive: boolean,
 *   framingHeightTiles: number
 * }} p
 */
export function computePlayViewState(p) {
  const { cw, ch, vx, vy, playerZ, flightActive, framingHeightTiles } = p;
  const now = performance.now();
  const dt = lastPerfMs ? Math.min(0.085, (now - lastPerfMs) / 1000) : 1 / 60;
  lastPerfMs = now;

  const z = Math.max(0, Number(playerZ) || 0);
  const zNorm = Math.min(1, z / PLAY_CAMERA_Z_REF);
  const t = zNorm * zNorm * (3 - 2 * zNorm);
  const flightTighten = flightActive && zNorm > 0.02 ? 0.04 * (1 - zNorm) : 0;
  const scaleFeel = Math.max(
    VIEW_SCALE_MIN,
    Math.min(1, VIEW_SCALE_MIN + (1 - VIEW_SCALE_MIN) * (1 - t) - flightTighten)
  );

  const K = verticalFramingSpanCoeff(z, framingHeightTiles, vy);
  const scaleFit = (ch * FRAMED_VERTICAL_FRAC) / (PLAY_BAKE_TILE_PX * K);
  const targetScale = Math.max(VIEW_SCALE_MIN, Math.min(1, scaleFeel, scaleFit));

  smoothedViewScale += (targetScale - smoothedViewScale) * (1 - Math.exp(-VIEW_SCALE_LAMBDA * dt));

  const effTileW = PLAY_BAKE_TILE_PX * smoothedViewScale;
  const effTileH = effTileW;

  const s = smoothedViewScale;
  if (s <= 0.62) lodDetail = 2;
  else if (s <= 0.82) lodDetail = Math.max(lodDetail, 1);
  if (s >= 0.9) lodDetail = 0;
  else if (s >= 0.68 && lodDetail === 2) lodDetail = 1;
  else if (s >= 0.86 && lodDetail === 1) lodDetail = 0;

  const chunkPad = s < 0.92 ? 2 : s < 0.99 ? 1 : 0;

  const viewW = cw / effTileW;
  const viewH = ch / effTileH;
  const margin = 4 + Math.min(36, Math.ceil(16 * (1 / Math.max(0.5, smoothedViewScale) - 1)));
  const startXTiles = Math.floor(vx - viewW / 2) - margin;
  const startYTiles = Math.floor(vy - viewH / 2) - margin;
  const endXTiles = Math.ceil(vx + viewW / 2) + margin;
  const endYTiles = Math.ceil(vy + viewH / 2) + margin;

  const { yLo, yHi } = verticalFramingWorldYBounds(effTileH, z, framingHeightTiles, vy);
  const midY = (yLo + yHi) * 0.5;
  const currentTransX = Math.round(cw / 2 - (vx + 0.5) * effTileW);
  const currentTransY = Math.round(ch / 2 - midY);

  return {
    bakeTilePx: PLAY_BAKE_TILE_PX,
    effTileW,
    effTileH,
    viewScale: smoothedViewScale,
    lodDetail,
    startXTiles,
    startYTiles,
    endXTiles,
    endYTiles,
    currentTransX,
    currentTransY,
    chunkPad
  };
}
