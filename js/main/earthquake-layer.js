/**
 * Independent "ground layer" shake intensity (0..1), smoothed like sky weather so it can
 * stack with rain/blizzard. Does not touch `weather-system.js` or preset ids.
 *
 * Move-driven pulses (`enqueueEarthquakeMovePulse`) add on top of the debug-slider baseline
 * and decay quickly for screen rumble + audio.
 */

import { WEATHER_SMOOTH_TAU_SEC } from './weather-system.js';

/** Base decay when no sustain envelope is active (aftershock spikes still apply). */
const MOVE_PULSE_DECAY_TAU_SEC = 0.55;
/** Time between scheduled aftershock peaks (seconds). */
const AFTERSHOCK_DELAY_SEC = 0.48;

let targetIntensity01 = 0;
/** Smoothed UI / weather-panel target (slider). */
let ambientActive01 = 0;
/** Fast-decay layer from Earthquake move + aftershocks (0..1). */
let movePulse01 = 0;

/** @type {{ at: number, peak: number }[]} */
let scheduledMovePulses = [];

/** Sustained rumble from a charged Earthquake (linear tail + floor so it stays readable for several seconds). */
let sustainStartSec = 0;
let sustainEndSec = -1;
let sustainPeak01 = 0;

/** @param {{ intensity01?: number }} [opts] */
export function initEarthquakeLayer(opts = {}) {
  scheduledMovePulses.length = 0;
  movePulse01 = 0;
  sustainEndSec = -1;
  sustainPeak01 = 0;
  if (opts.intensity01 != null) {
    const n = Number(opts.intensity01);
    if (Number.isFinite(n)) {
      const c = Math.max(0, Math.min(1, n));
      targetIntensity01 = c;
      ambientActive01 = c;
    }
  } else {
    targetIntensity01 = 0;
    ambientActive01 = 0;
  }
}

/** @param {number} intensity01 */
export function setEarthquakeTargetIntensity01(intensity01) {
  const n = Number(intensity01);
  if (!Number.isFinite(n)) return;
  targetIntensity01 = Math.max(0, Math.min(1, n));
}

export function getEarthquakeTargetIntensity01() {
  return targetIntensity01;
}

export function getEarthquakeActiveIntensity01() {
  return Math.max(0, Math.min(1, ambientActive01 + movePulse01));
}

/**
 * @param {number} dt seconds
 * @param {number} [nowSec] game time seconds (for aftershock scheduling); falls back to performance clock.
 */
export function tickEarthquakeLayer(dt, nowSec) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const t =
    nowSec != null && Number.isFinite(nowSec)
      ? nowSec
      : typeof performance !== 'undefined'
        ? performance.now() * 0.001
        : 0;

  const tgt = targetIntensity01;
  const k = 1 - Math.exp(-dt / Math.max(0.05, WEATHER_SMOOTH_TAU_SEC));
  ambientActive01 += (tgt - ambientActive01) * k;

  const sustainActive = sustainEndSec >= 0 && t < sustainEndSec && t >= sustainStartSec;
  const dk = Math.exp(-dt / Math.max(0.04, sustainActive ? 2.2 : MOVE_PULSE_DECAY_TAU_SEC));
  movePulse01 *= dk;

  for (let i = scheduledMovePulses.length - 1; i >= 0; i--) {
    const ev = scheduledMovePulses[i];
    if (ev.at <= t) {
      movePulse01 = Math.min(1, Math.max(movePulse01, ev.peak));
      scheduledMovePulses.splice(i, 1);
    }
  }

  if (sustainEndSec >= 0) {
    if (t >= sustainEndSec) {
      sustainEndSec = -1;
      sustainPeak01 = 0;
    } else if (t >= sustainStartSec) {
      const span = Math.max(1e-3, sustainEndSec - sustainStartSec);
      const env = (sustainEndSec - t) / span;
      const shaped = sustainPeak01 * (0.22 + 0.78 * env);
      movePulse01 = Math.min(1, Math.max(movePulse01, shaped));
    }
  }
}

/**
 * @param {number} primaryPeak01 main impact pulse 0..1
 * @param {number[]} aftershockPeaks01 already scaled peaks (any length)
 * @param {number} startSec world time when the main hit landed
 * @param {{ sustainSec?: number }} [opts] `sustainSec` keeps rumble elevated for long charged hits (e.g. 7s at max bar).
 */
export function enqueueEarthquakeMovePulse(primaryPeak01, aftershockPeaks01, startSec, opts = {}) {
  const base = Math.max(0, Math.min(1, Number(primaryPeak01) || 0));
  movePulse01 = Math.min(1, Math.max(movePulse01, base));
  const t0 = Number(startSec) || 0;
  const sustainSec = Math.max(0, Number(opts.sustainSec) || 0);
  if (sustainSec > 0.05) {
    const end = t0 + sustainSec;
    if (sustainEndSec < 0 || t0 >= sustainEndSec - 1e-3) {
      sustainStartSec = t0;
      sustainEndSec = end;
      sustainPeak01 = base;
    } else {
      sustainEndSec = Math.max(sustainEndSec, end);
      sustainPeak01 = Math.max(sustainPeak01, base);
    }
  }
  let t = t0 + AFTERSHOCK_DELAY_SEC;
  const arr = Array.isArray(aftershockPeaks01) ? aftershockPeaks01 : [];
  for (let i = 0; i < arr.length; i++) {
    const pk = Math.max(0, Math.min(1, Number(arr[i]) || 0));
    if (pk < 0.02) continue;
    scheduledMovePulses.push({ at: t, peak: pk });
    t += AFTERSHOCK_DELAY_SEC;
  }
  scheduledMovePulses.sort((a, b) => a.at - b.at);
}

/**
 * Cheap deterministic hash → [0, 1).
 * @param {number} x
 */
function hash01(x) {
  const u = Math.floor(x) >>> 0;
  let h = u ^ (u >>> 16);
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

/**
 * Integer-pixel camera shake for pixel-art play mode. Deterministic from world time + intensity.
 *
 * @param {number} timeSec
 * @param {number} active01 smoothed 0..1
 * @param {number} tileW effective tile width in pixels
 * @returns {{ x: number, y: number }}
 */
export function getEarthquakeShakePx(timeSec, active01, tileW) {
  const t = Math.max(0, Math.min(1, Number(active01) || 0));
  if (t < 0.002) return { x: 0, y: 0 };

  const tw = Math.max(1, Number(tileW) || 32);
  const time = Number.isFinite(timeSec) ? timeSec : 0;

  const hz = 14 + t * 10;
  const step = Math.floor(time * hz);
  const h0 = hash01(step * 0x9e3779b1);
  const h1 = hash01(step * 0x85ebca6b + 1);
  const h2 = hash01(step * 0xc2b2ae35 + 2);

  const amp = tw * (0.08 * t + 0.5 * t * t);
  const slow = 0.35 * Math.sin(time * (2.1 + 1.7 * t));
  const xF = (h0 * 2 - 1) * amp * (0.92 + slow);
  const yF = (h1 * 2 - 1) * amp * 0.55 * (0.88 - slow * 0.4);
  const micro = (h2 - 0.5) * tw * 0.04 * t;

  return {
    x: Math.round(xF + micro),
    y: Math.round(yF - micro * 0.5)
  };
}
