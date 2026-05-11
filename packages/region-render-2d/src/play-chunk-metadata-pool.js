const DEFAULT_WORKER_COUNT = 2;
const MAX_WORKER_COUNT = 2;
const QUEUE_SOFT_LIMIT = 96;
const QUEUE_HARD_LIMIT = 180;

let workers = [];
let metadataRevision = 1;
let lastDataRef = null;
let poolEnabled = true;

let nextJobId = 1;
const pendingByKey = new Map();
const queuedByKey = new Set();
const queue = [];
const readyByKey = new Map();
const partialByKey = new Map();
let workerIngestMsAccum = 0;

function resolveWorkerCount() {
  const hc = Number(globalThis.navigator?.hardwareConcurrency) || 0;
  if (!Number.isFinite(hc) || hc <= 0) return DEFAULT_WORKER_COUNT;
  return Math.max(DEFAULT_WORKER_COUNT, Math.min(MAX_WORKER_COUNT, Math.floor(hc / 2)));
}

function clearTransientState() {
  pendingByKey.clear();
  queuedByKey.clear();
  queue.length = 0;
  readyByKey.clear();
  partialByKey.clear();
}

function terminateWorkers() {
  for (const w of workers) {
    try { w.worker.terminate(); } catch { /* ignore */ }
  }
  workers = [];
}

function createWorkerSlot() {
  const worker = new Worker(
    new URL('../workers/play-chunk-metadata-worker.js', import.meta.url),
    { type: 'module' }
  );
  const slot = { worker, busy: false, key: '' };
  worker.onmessage = (ev) => {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const msg = ev.data || {};
    if (msg.type !== 'result_chunk') return;
    slot.busy = false;
    slot.key = '';
    const key = String(msg.key || '');
    const pending = pendingByKey.get(key);
    if (pending && pending.jobId === Number(msg.jobId) && pending.revision === Number(msg.revision)) {
      const totalChunks = Math.max(1, Number(msg.totalChunks) || 1);
      const chunkIndex = Math.max(0, Number(msg.chunkIndex) || 0);
      const partial = partialByKey.get(key) || {
        totalChunks,
        received: 0,
        tileEntries: [],
        roleEntries: null,
        scatterOriginEntries: null,
        clumpSuppressionLocalKeys: null,
        formalTreeRootEntries: null,
        scatterCandidateEntries: null
      };
      if (Array.isArray(msg.tileEntries)) partial.tileEntries.push(...msg.tileEntries);
      if (chunkIndex === 0) {
        partial.roleEntries = Array.isArray(msg.roleEntries) ? msg.roleEntries : null;
        partial.scatterOriginEntries = Array.isArray(msg.scatterOriginEntries) ? msg.scatterOriginEntries : null;
        partial.clumpSuppressionLocalKeys = Array.isArray(msg.clumpSuppressionLocalKeys) ? msg.clumpSuppressionLocalKeys : null;
        partial.formalTreeRootEntries = Array.isArray(msg.formalTreeRootEntries) ? msg.formalTreeRootEntries : null;
        partial.scatterCandidateEntries = Array.isArray(msg.scatterCandidateEntries) ? msg.scatterCandidateEntries : null;
      }
      partial.received += 1;
      partialByKey.set(key, partial);
      if (partial.received >= partial.totalChunks) {
        pendingByKey.delete(key);
        partialByKey.delete(key);
        readyByKey.set(key, {
          tileEntries: partial.tileEntries,
          roleEntries: partial.roleEntries,
          scatterOriginEntries: partial.scatterOriginEntries,
          clumpSuppressionLocalKeys: partial.clumpSuppressionLocalKeys,
          formalTreeRootEntries: partial.formalTreeRootEntries,
          scatterCandidateEntries: partial.scatterCandidateEntries,
          revision: pending.revision
        });
      }
    }
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    workerIngestMsAccum += Math.max(0, t1 - t0);
    pumpPlayChunkMetadataWorkers();
  };
  worker.onerror = () => {
    poolEnabled = false;
    clearTransientState();
    terminateWorkers();
  };
  workers.push(slot);
  try {
    worker.postMessage({ type: 'setData', revision: metadataRevision, data: lastDataRef });
  } catch {
    poolEnabled = false;
  }
}

function ensureWorkers() {
  if (!poolEnabled || typeof Worker === 'undefined') return false;
  if (workers.length > 0) return true;
  const count = resolveWorkerCount();
  for (let i = 0; i < count; i++) createWorkerSlot();
  return workers.length > 0;
}

function bumpRevisionAndBroadcastData(data) {
  metadataRevision += 1;
  clearTransientState();
  lastDataRef = data;
  if (!ensureWorkers()) return;
  for (const slot of workers) {
    slot.busy = false;
    slot.key = '';
    try {
      slot.worker.postMessage({ type: 'setData', revision: metadataRevision, data: lastDataRef });
    } catch {
      poolEnabled = false;
      clearTransientState();
      terminateWorkers();
      return;
    }
  }
}

export function syncPlayChunkMetadataPool(data, appMode) {
  if (appMode !== 'play') {
    clearTransientState();
    return;
  }
  if (data !== lastDataRef) bumpRevisionAndBroadcastData(data);
  else ensureWorkers();
}

export function enqueuePlayChunkMetadata(cx, cy, highPriority = false) {
  if (!poolEnabled || !ensureWorkers()) return false;
  if (!highPriority && queue.length >= QUEUE_HARD_LIMIT) return false;
  const key = `${cx},${cy}`;
  if (readyByKey.has(key) || pendingByKey.has(key) || queuedByKey.has(key)) return false;
  queuedByKey.add(key);
  const item = { key, cx, cy, highPriority: !!highPriority };
  if (highPriority) queue.unshift(item);
  else queue.push(item);
  return true;
}

export function pumpPlayChunkMetadataWorkers() {
  if (!poolEnabled || !ensureWorkers()) return;
  for (const slot of workers) {
    if (slot.busy) continue;
    const job = queue.shift();
    if (!job) break;
    queuedByKey.delete(job.key);
    const jobId = nextJobId++;
    pendingByKey.set(job.key, { jobId, revision: metadataRevision });
    slot.busy = true;
    slot.key = job.key;
    const pressure = queue.length + pendingByKey.size;
    let precomputeProfile = 'full';
    if (!job.highPriority && pressure >= QUEUE_SOFT_LIMIT) precomputeProfile = 'core-only';
    else if (!job.highPriority && pressure >= Math.floor(QUEUE_SOFT_LIMIT * 0.55)) precomputeProfile = 'roles-lite';
    try {
      slot.worker.postMessage({
        type: 'compute',
        jobId,
        revision: metadataRevision,
        key: job.key,
        cx: job.cx,
        cy: job.cy,
        precomputeProfile
      });
    } catch {
      slot.busy = false;
      slot.key = '';
      pendingByKey.delete(job.key);
    }
  }
}

export function takeReadyPlayChunkMetadata(key) {
  const v = readyByKey.get(key);
  if (!v) return null;
  readyByKey.delete(key);
  if (v.revision !== metadataRevision) return null;
  return {
    tileEntries: v.tileEntries,
    roleEntries: v.roleEntries,
    scatterOriginEntries: v.scatterOriginEntries,
    clumpSuppressionLocalKeys: v.clumpSuppressionLocalKeys,
    formalTreeRootEntries: v.formalTreeRootEntries,
    scatterCandidateEntries: v.scatterCandidateEntries
  };
}

export function consumePlayChunkMetadataIngestMs() {
  const v = workerIngestMsAccum;
  workerIngestMsAccum = 0;
  return v;
}
