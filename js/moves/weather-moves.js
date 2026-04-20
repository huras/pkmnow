/**
 * Weather-switching status moves — these don't hit anything directly; their effect is
 * pushing a new preset into the shared weather controller. The smoothed easing inside
 * the weather engine (`main/weather-system.js`'s `tickWeather`) takes over from there,
 * so the sky/rain/wind blend into the new look over a couple of seconds.
 *
 * Kept tiny on purpose: the moves-manager owns cooldowns and the `bumpPlayerMoveCastVisual`
 * shoot-anim cue, so these helpers only care about queueing the weather state.
 */

import { requestWeatherChange } from '../main/weather-control.js';

/** Target rain intensity when Rain Dance is cast. Tuned so the shift is clearly felt but
 *  doesn't auto-trigger lightning — that's Storm territory (>= 0.75). */
export const RAIN_DANCE_TARGET_INTENSITY = 0.82;
/** Sunny Day pushes intensity high for the `clear` preset so the cloud-threshold ramp
 *  clamps clouds to their sparsest reading (threshold 0.78). */
export const SUNNY_DAY_TARGET_INTENSITY = 1;
/** Target intensity when Blizzard is cast — full howl + max precip from the blizzard preset curve. */
export const BLIZZARD_TARGET_INTENSITY = 1;

/**
 * Queue a transition to the `rain` preset at {@link RAIN_DANCE_TARGET_INTENSITY}.
 * Returns true unconditionally (the queue can always accept a request); cooldown gating
 * is the caller's responsibility.
 */
export function castRainDance() {
  requestWeatherChange('rain', RAIN_DANCE_TARGET_INTENSITY);
  return true;
}

/**
 * Queue a transition to the `clear` preset at {@link SUNNY_DAY_TARGET_INTENSITY}. See
 * `resolveWeatherParams` in `main/weather-presets.js`: on `clear` the intensity scalar
 * drives the cloud threshold — high intensity → mostly empty sky.
 */
export function castSunnyDay() {
  requestWeatherChange('clear', SUNNY_DAY_TARGET_INTENSITY);
  return true;
}

/**
 * Queue a transition to the `blizzard` preset (heavy snow-storm look: dense clouds, high wind,
 * strong precip using the existing rain field + icy screen tint).
 */
export function castBlizzard() {
  requestWeatherChange('blizzard', BLIZZARD_TARGET_INTENSITY);
  return true;
}
