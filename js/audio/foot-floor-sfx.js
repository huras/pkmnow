import {
  resumeSpatialAudioContext,
  wireSpatialMediaElement,
  setSpatialSourceWorldPosition,
  centerSpatialSourceOnListener
} from './spatial-audio.js';

const _footFloorResolved = new URL('../../audio/sfx/Foot Floor.wav', import.meta.url).href;
const FOOT_FLOOR_WAV_URL = _footFloorResolved.replace(/ /g, '%20');

/** World-tile distance traveled before one footstep sound. */
export const FOOT_FLOOR_TILES_PER_STEP = 1.25;

const POOL_SIZE = 8;
const FOOT_FLOOR_VOL = 0.55;

/** @type {HTMLAudioElement[] | null} */
let pool = null;

function ensurePool() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(FOOT_FLOOR_WAV_URL);
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
export function playFootFloorSfx(source) {
  const a = borrowAudio();
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  a.volume = FOOT_FLOOR_VOL;
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
 * One `Foot Floor.wav` each time accumulated travel reaches `FOOT_FLOOR_TILES_PER_STEP` tiles while `active`.
 * @param {{ _footstepAccTiles?: number }} state
 * @param {number} distTiles
 * @param {boolean} active
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function advanceFootFloorStepsForDistance(state, distTiles, active, source) {
  if (!active) {
    state._footstepAccTiles = 0;
    return;
  }
  const d = Math.max(0, distTiles);
  if (d <= 1e-8) return;
  let acc = (state._footstepAccTiles || 0) + d;
  while (acc >= FOOT_FLOOR_TILES_PER_STEP) {
    playFootFloorSfx(source);
    acc -= FOOT_FLOOR_TILES_PER_STEP;
  }
  state._footstepAccTiles = acc;
}
