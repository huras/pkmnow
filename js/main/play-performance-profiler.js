const PERF_WINDOW_MS = 12000;
const PERF_WARMUP_MS = 2500;

/** @type {Array<{
 *   t: number,
 *   frameMs: number,
 *   updateMs: number,
 *   renderMs: number,
 *   updPlayerMs: number,
 *   updWildWindowMs: number,
 *   updWildMs: number,
 *   updPointerMs: number,
 *   updMovesMs: number,
 *   updGrassFireMs: number,
 *   updBgmMs: number,
 *   updHudMs: number
 * }>} */
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
 *   updPointerMs?: number,
 *   updMovesMs?: number,
 *   updGrassFireMs?: number,
 *   updBgmMs?: number,
 *   updHudMs?: number
 * }} [updateBreakdown]
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
 *   p95UpdPointerMsStable: number,
 *   p95UpdMovesMsStable: number,
 *   p95UpdGrassFireMsStable: number,
 *   p95UpdBgmMsStable: number,
 *   p95UpdHudMsStable: number
 * }}
 */
export function ingestPlayPerfSample(frameMs, updateMs, renderMs, now = performance.now(), updateBreakdown = {}) {
  samples.push({
    t: now,
    frameMs,
    updateMs,
    renderMs,
    updPlayerMs: updateBreakdown.updPlayerMs ?? 0,
    updWildWindowMs: updateBreakdown.updWildWindowMs ?? 0,
    updWildMs: updateBreakdown.updWildMs ?? 0,
    updPointerMs: updateBreakdown.updPointerMs ?? 0,
    updMovesMs: updateBreakdown.updMovesMs ?? 0,
    updGrassFireMs: updateBreakdown.updGrassFireMs ?? 0,
    updBgmMs: updateBreakdown.updBgmMs ?? 0,
    updHudMs: updateBreakdown.updHudMs ?? 0
  });
  trimSamples(now);

  const stable = samples.filter((s) => s.t >= warmupCutoffAt);
  const frameMsSorted = toSorted(samples, (s) => s.frameMs);
  const stableFrameMsSorted = toSorted(stable, (s) => s.frameMs);
  const stableUpdateSorted = toSorted(stable, (s) => s.updateMs);
  const stableRenderSorted = toSorted(stable, (s) => s.renderMs);
  const stableUpdPlayerSorted = toSorted(stable, (s) => s.updPlayerMs);
  const stableUpdWildWindowSorted = toSorted(stable, (s) => s.updWildWindowMs);
  const stableUpdWildSorted = toSorted(stable, (s) => s.updWildMs);
  const stableUpdPointerSorted = toSorted(stable, (s) => s.updPointerMs);
  const stableUpdMovesSorted = toSorted(stable, (s) => s.updMovesMs);
  const stableUpdGrassFireSorted = toSorted(stable, (s) => s.updGrassFireMs);
  const stableUpdBgmSorted = toSorted(stable, (s) => s.updBgmMs);
  const stableUpdHudSorted = toSorted(stable, (s) => s.updHudMs);

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
    p95UpdPointerMsStable: percentile(stableUpdPointerSorted, 0.95),
    p95UpdMovesMsStable: percentile(stableUpdMovesSorted, 0.95),
    p95UpdGrassFireMsStable: percentile(stableUpdGrassFireSorted, 0.95),
    p95UpdBgmMsStable: percentile(stableUpdBgmSorted, 0.95),
    p95UpdHudMsStable: percentile(stableUpdHudSorted, 0.95)
  };
}

export function resetPlayPerfProfiler() {
  samples.length = 0;
  warmupCutoffAt = performance.now() + PERF_WARMUP_MS;
}
