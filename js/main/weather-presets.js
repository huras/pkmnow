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

/** @typedef {'clear' | 'cloudy' | 'rain' | 'blizzard' | 'sandstorm'} WeatherPresetId */

/** @typedef {'clear' | 'rain' | 'snow' | 'sandstorm'} VolumetricWeatherMode */

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
 * @property {VolumetricWeatherMode} weatherMode — dominant mode for volumetric particles (rain / snow / sand / off).
 * @property {number} volumetricParticleDensity - 0..1 overall spawn budget for volumetric layer.
 * @property {number} volumetricVolumeDepth - 0..1 depth of spawn shell (screen-normalized).
 * @property {number} volumetricFallSpeed - 0..1 vertical motion scale.
 * @property {number} volumetricWindCarry - 0..1 how strongly global wind advects particles.
 * @property {number} volumetricTurbulence - 0..1 micro-wobble strength.
 * @property {number} volumetricAbsorptionBias - 0..1 raises soft-surface absorption (fewer splashes).
 * @property {number} volumetricSplashBias - 0..1 raises hard-surface splash response.
 */

/** Ordered list of supported preset ids. Source of truth for UI iteration. */
export const WEATHER_PRESETS = /** @type {const} */ (['clear', 'cloudy', 'rain', 'blizzard', 'sandstorm']);

/** Human-readable labels for each preset. Used by the debug panel chip. */
export const WEATHER_PRESET_LABELS = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  blizzard: 'Blizzard',
  sandstorm: 'Sandstorm'
};

/**
 * Narrowing type guard. Safer than raw equality checks scattered across UI handlers /
 * weather-control request validation / mailbox.
 * @param {unknown} id
 * @returns {id is WeatherPresetId}
 */
export function isWeatherPreset(id) {
  return id === 'clear' || id === 'cloudy' || id === 'rain' || id === 'blizzard' || id === 'sandstorm';
}

/** Defaults for volumetric tuning when a preset omits explicit zeros. */
function volumetricClear() {
  return {
    weatherMode: /** @type {VolumetricWeatherMode} */ ('clear'),
    volumetricParticleDensity: 0,
    volumetricVolumeDepth: 0.15,
    volumetricFallSpeed: 0.35,
    volumetricWindCarry: 0.12,
    volumetricTurbulence: 0.04,
    volumetricAbsorptionBias: 0.5,
    volumetricSplashBias: 0.35
  };
}

/**
 * @param {Partial<Pick<WeatherRenderParams,
 *   'weatherMode' | 'volumetricParticleDensity' | 'volumetricVolumeDepth' | 'volumetricFallSpeed' |
 *   'volumetricWindCarry' | 'volumetricTurbulence' | 'volumetricAbsorptionBias' | 'volumetricSplashBias'>>} v
 */
function V(v) {
  const c = volumetricClear();
  return { ...c, ...v };
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
        screenTint: t > 0 ? { r: 110, g: 120, b: 145, a: lerp(0, 0.28) } : null,
        ...V({
          weatherMode: 'rain',
          volumetricParticleDensity: lerp(0.22, 1) * t,
          volumetricVolumeDepth: lerp(0.35, 1) * t,
          volumetricFallSpeed: lerp(0.5, 1) * t,
          volumetricWindCarry: lerp(0.32, 0.95) * t,
          volumetricTurbulence: lerp(0.08, 0.38) * t,
          volumetricAbsorptionBias: lerp(0.42, 0.88) * t,
          volumetricSplashBias: lerp(0.55, 1) * t
        })
      };
    case 'blizzard':
      // Heavy overcast + strong horizontal precip (reuses rain streaks) + icy wash; wind scales in `wind-state`.
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.36, 0.015),
        cloudMinMul: lerp(0.52, 0.82),
        cloudMaxMul: lerp(1.62, 2.05),
        cloudAlphaMul: lerp(1.08, 1.32),
        rainIntensity: lerp(0.55, 0.98),
        screenTint: t > 0 ? { r: 210, g: 228, b: 248, a: lerp(0.08, 0.34) } : null,
        ...V({
          weatherMode: 'snow',
          volumetricParticleDensity: lerp(0.45, 1) * t,
          volumetricVolumeDepth: lerp(0.5, 1) * t,
          volumetricFallSpeed: lerp(0.18, 0.42) * t,
          volumetricWindCarry: lerp(0.55, 0.98) * t,
          volumetricTurbulence: lerp(0.12, 0.45) * t,
          volumetricAbsorptionBias: lerp(0.72, 0.98) * t,
          volumetricSplashBias: lerp(0.12, 0.35) * t
        })
      };
    case 'sandstorm':
      // Arid haze + strong wind-driven dust; minimal rain audio/gameplay coupling (rainIntensity stays low).
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.38, 0.08),
        cloudMinMul: lerp(0.5, 0.72),
        cloudMaxMul: lerp(1.5, 1.88),
        cloudAlphaMul: lerp(1.02, 1.22),
        rainIntensity: lerp(0, 0.06) * t,
        screenTint: t > 0 ? { r: 205, g: 178, b: 132, a: lerp(0.06, 0.26) } : null,
        ...V({
          weatherMode: 'sandstorm',
          volumetricParticleDensity: lerp(0.5, 1) * t,
          volumetricVolumeDepth: lerp(0.55, 1) * t,
          volumetricFallSpeed: lerp(0.08, 0.22) * t,
          volumetricWindCarry: lerp(0.85, 1) * t,
          volumetricTurbulence: lerp(0.22, 0.55) * t,
          volumetricAbsorptionBias: lerp(0.35, 0.55) * t,
          volumetricSplashBias: lerp(0.2, 0.4) * t
        })
      };
    case 'cloudy':
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.42, 0.22),
        cloudMinMul: 0.45,
        cloudMaxMul: lerp(1.55, 1.7),
        cloudAlphaMul: 1,
        rainIntensity: 0,
        screenTint: null,
        ...V({ weatherMode: 'clear', volumetricParticleDensity: 0 })
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
        screenTint: null,
        ...V({ weatherMode: 'clear', volumetricParticleDensity: 0 })
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
  const d = volumetricClear();
  const wm =
    src.weatherMode === 'rain' || src.weatherMode === 'snow' || src.weatherMode === 'sandstorm' || src.weatherMode === 'clear'
      ? src.weatherMode
      : d.weatherMode;
  const n01 = (v, fallback) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback;
  };
  return {
    cloudPresence: src.cloudPresence,
    cloudThreshold: src.cloudThreshold,
    cloudMinMul: src.cloudMinMul,
    cloudMaxMul: src.cloudMaxMul,
    cloudAlphaMul: src.cloudAlphaMul,
    rainIntensity: src.rainIntensity,
    screenTint: src.screenTint ? { ...src.screenTint } : null,
    weatherMode: wm,
    volumetricParticleDensity: n01(src.volumetricParticleDensity, d.volumetricParticleDensity),
    volumetricVolumeDepth: n01(src.volumetricVolumeDepth, d.volumetricVolumeDepth),
    volumetricFallSpeed: n01(src.volumetricFallSpeed, d.volumetricFallSpeed),
    volumetricWindCarry: n01(src.volumetricWindCarry, d.volumetricWindCarry),
    volumetricTurbulence: n01(src.volumetricTurbulence, d.volumetricTurbulence),
    volumetricAbsorptionBias: n01(src.volumetricAbsorptionBias, d.volumetricAbsorptionBias),
    volumetricSplashBias: n01(src.volumetricSplashBias, d.volumetricSplashBias)
  };
}
