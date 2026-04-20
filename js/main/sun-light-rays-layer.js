/**
 * Independent screen-space sun-shaft layer (0..1 intensity), eased like the earthquake
 * slider — does not touch weather presets or `weather-system.js`.
 *
 * When the player stands on a formal broadleaf tree footprint, a biome boost (see
 * `FORMAL_TREES_SUN_RAYS_*` in `render-constants.js`) is maxed with the UI target and
 * eased separately for cheap fade in/out.
 */

import { WEATHER_SMOOTH_TAU_SEC } from './weather-system.js';
import {
  FORMAL_TREES_SUN_RAYS_BOOST_INTENSITY,
  FORMAL_TREES_SUN_RAYS_FADE_SEC,
  SUN_LIGHT_RAYS_DAWN_EDGE_FADE_HOURS,
  SUN_LIGHT_RAYS_NIGHT_EDGE_FADE_HOURS
} from '../render/render-constants.js';
import { isPlayerMicroOnFormalTreeFootprint } from './play-formal-tree-footprint.js';
import { wrapHours, PHASE_DAY_START, PHASE_NIGHT_START } from './world-time-of-day.js';

/** ~99% of exponential step in FORMAL_TREES_SUN_RAYS_FADE_SEC */
const FORMAL_TREES_RAYS_FADE_LN100 = 4.605170186;

function smoothstep01(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/**
 * 0..1 daylight gate: off during night and dawn, ramps near day/night boundaries.
 * @param {number} worldHoursWrapped hour in [0, 24)
 */
export function getSunRaysDaylightVisibility01(worldHoursWrapped) {
  const x = wrapHours(worldHoursWrapped);
  const inEnd = PHASE_DAY_START;
  const inStart = inEnd - Math.max(0.05, SUN_LIGHT_RAYS_DAWN_EDGE_FADE_HOURS);
  const outEnd = PHASE_NIGHT_START;
  const outStart = outEnd - Math.max(0.05, SUN_LIGHT_RAYS_NIGHT_EDGE_FADE_HOURS);

  if (x >= outStart && x < outEnd) {
    const t = (x - outStart) / (outEnd - outStart);
    return 1 - smoothstep01(t);
  }
  if (x >= inStart && x < inEnd) {
    const t = (x - inStart) / (inEnd - inStart);
    return smoothstep01(t);
  }
  if (x >= inEnd && x < outStart) return 1;
  return 0;
}

let targetIntensity01 = 0;
let activeIntensity01 = 0;
let biomeBoostActive01 = 0;

/** @param {{ intensity01?: number }} [opts] */
export function initSunLightRaysLayer(opts = {}) {
  biomeBoostActive01 = 0;
  if (opts.intensity01 != null) {
    const n = Number(opts.intensity01);
    if (Number.isFinite(n)) {
      const c = Math.max(0, Math.min(1, n));
      targetIntensity01 = c;
      activeIntensity01 = c;
      return;
    }
  }
  targetIntensity01 = 0;
  activeIntensity01 = 0;
}

/** @param {number} intensity01 */
export function setSunLightRaysTargetIntensity01(intensity01) {
  const n = Number(intensity01);
  if (!Number.isFinite(n)) return;
  targetIntensity01 = Math.max(0, Math.min(1, n));
}

export function getSunLightRaysTargetIntensity01() {
  return targetIntensity01;
}

/**
 * @param {number} [worldHoursWrapped] when set (play), scales by daylight; splash/menu can pass fixed hour (e.g. 12).
 */
export function getSunLightRaysActiveIntensity01(worldHoursWrapped) {
  const h = Number(worldHoursWrapped);
  const dayMul = Number.isFinite(h) ? getSunRaysDaylightVisibility01(h) : getSunRaysDaylightVisibility01(12);
  const ui = Math.max(0, Math.min(1, activeIntensity01));
  const bio = Math.max(0, Math.min(1, biomeBoostActive01));
  return Math.min(1, Math.max(ui, bio) * dayMul);
}

/**
 * @param {number} dt seconds
 * @param {{ data?: object | null, player?: object | null }} [playCtx] when `data` + `player` set, updates formal-tree biome boost (O(1) tile probe).
 */
export function tickSunLightRaysLayer(dt, playCtx) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const tgt = targetIntensity01;
  const k = 1 - Math.exp(-dt / Math.max(0.05, WEATHER_SMOOTH_TAU_SEC));
  activeIntensity01 += (tgt - activeIntensity01) * k;

  let biomeWant = 0;
  const data = playCtx?.data;
  const pl = playCtx?.player;
  if (data && pl) {
    const px = Number(pl.visualX ?? pl.x);
    const py = Number(pl.visualY ?? pl.y);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      const mx = Math.floor(px);
      const my = Math.floor(py);
      if (isPlayerMicroOnFormalTreeFootprint(mx, my, data)) {
        biomeWant = FORMAL_TREES_SUN_RAYS_BOOST_INTENSITY;
      }
    }
  }

  const tauBio = Math.max(0.03, FORMAL_TREES_SUN_RAYS_FADE_SEC / FORMAL_TREES_RAYS_FADE_LN100);
  const kb = 1 - Math.exp(-dt / tauBio);
  biomeBoostActive01 += (biomeWant - biomeBoostActive01) * kb;
}
