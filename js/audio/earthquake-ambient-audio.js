/**
 * Earthquake ground-shake bed: loops `audio/sfx/Earthquake.mp3`, gain follows shake intensity.
 * Separate from sky weather ambient (`weather-ambient-audio.js`). Uses the ambience user gain.
 */

import { getSpatialAudioContext, resumeSpatialAudioContext } from './spatial-audio.js';
import { getEffectiveAmbienceMix01 } from './play-audio-mix-settings.js';
import { getEarthquakeActiveIntensity01, getEarthquakeShakePx } from '../main/earthquake-layer.js';

const EARTHQUAKE_MP3_URL = new URL('../../audio/sfx/Earthquake.mp3', import.meta.url).href;

const TUNING = {
  fadeInSec: 0.5,
  fadeOutSec: 0.55,
  frameGlideSec: 0.1,
  bedMasterLinearGain: 0.48,
  minIntensity: 0.025,
  pauseBufferMs: 60
};

/**
 * @typedef {{
 *   ctx: AudioContext,
 *   audio: HTMLAudioElement,
 *   bedGain: GainNode,
 *   userGain: GainNode,
 *   wantOn: boolean,
 *   isPlaying: boolean,
 *   startPromise: Promise<void> | null,
 *   pauseAtMs: number
 * }} EarthquakeBedGraph
 */

/** @type {EarthquakeBedGraph | null} */
let graph = null;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rampTo(gainNode, to, durationSec) {
  const ctx = gainNode.context;
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

function ensureGraph() {
  if (graph) return;
  const ctx = getSpatialAudioContext();

  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  audio.src = EARTHQUAKE_MP3_URL;

  const source = ctx.createMediaElementSource(audio);
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  const userGain = ctx.createGain();
  userGain.gain.value = getEffectiveAmbienceMix01();
  source.connect(bedGain);
  bedGain.connect(userGain);
  userGain.connect(ctx.destination);

  graph = {
    ctx,
    audio,
    bedGain,
    userGain,
    wantOn: false,
    isPlaying: false,
    startPromise: null,
    pauseAtMs: 0
  };
}

function startBedIfNeeded() {
  const g = graph;
  if (!g || g.isPlaying || g.startPromise) return;
  g.startPromise = resumeSpatialAudioContext()
    .then(() => g.audio.play())
    .then(() => {
      g.isPlaying = true;
      g.startPromise = null;
    })
    .catch(() => {
      g.isPlaying = false;
      g.startPromise = null;
    });
}

function pauseBedNow() {
  const g = graph;
  if (!g) return;
  try {
    g.audio.pause();
  } catch {
    /* ignore */
  }
  g.isPlaying = false;
  g.pauseAtMs = 0;
}

/**
 * Apply persisted ambience mix slider (same knob as rain/wind beds).
 */
export function applyEarthquakeAmbientUserMixFromStorage() {
  if (!graph) return;
  try {
    graph.userGain.gain.value = getEffectiveAmbienceMix01();
  } catch {
    /* ignore */
  }
}

/**
 * @param {number} gameTimeSec world / render time seconds (keeps gain aligned with visible shake).
 */
export function syncEarthquakeAmbientAudio(gameTimeSec) {
  ensureGraph();
  applyEarthquakeAmbientUserMixFromStorage();

  const g = graph;
  if (!g) return;

  const timeSec = Number.isFinite(gameTimeSec) ? gameTimeSec : performance.now() * 0.001;
  const active = clamp01(getEarthquakeActiveIntensity01());
  const shake = getEarthquakeShakePx(timeSec, active, 40);
  const mag = Math.hypot(shake.x, shake.y);
  const wantOn = active > TUNING.minIntensity;

  const dynamic = 0.55 + 0.45 * clamp01(mag / 12);
  const targetLinear = active * active * TUNING.bedMasterLinearGain * dynamic;
  const now = performance.now();

  if (wantOn && !g.wantOn) {
    g.wantOn = true;
    g.pauseAtMs = 0;
    rampTo(g.bedGain, 0, 0);
    startBedIfNeeded();
    rampTo(g.bedGain, targetLinear, TUNING.fadeInSec);
  } else if (!wantOn && g.wantOn) {
    g.wantOn = false;
    rampTo(g.bedGain, 0, TUNING.fadeOutSec);
    g.pauseAtMs = now + TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs;
  } else if (wantOn) {
    rampTo(g.bedGain, targetLinear, TUNING.frameGlideSec);
    if (!g.isPlaying && !g.startPromise) startBedIfNeeded();
  }

  if (!wantOn && active < 0.005) {
    return;
  }

  if (!g.wantOn && g.isPlaying && g.pauseAtMs && now >= g.pauseAtMs) {
    pauseBedNow();
  }
}

export function stopEarthquakeAmbientAudio() {
  if (!graph) return;
  graph.wantOn = false;
  rampTo(graph.bedGain, 0, TUNING.fadeOutSec);
  const pauseAt = performance.now() + TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs;
  graph.pauseAtMs = pauseAt;
  setTimeout(() => {
    if (graph && graph.isPlaying && !graph.wantOn) pauseBedNow();
  }, TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs);
}
