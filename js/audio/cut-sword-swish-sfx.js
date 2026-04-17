import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const _moderateResolved = new URL('../../audio/sfx/Link- Moderate Sword Swish.wav', import.meta.url).href;
const MODERATE_SWISH_URL = _moderateResolved.replace(/ /g, '%20');

const _strongResolved = new URL('../../audio/sfx/Link - Strong Sword Whish.wav', import.meta.url).href;
const STRONG_SWISH_URL = _strongResolved.replace(/ /g, '%20');

const POOL_SIZE = 4;
const CUT_SWISH_VOL = 0.58;

/** @type {HTMLAudioElement[] | null} */
let poolModerate = null;
/** @type {HTMLAudioElement[] | null} */
let poolStrong = null;

function ensurePoolModerate() {
  if (!poolModerate) {
    poolModerate = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(MODERATE_SWISH_URL);
      a.preload = 'auto';
      poolModerate.push(a);
    }
  }
  return poolModerate;
}

function ensurePoolStrong() {
  if (!poolStrong) {
    poolStrong = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(STRONG_SWISH_URL);
      a.preload = 'auto';
      poolStrong.push(a);
    }
  }
  return poolStrong;
}

function borrowFromPool(pool) {
  for (const a of pool) {
    if (a.paused || a.ended) return a;
  }
  return pool[0];
}

function playFromPool(pool, source) {
  const a = borrowFromPool(pool);
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = CUT_SWISH_VOL;
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
 * Field Cut combo: hits 1–2 = moderate swish; hit 3 = strong swish.
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 * @param {number} comboStep 1..3
 */
export function playCutComboSwordSwishSfx(source, comboStep) {
  const step = Math.floor(Number(comboStep) || 0);
  if (step === 3) {
    playFromPool(ensurePoolStrong(), source);
  } else if (step === 1 || step === 2) {
    playFromPool(ensurePoolModerate(), source);
  }
}
