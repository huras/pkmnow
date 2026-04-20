/**
 * Per-frame Canvas2D render phase timings for play-mode perf HUD (ingested by play-performance-profiler).
 * All durations are milliseconds; phases are mutually exclusive slices inside {@link import('../render.js').render}.
 */

/** Keys stored on each perf sample (excluding gap, which is derived at finalize). */
export const RENDER_FRAME_PHASE_KEYS = Object.freeze([
  'rndPrepMs',
  'rndMapMs',
  'rndCamMs',
  'rndChunkQMs',
  'rndChunkBakeMs',
  'rndChunkDrawMs',
  'rndTileWarmMs',
  'rndOceanMs',
  'rndGrassMs',
  'rndCollectMs',
  'rndEntitiesMs',
  'rndGrassDeferMs',
  'rndDebugMs',
  'rndWeatherMs',
  'rndVolumetricWeatherMs',
  'rndMinimapMs',
  'rndHoverMs',
  'rndGapMs'
]);

/** @type {Record<string, number>} */
let accum = createZeroBreakdown();

/** Last finalized breakdown (stable for game-loop reads after each `render()`). */
/** @type {Record<string, number>} */
let lastBreakdown = createZeroBreakdown();

function createZeroBreakdown() {
  /** @type {Record<string, number>} */
  const o = {};
  for (const k of RENDER_FRAME_PHASE_KEYS) o[k] = 0;
  return o;
}

/**
 * @param {string} appMode
 */
export function beginRenderFrameProfile(appMode) {
  void appMode;
  accum = createZeroBreakdown();
}

/**
 * @param {string} key
 * @param {number} ms
 */
export function addRenderFramePhaseMs(key, ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  if (!(key in accum)) accum[key] = 0;
  accum[key] += ms;
}

/**
 * @template T
 * @param {string} key
 * @param {() => T} fn
 * @returns {T}
 */
export function renderPhaseMs(key, fn) {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    addRenderFramePhaseMs(key, performance.now() - t0);
  }
}

/**
 * @param {number} totalMs wall time for the whole `render()` body
 * @returns {Record<string, number>}
 */
export function finalizeRenderFrameProfile(totalMs) {
  const sumPhases = RENDER_FRAME_PHASE_KEYS.filter((k) => k !== 'rndGapMs').reduce((s, k) => s + (accum[k] ?? 0), 0);
  const gap = Math.max(0, totalMs - sumPhases);
  accum.rndGapMs = gap;
  lastBreakdown = { ...accum };
  return lastBreakdown;
}

export function getLastRenderFrameBreakdown() {
  return lastBreakdown;
}

export function clearRenderFrameBreakdown() {
  accum = createZeroBreakdown();
  lastBreakdown = createZeroBreakdown();
}

/** Short HUD labels for `rnd top` (play FPS bar). */
export const RENDER_FRAME_PHASE_HUD_LABELS = Object.freeze(
  /** @type {Record<string, string>} */ ({
    rndPrepMs: 'pre',
    rndMapMs: 'map',
    rndCamMs: 'cam',
    rndChunkQMs: 'cq',
    rndChunkBakeMs: 'bbk',
    rndChunkDrawMs: 'cdr',
    rndTileWarmMs: 'tw',
    rndOceanMs: 'sea',
    rndGrassMs: 'veg',
    rndCollectMs: 'col',
    rndEntitiesMs: 'ent',
    rndGrassDeferMs: 'gd',
    rndDebugMs: 'dbg',
    rndWeatherMs: 'wx',
    rndVolumetricWeatherMs: 'vol',
    rndMinimapMs: 'mm',
    rndHoverMs: 'hov',
    rndGapMs: 'gap'
  })
);
