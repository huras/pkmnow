export const playChunkMap = new Map();
const playChunkBakeQueue = [];
const playChunkBakeQueuedByKey = new Map();
let playChunkBakeQueueHead = 0;

let lastDataForCache = null;
let lastTileWForCache = 0;

function resetPlayChunkBakeQueue() {
  playChunkBakeQueue.length = 0;
  playChunkBakeQueuedByKey.clear();
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
export function enqueuePlayChunkBake(cx, cy, forceRebake = false) {
  const key = `${cx},${cy}`;
  const queuedForce = playChunkBakeQueuedByKey.get(key);
  if (queuedForce != null) {
    if (forceRebake && !queuedForce) {
      playChunkBakeQueuedByKey.set(key, true);
      return true;
    }
    return false;
  }
  if (!forceRebake && playChunkMap.has(key)) return false;
  if (forceRebake) {
    playChunkBakeQueue.splice(playChunkBakeQueueHead, 0, key);
  } else {
    playChunkBakeQueue.push(key);
  }
  playChunkBakeQueuedByKey.set(key, !!forceRebake);
  return true;
}

/**
 * Remove até `limit` chunks da fila.
 * @returns {Array<{ key: string, cx: number, cy: number, forceRebake: boolean }>}
 */
export function dequeuePlayChunkBakes(limit) {
  const cap = Math.max(0, Math.floor(limit));
  const out = [];
  while (out.length < cap && playChunkBakeQueueHead < playChunkBakeQueue.length) {
    const key = playChunkBakeQueue[playChunkBakeQueueHead++];
    const forceRebake = playChunkBakeQueuedByKey.get(key);
    if (forceRebake == null) continue;
    playChunkBakeQueuedByKey.delete(key);
    const [cxRaw, cyRaw] = key.split(',');
    const cx = Number(cxRaw);
    const cy = Number(cyRaw);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    out.push({ key, cx, cy, forceRebake: !!forceRebake });
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
