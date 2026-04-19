/**
 * Small shared module so gameplay systems (fires, etc.) can read current weather
 * without importing main.js or touching the render layer.
 *
 * `main.js` writes the smoothed render state every tick; fire systems read it here.
 *
 * Wind lives in its own module — see `./wind-state.js`. This file is deliberately kept
 * to rain + preset so neither concern grows a tangled API surface.
 *
 * Volumetric weather params are published alongside rain/preset for the volumetric
 * particle layer + optional audio modulation.
 */

/** @typedef {import('./weather-presets.js').VolumetricWeatherMode} VolumetricWeatherMode */

let rainIntensity01 = 0;
/** @type {'clear' | 'cloudy' | 'rain' | 'blizzard' | 'sandstorm'} */
let presetName = 'clear';

/** Smoothed sandstorm categorical weight (mirrors weather-system preset blend). */
let weatherSandstormBlend01 = 0;

/** @type {VolumetricWeatherMode} */
let weatherMode = 'clear';
let volumetricParticleDensity = 0;
let volumetricVolumeDepth = 0.15;
let volumetricFallSpeed = 0.35;
let volumetricWindCarry = 0.12;
let volumetricTurbulence = 0.04;
let volumetricAbsorptionBias = 0.5;
let volumetricSplashBias = 0.35;

/** Minimum rain to meaningfully dampen / put out fires. Avoids trace rain ruining gameplay. */
export const RAIN_EXTINGUISH_THRESHOLD = 0.25;
/**
 * Rain-snuff timing (seconds from ignition to forced extinguish):
 *  - At rain = `RAIN_EXTINGUISH_THRESHOLD` → `FIRE_RAIN_EXTINGUISH_WEAK_SEC` (slow, lets the fire live for a bit).
 *  - At rain = 1.0                       → `FIRE_RAIN_EXTINGUISH_STRONG_SEC` (minimum cycle, "almost instant").
 *
 * `FIRE_RAIN_EXTINGUISH_GRACE_SEC` is kept as the minimum (strong-rain) value for any caller that
 * just wants a floor and doesn't need the intensity-scaled timing. Prefer `getRainFireSnuffSeconds()`
 * when scaling with current weather intensity.
 */
export const FIRE_RAIN_EXTINGUISH_STRONG_SEC = 1;
export const FIRE_RAIN_EXTINGUISH_WEAK_SEC = 6;
export const FIRE_RAIN_EXTINGUISH_GRACE_SEC = FIRE_RAIN_EXTINGUISH_STRONG_SEC;

/**
 * @param {{
 *   rainIntensity?: number,
 *   preset?: 'clear' | 'cloudy' | 'rain' | 'blizzard' | 'sandstorm',
 *   weatherMode?: VolumetricWeatherMode,
 *   volumetricParticleDensity?: number,
 *   volumetricVolumeDepth?: number,
 *   volumetricFallSpeed?: number,
 *   volumetricWindCarry?: number,
 *   volumetricTurbulence?: number,
 *   volumetricAbsorptionBias?: number,
 *   volumetricSplashBias?: number,
 *   weatherSandstormBlend01?: number
 * }} [next]
 */
export function setWeatherRenderState(next = {}) {
  const {
    rainIntensity = 0,
    preset = 'clear',
    weatherMode: wm,
    volumetricParticleDensity: vpd,
    volumetricVolumeDepth: vvd,
    volumetricFallSpeed: vfs,
    volumetricWindCarry: vwc,
    volumetricTurbulence: vt,
    volumetricAbsorptionBias: vab,
    volumetricSplashBias: vsb,
    weatherSandstormBlend01: ssb
  } = next;
  const r = Number(rainIntensity);
  rainIntensity01 = Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0));
  if (
    preset === 'clear' ||
    preset === 'cloudy' ||
    preset === 'rain' ||
    preset === 'blizzard' ||
    preset === 'sandstorm'
  ) {
    presetName = preset;
  }
  if (wm === 'clear' || wm === 'rain' || wm === 'snow' || wm === 'sandstorm') weatherMode = wm;
  const clamp01 = (v, d) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(0, Math.min(1, n));
  };
  if (vpd !== undefined) volumetricParticleDensity = clamp01(vpd, volumetricParticleDensity);
  if (vvd !== undefined) volumetricVolumeDepth = clamp01(vvd, volumetricVolumeDepth);
  if (vfs !== undefined) volumetricFallSpeed = clamp01(vfs, volumetricFallSpeed);
  if (vwc !== undefined) volumetricWindCarry = clamp01(vwc, volumetricWindCarry);
  if (vt !== undefined) volumetricTurbulence = clamp01(vt, volumetricTurbulence);
  if (vab !== undefined) volumetricAbsorptionBias = clamp01(vab, volumetricAbsorptionBias);
  if (vsb !== undefined) volumetricSplashBias = clamp01(vsb, volumetricSplashBias);
  if (ssb !== undefined) weatherSandstormBlend01 = clamp01(ssb, weatherSandstormBlend01);
}

export function getWeatherRainIntensity() {
  return rainIntensity01;
}

export function getWeatherPreset() {
  return presetName;
}

export function getWeatherSandstormBlend01() {
  return weatherSandstormBlend01;
}

/** @returns {VolumetricWeatherMode} */
export function getWeatherVolumetricMode() {
  return weatherMode;
}

export function getWeatherVolumetricParams() {
  return {
    weatherMode,
    volumetricParticleDensity,
    volumetricVolumeDepth,
    volumetricFallSpeed,
    volumetricWindCarry,
    volumetricTurbulence,
    volumetricAbsorptionBias,
    volumetricSplashBias
  };
}

export function isRainExtinguishing() {
  return rainIntensity01 >= RAIN_EXTINGUISH_THRESHOLD;
}

/**
 * Seconds of burn time before rain forcibly extinguishes a fire, lerped by current rain intensity.
 * Returns `Infinity` when rain is below the extinguish threshold (fires are not dampened at all).
 */
export function getRainFireSnuffSeconds() {
  if (rainIntensity01 < RAIN_EXTINGUISH_THRESHOLD) return Infinity;
  const span = 1 - RAIN_EXTINGUISH_THRESHOLD;
  const t = span > 0 ? (rainIntensity01 - RAIN_EXTINGUISH_THRESHOLD) / span : 1;
  const clamped = Math.max(0, Math.min(1, t));
  return (
    FIRE_RAIN_EXTINGUISH_WEAK_SEC +
    (FIRE_RAIN_EXTINGUISH_STRONG_SEC - FIRE_RAIN_EXTINGUISH_WEAK_SEC) * clamped
  );
}
