/**
 * Weather preset catalog — the pure "preset id + intensity → render params" mapping.
 * No state, no DOM, no side-effects. The weather system smoothly eases `activeWeatherParams`
 * toward the shape returned here whenever the target preset/intensity changes.
 *
 * To add a new preset (e.g. `'snow'`, `'fog'`, `'sandstorm'`):
 *  1. Add its id to {@link WEATHER_PRESETS} and a label to {@link WEATHER_PRESET_LABELS}.
 *  2. Add a `case` to {@link resolveWeatherParams} returning its render params.
 *  3. Extend the `isWeatherPreset` type guard / any DOM buttons that pick a preset.
 *  4. Optionally wire the ambient audio layer in `weather-ambient-audio.js`.
 */

/** @typedef {'clear' | 'cloudy' | 'rain'} WeatherPresetId */

/**
 * @typedef {object} WeatherRenderParams
 * @property {number} cloudPresence   - 0..1 — how much of the sky is covered by the cloud layer.
 * @property {number} cloudThreshold  - noise threshold for cloud mask (lower → denser clouds).
 * @property {number} cloudMinMul     - darkness multiplier for thinnest cloud bands.
 * @property {number} cloudMaxMul     - darkness multiplier for thickest cloud bands.
 * @property {number} cloudAlphaMul   - overall cloud opacity multiplier.
 * @property {number} rainIntensity   - 0..1 — drives rain streaks, puddles, ambient audio, fire snuff.
 * @property {{ r: number, g: number, b: number, a: number } | null} screenTint
 *   Additive color wash painted over the scene (e.g. slate blue during rain). `null` when absent.
 */

/** Ordered list of supported preset ids. Source of truth for UI iteration. */
export const WEATHER_PRESETS = /** @type {const} */ (['clear', 'cloudy', 'rain']);

/** Human-readable labels for each preset. Used by the debug panel chip. */
export const WEATHER_PRESET_LABELS = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain'
};

/**
 * Narrowing type guard. Safer than raw equality checks scattered across UI handlers /
 * weather-control request validation / mailbox.
 * @param {unknown} id
 * @returns {id is WeatherPresetId}
 */
export function isWeatherPreset(id) {
  return id === 'clear' || id === 'cloudy' || id === 'rain';
}

/**
 * Maps a preset + 0..1 intensity to fully-populated render params. Pure: callers snapshot
 * or smooth toward the returned shape.
 *
 * Tuning notes:
 *  - `cloudThreshold` inversely scales cloud density (`rain` with high intensity → 0.02 ≈ fully overcast).
 *  - `screenTint` alpha ramps with intensity so soft drizzle isn't instantly "gloomy blue".
 *  - `clear` intentionally keeps `cloudPresence: 1` but raises the threshold so the mask
 *    erodes clouds to scattered wisps — lets day-cycle sky read through.
 *
 * @param {WeatherPresetId | string} preset  Unknown ids fall through to `clear`.
 * @param {number} intensity01
 * @returns {WeatherRenderParams}
 */
export function resolveWeatherParams(preset, intensity01) {
  const t = Math.max(0, Math.min(1, Number(intensity01) || 0));
  const lerp = (a, b) => a + (b - a) * t;
  switch (preset) {
    case 'rain':
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.42, 0.02),
        cloudMinMul: lerp(0.45, 0.7),
        cloudMaxMul: lerp(1.55, 1.95),
        cloudAlphaMul: lerp(1, 1.25),
        rainIntensity: t,
        screenTint: t > 0 ? { r: 110, g: 120, b: 145, a: lerp(0, 0.28) } : null
      };
    case 'cloudy':
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.42, 0.22),
        cloudMinMul: 0.45,
        cloudMaxMul: lerp(1.55, 1.7),
        cloudAlphaMul: 1,
        rainIntensity: 0,
        screenTint: null
      };
    case 'clear':
    default:
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.42, 0.78),
        cloudMinMul: 0.4,
        cloudMaxMul: lerp(1.55, 1.1),
        cloudAlphaMul: lerp(1, 0.75),
        rainIntensity: 0,
        screenTint: null
      };
  }
}

/**
 * Structural copy of a {@link WeatherRenderParams} bundle. Kept centralized here so
 * adding a new field (e.g. `snowIntensity`) means editing one function, not three.
 * @param {WeatherRenderParams} src
 * @returns {WeatherRenderParams}
 */
export function cloneWeatherParams(src) {
  return {
    cloudPresence: src.cloudPresence,
    cloudThreshold: src.cloudThreshold,
    cloudMinMul: src.cloudMinMul,
    cloudMaxMul: src.cloudMaxMul,
    cloudAlphaMul: src.cloudAlphaMul,
    rainIntensity: src.rainIntensity,
    screenTint: src.screenTint ? { ...src.screenTint } : null
  };
}
