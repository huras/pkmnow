import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const JUMP_WAV_URL = new URL(
  '../../audio/sfx/Game Boy Advance - Pokemon Emerald - Miscellaneous - Sound Effects/emerald_000A.wav',
  import.meta.url
).href;

/** Overlap-friendly pool (double jump, tight re-press). */
const POOL_SIZE = 3;
const JUMP_VOL = 0.62;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(JUMP_WAV_URL);
      a.preload = 'auto';
      pool.push(a);
    }
  }
  return pool;
}

function borrowAudio() {
  const p = ensurePool();
  for (const a of p) {
    if (a.paused || a.ended) return a;
  }
  return p[0];
}

/**
 * Emerald menu-style tick; plays on every successful hop (incl. air jump).
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} p
 */
export function playJumpSfx(p) {
  const a = borrowAudio();
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = JUMP_VOL;
  a.playbackRate = 1;

  void resumeSpatialAudioContext();
  const graph = wireSpatialMediaElement(a);
  const wx = Number(p?.visualX ?? p?.x);
  const wy = Number(p?.visualY ?? p?.y);
  if (Number.isFinite(wx) && Number.isFinite(wy)) {
    setSpatialSourceWorldPosition(graph, wx, wy, Math.max(0, Number(p?.z) || 0));
  } else {
    centerSpatialSourceOnListener(graph);
  }

  const playP = a.play();
  if (playP !== undefined && typeof playP.catch === 'function') playP.catch(() => {});
}
