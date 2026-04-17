import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const _treeTackleResolved = new URL('../../audio/sfx/DK - Whiff.wav', import.meta.url).href;
const TREE_TACKLE_WAV_URL = _treeTackleResolved.replace(/ /g, '%20');

const POOL_SIZE = 4;
const TREE_TACKLE_VOL = 0.62;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(TREE_TACKLE_WAV_URL);
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
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function playTreeTackleSfx(source) {
  const a = borrowAudio();
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = TREE_TACKLE_VOL;
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
