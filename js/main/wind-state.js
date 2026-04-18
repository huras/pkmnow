/**
 * Global wind state — owns everything about the single "world wind vector" that drives
 * cloud drift, rain slant, streamline visuals and the `Wind.ogg` ambient loop. Kept as
 * its own module so gameplay / render / audio systems can subscribe without pulling in
 * `main.js` or the broader weather module.
 *
 * Data flow every tick:
 *   1. `main.js` calls {@link computeLiveWindState} with the current preset + smoothed
 *      rain intensity → derives a `{ baseIntensity, dirRad, gust }` envelope.
 *   2. `main.js` pushes it here via {@link setWindState}.
 *   3. Renderers, audio, particle FX, etc. read via the `getWind*` helpers below.
 *
 * Nothing in this file is stateful beyond the last snapshot — computation is pure so it
 * can be called anywhere (including from tests / debug panels) without side-effects.
 */

/**
 * Base wind direction in radians (screen-space: 0 = east, +π/2 = south). Roughly matches
 * the cloud drift vector used by `drawSnesCloudParallax` (vx=0.32, vy=0.09 → atan2 ≈ 0.274
 * rad). {@link computeLiveWindState} layers a slow wobble on top so streamlines / tree
 * sway don't feel rigidly aligned to a grid.
 */
export const WIND_BASE_DIR_RAD = 0.274;

/** Base wind strength (0..1) before gust modulation. Fed by {@link setWindState}. */
let windBaseIntensity01 = 0;
/** Current wind direction in radians. Matches screen-space convention (see above). */
let windDirectionRad = 0;
/** Slow gust envelope (0..1). Multiplied into base intensity for audible/visible gusts. */
let windGust01 = 1;

/**
 * Evolves the live wind envelope. The *base* intensity is preset-dependent (clear ≈
 * silent, cloudy has a low steady breeze, rain scales strongly with rainIntensity). On
 * top of that we layer a slow two-sinusoid gust envelope so both the on-screen particles
 * and the `Wind.ogg` ambient loop pulse naturally instead of reading as a flat hum.
 *
 * Direction wobbles gently around {@link WIND_BASE_DIR_RAD}.
 *
 * Pure function — does not touch the module-level snapshot. Call {@link setWindState}
 * with the returned values to publish them.
 *
 * @param {number} time world time seconds
 * @param {'clear' | 'cloudy' | 'rain'} preset
 * @param {number} rainIntensity01
 * @returns {{ baseIntensity: number, dirRad: number, gust: number }}
 */
export function computeLiveWindState(time, preset, rainIntensity01) {
  const rain = Math.max(0, Math.min(1, Number(rainIntensity01) || 0));
  const baseByPreset =
    preset === 'rain' ? 0.25 + 0.55 * rain : preset === 'cloudy' ? 0.3 : 0.08;
  const baseIntensity = Math.max(0, Math.min(1, baseByPreset));
  // Two-sine gust envelope (period ≈ 6–16 s), biased so average sits near ~0.7.
  const g1 = Math.sin(time * 0.38);
  const g2 = Math.sin(time * 0.11 + 1.7);
  const gust = Math.max(0.15, Math.min(1, 0.55 + 0.3 * g1 + 0.2 * g2));
  const dirRad = WIND_BASE_DIR_RAD + Math.sin(time * 0.07) * 0.22;
  return { baseIntensity, dirRad, gust };
}

/**
 * Publish the latest wind snapshot. Missing fields fall back to safe defaults so partial
 * updates don't corrupt the state. Call this every tick from the game loop after running
 * {@link computeLiveWindState}.
 */
export function setWindState({ baseIntensity = 0, dirRad = 0, gust = 1 } = {}) {
  const wb = Number(baseIntensity);
  windBaseIntensity01 = Math.max(0, Math.min(1, Number.isFinite(wb) ? wb : 0));
  const wd = Number(dirRad);
  windDirectionRad = Number.isFinite(wd) ? wd : 0;
  const wg = Number(gust);
  windGust01 = Math.max(0, Math.min(1, Number.isFinite(wg) ? wg : 1));
}

/** Base wind intensity (0..1) before gust modulation — stable target envelope. */
export function getWindBaseIntensity() {
  return windBaseIntensity01;
}

/** Wind direction in radians; matches screen-space convention used by the renderer. */
export function getWindDirectionRad() {
  return windDirectionRad;
}

/** Slow gust modulation 0..1. Multiply with base intensity for felt/heard gusts. */
export function getWindGust() {
  return windGust01;
}

/** Convenience: base intensity × gust envelope. Ready-to-use "felt" intensity. */
export function getWindFeltIntensity() {
  return windBaseIntensity01 * windGust01;
}
