/**
 * Small shared module so gameplay systems (fires, etc.) can read current weather
 * without importing main.js or touching the render layer.
 *
 * `main.js` writes the smoothed render state every tick; fire systems read it here.
 *
 * Wind lives in its own module — see `./wind-state.js`. This file is deliberately kept
 * to rain + preset so neither concern grows a tangled API surface.
 */

let rainIntensity01 = 0;
/** @type {'clear' | 'cloudy' | 'rain' | 'blizzard'} */
let presetName = 'clear';

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

export function setWeatherRenderState({ rainIntensity = 0, preset = 'clear' } = {}) {
  const r = Number(rainIntensity);
  rainIntensity01 = Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0));
  if (preset === 'clear' || preset === 'cloudy' || preset === 'rain' || preset === 'blizzard') presetName = preset;
}

export function getWeatherRainIntensity() {
  return rainIntensity01;
}

export function getWeatherPreset() {
  return presetName;
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
