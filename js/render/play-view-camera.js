import { PLAY_BAKE_TILE_PX, PLAY_CAMERA_Z_REF } from './render-constants.js';
import { isScreenGridCameraOn, applyScreenGridCamera, getScreenGridBlend } from './play-deadzone-camera.js';
import { getEncounterZoomMul } from '../encounter/encounter-cinematic.js';

/** Hard floor on zoom (world units shrink below this scale). */
const VIEW_SCALE_MIN = 0.48;
/** Smoothing rate toward target scale (1/s-ish). */
const VIEW_SCALE_LAMBDA = 11;

/** Keep shadow + sprite band inside this fraction of canvas height (Smash-style). */
const FRAMED_VERTICAL_FRAC = 0.86;

/**
 * During flight (airborne): place ground shadow at this fraction of canvas height (0 = top, 1 = bottom).
 * 0.5 = vertical center. Tune with {@link FLIGHT_CAM_TOP_PAD_PX}.
 */
export const FLIGHT_CAM_SHADOW_Y_FRAC = 0.5;

/**
 * During flight: minimum distance from canvas top to the top of the framed sprite band (px).
 * Larger values leave more empty sky above the Pokémon.
 */
export const FLIGHT_CAM_TOP_PAD_PX = 40;

/**
 * During flight zoom fit only: extra world-tile span **above** the sprite head so
 * `scaleFit` zooms out enough for shadow-at-center + Pokémon-high framing (with {@link FLIGHT_CAM_TOP_PAD_PX}).
 */
export const FLIGHT_CAM_ZOOM_SKY_TILES = 0.55;

/**
 * During flight: multiply {@link FRAMED_VERTICAL_FRAC} for zoom fit only (values below 1 zoom out slightly).
 */
export const FLIGHT_CAM_ZOOM_VERTICAL_FRAC_MUL = 0.9;

/** Only apply flight framing when airborne above this z (tiles), to avoid jitter on the ground. */
const FLIGHT_CAM_Z_EPS = 0.02;

/**
 * Eases in/out the extra flight zoom span (larger K → wider shot). Without this, K jumps the frame
 * `z` crosses {@link FLIGHT_CAM_Z_EPS}, `scaleFit` drops sharply, and LOD hysteresis hits ≤0.82 → LOD 1 instantly.
 */
const FLIGHT_ZOOM_BLEND_RISE_PER_S = 2.6;
const FLIGHT_ZOOM_BLEND_FALL_PER_S = 3.2;

let smoothedViewScale = 1;
/**
 * Zoom “só para LOD / chunkPad”: ignora `flightTighten`, blend de voo em K e fração vertical de voo,
 * para LOD 0/1/2 e padding não mudarem só porque `flightActive` ou o blend de enquadramento de voo.
 */
let smoothedViewScaleLod = 1;
/** 0 = ground-style vertical span for zoom fit; 1 = full flight span — smoothed per frame. */
let flightZoomBlend = 0;
let lastPerfMs = 0;
/** @type {0|1|2} */
let lodDetail = 0;

/** Debug (e.g. `debug-play.html`): keep vegetation / grass passes on full detail regardless of zoom. */
let forceLod0Always = false;

export function setPlayForceLod0Always(on) {
  forceLod0Always = !!on;
}

export function getPlayForceLod0Always() {
  return forceLod0Always;
}

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
 * Vertical span (tile-row units) used only for `scaleFit` while airborne in flight:
 * same band as {@link verticalFramingSpanCoeff} plus extra sky above the head so zoom
 * matches shadow-centered / sprite-high translation.
 */
function verticalFramingSpanCoeffFlightZoom(z, framingHeightTiles, vy) {
  const vc = vy + 0.5;
  const zClamped = Math.max(0, z);
  const H = Math.max(0.6, framingHeightTiles);
  const wShadowLo = vc - 0.18;
  const wShadowHi = vc + 0.18;
  const wFeet = vc - zClamped;
  const wHead = wFeet - H;
  const wFeetHi = wFeet + 0.1;
  const yLoC = Math.min(wShadowLo, wHead, wFeet) - FLIGHT_CAM_ZOOM_SKY_TILES;
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

  const screenGrid = isScreenGridCameraOn();
  const gridBlend = getScreenGridBlend();
  const z = Math.max(0, Number(playerZ) || 0);
  const zNorm = Math.min(1, z / PLAY_CAMERA_Z_REF);
  const t = zNorm * zNorm * (3 - 2 * zNorm);
  const flightTighten = flightActive && zNorm > 0.02 ? 0.04 * (1 - zNorm) : 0;
  const scaleFeel = Math.max(
    VIEW_SCALE_MIN,
    Math.min(1, VIEW_SCALE_MIN + (1 - VIEW_SCALE_MIN) * (1 - t) - flightTighten)
  );
  const scaleFeelLod = Math.max(
    VIEW_SCALE_MIN,
    Math.min(1, VIEW_SCALE_MIN + (1 - VIEW_SCALE_MIN) * (1 - t))
  );

  const wantFlightZoom = flightActive && z > FLIGHT_CAM_Z_EPS;
  if (wantFlightZoom) {
    flightZoomBlend = Math.min(1, flightZoomBlend + dt * FLIGHT_ZOOM_BLEND_RISE_PER_S);
  } else {
    flightZoomBlend = Math.max(0, flightZoomBlend - dt * FLIGHT_ZOOM_BLEND_FALL_PER_S);
  }

  const kGround = verticalFramingSpanCoeff(z, framingHeightTiles, vy);
  const kFlight = verticalFramingSpanCoeffFlightZoom(z, framingHeightTiles, vy);
  const b = flightZoomBlend * flightZoomBlend * (3 - 2 * flightZoomBlend);
  const K = kGround * (1 - b) + kFlight * b;

  const zoomVerticalFracGround = FRAMED_VERTICAL_FRAC;
  const zoomVerticalFracFlight = FRAMED_VERTICAL_FRAC * FLIGHT_CAM_ZOOM_VERTICAL_FRAC_MUL;
  const zoomVerticalFrac = zoomVerticalFracGround * (1 - b) + zoomVerticalFracFlight * b;

  const scaleFit = (ch * zoomVerticalFrac) / (PLAY_BAKE_TILE_PX * K);
  const freeScale = Math.max(VIEW_SCALE_MIN, Math.min(1, scaleFeel, scaleFit));
  const targetScale = freeScale + (1 - freeScale) * gridBlend;

  const scaleFitLod = (ch * FRAMED_VERTICAL_FRAC) / (PLAY_BAKE_TILE_PX * kGround);
  const freeScaleLod = Math.max(VIEW_SCALE_MIN, Math.min(1, scaleFeelLod, scaleFitLod));
  const targetScaleLod = freeScaleLod + (1 - freeScaleLod) * gridBlend;

  const smoothK = 1 - Math.exp(-VIEW_SCALE_LAMBDA * dt);
  smoothedViewScale += (targetScale - smoothedViewScale) * smoothK;
  smoothedViewScaleLod += (targetScaleLod - smoothedViewScaleLod) * smoothK;

  const encounterZoom = getEncounterZoomMul();
  const effTileW = PLAY_BAKE_TILE_PX * smoothedViewScale * encounterZoom;
  const effTileH = effTileW;

  const sLod = smoothedViewScaleLod;
  if (sLod <= 0.62) lodDetail = 2;
  else if (sLod <= 0.82) lodDetail = Math.max(lodDetail, 1);
  if (sLod >= 0.9) lodDetail = 0;
  else if (sLod >= 0.68 && lodDetail === 2) lodDetail = 1;
  else if (sLod >= 0.86 && lodDetail === 1) lodDetail = 0;

  if (forceLod0Always) lodDetail = 0;

  /** Far LOD: fewer offscreen chunks + slightly tighter tile margin (big win when zoomed out). */
  const chunkPad = lodDetail >= 2 ? 1 : sLod < 0.92 ? 2 : sLod < 0.99 ? 1 : 0;

  const viewW = cw / effTileW;
  const viewH = ch / effTileH;
  const marginBase = 4 + Math.min(36, Math.ceil(16 * (1 / Math.max(0.5, smoothedViewScale) - 1)));
  const margin = lodDetail >= 2 ? Math.max(2, marginBase - 8) : marginBase;
  const startXTiles = Math.floor(vx - viewW / 2) - margin;
  const startYTiles = Math.floor(vy - viewH / 2) - margin;
  const endXTiles = Math.ceil(vx + viewW / 2) + margin;
  const endYTiles = Math.ceil(vy + viewH / 2) + margin;

  const { yLo, yHi } = verticalFramingWorldYBounds(effTileH, z, framingHeightTiles, vy);
  const midY = (yLo + yHi) * 0.5;
  const transYGround = ch / 2 - midY;

  const vc = vy + 0.5;
  const shadowMidPx = vc * effTileH;
  const transShadow = ch * FLIGHT_CAM_SHADOW_Y_FRAC - shadowMidPx;
  const transTopMin = FLIGHT_CAM_TOP_PAD_PX - yLo;
  const transYFlight = Math.max(transShadow, transTopMin);

  /** Same smoothstep as K / zoom — avoids Y snap when flight framing toggles vs zoom blend. */
  const currentTransY = Math.round(transYGround * (1 - b) + transYFlight * b);
  const currentTransX = Math.round(cw / 2 - (vx + 0.5) * effTileW);

  /* ── Screen-grid camera (SNES ALTTP-style, toggle: G / minimap icon) ── */
  const _dz = applyScreenGridCamera(currentTransX, currentTransY, vx, vy, effTileW, effTileH, cw, ch);

  return {
    bakeTilePx: PLAY_BAKE_TILE_PX,
    effTileW,
    effTileH,
    viewScale: smoothedViewScale,
    lodDetail,
    startXTiles: _dz ? Math.floor(_dz.ax - viewW / 2) - margin : startXTiles,
    startYTiles: _dz ? Math.floor(_dz.ay - viewH / 2) - margin : startYTiles,
    endXTiles:   _dz ? Math.ceil(_dz.ax + viewW / 2) + margin  : endXTiles,
    endYTiles:   _dz ? Math.ceil(_dz.ay + viewH / 2) + margin  : endYTiles,
    currentTransX: _dz ? _dz.tx : currentTransX,
    currentTransY: _dz ? _dz.ty : currentTransY,
    chunkPad
  };
}
