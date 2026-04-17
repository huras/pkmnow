/**
 * Small shared module so gameplay systems (fires, etc.) can read current weather
 * without importing main.js or touching the render layer.
 *
 * `main.js` writes the smoothed render state every tick; fire systems read it here.
 */

let rainIntensity01 = 0;
/** @type {'clear' | 'cloudy' | 'rain'} */
let presetName = 'clear';

/** Minimum rain to meaningfully dampen / put out fires. Avoids trace rain ruining gameplay. */
export const RAIN_EXTINGUISH_THRESHOLD = 0.25;
/** Grace period (s) before rain starts snuffing a fire — lets flames be seen for a beat. */
export const FIRE_RAIN_EXTINGUISH_GRACE_SEC = 1;

export function setWeatherRenderState({ rainIntensity = 0, preset = 'clear' } = {}) {
  const r = Number(rainIntensity);
  rainIntensity01 = Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0));
  if (preset === 'clear' || preset === 'cloudy' || preset === 'rain') presetName = preset;
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
