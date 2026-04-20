/**
 * O(1) probe: player micro-tile is on the same formal 2×1 broadleaf footprint as play-chunk-bake
 * (surface, tree hash, density, CENTER terrain role, right column height, destroyed/regrow).
 */

import { MACRO_TILE_STRIDE, foliageDensity, getMicroTile } from '../chunking.js';
import {
  BIOME_TO_TERRAIN,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  tileSurfaceAllowsScatterVegetation
} from '../biome-tiles.js';
import { TERRAIN_SETS } from '../tessellation-data.js';
import { getRoleForCell } from '../tessellation-logic.js';
import { isPlayFormalTreeRootDestroyed, getFormalTreeRegrowVisualAlpha01 } from './play-crystal-tackle.js';

/**
 * @param {number} mx micro column
 * @param {number} my micro row
 * @param {object} data map data (`width`, `height`, `seed`)
 * @param {(mx: number, my: number) => object | null | undefined} [getTile] defaults to `getMicroTile(…, data)`
 */
export function isPlayerMicroOnFormalTreeFootprint(mx, my, data, getTile = null) {
  if (!data) return false;
  const mxI = mx | 0;
  const myI = my | 0;
  const microCols = data.width * MACRO_TILE_STRIDE;
  const microRows = data.height * MACRO_TILE_STRIDE;
  if (mxI < 0 || myI < 0 || mxI >= microCols || myI >= microRows) return false;

  const gt = typeof getTile === 'function' ? getTile : (x, y) => getMicroTile(x, y, data);
  const seed = Number(data.seed) || 0;

  const terrainCenterAt = (cx, cy) => {
    const t = gt(cx, cy);
    if (!t) return false;
    const gateSet = TERRAIN_SETS[BIOME_TO_TERRAIN[t.biomeId] || 'grass'];
    if (!gateSet) return true;
    const checkAtOrAbove = (r, c) => (gt(c, r)?.heightStep ?? -1) >= t.heightStep;
    return getRoleForCell(cy, cx, microRows, microCols, checkAtOrAbove, gateSet.type) === 'CENTER';
  };

  const formalRootAlive = (rx, ry) => {
    if (rx < 0 || ry < 0 || rx >= microCols || ry >= microRows) return false;
    const t = gt(rx, ry);
    if (!t || !tileSurfaceAllowsScatterVegetation(t)) return false;
    const tt = getTreeType(t.biomeId, rx, ry, seed);
    if (!tt || (rx + ry) % 3 !== 0) return false;
    if (foliageDensity(rx, ry, seed + 5555, TREE_NOISE_SCALE) < TREE_DENSITY_THRESHOLD) return false;
    if (isPlayFormalTreeRootDestroyed(rx, ry)) return false;
    if (getFormalTreeRegrowVisualAlpha01(rx, ry) < 0.999) return false;
    if (!terrainCenterAt(rx, ry)) return false;
    const tr = gt(rx + 1, ry);
    if (!tr || tr.heightStep !== t.heightStep) return false;
    return true;
  };

  if (formalRootAlive(mxI, myI)) return true;
  if (((mxI + myI) % 3) === 1 && formalRootAlive(mxI - 1, myI)) return true;
  return false;
}
