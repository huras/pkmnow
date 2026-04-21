/**
 * Encounter ME (Music Effect) layer.
 *
 * RPG Maker naming:
 * - BGM: background music (map themes)
 * - BGS: background sounds (rain/wind loops)
 * - SE : short sound effects
 * - ME : short musical stinger / event music (here: random encounter tension loop)
 */

import { getSpatialAudioContext, resumeSpatialAudioContext } from './spatial-audio.js';
import { getEffectiveMeMix01 } from './play-audio-mix-settings.js';

const ENCOUNTER_ME_URL = new URL('../../audio/me/017 - Oh No!.mp3', import.meta.url).href;

const TUNING = {
  fadeInSec: 0.2,
  fadeOutSec: 0.65,
  masterLinearGain: 0.7,
  pauseBufferMs: 70
};

/** @type {{ audio: HTMLAudioElement, gain: GainNode, userGain: GainNode } | null} */
let meLayer = null;
let isPlaying = false;
let startPromise = null;
let wantPlaying = false;
let pauseAtMs = 0;

function ensureMeLayer() {
  if (meLayer) return meLayer;
  const ctx = getSpatialAudioContext();
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = true;
  audio.src = ENCOUNTER_ME_URL;
  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const userGain = ctx.createGain();
  userGain.gain.value = getEffectiveMeMix01();
  source.connect(gain);
  gain.connect(userGain);
  userGain.connect(ctx.destination);
  meLayer = { audio, gain, userGain };
  return meLayer;
}

function rampTo(gainNode, to, durationSec) {
  const ctx = getSpatialAudioContext();
  const t = ctx.currentTime;
  try {
    gainNode.gain.cancelScheduledValues(t);
    const current = gainNode.gain.value;
    gainNode.gain.setValueAtTime(current, t);
    if (durationSec <= 0.001) gainNode.gain.setValueAtTime(to, t);
    else gainNode.gain.linearRampToValueAtTime(to, t + durationSec);
  } catch {
    gainNode.gain.value = to;
  }
}

function pauseNow() {
  if (!meLayer) return;
  try {
    meLayer.audio.pause();
  } catch {
    /* ignore */
  }
  isPlaying = false;
  pauseAtMs = 0;
}

/**
 * Keep ME gain in sync with BGM slider + global mute.
 */
export function applyEncounterMeUserMixFromStorage() {
  if (!meLayer?.userGain) return;
  try {
    meLayer.userGain.gain.value = getEffectiveMeMix01();
  } catch {
    /* ignore */
  }
}

/**
 * Start the encounter ME loop (idempotent). Uses a fast fade-in.
 */
export function playEncounterMeLoop() {
  const layer = ensureMeLayer();
  applyEncounterMeUserMixFromStorage();
  wantPlaying = true;
  pauseAtMs = 0;
  try {
    layer.audio.currentTime = 0;
  } catch {
    /* ignore seek failures */
  }
  rampTo(layer.gain, TUNING.masterLinearGain, TUNING.fadeInSec);
  if (isPlaying) return;
  if (startPromise) return;
  startPromise = resumeSpatialAudioContext()
    .then(() => layer.audio.play())
    .then(() => {
      isPlaying = true;
      startPromise = null;
    })
    .catch(() => {
      isPlaying = false;
      startPromise = null;
    });
}

/**
 * Fade out and stop the encounter ME loop.
 */
export function stopEncounterMeLoop() {
  if (!meLayer) return;
  wantPlaying = false;
  rampTo(meLayer.gain, 0, TUNING.fadeOutSec);
  pauseAtMs = performance.now() + TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs;
  setTimeout(() => {
    if (!wantPlaying && isPlaying && pauseAtMs && performance.now() >= pauseAtMs) {
      pauseNow();
    }
  }, TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs);
}

