/**
 * @fileoverview Infinite biome painter store. Biomes live in fixed-size chunks
 * (32x32 macro tiles) indexed by integer chunk coords (negatives allowed).
 * Unset cells default to OCEAN. Chunks that contain only OCEAN are dropped from
 * the in-memory Map when fully reset, and skipped when serializing to JSON.
 *
 * Coordinate vocabulary used everywhere in this module:
 *  - macroX / macroY: absolute macro tile coords across the infinite map (any int).
 *  - chunkCX / chunkCY: integer chunk coords (macroX = chunkCX * CHUNK_SIZE + offX).
 *  - chunkKey: "cx,cy" string used as Map key.
 *
 * Listeners receive a Set of chunkKey strings that changed since the last
 * notify so consumers (bake cache, autosave) can react with minimum work.
 */

import { BIOMES } from 'region-map-gen/biomes.js';

export const CHUNK_SIZE = 32;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const STORAGE_KEY = 'hoenn-editor-v2';
export const DEFAULT_BIOME_ID = BIOMES.OCEAN.id;

/** Local int key for a chunk: avoids string allocation in inner loops. */
function chunkLocalIdx(offX, offY) {
  return offY * CHUNK_SIZE + offX;
}

function chunkKey(cx, cy) {
  return `${cx},${cy}`;
}

function parseChunkKey(key) {
  const i = key.indexOf(',');
  return { cx: Number(key.slice(0, i)), cy: Number(key.slice(i + 1)) };
}

/** Floor division for negative-safe chunk math. */
function floorDiv(a, b) {
  return Math.floor(a / b);
}

function modPos(a, b) {
  return ((a % b) + b) % b;
}

export class EditorStore {
  constructor() {
    /** @type {Map<string, Uint8Array>} */
    this.chunks = new Map();
    this.seed = 'hoenn-editor';
    /** @type {Set<(dirtyKeys: Set<string>) => void>} */
    this._listeners = new Set();
    this._dirty = new Set();
    this._batchDepth = 0;
  }

  /** Begin a batched mutation: listeners only fire on `endBatch()`. */
  beginBatch() {
    this._batchDepth++;
  }

  endBatch() {
    if (this._batchDepth > 0) this._batchDepth--;
    if (this._batchDepth === 0) this._flushDirty();
  }

  /** Force-flush even outside an explicit batch (used internally). */
  _flushDirty() {
    if (this._dirty.size === 0) return;
    const snapshot = this._dirty;
    this._dirty = new Set();
    for (const cb of this._listeners) {
      try { cb(snapshot); } catch (e) { console.error('EditorStore listener threw', e); }
    }
  }

  /**
   * Subscribe to chunk-dirty notifications.
   * @param {(dirtyKeys: Set<string>) => void} cb
   * @returns {() => void} unsubscribe
   */
  onChunksDirty(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  _markDirty(key) {
    this._dirty.add(key);
    if (this._batchDepth === 0) this._flushDirty();
  }

  /** Compute chunk coords + in-chunk offset for an absolute macro position. */
  _locate(macroX, macroY) {
    const cx = floorDiv(macroX, CHUNK_SIZE);
    const cy = floorDiv(macroY, CHUNK_SIZE);
    const offX = modPos(macroX, CHUNK_SIZE);
    const offY = modPos(macroY, CHUNK_SIZE);
    return { cx, cy, offX, offY, key: chunkKey(cx, cy) };
  }

  /**
   * Lookup biome id at a macro tile. Returns default OCEAN if unset.
   * @param {number} macroX
   * @param {number} macroY
   * @returns {number}
   */
  getBiome(macroX, macroY) {
    const { offX, offY, key } = this._locate(macroX, macroY);
    const chunk = this.chunks.get(key);
    return chunk ? chunk[chunkLocalIdx(offX, offY)] : DEFAULT_BIOME_ID;
  }

  /**
   * Set biome at a macro tile. Allocates a chunk lazily on first write.
   * Listeners receive the key of the touched chunk.
   */
  setBiome(macroX, macroY, biomeId) {
    const id = biomeId | 0;
    const { offX, offY, key } = this._locate(macroX, macroY);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      if (id === DEFAULT_BIOME_ID) return false;
      chunk = new Uint8Array(CHUNK_AREA);
      if (DEFAULT_BIOME_ID !== 0) chunk.fill(DEFAULT_BIOME_ID);
      this.chunks.set(key, chunk);
    }
    const idx = chunkLocalIdx(offX, offY);
    if (chunk[idx] === id) return false;
    chunk[idx] = id;
    this._markDirty(key);
    return true;
  }

  /**
   * Fill an axis-aligned rectangle (inclusive on both ends) with `biomeId`.
   * Operates chunk-by-chunk to avoid repeated `_locate` work.
   * @returns {number} count of cells that actually changed
   */
  setRect(x0, y0, x1, y1, biomeId) {
    const id = biomeId | 0;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const minCX = floorDiv(minX, CHUNK_SIZE);
    const maxCX = floorDiv(maxX, CHUNK_SIZE);
    const minCY = floorDiv(minY, CHUNK_SIZE);
    const maxCY = floorDiv(maxY, CHUNK_SIZE);

    this.beginBatch();
    let changed = 0;
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const baseX = cx * CHUNK_SIZE;
        const baseY = cy * CHUNK_SIZE;
        const localMinX = Math.max(0, minX - baseX);
        const localMinY = Math.max(0, minY - baseY);
        const localMaxX = Math.min(CHUNK_SIZE - 1, maxX - baseX);
        const localMaxY = Math.min(CHUNK_SIZE - 1, maxY - baseY);
        const key = chunkKey(cx, cy);
        let chunk = this.chunks.get(key);
        if (!chunk) {
          if (id === DEFAULT_BIOME_ID) continue;
          chunk = new Uint8Array(CHUNK_AREA);
          if (DEFAULT_BIOME_ID !== 0) chunk.fill(DEFAULT_BIOME_ID);
          this.chunks.set(key, chunk);
        }
        let touchedThisChunk = false;
        for (let oy = localMinY; oy <= localMaxY; oy++) {
          const row = oy * CHUNK_SIZE;
          for (let ox = localMinX; ox <= localMaxX; ox++) {
            const idx = row + ox;
            if (chunk[idx] !== id) {
              chunk[idx] = id;
              changed++;
              touchedThisChunk = true;
            }
          }
        }
        if (touchedThisChunk) this._dirty.add(key);
      }
    }
    this.endBatch();
    return changed;
  }

  /** Returns the smallest axis-aligned bounding box covering non-OCEAN tiles. */
  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const [key, chunk] of this.chunks) {
      const { cx, cy } = parseChunkKey(key);
      for (let oy = 0; oy < CHUNK_SIZE; oy++) {
        const row = oy * CHUNK_SIZE;
        for (let ox = 0; ox < CHUNK_SIZE; ox++) {
          if (chunk[row + ox] === DEFAULT_BIOME_ID) continue;
          const mx = cx * CHUNK_SIZE + ox;
          const my = cy * CHUNK_SIZE + oy;
          if (mx < minX) minX = mx;
          if (my < minY) minY = my;
          if (mx > maxX) maxX = mx;
          if (my > maxY) maxY = my;
          any = true;
        }
      }
    }
    if (!any) return null;
    return { minX, minY, maxX, maxY };
  }

  /**
   * Read-only snapshot of chunk keys present in the store (sorted).
   * Used by renderer to decide which background chunks to consider for bake.
   */
  chunkKeys() {
    return Array.from(this.chunks.keys()).sort();
  }

  /** Number of chunks currently allocated. */
  chunkCount() {
    return this.chunks.size;
  }

  /** Serialize to a JSON-safe object (v2 chunked format). */
  toJSON() {
    /** @type {Record<string, number[]>} */
    const chunks = {};
    for (const [key, chunk] of this.chunks) {
      let allDefault = true;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] !== DEFAULT_BIOME_ID) { allDefault = false; break; }
      }
      if (allDefault) continue;
      chunks[key] = Array.from(chunk);
    }
    return {
      version: 2,
      chunkSize: CHUNK_SIZE,
      seed: this.seed,
      chunks,
    };
  }

  /** Replace contents from a JSON-safe object. Accepts v2 (chunked) and v1 (flat). */
  fromJSON(obj) {
    if (!obj || typeof obj !== 'object') {
      throw new Error('EditorStore.fromJSON: invalid root object');
    }
    this.chunks.clear();
    this._dirty.clear();
    this.seed = typeof obj.seed === 'string' ? obj.seed : 'hoenn-editor';

    if (obj.version === 2) {
      const cs = Number(obj.chunkSize) || CHUNK_SIZE;
      if (cs !== CHUNK_SIZE) {
        throw new Error(`EditorStore.fromJSON: chunkSize ${cs} != expected ${CHUNK_SIZE}`);
      }
      const src = obj.chunks || {};
      for (const [key, arr] of Object.entries(src)) {
        if (!Array.isArray(arr) || arr.length !== CHUNK_AREA) continue;
        this.chunks.set(key, Uint8Array.from(arr));
      }
    } else if (obj.version === 1 && Array.isArray(obj.biomes)) {
      const w = Number(obj.width);
      const h = Number(obj.height);
      if (!Number.isFinite(w) || !Number.isFinite(h) || obj.biomes.length !== w * h) {
        throw new Error('EditorStore.fromJSON: v1 dimensions/biomes mismatch');
      }
      this.beginBatch();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const id = obj.biomes[y * w + x] | 0;
          if (id !== DEFAULT_BIOME_ID) this.setBiome(x, y, id);
        }
      }
      this.endBatch();
    } else {
      throw new Error(`EditorStore.fromJSON: unsupported version ${obj.version}`);
    }

    const allKeys = new Set(this.chunks.keys());
    for (const cb of this._listeners) {
      try { cb(allKeys); } catch (e) { console.error('EditorStore listener threw', e); }
    }
  }

  /** Reset to an empty store (notifies listeners with all previously-present keys). */
  clear() {
    const keys = new Set(this.chunks.keys());
    this.chunks.clear();
    this._dirty.clear();
    for (const cb of this._listeners) {
      try { cb(keys); } catch (e) { console.error('EditorStore listener threw', e); }
    }
  }
}

/** Singleton store used by the editor + play page within the same tab. */
export const editorStore = new EditorStore();

export function persistToLocalStorage(store = editorStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.toJSON()));
    return true;
  } catch {
    return false;
  }
}

export function readFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
