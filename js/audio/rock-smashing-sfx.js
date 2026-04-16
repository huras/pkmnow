import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const ROCK_SMASHING_MP3_URL = new URL('../../audio/sfx/rock-smashing-a.mp3', import.meta.url).href;
const ROCK_SMASHING_BREAK_MP3_URL = new URL('../../audio/sfx/rock-smashing-b.mp3', import.meta.url).href;
const ROCK_SMASHING_CARRY_DROP_MP3_URL = new URL('../../audio/sfx/rock-smashing-c.mp3', import.meta.url).href;

const POOL_SIZE = 6;
const ROCK_SMASHING_VOL = 0.62;

/** @type {HTMLAudioElement[] | null} */
let pool = null;
/** @type {HTMLAudioElement[] | null} */
let breakPool = null;
/** @type {HTMLAudioElement[] | null} */
let carryDropPool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(ROCK_SMASHING_MP3_URL);
      a.preload = 'auto';
      pool.push(a);
    }
  }
  return pool;
}

function ensureCarryDropPool() {
  if (!carryDropPool) {
    carryDropPool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(ROCK_SMASHING_CARRY_DROP_MP3_URL);
      a.preload = 'auto';
      carryDropPool.push(a);
    }
  }
  return carryDropPool;
}

function ensureBreakPool() {
  if (!breakPool) {
    breakPool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(ROCK_SMASHING_BREAK_MP3_URL);
      a.preload = 'auto';
      breakPool.push(a);
    }
  }
  return breakPool;
}

function borrowAudio(kind = 'default') {
  const p =
    kind === 'carryDrop'
      ? ensureCarryDropPool()
      : kind === 'break'
        ? ensureBreakPool()
        : ensurePool();
  for (const a of p) {
    if (a.paused || a.ended) return a;
  }
  return p[0];
}

/**
 * Rock-smashing SFX used by breakable detail hits and breaks.
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function playRockSmashingSfx(source) {
  const a = borrowAudio('default');
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = ROCK_SMASHING_VOL;
  a.playbackRate = 1;

  void resumeSpatialAudioContext();
  const graph = wireSpatialMediaElement(a);
  const wx = Number(source?.visualX ?? source?.x);
  const wy = Number(source?.visualY ?? source?.y);
  if (Number.isFinite(wx) && Number.isFinite(wy)) {
    setSpatialSourceWorldPosition(graph, wx, wy, Math.max(0, Number(source?.z) || 0));
  } else {
    centerSpatialSourceOnListener(graph);
  }

  const playP = a.play();
  if (playP !== undefined && typeof playP.catch === 'function') playP.catch(() => {});
}

/**
 * Dedicated SFX for final impact that breaks a rock/detail.
 * Uses `rock-smashing-b.mp3`.
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function playRockSmashingBreakSfx(source) {
  const a = borrowAudio('break');
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = ROCK_SMASHING_VOL;
  a.playbackRate = 1;

  void resumeSpatialAudioContext();
  const graph = wireSpatialMediaElement(a);
  const wx = Number(source?.visualX ?? source?.x);
  const wy = Number(source?.visualY ?? source?.y);
  if (Number.isFinite(wx) && Number.isFinite(wy)) {
    setSpatialSourceWorldPosition(graph, wx, wy, Math.max(0, Number(source?.z) || 0));
  } else {
    centerSpatialSourceOnListener(graph);
  }

  const playP = a.play();
  if (playP !== undefined && typeof playP.catch === 'function') playP.catch(() => {});
}

/**
 * Dedicated SFX for forced carry drop after carrier is attacked.
 * Uses `rock-smashing-c.mp3`.
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function playRockSmashingCarryDropSfx(source) {
  const a = borrowAudio('carryDrop');
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = ROCK_SMASHING_VOL;
  a.playbackRate = 1;

  void resumeSpatialAudioContext();
  const graph = wireSpatialMediaElement(a);
  const wx = Number(source?.visualX ?? source?.x);
  const wy = Number(source?.visualY ?? source?.y);
  if (Number.isFinite(wx) && Number.isFinite(wy)) {
    setSpatialSourceWorldPosition(graph, wx, wy, Math.max(0, Number(source?.z) || 0));
  } else {
    centerSpatialSourceOnListener(graph);
  }

  const playP = a.play();
  if (playP !== undefined && typeof playP.catch === 'function') playP.catch(() => {});
}
