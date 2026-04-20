import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const FAR_AWAY_MP3_URL = new URL('../../audio/sfx/far-away-lightining.mp3', import.meta.url).href;
const NEARBY_MP3_URL = new URL('../../audio/sfx/nearby-lightining.mp3', import.meta.url).href;

const POOL_SIZE = 4;
const FAR_VOL = 0.62;
const NEAR_VOL = 0.74;

/** @type {HTMLAudioElement[] | null} */
let farPool = null;
/** @type {HTMLAudioElement[] | null} */
let nearPool = null;

function ensureFarPool() {
  if (!farPool) {
    farPool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(FAR_AWAY_MP3_URL);
      a.preload = 'auto';
      farPool.push(a);
    }
  }
  return farPool;
}

function ensureNearPool() {
  if (!nearPool) {
    nearPool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(NEARBY_MP3_URL);
      a.preload = 'auto';
      nearPool.push(a);
    }
  }
  return nearPool;
}

function borrowFrom(pool) {
  for (const a of pool) {
    if (a.paused || a.ended) return a;
  }
  return pool[0];
}

/** Distant rumble — not panned to the hidden strike. */
export function playFarRainLightningSfx() {
  const a = borrowFrom(ensureFarPool());
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = FAR_VOL;
  a.playbackRate = 1;

  void resumeSpatialAudioContext();
  const graph = wireSpatialMediaElement(a);
  centerSpatialSourceOnListener(graph);

  const playP = a.play();
  if (playP !== undefined && typeof playP.catch === 'function') playP.catch(() => {});
}

/**
 * Close strike on the visible play area — spatialized at impact.
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function playNearRainLightningSfx(source) {
  const a = borrowFrom(ensureNearPool());
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = NEAR_VOL;
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
