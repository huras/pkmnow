/**
 * Static Entity Cache
 *
 * Computes and caches static world-object descriptors (trees, scatters, buildings)
 * per chunk. These are 100% deterministic given (mx, my, seed).
 *
 * First access for a chunk pays the scan cost ONCE.
 * All subsequent frames do a Map.get() per chunk — O(visible_chunks) instead of
 * the previous O(viewport_area) tile scan in render-item-collector.js.
 *
 * Runtime state (isDestroyed, isBurning, isCharred, regrowFade01) is NOT stored here.
 * collectRenderItems adds those at consumption time from play-crystal-tackle.js.
 */

import {
  BIOME_VEGETATION,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  isSortableScatter,
  tileSurfaceAllowsScatterVegetation,
  scatterHasWindSway,
  BERRY_PATCH_THRESHOLD
} from '../biome-tiles.js';
import { getMicroTile, MACRO_TILE_STRIDE, foliageDensity } from '../chunking.js';
import { validScatterOriginMicro } from '../scatter-pass2-debug.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { seededHash, parseShape } from '../tessellation-logic.js';
import { hasScatterItemKeyOverride } from '../main/scatter-item-override.js';
import { PLAY_CHUNK_SIZE } from './render-constants.js';

// ---------------------------------------------------------------------------
// Module-level cache — one entry per chunk, keyed by "cx,cy" string.
// ---------------------------------------------------------------------------

/** @type {Map<string, object[]>} chunk key → static entity descriptor list */
const _chunkEntityCache = new Map();

/** Scatter origin validity memo — persists across frames, cleared on map change. */
let _scatterMemo = new Map();
let _memoSeed = NaN;
let _memoFullW = -1;
let _memoFullH = -1;

/**
 * Invalidate the entire static entity cache.
 * Call this whenever the map (seed/dimensions) changes, or when scatter overrides
 * change which origins exist as `_override` vs procedural scatter (e.g. Strength place/drop).
 */
export function invalidateStaticEntityCache() {
  _chunkEntityCache.clear();
  _scatterMemo = new Map();
  _memoSeed = NaN;
  _memoFullW = -1;
  _memoFullH = -1;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Returns the cached static entity descriptor list for one chunk.
 * Computes and stores on first access; O(1) Map lookup on all subsequent frames.
 *
 * Descriptors contain only deterministic fields. Callers must add runtime fields
 * (isDestroyed, isBurning, etc.) before pushing to renderItems.
 *
 * @param {number} cx     chunk X index
 * @param {number} cy     chunk Y index
 * @param {string} key    chunk map key e.g. "5,3"
 * @param {object} data   world data object
 * @param {number} fullW  width  * MACRO_TILE_STRIDE
 * @param {number} fullH  height * MACRO_TILE_STRIDE
 * @returns {object[]}
 */
export function getStaticEntitiesForChunk(cx, cy, key, data, fullW, fullH) {
  if (_chunkEntityCache.has(key)) return _chunkEntityCache.get(key);

  // Invalidate scatter memo if map changed.
  if (data.seed !== _memoSeed || fullW !== _memoFullW || fullH !== _memoFullH) {
    _scatterMemo = new Map();
    _memoSeed   = data.seed;
    _memoFullW  = fullW;
    _memoFullH  = fullH;
  }

  const entities = [];
  const tileX0 = cx * PLAY_CHUNK_SIZE;
  const tileY0 = cy * PLAY_CHUNK_SIZE;
  const tileX1 = Math.min(fullW, tileX0 + PLAY_CHUNK_SIZE);
  const tileY1 = Math.min(fullH, tileY0 + PLAY_CHUNK_SIZE);

  /** Local getCached that reads directly from data — valid without a frame context. */
  const directGet = (mx, my) => getMicroTile(mx, my, data);

  for (let myScan = tileY0; myScan < tileY1; myScan++) {
    for (let mxScan = tileX0; mxScan < tileX1; mxScan++) {
      const t = directGet(mxScan, myScan);
      if (!tileSurfaceAllowsScatterVegetation(t)) continue;

      // --- a. Formal Trees ---
      const treeType = getTreeType(t.biomeId, mxScan, myScan, data.seed);
      if (
        treeType &&
        (mxScan + myScan) % 3 === 0 &&
        foliageDensity(mxScan, myScan, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD
      ) {
        if (directGet(mxScan + 1, myScan)?.heightStep === t.heightStep) {
          entities.push({ type: 'tree', treeType, originX: mxScan, originY: myScan, biomeId: t.biomeId });
        }
      }

      // --- b. Scatters ---
      const items = BIOME_VEGETATION[t.biomeId] || [];
      
      // Filter items based on berry patch density
      const isBerryPatch = t.berryPatchDensity >= BERRY_PATCH_THRESHOLD;
      const filteredItems = items.filter(ik => {
        const isBerry = ik.includes('berry-tree-');
        return isBerryPatch ? isBerry : !isBerry;
      });

      const proceduralItem = filteredItems.length > 0 
        ? filteredItems[Math.floor(seededHash(mxScan, myScan, data.seed + 222) * filteredItems.length)]
        : null;

      if (proceduralItem && isSortableScatter(proceduralItem)) {
        if (validScatterOriginMicro(mxScan, myScan, data.seed, fullW, fullH, directGet, _scatterMemo)) {
          const objSet = OBJECT_SETS[proceduralItem];
          if (objSet) {
            const { cols, rows } = parseShape(objSet.shape);
            entities.push({
              type: 'scatter',
              itemKey: proceduralItem,   // may be overridden at runtime — see collectRenderItems
              objSet,
              originX: mxScan,
              originY: myScan,
              cols,
              rows,
              windSway: scatterHasWindSway(proceduralItem),
              hasOverride: false         // updated at consumption time
            });
          }
        }
      }

      // Override-only origin: tile wouldn't normally spawn a scatter, but has a forced one.
      // Marked as sentinel so collectRenderItems can handle it at runtime.
      if (hasScatterItemKeyOverride(mxScan, myScan)) {
        // Only add sentinel if this tile didn't already produce a scatter entry above.
        const alreadyCovered = entities.length > 0 &&
          entities[entities.length - 1].type === 'scatter' &&
          entities[entities.length - 1].originX === mxScan &&
          entities[entities.length - 1].originY === myScan;
        if (!alreadyCovered) {
          entities.push({ type: '_override', originX: mxScan, originY: myScan });
        }
      }

      // --- c. Buildings ---
      if (t.urbanBuilding && t.urbanBuildingOrigin) {
        entities.push({
          type: 'building',
          bData: t.urbanBuilding,
          originX: mxScan,
          originY: myScan
        });
      }
    }
  }

  _chunkEntityCache.set(key, entities);
  return entities;
}
