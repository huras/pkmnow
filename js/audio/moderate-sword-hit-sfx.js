import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const _resolved = new URL('../../audio/sfx/Moderate Sword Hit.wav', import.meta.url).href;
const MODERATE_SWORD_HIT_URL = _resolved.replace(/ /g, '%20');

const POOL_SIZE = 6;
const VOL = 0.58;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(MODERATE_SWORD_HIT_URL);
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

/**
 * Cut (field) contact on a wild Pokémon hurtbox center.
 * @param {{ x?: number, y?: number, z?: number } | null | undefined} worldPos
 */
export function playModerateSwordHitSfx(worldPos) {
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
  const wx = Number(worldPos?.x);
  const wy = Number(worldPos?.y);
  if (Number.isFinite(wx) && Number.isFinite(wy)) {
    setSpatialSourceWorldPosition(graph, wx, wy, Math.max(0, Number(worldPos?.z) || 0));
  } else {
    centerSpatialSourceOnListener(graph);
  }
  const playP = a.play();
  if (playP !== undefined && typeof playP.catch === 'function') playP.catch(() => {});
}
