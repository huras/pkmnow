/**
 * Independent screen-space sun-shaft layer (0..1 intensity), eased like the earthquake
 * slider — does not touch weather presets or `weather-system.js`.
 */

import { WEATHER_SMOOTH_TAU_SEC } from './weather-system.js';

let targetIntensity01 = 0;
let activeIntensity01 = 0;

/** @param {{ intensity01?: number }} [opts] */
export function initSunLightRaysLayer(opts = {}) {
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

export function getSunLightRaysActiveIntensity01() {
  return Math.max(0, Math.min(1, activeIntensity01));
}

/** @param {number} dt seconds */
export function tickSunLightRaysLayer(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const tgt = targetIntensity01;
  const k = 1 - Math.exp(-dt / Math.max(0.05, WEATHER_SMOOTH_TAU_SEC));
  activeIntensity01 += (tgt - activeIntensity01) * k;
}
