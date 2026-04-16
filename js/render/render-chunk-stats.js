let lastPlayChunkFrameStats = {
  mode: 'idle',
  totalVisible: 0,
  drawnVisible: 0,
  missingVisible: 0,
  bakedThisFrame: 0,
  bakeBudget: 0,
  bakeBoost: 0,
  queueSize: 0
};
let playChunkBakeBoost = 0;
let playChunkBakeStableFrames = 0;

export function resetPlayChunkBakeAutoTuner() {
  playChunkBakeBoost = 0;
  playChunkBakeStableFrames = 0;
}

export function getAdaptivePlayChunkBakeBudget({
  lodDetail,
  cachedVisibleChunks,
  missingVisibleChunks,
  queueSize,
  totalVisibleChunks
}) {
  let budget = lodDetail >= 2 ? 1 : 2;
  if (cachedVisibleChunks === 0 && missingVisibleChunks > 0) budget = Math.max(budget, 8);
  else if (missingVisibleChunks >= 10) budget = Math.max(budget, 4);
  if (queueSize >= 48) budget = Math.max(budget, 3);

  const severeMissing = Math.max(10, Math.floor(totalVisibleChunks * 0.45));
  const severeQueue = queueSize >= 96;
  const mediumPressure = missingVisibleChunks >= 6 || queueSize >= 36;
  const highPressure = missingVisibleChunks >= severeMissing || severeQueue;
  const coldStart = cachedVisibleChunks === 0 && missingVisibleChunks > 0;
  const steadyState = missingVisibleChunks === 0 && queueSize === 0;

  if (coldStart) playChunkBakeBoost = Math.max(playChunkBakeBoost, 6);
  if (highPressure) playChunkBakeBoost = Math.min(8, playChunkBakeBoost + 2);
  else if (mediumPressure) playChunkBakeBoost = Math.min(8, playChunkBakeBoost + 1);

  if (steadyState) {
    playChunkBakeStableFrames++;
    if (playChunkBakeStableFrames >= 10 && playChunkBakeBoost > 0) {
      playChunkBakeBoost -= 1;
      playChunkBakeStableFrames = 0;
    }
  } else {
    playChunkBakeStableFrames = 0;
    if (!mediumPressure && playChunkBakeBoost > 0) {
      playChunkBakeBoost -= 1;
    }
  }

  budget = Math.max(budget, budget + playChunkBakeBoost);
  return Math.min(12, Math.max(1, budget));
}

export function getPlayChunkFrameStats() {
  return lastPlayChunkFrameStats;
}

export function setLastPlayChunkFrameStats(stats) {
  lastPlayChunkFrameStats = stats;
}

export function getPlayChunkBakeBoost() {
  return playChunkBakeBoost;
}
