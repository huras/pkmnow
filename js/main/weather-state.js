/**
 * Small shared module so gameplay systems (fires, etc.) can read current weather
 * without importing main.js or touching the render layer.
 *
 * `main.js` writes the smoothed render state every tick; fire systems read it here.
 */

let rainIntensity01 = 0;
/** @type {'clear' | 'cloudy' | 'rain'} */
let presetName = 'clear';

/** Base wind strength (0..1) before gust modulation. Fed by {@link setWeatherRenderState}. */
let windBaseIntensity01 = 0;
/** Wind direction as radians (screen-space: 0 = east, +pi/2 = south, matches draw code). */
let windDirectionRad = 0;
/** Slow gust envelope (0..1). Multiplied into base intensity for audible/visible gusts. */
let windGust01 = 1;

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

export function setWeatherRenderState({
  rainIntensity = 0,
  preset = 'clear',
  windBaseIntensity = 0,
  windDirRad = 0,
  windGust = 1
} = {}) {
  const r = Number(rainIntensity);
  rainIntensity01 = Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0));
  if (preset === 'clear' || preset === 'cloudy' || preset === 'rain') presetName = preset;
  const wb = Number(windBaseIntensity);
  windBaseIntensity01 = Math.max(0, Math.min(1, Number.isFinite(wb) ? wb : 0));
  const wd = Number(windDirRad);
  windDirectionRad = Number.isFinite(wd) ? wd : 0;
  const wg = Number(windGust);
  windGust01 = Math.max(0, Math.min(1, Number.isFinite(wg) ? wg : 1));
}

export function getWeatherRainIntensity() {
  return rainIntensity01;
}

export function getWeatherPreset() {
  return presetName;
}

/** Base wind intensity (0..1) before gust modulation — stable target envelope. */
export function getWeatherWindBaseIntensity() {
  return windBaseIntensity01;
}

/** Wind direction in radians; matches screen-space convention used by the renderer. */
export function getWeatherWindDirectionRad() {
  return windDirectionRad;
}

/** Slow gust modulation 0..1. Multiply with base intensity for felt/heard gusts. */
export function getWeatherWindGust() {
  return windGust01;
}

/** Convenience: base intensity × gust envelope. Ready-to-use "felt" intensity. */
export function getWeatherWindFeltIntensity() {
  return windBaseIntensity01 * windGust01;
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
