import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';
import { getEffectiveMeMix01 } from './play-audio-mix-settings.js';

const FANFARE_OGG_URL = new URL('../../audio/me/Fanfare3.ogg', import.meta.url).href;

const POOL_SIZE = 2;
/** Base linear gain before ME mix slider (same bucket as encounter ME in UI). */
const FANFARE_BASE_VOL = 0.72;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(FANFARE_OGG_URL);
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
 * Short level-up fanfare (ME-style stinger). Uses ME mix + mute from minimap audio.
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function playPlayerLevelUpFanfareSfx(source) {
  const a = borrowAudio();
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  const me = getEffectiveMeMix01();
  if (me <= 0) return;
  a.volume = Math.max(0, Math.min(1, FANFARE_BASE_VOL * me));
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
