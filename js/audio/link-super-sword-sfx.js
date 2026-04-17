import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const _resolved = new URL('../../audio/sfx/Link - Super Sword.wav', import.meta.url).href;
const SUPER_SWORD_URL = _resolved.replace(/ /g, '%20');

const POOL_SIZE = 3;
const VOL = 0.62;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(SUPER_SWORD_URL);
      a.preload = 'auto';
      pool.push(a);
    }
  }
  return pool;
}

function borrow() {
  const p = ensurePool();
  for (const a of p) {
    if (a.paused || a.ended) return a;
  }
  return p[0];
}

/** Strong charged Cut (first bar full). */
export function playLinkSuperSwordSfx(source) {
  const a = borrow();
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = VOL;
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
