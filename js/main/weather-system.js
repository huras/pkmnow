/**
 * Weather engine — the only place that owns the mutable "target preset / intensity" and
 * the smoothed "active render params". Decoupled from `main.js` so the DOM panel, moves
 * (Rain Dance / Sunny Day), and any future complex behavior (storm escalation, clouds
 * reacting to combat, fog after dawn, etc.) can hook in by registering a listener or
 * calling {@link setWeatherTarget} — without touching a 1200-line file.
 *
 * Lifecycle per tick (driven from `main.js`'s world-time hook):
 *  1. {@link tickWeather} drains any request posted by {@link module:main/weather-control}
 *     (moves mailbox) and applies it as a new target.
 *  2. Resolves the target → full render params via `weather-presets`.
 *  3. Exponentially eases the `active` snapshot toward the target.
 *  4. Publishes rain state + wind state to the shared read-only modules so audio / fire /
 *     render systems can consume them.
 *
 * Listener API:
 *   {@link addWeatherTargetChangeListener} fires whenever the *target* changes (UI button,
 *   slider drag, or move mailbox). UI sync plugs into this so the debug panel always
 *   reflects the true target, even when moves change it programmatically.
 */

import { consumeWeatherChangeRequest } from './weather-control.js';
import { setWeatherRenderState } from './weather-state.js';
import { computeLiveWindState, setWindState } from './wind-state.js';
import {
  WEATHER_PRESETS,
  cloneWeatherParams,
  isWeatherPreset,
  resolveWeatherParams
} from './weather-presets.js';

/** @typedef {import('./weather-presets.js').WeatherPresetId} WeatherPresetId */
/** @typedef {import('./weather-presets.js').WeatherRenderParams} WeatherRenderParams */

/**
 * Time constant (seconds) for exponential smoothing of weather transitions. Chosen so
 * preset flips finish the eye-catching part of the blend in ~2-3 s — short enough that
 * Rain Dance / Sunny Day feel *cast*, long enough that nothing pops.
 */
export const WEATHER_SMOOTH_TAU_SEC = 1.2;

/** Alpha below which the tint is treated as transparent (avoids leaving a sliver tint on fade-out). */
const TINT_ALPHA_EPSILON = 0.002;

/** @type {WeatherPresetId} */
let targetPreset = 'cloudy';
/** 0..1 intensity scalar (UI slider target). */
let targetIntensity01 = 0.75;
/** @type {WeatherRenderParams | null} — smoothed display state; lazily allocated. */
let activeParams = null;
/** Smoothed categorical blend (one-hot target eased over time) used by systems with discrete behavior. */
const activePresetBlend = {
  clear: 0,
  cloudy: 0,
  rain: 0,
  blizzard: 0
};

/** @type {Set<(ev: { preset: WeatherPresetId, intensity01: number, source: WeatherTargetChangeSource }) => void>} */
const targetChangeListeners = new Set();

/** @typedef {'init' | 'ui' | 'mailbox' | 'external'} WeatherTargetChangeSource */

/**
 * Seed the engine before the first tick. Safe to call multiple times; each call fires
 * one `'init'` listener event so UI panels can paint their initial state from whatever
 * was loaded (save file, URL param, default).
 *
 * @param {{ preset?: WeatherPresetId, intensity01?: number }} [opts]
 */
export function initWeatherSystem(opts = {}) {
  if (opts.preset && isWeatherPreset(opts.preset)) targetPreset = opts.preset;
  if (opts.intensity01 != null) {
    const n = Number(opts.intensity01);
    if (Number.isFinite(n)) targetIntensity01 = Math.max(0, Math.min(1, n));
  }
  activeParams = cloneWeatherParams(resolveWeatherParams(targetPreset, targetIntensity01));
  for (const id of WEATHER_PRESETS) {
    activePresetBlend[id] = id === targetPreset ? 1 : 0;
  }
  emitTargetChanged('init');
}

/**
 * Update the target preset and/or intensity. Missing fields keep their current value.
 * Always fires a target-change event (listener responsibility to dedupe if they care).
 *
 * @param {{ preset?: WeatherPresetId, intensity01?: number }} next
 * @param {WeatherTargetChangeSource} [source='external'] Distinguishes programmatic calls
 *   from UI drags, so listeners (e.g. debug panel) can skip no-op DOM writes when they
 *   were the originator.
 */
export function setWeatherTarget(next, source = 'external') {
  let changed = false;
  if (next?.preset && isWeatherPreset(next.preset) && next.preset !== targetPreset) {
    targetPreset = next.preset;
    changed = true;
  }
  if (next?.intensity01 != null) {
    const n = Number(next.intensity01);
    if (Number.isFinite(n)) {
      const clamped = Math.max(0, Math.min(1, n));
      if (clamped !== targetIntensity01) {
        targetIntensity01 = clamped;
        changed = true;
      }
    }
  }
  if (changed) emitTargetChanged(source);
}

/** @returns {{ preset: WeatherPresetId, intensity01: number }} */
export function getWeatherTarget() {
  return { preset: targetPreset, intensity01: targetIntensity01 };
}

/**
 * Returns the current (smoothed) render params. Never null after the first tick, but
 * lazy-inits on first read so it's safe to call before the first tick.
 * @returns {WeatherRenderParams}
 */
export function getActiveWeatherParams() {
  if (!activeParams) {
    activeParams = cloneWeatherParams(resolveWeatherParams(targetPreset, targetIntensity01));
  }
  return activeParams;
}

/**
 * Subscribe to target changes. Returns an unsubscribe function.
 * @param {(ev: { preset: WeatherPresetId, intensity01: number, source: WeatherTargetChangeSource }) => void} listener
 */
export function addWeatherTargetChangeListener(listener) {
  targetChangeListeners.add(listener);
  return () => targetChangeListeners.delete(listener);
}

/**
 * Advance the weather engine one step.
 *
 * @param {number} dt       seconds since last tick
 * @param {number} gameTime world time seconds (used to evolve wind's gust/direction envelope)
 */
export function tickWeather(dt, gameTime) {
  if (!Number.isFinite(dt) || dt <= 0) return;

  // 1. Drain mailbox requests from moves. Applied as a target change so listeners (UI)
  //    re-sync, then the smoother eases toward the new preset naturally.
  const req = consumeWeatherChangeRequest();
  if (req) {
    setWeatherTarget({ preset: req.preset ?? undefined, intensity01: req.intensity01 ?? undefined }, 'mailbox');
  }

  // 2. Resolve the full target params once; ease active toward them.
  const target = resolveWeatherParams(targetPreset, targetIntensity01);
  const active = getActiveWeatherParams();
  const k = 1 - Math.exp(-dt / Math.max(0.05, WEATHER_SMOOTH_TAU_SEC));
  const lerpN = (a, b) => a + (b - a) * k;

  active.cloudPresence = lerpN(active.cloudPresence, target.cloudPresence);
  active.cloudThreshold = lerpN(active.cloudThreshold, target.cloudThreshold);
  active.cloudMinMul = lerpN(active.cloudMinMul, target.cloudMinMul);
  active.cloudMaxMul = lerpN(active.cloudMaxMul, target.cloudMaxMul);
  active.cloudAlphaMul = lerpN(active.cloudAlphaMul, target.cloudAlphaMul);
  active.rainIntensity = lerpN(active.rainIntensity, target.rainIntensity);

  // Tint blends via alpha so `null` targets smoothly fade out instead of popping. When
  // the current tint has no source but the target does (or vice versa) we fabricate a
  // zero-alpha stand-in so the RGB channels don't jump on the first frame of the fade.
  const curT = active.screenTint;
  const tgtT = target.screenTint;
  if (!curT && !tgtT) {
    active.screenTint = null;
  } else {
    const cur = curT || { r: tgtT.r, g: tgtT.g, b: tgtT.b, a: 0 };
    const tgt = tgtT || { r: cur.r, g: cur.g, b: cur.b, a: 0 };
    const blended = {
      r: lerpN(cur.r, tgt.r),
      g: lerpN(cur.g, tgt.g),
      b: lerpN(cur.b, tgt.b),
      a: lerpN(cur.a, tgt.a)
    };
    active.screenTint = blended.a > TINT_ALPHA_EPSILON ? blended : null;
  }

  // 2b. Smooth categorical preset blend (needed for systems that branch by preset id).
  let presetSum = 0;
  for (const id of WEATHER_PRESETS) {
    const targetW = id === targetPreset ? 1 : 0;
    const nextW = lerpN(activePresetBlend[id] || 0, targetW);
    activePresetBlend[id] = Math.max(0, Math.min(1, nextW));
    presetSum += activePresetBlend[id];
  }
  if (presetSum > 1e-6) {
    for (const id of WEATHER_PRESETS) activePresetBlend[id] /= presetSum;
  }

  // 3. Publish to shared read-only state modules (rain → weather-state; wind → wind-state).
  //    Everything else (audio, fire snuff, render) reads from there, not from this engine.
  setWeatherRenderState({ rainIntensity: active.rainIntensity, preset: getActiveWeatherPreset() });
  setWindState(computeLiveWindState(gameTime, targetPreset, active.rainIntensity, activePresetBlend));
}

/**
 * Dominant smoothed preset id (argmax over {@link activePresetBlend}).
 * Useful for systems that still need a single enum while transitioning.
 * @returns {WeatherPresetId}
 */
export function getActiveWeatherPreset() {
  let bestId = /** @type {WeatherPresetId} */ ('clear');
  let bestW = -1;
  for (const id of WEATHER_PRESETS) {
    const w = Number(activePresetBlend[id]) || 0;
    if (w > bestW) {
      bestW = w;
      bestId = /** @type {WeatherPresetId} */ (id);
    }
  }
  return bestId;
}

/**
 * Smoothed 0..1 weight for a specific preset id.
 * Lets render/audio crossfade preset-specific behavior instead of hard-switching.
 * @param {WeatherPresetId} preset
 */
export function getActiveWeatherPresetBlend(preset) {
  return Math.max(0, Math.min(1, Number(activePresetBlend[preset]) || 0));
}

/** @param {WeatherTargetChangeSource} source */
function emitTargetChanged(source) {
  if (targetChangeListeners.size === 0) return;
  const ev = { preset: targetPreset, intensity01: targetIntensity01, source };
  for (const listener of targetChangeListeners) {
    try {
      listener(ev);
    } catch (err) {
      // Keep one buggy listener from breaking the rest; weather ticks every frame.
      console.error('[weather-system] listener error', err);
    }
  }
}
