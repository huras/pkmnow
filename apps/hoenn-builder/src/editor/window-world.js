/**
 * @fileoverview Build a finite `world` object (compatible with `region-map-gen`
 * and `region-render-2d`) from a window of an infinite `EditorStore`. The
 * window is `size×size` macro tiles centered around a painter-space macro
 * coordinate; everything outside the window is OCEAN (matching the store's
 * default), so bake/walkability treat the boundary as ordinary deep water.
 *
 * Coordinate mapping:
 *  - painter (macro): coordinates exposed to UI/store; any integer.
 *  - world (macro):   indexes inside the returned `world.biomes`, 0..size-1.
 *
 *      worldMX = painterMX - origin.mx
 *      painterMX = worldMX + origin.mx
 *
 * `needsRebuild(origin, newCenter, size, margin)` returns true when the new
 * center is within `margin` macro tiles of the window edge.
 */

import {
  createWorldFromBiomeMap,
  defaultElevationForBiome,
} from 'region-map-gen/world-from-biome-map.js';
import { resolveWaterLevel } from 'region-map-gen/biomes.js';
import { CHUNK_SIZE, DEFAULT_BIOME_ID } from './editor-store.js';

/**
 * Default macro side of the finite window. 256 macro tiles ≈ 10500 micro
 * tiles ≈ 500k painter px each way, big enough that even at extreme zoom-out
 * (≈0.015) the user sees the painted area, not the oceanic window edge.
 *
 * Memory is trivial (Uint8Array(65536) ≈ 64 KB) and bakes are gated by
 * zoom in the editor renderer, so this size doesn't penalize performance.
 */
export const DEFAULT_WINDOW_SIZE = 256;

/** When camera/player gets this close to a window edge, recentralize. */
export const DEFAULT_REBUILD_MARGIN = 24;

/**
 * @param {import('./editor-store.js').EditorStore} store
 * @param {number} centerMX - painter-space macro X
 * @param {number} centerMY - painter-space macro Y
 * @param {number} [size]  - finite world side in macro tiles
 * @returns {{ world: object, origin: { mx: number, my: number }, size: number }}
 */
export function buildWindowWorld(store, centerMX, centerMY, size = DEFAULT_WINDOW_SIZE) {
  const half = Math.floor(size / 2);
  const originMX = Math.floor(centerMX) - half;
  const originMY = Math.floor(centerMY) - half;

  const biomes = new Uint8Array(size * size);
  if (DEFAULT_BIOME_ID !== 0) biomes.fill(DEFAULT_BIOME_ID);

  fillBiomesFromStore(biomes, store, originMX, originMY, size);

  const world = createWorldFromBiomeMap({
    biomes,
    width: size,
    height: size,
    seed: store.seed || 'hoenn-editor',
  });

  return { world, origin: { mx: originMX, my: originMY }, size };
}

/**
 * Repopulate `biomes` (and the matching default `cells` elevation) for an
 * existing window without allocating a new world. Useful when origin stayed
 * the same but specific chunks became dirty. Returns true if anything changed.
 *
 * Why also refresh `cells`: `getMicroTile` derives `heightStep` from
 * bilinearly-interpolated elevation. When the user repaints a macro cell
 * (e.g. OCEAN → MOUNTAIN), the biome lookup is now authoritative for painted
 * worlds (see `chunking.js`), but `heightStep` would still come from the old
 * elevation. Re-syncing `cells` from `defaultElevationForBiome` keeps water
 * vs. land and mountain steps in agreement with the painted biome.
 *
 * NOTE: this only touches `world.biomes`/`world.cells`. Bake cache for
 * affected chunks must still be invalidated by the caller.
 */
export function refreshWindowBiomes(world, store, origin, size) {
  const biomes = world.biomes;
  const cells = world.cells;
  const waterLevel = resolveWaterLevel(world.config || {});
  let changed = false;
  for (let i = 0; i < biomes.length; i++) {
    const wy = (i / size) | 0;
    const wx = i - wy * size;
    const id = store.getBiome(origin.mx + wx, origin.my + wy);
    if (biomes[i] !== id) {
      biomes[i] = id;
      if (cells) cells[i] = defaultElevationForBiome(id, waterLevel);
      changed = true;
    }
  }
  return changed;
}

/**
 * Returns true when the (continuous) center coord drifts close to the edge of
 * the window described by `origin`/`size`, so the caller should rebuild.
 *
 * `margin` is expressed in macro tiles.
 */
export function needsRebuild(origin, centerMX, centerMY, size, margin = DEFAULT_REBUILD_MARGIN) {
  const localX = centerMX - origin.mx;
  const localY = centerMY - origin.my;
  return (
    localX < margin ||
    localY < margin ||
    localX > size - margin ||
    localY > size - margin
  );
}

/**
 * Convert painter macro coords → world macro coords (returns null when out).
 */
export function painterToWorld(origin, size, painterMX, painterMY) {
  const wx = painterMX - origin.mx;
  const wy = painterMY - origin.my;
  if (wx < 0 || wy < 0 || wx >= size || wy >= size) return null;
  return { wx, wy };
}

/** Convert world macro coords → painter macro coords. */
export function worldToPainter(origin, worldMX, worldMY) {
  return { mx: worldMX + origin.mx, my: worldMY + origin.my };
}

function fillBiomesFromStore(biomes, store, originMX, originMY, size) {
  // Iterate by chunks intersected by the window to minimize per-cell `_locate`.
  const startCX = Math.floor(originMX / CHUNK_SIZE);
  const endCX = Math.floor((originMX + size - 1) / CHUNK_SIZE);
  const startCY = Math.floor(originMY / CHUNK_SIZE);
  const endCY = Math.floor((originMY + size - 1) / CHUNK_SIZE);

  for (let cy = startCY; cy <= endCY; cy++) {
    for (let cx = startCX; cx <= endCX; cx++) {
      const chunk = store.chunks.get(`${cx},${cy}`);
      if (!chunk) continue;
      const chunkBaseX = cx * CHUNK_SIZE;
      const chunkBaseY = cy * CHUNK_SIZE;
      const localXStart = Math.max(0, originMX - chunkBaseX);
      const localYStart = Math.max(0, originMY - chunkBaseY);
      const localXEnd = Math.min(CHUNK_SIZE, originMX + size - chunkBaseX);
      const localYEnd = Math.min(CHUNK_SIZE, originMY + size - chunkBaseY);
      for (let oy = localYStart; oy < localYEnd; oy++) {
        const wy = chunkBaseY + oy - originMY;
        const worldRow = wy * size;
        const chunkRow = oy * CHUNK_SIZE;
        for (let ox = localXStart; ox < localXEnd; ox++) {
          const wx = chunkBaseX + ox - originMX;
          biomes[worldRow + wx] = chunk[chunkRow + ox];
        }
      }
    }
  }
}
