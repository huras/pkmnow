import { MACRO_TILE_STRIDE, getMicroTile } from './chunking.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import { playChunkMap } from './render/play-chunk-cache.js';

const CUT_GRASS_REGROW_SEC = 12;

/** @type {Map<string, number>} key -> regrowAtMs */
const cutTileStates = new Map();

function tileKey(mx, my) {
  return `${mx},${my}`;
}

function cleanupExpired(nowMs) {
  if (cutTileStates.size === 0) return;
  for (const [k, regrowAtMs] of cutTileStates.entries()) {
    if (!Number.isFinite(regrowAtMs) || regrowAtMs <= nowMs) {
      cutTileStates.delete(k);
    }
  }
}

function hasCuttableGrass(mx, my, data) {
  const getTile = (x, y) => getMicroTile(x, y, data);
  const layers = getPlayAnimatedGrassLayers(mx, my, data, getTile, playChunkMap);
  return !!(layers.base || layers.top);
}

export function clearGrassCutStateForNewMap() {
  cutTileStates.clear();
}

export function grassCutSuppressesAnimatedGrassAt(mx, my) {
  const nowMs = performance.now();
  const k = tileKey(mx, my);
  const regrowAtMs = cutTileStates.get(k);
  if (!regrowAtMs) return false;
  if (regrowAtMs <= nowMs) {
    cutTileStates.delete(k);
    return false;
  }
  return true;
}

/**
 * Temporarily suppresses animated grass in a circle.
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} radiusTiles
 * @param {object | null | undefined} data
 * @returns {number} number of tiles cut
 */
export function cutGrassInCircle(worldX, worldY, radiusTiles, data) {
  if (!data) return 0;
  const cx = Number(worldX);
  const cy = Number(worldY);
  const radius = Math.max(0.2, Number(radiusTiles) || 0);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius)) return 0;
  const nowMs = performance.now();
  cleanupExpired(nowMs);
  const regrowAtMs = nowMs + CUT_GRASS_REGROW_SEC * 1000;
  const r2 = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  let cutCount = 0;
  for (let my = minY; my <= maxY; my++) {
    for (let mx = minX; mx <= maxX; mx++) {
      if (mx < 0 || my < 0 || mx >= microW || my >= microH) continue;
      const dx = mx + 0.5 - cx;
      const dy = my + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (!hasCuttableGrass(mx, my, data)) continue;
      cutTileStates.set(tileKey(mx, my), regrowAtMs);
      cutCount++;
    }
  }
  return cutCount;
}
