import { RENDER_FRAME_PHASE_KEYS } from '../render/render-frame-phases.js';

const PERF_WINDOW_MS = 12000;
const PERF_WARMUP_MS = 2500;

/** @typedef {Record<string, number>} RenderPhaseBreakdown */

/** @type {Array<{
 *   t: number,
 *   frameMs: number,
 *   updateMs: number,
 *   renderMs: number,
 *   updPlayerMs: number,
 *   updWildWindowMs: number,
 *   updWildMs: number,
 *   updWildMiscMs: number,
 *   updWildVerticalMs: number,
 *   updWildSocialMs: number,
 *   updWildMotionMs: number,
 *   updWildPostMs: number,
 *   updPointerMs: number,
 *   updMovesMs: number,
 *   updGrassFireMs: number,
 *   updBgmMs: number,
 *   updHudMs: number
 * } & RenderPhaseBreakdown>} */
const samples = [];
let warmupCutoffAt = 0;

function trimSamples(now) {
  const cutoff = now - PERF_WINDOW_MS;
  while (samples.length && samples[0].t < cutoff) samples.shift();
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * p)));
  return sortedValues[idx];
}

function toSorted(list, pick) {
  const values = list.map(pick).filter((v) => Number.isFinite(v));
  values.sort((a, b) => a - b);
  return values;
}

function safeFpsFromFrameMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0.0001) return 0;
  return 1000 / ms;
}

/**
 * @param {number} frameMs
 * @param {number} updateMs
 * @param {number} renderMs
 * @param {number} now
 * @param {{
 *   updPlayerMs?: number,
 *   updWildWindowMs?: number,
 *   updWildMs?: number,
 *   updWildMiscMs?: number,
 *   updWildVerticalMs?: number,
 *   updWildSocialMs?: number,
 *   updWildMotionMs?: number,
 *   updWildPostMs?: number,
 *   updPointerMs?: number,
 *   updMovesMs?: number,
 *   updGrassFireMs?: number,
 *   updBgmMs?: number,
 *   updHudMs?: number
 * }} [updateBreakdown]
 * @param {RenderPhaseBreakdown} [renderBreakdown] Phase timings from the same frame as `renderMs` (see render-frame-phases).
 * @returns {{
 *   frameCount: number,
 *   stableFrameCount: number,
 *   stableRatio01: number,
 *   p50FrameMs: number,
 *   p95FrameMs: number,
 *   p50Fps: number,
 *   p95FrameMsStable: number,
 *   p95UpdateMsStable: number,
 *   p95RenderMsStable: number,
 *   p95UpdPlayerMsStable: number,
 *   p95UpdWildWindowMsStable: number,
 *   p95UpdWildMsStable: number,
 *   p95UpdWildMiscMsStable: number,
 *   p95UpdWildVerticalMsStable: number,
 *   p95UpdWildSocialMsStable: number,
 *   p95UpdWildMotionMsStable: number,
 *   p95UpdWildPostMsStable: number,
 *   p95UpdPointerMsStable: number,
 *   p95UpdMovesMsStable: number,
 *   p95UpdGrassFireMsStable: number,
 *   p95UpdBgmMsStable: number,
 *   p95UpdHudMsStable: number,
 *   renderP95Stable: RenderPhaseBreakdown
 * }}
 */
export function ingestPlayPerfSample(
  frameMs,
  updateMs,
  renderMs,
  now = performance.now(),
  updateBreakdown = {},
  renderBreakdown = {}
) {
  /** @type {typeof samples[number]} */
  const row = {
    t: now,
    frameMs,
    updateMs,
    renderMs,
    updPlayerMs: updateBreakdown.updPlayerMs ?? 0,
    updWildWindowMs: updateBreakdown.updWildWindowMs ?? 0,
    updWildMs: updateBreakdown.updWildMs ?? 0,
    updWildMiscMs: updateBreakdown.updWildMiscMs ?? 0,
    updWildVerticalMs: updateBreakdown.updWildVerticalMs ?? 0,
    updWildSocialMs: updateBreakdown.updWildSocialMs ?? 0,
    updWildMotionMs: updateBreakdown.updWildMotionMs ?? 0,
    updWildPostMs: updateBreakdown.updWildPostMs ?? 0,
    updPointerMs: updateBreakdown.updPointerMs ?? 0,
    updMovesMs: updateBreakdown.updMovesMs ?? 0,
    updGrassFireMs: updateBreakdown.updGrassFireMs ?? 0,
    updBgmMs: updateBreakdown.updBgmMs ?? 0,
    updHudMs: updateBreakdown.updHudMs ?? 0
  };
  for (const k of RENDER_FRAME_PHASE_KEYS) {
    row[k] = renderBreakdown[k] ?? 0;
  }
  samples.push(row);
  trimSamples(now);

  const stable = samples.filter((s) => s.t >= warmupCutoffAt);
  const frameMsSorted = toSorted(samples, (s) => s.frameMs);
  const stableFrameMsSorted = toSorted(stable, (s) => s.frameMs);
  const stableUpdateSorted = toSorted(stable, (s) => s.updateMs);
  const stableRenderSorted = toSorted(stable, (s) => s.renderMs);
  const stableUpdPlayerSorted = toSorted(stable, (s) => s.updPlayerMs);
  const stableUpdWildWindowSorted = toSorted(stable, (s) => s.updWildWindowMs);
  const stableUpdWildSorted = toSorted(stable, (s) => s.updWildMs);
  const stableUpdWildMiscSorted = toSorted(stable, (s) => s.updWildMiscMs);
  const stableUpdWildVerticalSorted = toSorted(stable, (s) => s.updWildVerticalMs);
  const stableUpdWildSocialSorted = toSorted(stable, (s) => s.updWildSocialMs);
  const stableUpdWildMotionSorted = toSorted(stable, (s) => s.updWildMotionMs);
  const stableUpdWildPostSorted = toSorted(stable, (s) => s.updWildPostMs);
  const stableUpdPointerSorted = toSorted(stable, (s) => s.updPointerMs);
  const stableUpdMovesSorted = toSorted(stable, (s) => s.updMovesMs);
  const stableUpdGrassFireSorted = toSorted(stable, (s) => s.updGrassFireMs);
  const stableUpdBgmSorted = toSorted(stable, (s) => s.updBgmMs);
  const stableUpdHudSorted = toSorted(stable, (s) => s.updHudMs);

  /** @type {RenderPhaseBreakdown} */
  const renderP95Stable = {};
  for (const k of RENDER_FRAME_PHASE_KEYS) {
    renderP95Stable[k] = percentile(toSorted(stable, (s) => s[k] ?? 0), 0.95);
  }

  const p50FrameMs = percentile(frameMsSorted, 0.5);
  const p95FrameMs = percentile(frameMsSorted, 0.95);
  const p95FrameMsStable = percentile(stableFrameMsSorted, 0.95);

  return {
    frameCount: samples.length,
    stableFrameCount: stable.length,
    stableRatio01: samples.length > 0 ? stable.length / samples.length : 0,
    p50FrameMs,
    p95FrameMs,
    p50Fps: safeFpsFromFrameMs(p50FrameMs),
    p95FrameMsStable,
    p95UpdateMsStable: percentile(stableUpdateSorted, 0.95),
    p95RenderMsStable: percentile(stableRenderSorted, 0.95),
    p95UpdPlayerMsStable: percentile(stableUpdPlayerSorted, 0.95),
    p95UpdWildWindowMsStable: percentile(stableUpdWildWindowSorted, 0.95),
    p95UpdWildMsStable: percentile(stableUpdWildSorted, 0.95),
    p95UpdWildMiscMsStable: percentile(stableUpdWildMiscSorted, 0.95),
    p95UpdWildVerticalMsStable: percentile(stableUpdWildVerticalSorted, 0.95),
    p95UpdWildSocialMsStable: percentile(stableUpdWildSocialSorted, 0.95),
    p95UpdWildMotionMsStable: percentile(stableUpdWildMotionSorted, 0.95),
    p95UpdWildPostMsStable: percentile(stableUpdWildPostSorted, 0.95),
    p95UpdPointerMsStable: percentile(stableUpdPointerSorted, 0.95),
    p95UpdMovesMsStable: percentile(stableUpdMovesSorted, 0.95),
    p95UpdGrassFireMsStable: percentile(stableUpdGrassFireSorted, 0.95),
    p95UpdBgmMsStable: percentile(stableUpdBgmSorted, 0.95),
    p95UpdHudMsStable: percentile(stableUpdHudSorted, 0.95),
    renderP95Stable
  };
}

export function resetPlayPerfProfiler() {
  samples.length = 0;
  warmupCutoffAt = performance.now() + PERF_WARMUP_MS;
}
