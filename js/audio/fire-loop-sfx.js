/**
 * Looping `Fire.ogg` voices bound to burning sources (grass tiles + trees). We keep a small
 * pool of Web-Audio voices and each frame we hand them out to the closest currently-burning
 * sources. Assigning a fresh voice fades it IN over {@link TUNING.fadeInSec} so the loop
 * doesn't punch in at full volume (fire takes a beat to really catch); releasing fades OUT
 * over {@link TUNING.fadeOutSec} and pauses after the tail.
 *
 * Gain pipeline per voice:
 *   `<audio>` → MediaElementSource → filter → fadeGain → panner → spatialMasterGain → destination
 *
 * The spatial master gain is the existing SFX/cries submix, so the minimap "SFX" slider and
 * global mute already apply automatically.
 */

import {
  getSpatialAudioContext,
  resumeSpatialAudioContext,
  wireLoopingSpatialMediaElement,
  setSpatialSourceWorldPosition
} from './spatial-audio.js';
import { listActiveGrassFireSources } from '../play-grass-fire.js';
import { listActiveBurningTreeSources } from '../main/play-crystal-tackle.js';

const FIRE_OGG_URL = 'audio/bgs/Fire.ogg';

const TUNING = {
  /** Max simultaneous fire voices. Extra burning sources are silent (closest-first wins). */
  maxVoices: 5,
  /** Fire "takes hold" on assign: loop ramps 0 → master over this many seconds. */
  fadeInSec: 1.4,
  /** Loop fades to silence over this many seconds when a source is extinguished / released. */
  fadeOutSec: 0.55,
  /** Short per-frame glide for position / proximity-driven gain tweaks. */
  frameGlideSec: 0.12,
  /** Peak linear gain per voice before the spatial submix. Quieter than oneshots on purpose. */
  masterLinearGain: 0.6,
  /** Sources past this world-tile distance get no voice even if a voice is free. */
  rangeTiles: 22,
  /** Extra ms after fade-out before we actually pause the `<audio>` element (tail buffer). */
  pauseBufferMs: 80
};

/**
 * @typedef {{
 *   audio: HTMLAudioElement,
 *   fadeGain: GainNode,
 *   panner: import('./spatial-audio.js').SpatialMediaGraph['panner'],
 *   filter: import('./spatial-audio.js').SpatialMediaGraph['filter'],
 *   currentId: string | null,
 *   assignedAtMs: number,
 *   isPlaying: boolean,
 *   startPromise: Promise<void> | null,
 *   pauseAtMs: number
 * }} FireVoice
 */

/** @type {FireVoice[] | null} */
let voices = null;

function createVoice() {
  const audio = new Audio();
  audio.src = FIRE_OGG_URL;
  audio.loop = true;
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  const graph = wireLoopingSpatialMediaElement(audio);
  return /** @type {FireVoice} */ ({
    audio,
    fadeGain: graph.fadeGain,
    panner: graph.panner,
    filter: graph.filter,
    currentId: null,
    assignedAtMs: 0,
    isPlaying: false,
    startPromise: null,
    pauseAtMs: 0
  });
}

function ensureVoices() {
  if (!voices) {
    voices = [];
    for (let i = 0; i < TUNING.maxVoices; i++) voices.push(createVoice());
  }
  return voices;
}

/**
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

/** @param {FireVoice} voice */
function startVoiceIfNeeded(voice) {
  if (voice.isPlaying || voice.startPromise) return;
  voice.startPromise = resumeSpatialAudioContext()
    .then(() => voice.audio.play())
    .then(() => {
      voice.isPlaying = true;
      voice.startPromise = null;
    })
    .catch(() => {
      voice.isPlaying = false;
      voice.startPromise = null;
    });
}

/** @param {FireVoice} voice */
function pauseVoiceNow(voice) {
  try {
    voice.audio.pause();
  } catch {
    /* ignore */
  }
  voice.isPlaying = false;
  voice.pauseAtMs = 0;
}

/**
 * @param {FireVoice} voice
 * @param {{ id: string, x: number, y: number, z?: number }} src
 */
function assignVoiceToSource(voice, src) {
  voice.currentId = src.id;
  voice.assignedAtMs = performance.now();
  voice.pauseAtMs = 0;
  // Desync the loop phase so multiple voices never phase-lock into a single beat pattern.
  try {
    const dur = voice.audio.duration;
    if (Number.isFinite(dur) && dur > 0.2) voice.audio.currentTime = Math.random() * dur;
    else voice.audio.currentTime = 0;
  } catch {
    /* ignore */
  }
  setSpatialSourceWorldPosition(
    /** @type {any} */ ({ panner: voice.panner, filter: voice.filter }),
    src.x,
    src.y,
    Number(src.z) || 0
  );
  startVoiceIfNeeded(voice);
  rampTo(voice.fadeGain, TUNING.masterLinearGain, TUNING.fadeInSec);
}

/** @param {FireVoice} voice */
function releaseVoice(voice) {
  voice.currentId = null;
  rampTo(voice.fadeGain, 0, TUNING.fadeOutSec);
  voice.pauseAtMs = performance.now() + TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs;
}

/**
 * Public per-frame sync. Call from the play-mode game loop.
 * @param {object | null} data
 * @param {{ visualX?: number, x?: number, visualY?: number, y?: number } | null | undefined} player
 */
export function syncFireLoopAudio(data, player) {
  const pool = ensureVoices();
  const lx = Number(player?.visualX ?? player?.x);
  const ly = Number(player?.visualY ?? player?.y);
  const haveListener = Number.isFinite(lx) && Number.isFinite(ly);

  // Gather active sources (grass + trees).
  /** @type {Array<{ id: string, x: number, y: number, startedAtMs: number, dist2: number }>} */
  const sources = [];
  const rangeSq = TUNING.rangeTiles * TUNING.rangeTiles;
  const pushWithDist = (s) => {
    const dx = (s.x - (haveListener ? lx : s.x)) || 0;
    const dy = (s.y - (haveListener ? ly : s.y)) || 0;
    const d2 = dx * dx + dy * dy;
    if (d2 > rangeSq) return;
    sources.push({ id: s.id, x: s.x, y: s.y, startedAtMs: s.startedAtMs, dist2: d2 });
  };
  for (const s of listActiveGrassFireSources()) pushWithDist(s);
  if (data) {
    for (const s of listActiveBurningTreeSources(data)) pushWithDist(s);
  }
  sources.sort((a, b) => a.dist2 - b.dist2);
  const picked = sources.slice(0, TUNING.maxVoices);

  // Drop voices whose source is no longer in the picked set (or is no longer burning).
  const pickedIds = new Set(picked.map((s) => s.id));
  for (const voice of pool) {
    if (voice.currentId && !pickedIds.has(voice.currentId)) releaseVoice(voice);
  }

  // Build a map of still-owned ids so we don't steal a voice from its own source.
  const ownedIds = new Set();
  for (const voice of pool) if (voice.currentId) ownedIds.add(voice.currentId);

  // Assign free voices to unowned picked sources (closest first).
  for (const src of picked) {
    if (ownedIds.has(src.id)) {
      // Already owned by some voice — just refresh panner to track (positions are fixed but
      // a sub-tile snap / later extensions might move them).
      const voice = pool.find((v) => v.currentId === src.id);
      if (voice) {
        setSpatialSourceWorldPosition(
          /** @type {any} */ ({ panner: voice.panner, filter: voice.filter }),
          src.x,
          src.y,
          0
        );
        // Glide current fade toward master in case a previous release was scheduled and
        // then the source reappeared before pause fired.
        rampTo(voice.fadeGain, TUNING.masterLinearGain, TUNING.frameGlideSec);
        voice.pauseAtMs = 0;
      }
      continue;
    }
    const freeVoice = pool.find((v) => !v.currentId);
    if (!freeVoice) break;
    assignVoiceToSource(freeVoice, src);
    ownedIds.add(src.id);
  }

  // Finalize deferred pauses once the fade-out tail has elapsed.
  const now = performance.now();
  for (const voice of pool) {
    if (!voice.currentId && voice.isPlaying && voice.pauseAtMs && now >= voice.pauseAtMs) {
      pauseVoiceNow(voice);
    }
  }
}

/**
 * Fade everything out and pause after the tail. Call when leaving play mode.
 */
export function stopFireLoopAudio() {
  const pool = voices;
  if (!pool) return;
  const pauseAt = performance.now() + TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs;
  for (const voice of pool) {
    voice.currentId = null;
    rampTo(voice.fadeGain, 0, TUNING.fadeOutSec);
    voice.pauseAtMs = pauseAt;
  }
  setTimeout(() => {
    if (!voices) return;
    for (const voice of voices) if (voice.isPlaying && !voice.currentId) pauseVoiceNow(voice);
  }, TUNING.fadeOutSec * 1000 + TUNING.pauseBufferMs);
}
