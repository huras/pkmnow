import { getSpatialAudioContext, resumeSpatialAudioContext } from './spatial-audio.js';
import { getBiomeBgmUrlsForBiome } from './biome-bgm-tracks.js';
import { getMicroTile } from '../chunking.js';
import { getEffectiveBgmMix01 } from './play-audio-mix-settings.js';

const TUNING = {
  fadeOutSec: 1.15,
  fadeInSec: 1.25,
  gapSec: 0.7,
  stopFadeSec: 0.32,
  hysteresisMs: 260,
  masterLinearGain: 0.34
};

/** @typedef {{ audio: HTMLAudioElement, gain: GainNode, userGain: GainNode }} BgmSlot */

/** @type {BgmSlot | null} */
let slot0 = null;
/** @type {BgmSlot | null} */
let slot1 = null;

/** @type {0 | 1 | null} */
let activeSlot = null;
/** Biome id for the current / last-started playlist. */
let playingBiomeId = /** @type {number | null} */ (null);
/** After hysteresis — world intent. */
let stableDesiredBiomeId = /** @type {number | null} */ (null);
let biomeCandidate = /** @type {number | null} */ (null);
let biomeCandidateSinceMs = 0;

/** Invalidate in-flight timeout chains (biome change / stop). */
let chainEpoch = 0;
/** @type {ReturnType<typeof setTimeout>[]} */
const timeoutHandles = [];

/** @type {Map<number, string>} */
const lastUrlByBiome = new Map();

/**
 * Seeded shuffle session: `Date.now()` once per play session (see {@link resetBgmShuffleSession}).
 * @type {number}
 */
let bgmShuffleSessionSeed = 0;
/** Shuffled order per biome (lazy); cursor is round-robin into this list. */
/** @type {Map<number, string[]>} */
const shuffledUrlsByBiome = new Map();
/** @type {Map<number, number>} */
const shuffleCursorByBiome = new Map();

/**
 * @param {number} seed32
 * @returns {() => number} uniform in [0, 1)
 */
function mulberry32(seed32) {
  let a = seed32 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} sessionMs
 * @param {number} biomeId
 * @returns {number}
 */
function mixShuffleSeed(sessionMs, biomeId) {
  const lo = sessionMs >>> 0;
  const hi = (Math.floor(sessionMs / 0x100000000) >>> 0) ^ (biomeId << 16);
  return (lo ^ hi ^ Math.imul(biomeId + 1, 0x9e3779b1)) >>> 0;
}

/**
 * @param {readonly string[]} urls
 * @param {() => number} rnd01
 * @returns {string[]}
 */
function fisherYatesShuffle(urls, rnd01) {
  const a = urls.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd01() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function ensureBgmShuffleSessionSeed() {
  if (bgmShuffleSessionSeed === 0) {
    bgmShuffleSessionSeed = Date.now();
  }
}

function resetBgmShuffleSession() {
  bgmShuffleSessionSeed = 0;
  shuffledUrlsByBiome.clear();
  shuffleCursorByBiome.clear();
}

/** While a fade→gap→play chain is resolving toward this biome, ignore duplicate syncs. */
let transitionTargetBiome = /** @type {number | null} */ (null);

/** After failed `play()`, avoid hammering `startOrRetargetToBiome` every frame until user gesture. */
let coldPlayRetryNotBeforeMs = 0;


function clearTimeouts() {
  for (const h of timeoutHandles) clearTimeout(h);
  timeoutHandles.length = 0;
}

/**
 * @param {() => void} fn
 * @param {number} ms
 */
function afterMs(fn, ms) {
  const h = setTimeout(() => {
    const i = timeoutHandles.indexOf(h);
    if (i >= 0) timeoutHandles.splice(i, 1);
    fn();
  }, ms);
  timeoutHandles.push(h);
}

function ensureSlots() {
  if (slot0) {
    applyBgmUserMixFromStorage();
    return;
  }
  const ctx = getSpatialAudioContext();
  const mk = () => {
    const audio = new Audio();
    audio.preload = 'auto';
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const userGain = ctx.createGain();
    userGain.gain.value = getEffectiveBgmMix01();
    source.connect(gain);
    gain.connect(userGain);
    userGain.connect(ctx.destination);
    return { audio, gain, userGain };
  };
  slot0 = mk();
  slot1 = mk();
}

/**
 * Applies {@link getBgmMix01} to both BGM slots (post-fade trim). Safe to call any time after {@link ensureSlots}.
 */
export function applyBgmUserMixFromStorage() {
  const v = getEffectiveBgmMix01();
  if (slot0?.userGain) {
    try {
      slot0.userGain.gain.value = v;
    } catch {
      /* ignore */
    }
  }
  if (slot1?.userGain) {
    try {
      slot1.userGain.gain.value = v;
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {0|1} i
 * @returns {BgmSlot}
 */
function slotAt(i) {
  ensureSlots();
  return i === 0 ? /** @type {BgmSlot} */ (slot0) : /** @type {BgmSlot} */ (slot1);
}

/**
 * @param {GainNode} gainNode
 * @param {number} from
 * @param {number} to
 * @param {number} durationSec
 */
function rampLinear(gainNode, from, to, durationSec) {
  const ctx = getSpatialAudioContext();
  const t = ctx.currentTime;
  try {
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(from, t);
    if (durationSec <= 0.001) gainNode.gain.setValueAtTime(to, t);
    else gainNode.gain.linearRampToValueAtTime(to, t + durationSec);
  } catch {
    gainNode.gain.value = to;
  }
}

/**
 * @param {number} biomeId
 * @returns {string | null}
 */
function pickNextUrl(biomeId) {
  const urls = getBiomeBgmUrlsForBiome(biomeId);
  if (!urls?.length) return null;
  if (urls.length === 1) {
    const u = urls[0];
    lastUrlByBiome.set(biomeId, u);
    return u;
  }
  let shuffled = shuffledUrlsByBiome.get(biomeId);
  if (!shuffled) {
    ensureBgmShuffleSessionSeed();
    const rnd = mulberry32(mixShuffleSeed(bgmShuffleSessionSeed, biomeId));
    shuffled = fisherYatesShuffle(urls, rnd);
    shuffledUrlsByBiome.set(biomeId, shuffled);
    shuffleCursorByBiome.set(biomeId, 0);
  }
  const last = lastUrlByBiome.get(biomeId);
  const n = shuffled.length;
  let cursor = shuffleCursorByBiome.get(biomeId) ?? 0;
  for (let k = 0; k < n; k++) {
    const pick = shuffled[cursor % n];
    cursor = (cursor + 1) % n;
    if (pick !== last || n <= 1) {
      shuffleCursorByBiome.set(biomeId, cursor);
      lastUrlByBiome.set(biomeId, pick);
      return pick;
    }
  }
  const fallback = shuffled[cursor % n];
  shuffleCursorByBiome.set(biomeId, (cursor + 1) % n);
  lastUrlByBiome.set(biomeId, fallback);
  return fallback;
}

/**
 * @param {0|1} slotIdx
 * @param {() => void} onComplete
 * @param {number} fadeSec
 */
function fadeOutAndPause(slotIdx, onComplete, fadeSec) {
  const slot = slotAt(slotIdx);
  const g = slot.gain.gain.value;
  rampLinear(slot.gain, g, 0, fadeSec);
  afterMs(() => {
    try {
      slot.audio.pause();
    } catch {
      /* ignore */
    }
    onComplete();
  }, fadeSec * 1000 + 40);
}

/**
 * @param {0|1} slotIdx
 * @param {number} fadeSec
 */
function fadeInPlaying(slotIdx, fadeSec) {
  const slot = slotAt(slotIdx);
  slot.gain.gain.value = 0;
  rampLinear(slot.gain, 0, TUNING.masterLinearGain, fadeSec);
}

/**
 * @param {0|1 | null} slotIdx
 */
function detachEnded(slotIdx) {
  if (slotIdx == null) return;
  const slot = slotAt(slotIdx);
  if (slot.audio._biomeBgmOnEnded) {
    slot.audio.removeEventListener('ended', slot.audio._biomeBgmOnEnded);
    slot.audio._biomeBgmOnEnded = null;
  }
}

/**
 * @param {0|1} slotIdx
 * @param {() => void} handler
 */
function attachEnded(slotIdx, handler) {
  const slot = slotAt(slotIdx);
  detachEnded(slotIdx);
  slot.audio._biomeBgmOnEnded = handler;
  slot.audio.addEventListener('ended', handler);
}

/**
 * @param {0|1} slotIdx
 * @param {string} url
 * @returns {Promise<boolean>} whether playback actually started
 */
function loadAndPlay(slotIdx, url) {
  const slot = slotAt(slotIdx);
  slot.audio.pause();
  slot.audio.src = url;
  slot.audio.currentTime = 0;
  slot.audio.load();

  return new Promise((resolve) => {
    let settled = false;
    let canAttemptPlay = false;
    let playAttempted = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      slot.audio.removeEventListener('canplay', onCanPlay);
      slot.audio.removeEventListener('error', onError);
      clearTimeout(failSafeTimer);
      resolve(ok);
    };

    const tryPlay = () => {
      if (settled || !canAttemptPlay || playAttempted) return;
      playAttempted = true;
      void resumeSpatialAudioContext()
        .then(() => slot.audio.play())
        .then(() => finish(true))
        .catch(() => finish(false));
    };

    const onCanPlay = () => {
      canAttemptPlay = true;
      tryPlay();
    };

    const onError = () => finish(false);

    const failSafeTimer = setTimeout(() => finish(false), 8000);
    slot.audio.addEventListener('canplay', onCanPlay, { once: true });
    slot.audio.addEventListener('error', onError, { once: true });

    if (slot.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      canAttemptPlay = true;
      tryPlay();
    }
  });
}

/**
 * @param {object} opts
 * @param {0|1 | null} opts.prevSlot slot to fade out (null = cold start)
 * @param {0|1} opts.nextSlot
 * @param {number} opts.biomeId
 * @param {number} opts.epoch chain token
 */
function sequenceFadeGapPlay({ prevSlot, nextSlot, biomeId, epoch }) {
  const url = pickNextUrl(biomeId);

  const runPlay = () => {
    if (epoch !== chainEpoch) return;
    if (!url) {
      playingBiomeId = biomeId;
      activeSlot = null;
      transitionTargetBiome = null;
      return;
    }
    void loadAndPlay(nextSlot, url).then((ok) => {
      if (epoch !== chainEpoch) return;
      detachEnded(prevSlot);
      if (!ok) {
        transitionTargetBiome = null;
        coldPlayRetryNotBeforeMs = performance.now() + 450;
        return;
      }
      fadeInPlaying(nextSlot, TUNING.fadeInSec);
      attachEnded(nextSlot, () => onActiveTrackEnded(nextSlot));
      activeSlot = nextSlot;
      playingBiomeId = biomeId;
      transitionTargetBiome = null;
    });
  };

  if (prevSlot == null) {
    afterMs(runPlay, 0);
    return;
  }

  detachEnded(prevSlot);
  fadeOutAndPause(
    prevSlot,
    () => {
      if (epoch !== chainEpoch) return;
      afterMs(runPlay, TUNING.gapSec * 1000);
    },
    TUNING.fadeOutSec
  );
}

/**
 * @param {0|1} endedSlot
 */
function onActiveTrackEnded(endedSlot) {
  if (activeSlot !== endedSlot) return;
  const biome = stableDesiredBiomeId ?? playingBiomeId;
  if (biome == null) return;

  if (biome !== playingBiomeId) {
    chainEpoch++;
    clearTimeouts();
    const ep = chainEpoch;
    const nextS = /** @type {0|1} */ (1 - endedSlot);
    sequenceFadeGapPlay({ prevSlot: endedSlot, nextSlot: nextS, biomeId: biome, epoch: ep });
    return;
  }

  chainEpoch++;
  clearTimeouts();
  const ep = chainEpoch;
  const nextS = /** @type {0|1} */ (1 - endedSlot);
  sequenceFadeGapPlay({ prevSlot: endedSlot, nextSlot: nextS, biomeId: biome, epoch: ep });
}

/**
 * @param {number} targetBiome
 */
function startOrRetargetToBiome(targetBiome) {
  const urls = getBiomeBgmUrlsForBiome(targetBiome);
  if (!urls?.length) {
    chainEpoch++;
    clearTimeouts();
    transitionTargetBiome = null;
    for (const i of /** @type {(0|1)[]} */ ([0, 1])) {
      detachEnded(i);
      const slot = slotAt(i);
      rampLinear(slot.gain, slot.gain.gain.value, 0, TUNING.stopFadeSec);
      try {
        slot.audio.pause();
      } catch {
        /* ignore */
      }
    }
    activeSlot = null;
    playingBiomeId = targetBiome;
    return;
  }

  if (activeSlot !== null && playingBiomeId === targetBiome) {
    transitionTargetBiome = null;
    return;
  }

  if (
    transitionTargetBiome === targetBiome &&
    playingBiomeId != null &&
    targetBiome !== playingBiomeId
  ) {
    return;
  }

  if (
    transitionTargetBiome === targetBiome &&
    activeSlot === null &&
    playingBiomeId === null
  ) {
    return;
  }

  chainEpoch++;
  clearTimeouts();
  const ep = chainEpoch;
  transitionTargetBiome = targetBiome;

  if (activeSlot == null) {
    sequenceFadeGapPlay({ prevSlot: null, nextSlot: 0, biomeId: targetBiome, epoch: ep });
    return;
  }

  const prev = activeSlot;
  const nextS = /** @type {0|1} */ (1 - prev);
  sequenceFadeGapPlay({ prevSlot: prev, nextSlot: nextS, biomeId: targetBiome, epoch: ep });
}

function stopBiomeBgmInternal(useLongFade) {
  chainEpoch++;
  clearTimeouts();
  const fade = useLongFade ? TUNING.fadeOutSec : TUNING.stopFadeSec;
  for (const i of /** @type {(0|1)[]} */ ([0, 1])) {
    detachEnded(i);
    const slot = slotAt(i);
    const g = slot.gain.gain.value;
    rampLinear(slot.gain, g, 0, fade);
    try {
      slot.audio.pause();
    } catch {
      /* ignore */
    }
  }
  afterMs(() => {
    for (const i of /** @type {(0|1)[]} */ ([0, 1])) {
      try {
        slotAt(i).audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }, fade * 1000 + 60);
  activeSlot = null;
  playingBiomeId = null;
  transitionTargetBiome = null;
}

/**
 * @param {object} data
 * @param {import('../player.js').player} player
 */
export function syncBiomeBgm(data, player) {
  if (!data || !player) return;

  const mx = Math.floor(player.x);
  const my = Math.floor(player.y);
  let tile;
  try {
    tile = getMicroTile(mx, my, data);
  } catch {
    return;
  }
  const raw = tile?.biomeId;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return;

  const now = performance.now();
  if (raw !== biomeCandidate) {
    biomeCandidate = raw;
    biomeCandidateSinceMs = now;
  }
  if (now - biomeCandidateSinceMs < TUNING.hysteresisMs) return;
  stableDesiredBiomeId = biomeCandidate;

  if (stableDesiredBiomeId === playingBiomeId && activeSlot !== null) return;
  if (
    transitionTargetBiome != null &&
    stableDesiredBiomeId === transitionTargetBiome &&
    playingBiomeId != null &&
    stableDesiredBiomeId !== playingBiomeId
  ) {
    return;
  }

  if (
    activeSlot === null &&
    playingBiomeId === null &&
    performance.now() < coldPlayRetryNotBeforeMs
  ) {
    return;
  }

  startOrRetargetToBiome(/** @type {number} */ (stableDesiredBiomeId));
}

/**
 * @param {string | null | undefined} src
 * @returns {string | null}
 */
function trackNameFromSrc(src) {
  if (!src) return null;
  const base = src.split('?')[0] || '';
  const lastSlash = base.lastIndexOf('/');
  const raw = lastSlash >= 0 ? base.slice(lastSlash + 1) : base;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Lightweight state for UI/debug overlays.
 * @returns {{
 *   playingBiomeId: number | null,
 *   stableDesiredBiomeId: number | null,
 *   transitionTargetBiome: number | null,
 *   activeSlot: 0 | 1 | null,
 *   status: 'idle' | 'transitioning' | 'playing',
 *   currentTrackName: string | null
 * }}
 */
export function getBiomeBgmUiState() {
  const currentSrc =
    activeSlot === 0
      ? (slot0?.audio.currentSrc || slot0?.audio.src)
      : activeSlot === 1
        ? (slot1?.audio.currentSrc || slot1?.audio.src)
        : null;
  const status =
    activeSlot == null ? (transitionTargetBiome != null ? 'transitioning' : 'idle') : 'playing';
  return {
    playingBiomeId,
    stableDesiredBiomeId,
    transitionTargetBiome,
    activeSlot,
    status,
    currentTrackName: trackNameFromSrc(currentSrc)
  };
}

/**
 * Forces a smooth transition to the next shuffled track for the current biome intent.
 * @returns {boolean} true when a transition was started
 */
export function forceNextBiomeBgmTrack() {
  const targetBiome = transitionTargetBiome ?? stableDesiredBiomeId ?? playingBiomeId;
  if (targetBiome == null || !Number.isFinite(targetBiome)) return false;

  const urls = getBiomeBgmUrlsForBiome(targetBiome);
  if (!urls?.length) return false;

  chainEpoch++;
  clearTimeouts();
  const ep = chainEpoch;
  transitionTargetBiome = targetBiome;

  if (activeSlot == null) {
    sequenceFadeGapPlay({ prevSlot: null, nextSlot: 0, biomeId: targetBiome, epoch: ep });
    return true;
  }

  const prev = activeSlot;
  const nextS = /** @type {0|1} */ (1 - prev);
  sequenceFadeGapPlay({ prevSlot: prev, nextSlot: nextS, biomeId: targetBiome, epoch: ep });
  return true;
}

/** Call when leaving play mode. */
export function stopBiomeBgm() {
  biomeCandidate = null;
  stableDesiredBiomeId = null;
  transitionTargetBiome = null;
  coldPlayRetryNotBeforeMs = 0;
  lastUrlByBiome.clear();
  resetBgmShuffleSession();
  stopBiomeBgmInternal(false);
}
