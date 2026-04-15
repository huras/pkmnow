export const playChunkMap = new Map();
const playChunkBakeQueue = [];
const playChunkBakeQueuedKeys = new Set();
let playChunkBakeQueueHead = 0;

let lastDataForCache = null;
let lastTileWForCache = 0;

function resetPlayChunkBakeQueue() {
  playChunkBakeQueue.length = 0;
  playChunkBakeQueuedKeys.clear();
  playChunkBakeQueueHead = 0;
}

function compactPlayChunkBakeQueueIfNeeded() {
  if (playChunkBakeQueueHead < 512) return;
  if (playChunkBakeQueueHead * 2 < playChunkBakeQueue.length) return;
  playChunkBakeQueue.splice(0, playChunkBakeQueueHead);
  playChunkBakeQueueHead = 0;
}

/**
 * Enfileira um chunk para bake em orçamento futuro de frame.
 * @returns {boolean} true se foi enfileirado agora.
 */
export function enqueuePlayChunkBake(cx, cy) {
  const key = `${cx},${cy}`;
  if (playChunkMap.has(key) || playChunkBakeQueuedKeys.has(key)) return false;
  playChunkBakeQueue.push(key);
  playChunkBakeQueuedKeys.add(key);
  return true;
}

/**
 * Remove até `limit` chunks da fila.
 * @returns {Array<{ key: string, cx: number, cy: number }>}
 */
export function dequeuePlayChunkBakes(limit) {
  const cap = Math.max(0, Math.floor(limit));
  const out = [];
  while (out.length < cap && playChunkBakeQueueHead < playChunkBakeQueue.length) {
    const key = playChunkBakeQueue[playChunkBakeQueueHead++];
    if (!playChunkBakeQueuedKeys.delete(key)) continue;
    const [cxRaw, cyRaw] = key.split(',');
    const cx = Number(cxRaw);
    const cy = Number(cyRaw);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    out.push({ key, cx, cy });
  }
  compactPlayChunkBakeQueueIfNeeded();
  return out;
}

export function getPlayChunkBakeQueueSize() {
  return playChunkBakeQueue.length - playChunkBakeQueueHead;
}

/**
 * Invalida o cache global de blocos se os dados básicos (mapa ou escala) mudarem.
 * @returns {boolean} true se o cache foi limpo (novo mapa / escala).
 */
export function syncPlayChunkCache(data, tileW, appMode) {
  if (appMode !== 'play' || data !== lastDataForCache || tileW !== lastTileWForCache) {
    playChunkMap.clear();
    resetPlayChunkBakeQueue();
    lastDataForCache = data;
    lastTileWForCache = tileW;
    return true;
  }
  return false;
}
