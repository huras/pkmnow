import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const GRASS_RUSTLE_WAV_URL = new URL(
  '../../audio/sfx/Game Boy Advance - Pokemon Emerald - Miscellaneous - Sound Effects/emerald_00A9.wav',
  import.meta.url
).href;

const POOL_SIZE = 4;
const GRASS_RUSTLE_VOL = 0.52;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(GRASS_RUSTLE_WAV_URL);
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
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} p
 */
export function playGrassRustleSfx(p) {
  const a = borrowAudio();
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = GRASS_RUSTLE_VOL;
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
