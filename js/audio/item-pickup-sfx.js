import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';
const ITEM_PICKUP_WAV_URL = new URL('../../audio/sfx/A-Drip.wav', import.meta.url).href;

const POOL_SIZE = 4;
/** Base linear gain before file loudness trim and cries/SFX mix slider. */
const ITEM_PICKUP_VOL = 0.62;
/** A-Drip is hot on disk — half vs other spatial SFX at the same mix. */
const ITEM_PICKUP_LOUD_FILE_TRIM = 0.5;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(ITEM_PICKUP_WAV_URL);
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
export function playItemPickupSfx(source) {
  const a = borrowAudio();
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = Math.max(0, Math.min(1, ITEM_PICKUP_VOL * ITEM_PICKUP_LOUD_FILE_TRIM));
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
