import { MACRO_TILE_STRIDE, foliageDensity, foliageType } from './chunking.js';
import { TERRAIN_SETS } from './tessellation-data.js';
import { getRoleForCell } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN,
  GRASS_TILES,
  getGrassVariant,
  getTreeType,
  getGrassParams,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  lakeLotusGrassInteriorAllowed
} from './biome-tiles.js';
import { PLAY_CHUNK_SIZE } from './render/render-constants.js';

const toLocalSuppressionKey = (mx, my) => {
  const localX = ((mx % PLAY_CHUNK_SIZE) + PLAY_CHUNK_SIZE) % PLAY_CHUNK_SIZE;
  const localY = ((my % PLAY_CHUNK_SIZE) + PLAY_CHUNK_SIZE) % PLAY_CHUNK_SIZE;
  return (localY << 8) | localX;
};

/**
 * Same surface gate as PASS 5a `forEachAbovePlayerTile` in render.js (height + CENTER cliff role).
 * @param {(col: number, row: number) => object | null | undefined} getTile
 */
export function playGrassPassesAboveTileSurfaceGate(mx, my, data, getTile) {
  const tile = getTile(mx, my);
  if (!tile || tile.heightStep < 1) return false;
  const microRows = data.height * MACRO_TILE_STRIDE;
  const microCols = data.width * MACRO_TILE_STRIDE;
  const gateSet = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
  if (gateSet) {
    const checkAtOrAbove = (r, c) => (getTile(c, r)?.heightStep ?? -1) >= tile.heightStep;
    if (getRoleForCell(my, mx, microRows, microCols, checkAtOrAbove, gateSet.type) !== 'CENTER') return false;
  }
  return true;
}

/**
 * Which animated grass layers would draw at LOD0 (union used for flammability; render still gates top by lodDetail).
 * @param {(col: number, row: number) => object | null | undefined} getTile
 * @param {Map<string, { canvas: HTMLCanvasElement, suppressedSet: Set<number> }>} playChunkMap
 * @returns {{ base: boolean, top: boolean }}
 */
export function getPlayAnimatedGrassLayers(mx, my, data, getTile, playChunkMap) {
  const out = { base: false, top: false };
  if (!playGrassPassesAboveTileSurfaceGate(mx, my, data, getTile)) return out;

  const tile = getTile(mx, my);
  if (!tile) return out;

  const microRows = data.height * MACRO_TILE_STRIDE;
  const microCols = data.width * MACRO_TILE_STRIDE;

  const gv = getGrassVariant(tile.biomeId);
  const gTiles = GRASS_TILES[gv];
  const { scale: gs, threshold: gt } = getGrassParams(tile.biomeId);

  if (gTiles && foliageDensity(mx, my, data.seed, gs) >= gt && !tile.isRoad && !tile.isCity) {
    let isFlat = true;
    const lakeInterior = lakeLotusGrassInteriorAllowed(mx, my, tile, microRows, microCols, getTile);
    if (lakeInterior === null) {
      const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
      if (setForRole) {
        const checkAtOrAbove = (r, c) => (getTile(c, r)?.heightStep ?? -99) >= tile.heightStep;
        if (getRoleForCell(my, mx, microRows, microCols, checkAtOrAbove, setForRole.type) !== 'CENTER') isFlat = false;
      }
    } else {
      isFlat = lakeInterior;
    }

    if (isFlat) {
      const trType = getTreeType(tile.biomeId, mx, my, data.seed);
      const isFT =
        !!trType &&
        (mx + my) % 3 === 0 &&
        foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
      const isFN =
        !!trType &&
        (mx + my) % 3 === 1 &&
        foliageDensity(mx - 1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

      const cx = Math.floor(mx / PLAY_CHUNK_SIZE);
      const cy = Math.floor(my / PLAY_CHUNK_SIZE);
      const chunk = playChunkMap.get(`${cx},${cy}`);
      const isOccupiedByObject = chunk ? chunk.suppressedSet.has(toLocalSuppressionKey(mx, my)) : false;

      if (!isFT && !isFN && !isOccupiedByObject) {
        let baseId = gTiles.original;
        if (gv === 'lotus' && gTiles.grass2 != null) {
          const ftPick = foliageType(mx, my, data.seed);
          baseId = ftPick < 0.5 ? gTiles.original : gTiles.grass2;
        }
        out.base = baseId != null;
      }
    }
  }

  const vt = getGrassVariant(tile.biomeId);
  const vTiles = GRASS_TILES[vt];
  const { scale: vs, threshold: vt_th } = getGrassParams(tile.biomeId);
  if (vTiles && foliageDensity(mx, my, data.seed, vs) >= vt_th && !tile.isRoad && !tile.isCity) {
    const topId = vTiles.originalTop;
    if (topId) {
      const treeT_chk = getTreeType(tile.biomeId, mx - 1, my, data.seed);
      const isFT =
        !!treeT_chk &&
        (mx + my) % 3 === 0 &&
        foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
      const isFN =
        !!treeT_chk &&
        (mx + my) % 3 === 1 &&
        foliageDensity(mx - 1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

      const cx = Math.floor(mx / PLAY_CHUNK_SIZE);
      const cy = Math.floor(my / PLAY_CHUNK_SIZE);
      const chunk = playChunkMap.get(`${cx},${cy}`);
      const isOccupiedByObject = chunk ? chunk.suppressedSet.has(toLocalSuppressionKey(mx, my)) : false;

      if (!isFT && !isFN && !isOccupiedByObject) out.top = true;
    }
  }

  return out;
}

/**
 * True if either animated grass layer would exist (gameplay / fire catch).
 */
export function isPlayGrassFlammable(mx, my, data, getTile, playChunkMap) {
  const { base, top } = getPlayAnimatedGrassLayers(mx, my, data, getTile, playChunkMap);
  return base || top;
}
