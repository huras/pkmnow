import { padDex3, getGen1ShowdownCrySlug } from './gen1-name-to-dex.js';
import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from '../audio/spatial-audio.js';
import { getCriesMix01 } from '../audio/play-audio-mix-settings.js';

/** Two slots per dex so overlapping wild cries do not cancel each other. */
const POOL_SIZE = 2;

/** Global loudness boost (cries were tuned a bit quiet vs spatial + MP3). */
const CRY_VOL_BOOST = 1.22;

/** Scales all cry volumes vs the boosted range (user: ~75% of previous perceived level). */
const CRY_VOL_RANGE_SCALE = 0.75;

/** Default cry level when no envelope is passed. */
const CRY_DEFAULT_VOL = 0.74;

/** Fade-out curve: exponent on `t` in [0,1] — higher = volume stays up longer before tail (slower decay). */
const CRY_FADE_OUT_T_POWER = 2.75;

/** Hurt-tail fade: exponent on normalized remaining time (same idea as {@link CRY_FADE_OUT_T_POWER}). */
const CRY_HURT_TAIL_U_POWER = 2.35;

function clampCryVol(v) {
  return Math.max(0, Math.min(1, v * CRY_VOL_BOOST * CRY_VOL_RANGE_SCALE * getCriesMix01()));
}
/** @type {Map<number, HTMLAudioElement[]>} */
const pools = new Map();

/** In-flight {@link preloadPokemonCry} per dex (dedupes parallel spawns). */
/** @type {Map<number, Promise<void>>} */
const cryPreloadInflight = new Map();

function clampDex(dex) {
  return Math.max(1, Math.min(151, Number(dex) || 1));
}

/** @type {WeakMap<object, number>} */
const nextEmotionCryByEntity = new WeakMap();
/** @type {WeakMap<object, number>} */
const nextAttackCryByEntity = new WeakMap();

/** Wild mon currently playing cry (emotion, attack, or hurt tail) — one slot per entity. */
/** @type {WeakMap<object, HTMLAudioElement>} */
const activeCryAudioByEntity = new WeakMap();

/**
 * Hard-stop any cry tied to this entity (emotion / attack / hurt).
 * @param {object | null | undefined} entity
 */
export function stopOngoingCryForEntity(entity) {
  if (!entity) return;
  const a = activeCryAudioByEntity.get(entity);
  if (!a) return;
  activeCryAudioByEntity.delete(entity);
  if (a._cryBindAbort) {
    a._cryBindAbort.abort();
    a._cryBindAbort = null;
  }
  clearCryEnvelope(a);
  try {
    a.pause();
  } catch {
    /* ignore */
  }
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} entity
 * @param {HTMLAudioElement} audio
 */
function bindActiveCryToEntity(entity, audio) {
  if (audio._cryBindAbort) audio._cryBindAbort.abort();
  const ac = new AbortController();
  audio._cryBindAbort = ac;
  activeCryAudioByEntity.set(entity, audio);
  const done = () => {
    if (audio._cryBindAbort === ac) audio._cryBindAbort = null;
    if (activeCryAudioByEntity.get(entity) === audio) activeCryAudioByEntity.delete(entity);
    clearCryEnvelope(audio);
  };
  audio.addEventListener('ended', done, { once: true, signal: ac.signal });
  audio.addEventListener('error', done, { once: true, signal: ac.signal });
}

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
    /** Fade-out: power > 1 keeps level higher longer; fade-in reaches full level a bit earlier. */
    let volBlend = t;
    if (v1 < v0 - 1e-4) volBlend = Math.pow(t, CRY_FADE_OUT_T_POWER);
    else if (v1 > v0 + 1e-4) volBlend = 1 - (1 - t) * (1 - t);
    audio.volume = Math.max(0, Math.min(1, v0 + (v1 - v0) * volBlend));
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
  const d = clampDex(dex);
  return `./audio/cries/gen1/${padDex3(d)}-${getGen1ShowdownCrySlug(d)}.mp3`;
}

/**
 * Ensure the cry pool exists for this dex (two {@link HTMLAudioElement} slots).
 * @param {number} dex
 * @returns {HTMLAudioElement[]}
 */
function ensureCryPool(dex) {
  const d = clampDex(dex);
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
  return pool;
}

/**
 * Warm cry buffers for a species before cries play (spawn / emotion / hurt).
 * Dedupes concurrent preloads per dex. Does not block the game loop — callers use `void`.
 * @param {number} dex
 * @returns {Promise<void>}
 */
export function preloadPokemonCry(dex) {
  const d = clampDex(dex);
  const existing = cryPreloadInflight.get(d);
  if (existing) return existing;

  void resumeSpatialAudioContext();

  const pool = ensureCryPool(d);

  const waitOne = (a) =>
    new Promise((resolve) => {
      if (a.error) {
        resolve();
        return;
      }
      if (a.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      a.addEventListener('canplay', done, { once: true });
      a.addEventListener('error', done, { once: true });
      setTimeout(done, 5000);
      try {
        if (a.readyState === HTMLMediaElement.HAVE_NOTHING) a.load();
      } catch {
        done();
      }
    });

  const p = Promise.all(pool.map(waitOne)).then(() => {});
  cryPreloadInflight.set(d, p);
  p.finally(() => {
    if (cryPreloadInflight.get(d) === p) cryPreloadInflight.delete(d);
  });
  return p;
}

function borrowAudio(dex) {
  const pool = ensureCryPool(dex);
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

  if (entity) stopOngoingCryForEntity(entity);

  const a = borrowAudio(dex);
  clearCryEnvelope(a);

  const env = opts.envelope;
  let v0;
  let v1;
  let r0;
  let r1;
  if (env) {
    v0 = clampCryVol(env.volumeFrom ?? opts.volume ?? CRY_DEFAULT_VOL);
    v1 = clampCryVol(env.volumeTo ?? env.volumeFrom ?? opts.volume ?? CRY_DEFAULT_VOL);
    r0 = env.rateFrom ?? opts.playbackRate ?? 1;
    r1 = env.rateTo ?? r0;
  } else {
    const vol = clampCryVol(opts.volume != null ? opts.volume : CRY_DEFAULT_VOL);
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

  void resumeSpatialAudioContext();
  const graph = wireSpatialMediaElement(a);
  if (entity && Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
    setSpatialSourceWorldPosition(graph, entity.x, entity.y, Number(entity.z) || 0);
  } else {
    centerSpatialSourceOnListener(graph);
  }

  const p = a.play();
  if (p !== undefined && typeof p.catch === 'function') {
    p.catch(() => {});
  }
  if (entity) bindActiveCryToEntity(entity, a);

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
 * Linear envelope over the **remaining** clip from `startTime` to `duration` (hurt tail).
 * @param {HTMLAudioElement} audio
 * @param {number} startTime
 * @param {number} fallbackDur
 */
function attachHurtTailEnvelope(audio, startTime, fallbackDur) {
  clearCryEnvelope(audio);
  const ac = new AbortController();
  audio._cryEnvelopeAbort = ac;
  const v0 = clampCryVol(0.78);
  const v1 = clampCryVol(0.38);
  const r0 = 1.06;
  const r1 = 0.9;

  const tick = () => {
    const d = audio.duration;
    const end = d && Number.isFinite(d) && d > startTime + 0.04 ? d : startTime + fallbackDur;
    const denom = Math.max(0.05, end - startTime);
    const u = Math.min(1, Math.max(0, (audio.currentTime - startTime) / denom));
    const uVol = Math.pow(u, CRY_HURT_TAIL_U_POWER);
    audio.volume = Math.max(0, Math.min(1, v0 + (v1 - v0) * uVol));
    audio.playbackRate = Math.max(0.55, Math.min(1.45, r0 + (r1 - r0) * u));
  };

  const done = () => {
    clearCryEnvelope(audio);
  };

  audio.addEventListener('timeupdate', tick, { signal: ac.signal });
  audio.addEventListener('ended', done, { once: true, signal: ac.signal });
  audio.addEventListener('error', done, { once: true, signal: ac.signal });
}

/**
 * On damage: stop this wild Pokémon's cry, then play from the midpoint to the end (hurt sting).
 * @param {object | null | undefined} entity
 */
export function playWildDamageHurtCry(entity) {
  if (!entity) return;
  const dex = entity.dexId ?? 1;
  stopOngoingCryForEntity(entity);

  const a = borrowAudio(dex);
  clearCryEnvelope(a);

  const fallbackHalf = 0.36;

  let hurtBegun = false;
  const beginHurtTail = () => {
    if (hurtBegun) return;
    hurtBegun = true;
    const d = a.duration;
    const hurtStart =
      d && Number.isFinite(d) && d > 0.1 ? d * 0.5 : fallbackHalf;
    try {
      a.currentTime = hurtStart;
    } catch {
      /* ignore */
    }
    a.playbackRate = 1.02;
    a.volume = clampCryVol(0.78);

    void resumeSpatialAudioContext();
    const graph = wireSpatialMediaElement(a);
    if (Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
      setSpatialSourceWorldPosition(graph, entity.x, entity.y, Number(entity.z) || 0);
    } else {
      centerSpatialSourceOnListener(graph);
    }

    const p = a.play();
    if (p !== undefined && typeof p.catch === 'function') p.catch(() => {});
    bindActiveCryToEntity(entity, a);
    const remain =
      d && Number.isFinite(d) && d > hurtStart + 0.04 ? d - hurtStart : fallbackHalf;
    attachHurtTailEnvelope(a, hurtStart, remain);
  };

  if (a.readyState >= HTMLMediaElement.HAVE_METADATA) {
    beginHurtTail();
  } else {
    // Do NOT call `a.load()` on every hurt when data is already loading — it resets and
    // re-fetches. Kick `load()` only from HAVE_NOTHING; {@link preloadPokemonCry} should
    // have metadata ready before combat cries matter.
    a.addEventListener('loadedmetadata', beginHurtTail, { once: true });
    a.addEventListener('error', beginHurtTail, { once: true });
    setTimeout(beginHurtTail, 2800);
    try {
      if (a.readyState === HTMLMediaElement.HAVE_NOTHING) a.load();
    } catch {
      beginHurtTail();
    }
  }
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
