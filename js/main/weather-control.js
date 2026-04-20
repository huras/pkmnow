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
let pendingIntensity01 = null;

/**
 * Queue a weather change. Either argument may be `null`/omitted to keep the current
 * value. Intensity is clamped to `[0, 1]`; invalid presets are ignored silently.
 * @param {WeatherPresetId | null | undefined} preset
 * @param {number | null | undefined} intensity01
 */
export function requestWeatherChange(preset, intensity01) {
  if (
    preset === 'clear' ||
    preset === 'cloudy' ||
    preset === 'rain' ||
    preset === 'blizzard' ||
    preset === 'sandstorm'
  ) {
    pendingPreset = preset;
  }
  if (intensity01 != null) {
    const n = Number(intensity01);
    if (Number.isFinite(n)) {
      pendingIntensity01 = Math.max(0, Math.min(1, n));
    }
  }
}

/**
 * Pop any queued change. Returns `null` when nothing's pending. After calling this the
 * queue is empty; callers are expected to apply the change immediately.
 * @returns {{ preset: WeatherPresetId | null, intensity01: number | null } | null}
 */
export function consumeWeatherChangeRequest() {
  if (pendingPreset == null && pendingIntensity01 == null) return null;
  const out = { preset: pendingPreset, intensity01: pendingIntensity01 };
  pendingPreset = null;
  pendingIntensity01 = null;
  return out;
}
