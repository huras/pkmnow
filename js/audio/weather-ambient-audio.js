/**
 * Looping ambient weather audio:
 *  - `Rain.ogg` plays under any rain (low threshold so trace rain already adds patter).
 *  - `Storm.ogg` layers on top once rain intensity crosses the storm threshold.
 *  - `Wind.ogg` plays whenever the gust-modulated "felt" wind intensity is audible, so its
 *    volume naturally fades in and out with the weather-state gust envelope instead of
 *    being a constant hum (fatigue-safe).
 *
 * All three files are seamless oggs, so we rely on `HTMLAudioElement.loop = true` for the
 * loop and only handle gain fades here.
 *
 * Gain pipeline per layer:  MediaElementSource → layerGain (fade) → userGain (BGM mix) → destination
 *
 * `syncWeatherAmbientAudio()` is called from the play game loop (every frame) and reads
 * the smoothed rain / wind state from `main/weather-state.js`. It schedules short gain
 * ramps each frame so intensity changes glide, and on the threshold crossings it starts
 * / pauses the underlying `<audio>` element with a longer fade.
 */

import { getSpatialAudioContext, resumeSpatialAudioContext } from './spatial-audio.js';
import { getEffectiveBgmMix01 } from './play-audio-mix-settings.js';
import {
  getWeatherRainIntensity,
  getWeatherWindBaseIntensity,
  getWeatherWindGust
} from '../main/weather-state.js';

const TUNING = {
  /** Fade window when a layer starts playing (0 → target). */
  fadeInSec: 1.1,
  /** Fade window when a layer stops playing (target → 0). */
  fadeOutSec: 1.4,
  /** Short per-frame smoothing window for small target changes (no start/stop crossing). */
  frameGlideSec: 0.18,
  /** Master trim on the rain bed (linear gain at full scale). */
  rainMasterLinearGain: 0.6,
  /** Master trim on the storm bed (linear gain at full scale). */
  stormMasterLinearGain: 0.55,
  /** Master trim on the wind bed (linear gain at full scale; kept quieter so it doesn't fatigue). */
  windMasterLinearGain: 0.42,
  /** Rain intensity below this: rain layer is silent and paused. */
  rainMinIntensity: 0.04,
  /** Rain intensity at/above this: storm layer blends in. */
  stormThreshold: 0.75,
  /** Wind "felt" intensity (base × gust) below this: wind layer is silent and paused. */
  windMinIntensity: 0.06,
  /** Extra buffer before actually pausing, so the tail of the fade is audible. */
  pauseBufferMs: 60
};

const URLS = {
  rain: 'audio/bgs/Rain.ogg',
  storm: 'audio/bgs/Storm.ogg',
  wind: 'audio/bgs/Wind.ogg'
};

/**
 * @typedef {{
 *   audio: HTMLAudioElement,
 *   gain: GainNode,
 *   userGain: GainNode,
 *   url: string,
 *   wantPlaying: boolean,
 *   isPlaying: boolean,
 *   startPromise: Promise<void> | null,
 *   pauseAtMs: number
 * }} AmbientLayer
 */

/** @type {AmbientLayer | null} */
let rainLayer = null;
/** @type {AmbientLayer | null} */
let stormLayer = null;
/** @type {AmbientLayer | null} */
let windLayer = null;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * @param {string} url
 * @returns {AmbientLayer}
 */
function createLayer(url) {
  const ctx = getSpatialAudioContext();
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  audio.src = url;
  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const userGain = ctx.createGain();
  userGain.gain.value = getEffectiveBgmMix01();
  source.connect(gain);
  gain.connect(userGain);
  userGain.connect(ctx.destination);
  return {
    audio,
    gain,
    userGain,
    url,
    wantPlaying: false,
    isPlaying: false,
    startPromise: null,
    pauseAtMs: 0
  };
}

function ensureLayers() {
  if (!rainLayer) rainLayer = createLayer(URLS.rain);
  if (!stormLayer) stormLayer = createLayer(URLS.storm);
  if (!windLayer) windLayer = createLayer(URLS.wind);
}

/**
 * Apply persisted BGM mix slider to the ambient layers (post-fade trim). Safe anytime.
 */
export function applyWeatherAmbientUserMixFromStorage() {
  const v = getEffectiveBgmMix01();
  for (const layer of [rainLayer, stormLayer, windLayer]) {
    if (!layer) continue;
    try {
      layer.userGain.gain.value = v;
    } catch {
      /* ignore */
    }
  }
}

/**
 * Schedules a short linear ramp on `gainNode` to `to`, gliding from whatever the current
 * value is. Safe to call every frame — it cancels pending ramps first.
 * @param {GainNode} gainNode
 * @param {number} to
 * @param {number} durationSec
 */
function rampTo(gainNode, to, durationSec) {
  const ctx = getSpatialAudioContext();
  const t = ctx.currentTime;
  const current = gainNode.gain.value;
  try {
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(current, t);
    if (durationSec <= 0.001) gainNode.gain.setValueAtTime(to, t);
    else gainNode.gain.linearRampToValueAtTime(to, t + durationSec);
  } catch {
    gainNode.gain.value = to;
  }
}

/**
 * @param {AmbientLayer} layer
 */
function startLayerIfNeeded(layer) {
  if (layer.isPlaying || layer.startPromise) return;
  layer.startPromise = resumeSpatialAudioContext()
    .then(() => layer.audio.play())
    .then(() => {
      layer.isPlaying = true;
      layer.startPromise = null;
    })
    .catch(() => {
      // Playback blocked (e.g. no user gesture yet) — will retry on next sync that wants it.
      layer.isPlaying = false;
      layer.startPromise = null;
    });
}

/**
 * @param {AmbientLayer} layer
 */
function pauseLayerNow(layer) {
  try {
    layer.audio.pause();
  } catch {
    /* ignore */
  }
  layer.isPlaying = false;
  layer.pauseAtMs = 0;
}

/**
 * Drive a single layer toward the given normalized target [0..1]. When target is 0 the
 * layer fades out and pauses; when non-zero the layer fades in from silence and then
 * tracks the target with a short per-frame glide.
 * @param {AmbientLayer} layer
 * @param {number} target01
 * @param {number} masterLinearGain
 */
function updateLayer(layer, target01, masterLinearGain) {
  const desiredGain = clamp01(target01) * masterLinearGain;
  const wantOn = desiredGain > 0.0001;
  const now = performance.now();

  if (wantOn && !layer.wantPlaying) {
    // Rising edge: start playback and fade in.
    layer.wantPlaying = true;
    layer.pauseAtMs = 0;
    startLayerIfNeeded(layer);
    rampTo(layer.gain, desiredGain, TUNING.fadeInSec);
  } else if (!wantOn && layer.wantPlaying) {
    // Falling edge: schedule a fade-out and a deferred pause.
    layer.wantPlaying = false;
    rampTo(layer.gain, 0, TUNING.fadeOutSec);
    layer.pauseAtMs = now + TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs;
  } else if (wantOn) {
    // Steady-state: smoothly glide to the current target (handles intensity drift).
    rampTo(layer.gain, desiredGain, TUNING.frameGlideSec);
    // If we asked to start but it silently failed (autoplay block), retry once audible.
    if (!layer.isPlaying && !layer.startPromise) startLayerIfNeeded(layer);
  }

  // Deferred pause after fade-out completes.
  if (!layer.wantPlaying && layer.isPlaying && layer.pauseAtMs && now >= layer.pauseAtMs) {
    pauseLayerNow(layer);
  }
}

/**
 * Per-frame sync: maps rain intensity to rain/storm layer targets and drives playback.
 * Call from the play-mode game loop.
 */
export function syncWeatherAmbientAudio() {
  ensureLayers();
  applyWeatherAmbientUserMixFromStorage();

  const intensity = clamp01(getWeatherRainIntensity());

  // Rain bed: ramp from `rainMinIntensity` → 1 across intensity [rainMin..1].
  const rainSpan = Math.max(0.001, 1 - TUNING.rainMinIntensity);
  const rainUnit =
    intensity <= TUNING.rainMinIntensity ? 0 : clamp01((intensity - TUNING.rainMinIntensity) / rainSpan);

  // Storm bed: ramp from `stormThreshold` → 1 across intensity [stormThreshold..1].
  const stormSpan = Math.max(0.001, 1 - TUNING.stormThreshold);
  const stormUnit =
    intensity < TUNING.stormThreshold ? 0 : clamp01((intensity - TUNING.stormThreshold) / stormSpan);

  updateLayer(/** @type {AmbientLayer} */ (rainLayer), rainUnit, TUNING.rainMasterLinearGain);
  updateLayer(/** @type {AmbientLayer} */ (stormLayer), stormUnit, TUNING.stormMasterLinearGain);

  // Wind layer: gain follows the already gust-modulated "felt" intensity coming from
  // main.js (base × slow-sine gust). Because `main.js` pulses the gust envelope ~0.15..1,
  // the layer naturally fades in and out with different volumes without any extra LFO here.
  const windBase = clamp01(getWeatherWindBaseIntensity());
  const windGust = clamp01(getWeatherWindGust());
  const windFelt = windBase * windGust;
  const windSpan = Math.max(0.001, 1 - TUNING.windMinIntensity);
  const windUnit =
    windFelt <= TUNING.windMinIntensity ? 0 : clamp01((windFelt - TUNING.windMinIntensity) / windSpan);
  updateLayer(/** @type {AmbientLayer} */ (windLayer), windUnit, TUNING.windMasterLinearGain);
}

/**
 * Fade both layers to silence and pause them after the fade. Call when leaving play mode.
 */
export function stopWeatherAmbientAudio() {
  for (const layer of [rainLayer, stormLayer, windLayer]) {
    if (!layer) continue;
    layer.wantPlaying = false;
    rampTo(layer.gain, 0, TUNING.fadeOutSec);
    const pauseAt = performance.now() + TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs;
    layer.pauseAtMs = pauseAt;
    setTimeout(() => {
      if (layer.isPlaying && !layer.wantPlaying) pauseLayerNow(layer);
    }, TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs);
  }
}
