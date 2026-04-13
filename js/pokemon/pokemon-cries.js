import { padDex3, getGen1ShowdownCrySlug } from './gen1-name-to-dex.js';

/** Two slots per dex so overlapping wild cries do not cancel each other. */
const POOL_SIZE = 2;
/** @type {Map<number, HTMLAudioElement[]>} */
const pools = new Map();

/** @type {WeakMap<object, number>} */
const nextEmotionCryByEntity = new WeakMap();
/** @type {WeakMap<object, number>} */
const nextAttackCryByEntity = new WeakMap();

/** @param {HTMLAudioElement} audio */
function clearCryEnvelope(audio) {
  if (audio._cryEnvelopeAbort) {
    audio._cryEnvelopeAbort.abort();
    audio._cryEnvelopeAbort = null;
  }
}

/**
 * Linear volume / pitch over the cry; cheap `timeupdate` + AbortController cleanup.
 * @param {HTMLAudioElement} audio
 * @param {{ v0: number, v1: number, r0: number, r1: number, fallbackDur: number }} curve
 */
function attachCryEnvelope(audio, curve) {
  clearCryEnvelope(audio);
  const { v0, v1, r0, r1, fallbackDur } = curve;
  if (v0 === v1 && r0 === r1) return;

  const ac = new AbortController();
  audio._cryEnvelopeAbort = ac;

  const tick = () => {
    let t;
    const d = audio.duration;
    if (d && Number.isFinite(d) && d > 0.02) {
      t = Math.min(1, Math.max(0, audio.currentTime / d));
    } else {
      t = Math.min(1, Math.max(0, audio.currentTime / fallbackDur));
    }
    audio.volume = Math.max(0, Math.min(1, v0 + (v1 - v0) * t));
    audio.playbackRate = Math.max(0.55, Math.min(1.45, r0 + (r1 - r0) * t));
  };

  const done = () => {
    clearCryEnvelope(audio);
  };

  audio.addEventListener('timeupdate', tick, { signal: ac.signal });
  audio.addEventListener('ended', done, { once: true, signal: ac.signal });
  audio.addEventListener('error', done, { once: true, signal: ac.signal });
}

function cryUrlForDex(dex) {
  const d = Math.max(1, Math.min(151, Number(dex) || 1));
  return `./audio/cries/gen1/${padDex3(d)}-${getGen1ShowdownCrySlug(d)}.mp3`;
}

function borrowAudio(dex) {
  const d = Math.max(1, Math.min(151, Number(dex) || 1));
  let pool = pools.get(d);
  if (!pool) {
    const url = cryUrlForDex(d);
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(url);
      a.preload = 'auto';
      pool.push(a);
    }
    pools.set(d, pool);
  }
  for (const a of pool) {
    if (a.paused || a.ended) return a;
  }
  return pool[0];
}

/**
 * @param {'emotion' | 'attack'} lane
 */
function canPlayLane(entity, lane) {
  if (!entity) return true;
  const now = performance.now() * 0.001;
  const map = lane === 'attack' ? nextAttackCryByEntity : nextEmotionCryByEntity;
  return now >= (map.get(entity) ?? 0);
}

/**
 * @param {'emotion' | 'attack'} lane
 */
function noteLane(entity, lane, minGapSec) {
  if (!entity) return;
  const now = performance.now() * 0.001;
  const map = lane === 'attack' ? nextAttackCryByEntity : nextEmotionCryByEntity;
  map.set(entity, now + minGapSec);
}

/**
 * @typedef {{ volumeFrom?: number, volumeTo?: number, rateFrom?: number, rateTo?: number, fallbackDurationSec?: number }} CryEnvelope
 */

/**
 * @param {number} dex
 * @param {{
 *   volume?: number,
 *   playbackRate?: number,
 *   entity?: object,
 *   minGapSec?: number,
 *   lane?: 'emotion' | 'attack',
 *   envelope?: CryEnvelope
 * }} [opts]
 */
export function playPokemonCry(dex, opts = {}) {
  const entity = opts.entity;
  const lane = opts.lane ?? 'emotion';
  const minGap = opts.minGapSec ?? 1.25;
  if (!canPlayLane(entity, lane)) return false;

  const a = borrowAudio(dex);
  clearCryEnvelope(a);

  const env = opts.envelope;
  let v0;
  let v1;
  let r0;
  let r1;
  if (env) {
    v0 = env.volumeFrom ?? opts.volume ?? 0.52;
    v1 = env.volumeTo ?? v0;
    r0 = env.rateFrom ?? opts.playbackRate ?? 1;
    r1 = env.rateTo ?? r0;
  } else {
    const vol = opts.volume != null ? opts.volume : 0.52;
    const rate = opts.playbackRate != null ? opts.playbackRate : 1;
    v0 = v1 = vol;
    r0 = r1 = rate;
  }

  a.volume = Math.max(0, Math.min(1, v0));
  a.playbackRate = Math.max(0.55, Math.min(1.45, r0));
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }

  const p = a.play();
  if (p !== undefined && typeof p.catch === 'function') {
    p.catch(() => {});
  }
  noteLane(entity, lane, minGap);

  if (env || v0 !== v1 || r0 !== r1) {
    attachCryEnvelope(a, {
      v0,
      v1,
      r0,
      r1,
      fallbackDur: env?.fallbackDurationSec ?? 0.9
    });
  }
  return true;
}

/**
 * Cry when a wild balloon emotion is shown (deduped by `setEmotion` + per-entity gap).
 * @param {object} entity
 * @param {number} emotionType
 * @param {string} portraitSlug
 */
export function playWildEmotionCry(entity, emotionType, portraitSlug) {
  const dex = entity?.dexId ?? 1;
  if (emotionType === 7) return;
  if (emotionType === 9 && portraitSlug !== 'Pain') return;

  if (emotionType === 0 && portraitSlug === 'Surprised') {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 1.35,
      envelope: {
        volumeFrom: 0.46,
        volumeTo: 0.64,
        rateFrom: 1.1,
        rateTo: 0.97,
        fallbackDurationSec: 0.85
      }
    });
    return;
  }
  if (emotionType === 0) {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 1.25,
      envelope: {
        volumeFrom: 0.4,
        volumeTo: 0.54,
        rateFrom: 1.06,
        rateTo: 0.98,
        fallbackDurationSec: 0.88
      }
    });
    return;
  }
  if (emotionType === 4) {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 1.2,
      envelope: {
        volumeFrom: 0.5,
        volumeTo: 0.6,
        rateFrom: 1.04,
        rateTo: 1.12,
        fallbackDurationSec: 0.82
      }
    });
    return;
  }
  if (emotionType === 5) {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 1.1,
      envelope: {
        volumeFrom: 0.42,
        volumeTo: 0.3,
        rateFrom: 1.02,
        rateTo: 0.87,
        fallbackDurationSec: 0.95
      }
    });
    return;
  }
  if (emotionType === 1) {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 1.15,
      envelope: {
        volumeFrom: 0.3,
        volumeTo: 0.4,
        rateFrom: 0.93,
        rateTo: 1.05,
        fallbackDurationSec: 0.9
      }
    });
    return;
  }
  if (emotionType === 2 || emotionType === 3) {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 1.4,
      envelope: {
        volumeFrom: 0.34,
        volumeTo: 0.48,
        rateFrom: 0.97,
        rateTo: 1.09,
        fallbackDurationSec: 0.92
      }
    });
    return;
  }
  if (emotionType === 6) {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 1.2,
      envelope: {
        volumeFrom: 0.32,
        volumeTo: 0.42,
        rateFrom: 0.98,
        rateTo: 1.05,
        fallbackDurationSec: 0.88
      }
    });
    return;
  }
  if (emotionType === 9 && portraitSlug === 'Pain') {
    playPokemonCry(dex, {
      entity,
      lane: 'emotion',
      minGapSec: 0.5,
      envelope: {
        volumeFrom: 0.54,
        volumeTo: 0.36,
        rateFrom: 1.02,
        rateTo: 0.86,
        fallbackDurationSec: 0.8
      }
    });
  }
}

/**
 * Cry on wild move cast (tighter gap than emotion; still per-entity).
 * @param {object} entity
 */
export function playWildAttackCry(entity) {
  const dex = entity?.dexId ?? 1;
  playPokemonCry(dex, {
    entity,
    lane: 'attack',
    minGapSec: 0.28,
    envelope: {
      volumeFrom: 0.66,
      volumeTo: 0.74,
      rateFrom: 1.08,
      rateTo: 1.0,
      fallbackDurationSec: 0.55
    }
  });
}
