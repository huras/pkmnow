/**
 * Shared "request weather change" mailbox. Moves (Rain Dance, Sunny Day, future weather
 * toggles) push a desired preset + intensity here; the weather engine
 * (`./weather-system.js`) drains the request each tick, pipes it through
 * {@link setWeatherTarget}, and the registered UI listener re-syncs the debug panel so
 * the player's chip stays in lockstep.
 *
 * Kept as a tiny standalone module (rather than exporting setters from the engine
 * directly) so moves have an import surface free of engine internals — avoids
 * dependency cycles and keeps the moves directory decoupled from `main/*`.
 */

/** @typedef {'clear' | 'cloudy' | 'rain' | 'blizzard' | 'sandstorm'} WeatherPresetId */

/** @type {WeatherPresetId | null} */
let pendingPreset = null;
/** @type {number | null} */
let pendingCloudIntensity01 = null;
/** @type {number | null} */
let pendingPrecipIntensity01 = null;

function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : null;
}

/**
 * Queue a weather change. Either argument may be `null`/omitted to keep the current
 * value. Intensities are clamped to `[0, 1]`; invalid presets are ignored silently.
 *
 * When `precipIntensity01` is provided and `cloudIntensity01` is omitted, cloud mirrors
 * precip (Rain Dance / Sunny Day keep sky and particles aligned).
 *
 * @param {WeatherPresetId | null | undefined} preset
 * @param {number | null | undefined} precipIntensity01
 * @param {number | null | undefined} [cloudIntensity01]
 */
export function requestWeatherChange(preset, precipIntensity01, cloudIntensity01) {
  if (
    preset === 'clear' ||
    preset === 'cloudy' ||
    preset === 'rain' ||
    preset === 'blizzard' ||
    preset === 'sandstorm'
  ) {
    pendingPreset = preset;
  }
  if (precipIntensity01 != null) {
    const c = clamp01(precipIntensity01);
    if (c != null) {
      pendingPrecipIntensity01 = c;
      if (cloudIntensity01 === undefined || cloudIntensity01 === null) {
        pendingCloudIntensity01 = c;
      }
    }
  }
  if (cloudIntensity01 != null) {
    const c = clamp01(cloudIntensity01);
    if (c != null) pendingCloudIntensity01 = c;
  }
}

/**
 * Pop any queued change. Returns `null` when nothing's pending. After calling this the
 * queue is empty; callers are expected to apply the change immediately.
 * @returns {{ preset: WeatherPresetId | null, cloudIntensity01: number | null, precipIntensity01: number | null } | null}
 */
export function consumeWeatherChangeRequest() {
  if (pendingPreset == null && pendingCloudIntensity01 == null && pendingPrecipIntensity01 == null) {
    return null;
  }
  const out = {
    preset: pendingPreset,
    cloudIntensity01: pendingCloudIntensity01,
    precipIntensity01: pendingPrecipIntensity01
  };
  pendingPreset = null;
  pendingCloudIntensity01 = null;
  pendingPrecipIntensity01 = null;
  return out;
}
