export const playChunkMap = new Map();
const playChunkBakeQueue = [];
const playChunkBakeQueuedByKey = new Map();
let playChunkBakeQueueHead = 0;
const playChunkLastUsedTickByKey = new Map();
let playChunkUseTick = 1;
let playChunkCacheRevision = 1;

/** Soft safety cap to avoid unbounded memory growth in long sessions. */
export const PLAY_CHUNK_CACHE_MAX_ENTRIES = 512;
/** Keep a warm ring around current player chunk to reduce rebake thrash. */
export const PLAY_CHUNK_CACHE_KEEP_RING_RADIUS = 10;

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

function touchPlayChunkKey(key) {
  playChunkLastUsedTickByKey.set(key, playChunkUseTick++);
}

function bumpPlayChunkCacheRevision() {
  playChunkCacheRevision++;
}

function dropPlayChunkByKey(key) {
  playChunkMap.delete(key);
  playChunkLastUsedTickByKey.delete(key);
  bumpPlayChunkCacheRevision();
}

/** @param {string} key */
export function hasPlayChunk(key) {
  const hit = playChunkMap.has(key);
  if (hit) touchPlayChunkKey(key);
  return hit;
}

/** @param {string} key */
export function getPlayChunk(key) {
  const v = playChunkMap.get(key);
  if (v) touchPlayChunkKey(key);
  return v;
}

/**
 * @param {string} key
 * @param {{ canvas: HTMLCanvasElement, suppressedSet: Set<number> }} chunk
 */
export function setPlayChunk(key, chunk) {
  // Parse cx/cy once here so prunePlayChunkCache never needs to split strings.
  const [cxRaw, cyRaw] = key.split(',');
  const cx = Number(cxRaw);
  const cy = Number(cyRaw);
  const w = chunk.canvas.width;
  const h = chunk.canvas.height;
  /** @type {{ canvas: HTMLCanvasElement, bitmap: ImageBitmap|null, suppressedSet: Set<number>, w: number, h: number, cx: number, cy: number }} */
  const entry = { canvas: chunk.canvas, bitmap: null, suppressedSet: chunk.suppressedSet, w, h, cx, cy };
  playChunkMap.set(key, entry);
  touchPlayChunkKey(key);
  bumpPlayChunkCacheRevision();
  // Async GPU upload: after the first frame (canvas draw), all subsequent frames use
  // the ImageBitmap which is a zero-copy GPU blit — no pixel re-upload per frame.
  if (typeof createImageBitmap === 'function') {
    createImageBitmap(chunk.canvas).then((bmp) => {
      // Only attach if the chunk is still the same entry (not evicted and re-baked).
      const current = playChunkMap.get(key);
      if (current === entry) current.bitmap = bmp;
    }).catch(() => { /* fall back to canvas draw silently */ });
  }
}

export function clearPlayChunkCache() {
  playChunkMap.clear();
  playChunkLastUsedTickByKey.clear();
  bumpPlayChunkCacheRevision();
}

export function getPlayChunkCacheRevision() {
  return playChunkCacheRevision;
}

/**
 * Evicts old/far chunks to keep memory bounded.
 * @param {{
 *   maxEntries?: number,
 *   keepKeys?: Iterable<string>,
 *   centerCx?: number,
 *   centerCy?: number,
 *   keepRingRadius?: number
 * }} opts
 * @returns {number} removed entries count
 */
export function prunePlayChunkCache(opts = {}) {
  const maxEntries = Math.max(1, Math.floor(opts.maxEntries ?? PLAY_CHUNK_CACHE_MAX_ENTRIES));
  if (playChunkMap.size <= maxEntries) return 0;

  const keepSet = new Set(opts.keepKeys || []);
  const centerCx = Number.isFinite(opts.centerCx) ? Number(opts.centerCx) : null;
  const centerCy = Number.isFinite(opts.centerCy) ? Number(opts.centerCy) : null;
  const keepRingRadius = Math.max(0, Math.floor(opts.keepRingRadius ?? PLAY_CHUNK_CACHE_KEEP_RING_RADIUS));

  const candidates = [];
  for (const [key, entry] of playChunkMap.entries()) {
    if (keepSet.has(key)) continue;
    // cx/cy stored in the entry at bake time — no string parsing needed.
    const cx = entry.cx;
    const cy = entry.cy;
    const hasCenter = centerCx != null && centerCy != null && Number.isFinite(cx) && Number.isFinite(cy);
    const dist = hasCenter ? Math.abs(cx - centerCx) + Math.abs(cy - centerCy) : -1;
    if (hasCenter && dist <= keepRingRadius) continue;
    const lastUsed = playChunkLastUsedTickByKey.get(key) ?? -1;
    candidates.push({ key, dist, lastUsed });
  }

  candidates.sort((a, b) => {
    if (a.dist !== b.dist) return b.dist - a.dist; // farthest first
    return a.lastUsed - b.lastUsed; // oldest first
  });

  let removed = 0;
  for (const c of candidates) {
    if (playChunkMap.size <= maxEntries) break;
    dropPlayChunkByKey(c.key);
    removed++;
  }
  return removed;
}

/**
 * Enfileira um chunk para bake em orçamento futuro de frame.
 * @param {boolean} [forceRebake=false] se true, invalida cache e força re-geração.
 * @param {boolean} [highPriority=false] se true, coloca no início da fila (para chunks visíveis).
 * @returns {boolean} true se foi enfileirado agora.
 */
export function enqueuePlayChunkBake(cx, cy, forceRebake = false, highPriority = false) {
  const key = `${cx},${cy}`;
  const queuedForce = playChunkBakeQueuedByKey.get(key);
  if (queuedForce != null) {
    // Se já está na fila mas queremos aumentar prioridade ou forçar rebake
    if ((forceRebake && !queuedForce) || (highPriority && !forceRebake)) {
       // Simplificação: não movemos na fila se já está lá, mas o flag forceRebake no map
       // guardará o estado mais agressivo solicitado.
       if (forceRebake) playChunkBakeQueuedByKey.set(key, true);
       return true;
    }
    return false;
  }
  if (!forceRebake && hasPlayChunk(key)) return false;
  
  if (forceRebake || highPriority) {
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
    clearPlayChunkCache();
    resetPlayChunkBakeQueue();
    lastDataForCache = data;
    lastTileWForCache = tileW;
    return true;
  }
  return false;
}
