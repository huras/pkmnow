import { getMicroTile } from '../chunking.js';
import { WATER_STEPS, LAND_STEPS, MACRO_TILE_STRIDE } from '../chunking.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_TO_FOLIAGE,
  BIOME_VEGETATION,
  FOLIAGE_DENSITY_THRESHOLD,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  tileSurfaceAllowsScatterVegetation,
  SCATTER_NOISE_SEED_OFFSET,
  SCATTER_NOISE_SCALE,
  SCATTER_NOISE_THRESHOLD
} from '../biome-tiles.js';
import { TERRAIN_SETS } from '../tessellation-data.js';
import { getRoleForCell } from '../tessellation-logic.js';
import { PLAY_CHUNK_SIZE } from '../render/render-constants.js';
import { foliageDensity } from '../chunking.js';
import { validScatterOriginMicro } from '../scatter-pass2-debug.js';
import { resolveScatterVegetationItemKey } from '../vegetation-channels.js';

let currentData = null;
let currentRevision = 0;
const TILE_CHUNK_SIZE = 256;

function emitResultChunks({
  jobId,
  key,
  revision,
  tileEntries,
  roleEntries,
  scatterOriginEntries,
  clumpSuppressionLocalKeys,
  formalTreeRootEntries,
  scatterCandidateEntries
}) {
  const totalChunks = Math.max(1, Math.ceil((tileEntries?.length || 0) / TILE_CHUNK_SIZE));
  if (!Array.isArray(tileEntries) || tileEntries.length === 0) {
    self.postMessage({
      type: 'result_chunk',
      jobId,
      key,
      revision,
      chunkIndex: 0,
      totalChunks: 1,
      tileEntries: [],
      roleEntries,
      scatterOriginEntries,
      clumpSuppressionLocalKeys,
      formalTreeRootEntries,
      scatterCandidateEntries
    });
    return;
  }
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * TILE_CHUNK_SIZE;
    const end = Math.min(tileEntries.length, start + TILE_CHUNK_SIZE);
    self.postMessage({
      type: 'result_chunk',
      jobId,
      key,
      revision,
      chunkIndex,
      totalChunks,
      tileEntries: tileEntries.slice(start, end),
      roleEntries: chunkIndex === 0 ? roleEntries : null,
      scatterOriginEntries: chunkIndex === 0 ? scatterOriginEntries : null,
      clumpSuppressionLocalKeys: chunkIndex === 0 ? clumpSuppressionLocalKeys : null,
      formalTreeRootEntries: chunkIndex === 0 ? formalTreeRootEntries : null,
      scatterCandidateEntries: chunkIndex === 0 ? scatterCandidateEntries : null
    });
  }
}

function toTileKey(mx, my) {
  return (mx << 16) | (my & 0xffff);
}

function computeChunkTileEntries(cx, cy) {
  if (!currentData) return [];
  const startX = cx * PLAY_CHUNK_SIZE;
  const startY = cy * PLAY_CHUNK_SIZE;
  const endX = startX + PLAY_CHUNK_SIZE;
  const endY = startY + PLAY_CHUNK_SIZE;
  const out = [];
  for (let my = startY - 2; my < endY + 2; my++) {
    for (let mx = startX - 2; mx < endX + 2; mx++) {
      const tile = getMicroTile(mx, my, currentData);
      out.push([toTileKey(mx, my), tile]);
    }
  }
  return out;
}

function computeRoleEntries(cx, cy, tileEntries) {
  if (!currentData || !Array.isArray(tileEntries) || tileEntries.length === 0) return [];
  const startX = cx * PLAY_CHUNK_SIZE;
  const startY = cy * PLAY_CHUNK_SIZE;
  const endX = startX + PLAY_CHUNK_SIZE;
  const endY = startY + PLAY_CHUNK_SIZE;

  const tileMap = new Map();
  for (const entry of tileEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    tileMap.set(Number(entry[0]), entry[1]);
  }
  const getCachedTile = (mx, my) => tileMap.get(toTileKey(mx, my));

  const setTypes = new Set();
  const levelSet = new Set();
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const tile = getCachedTile(mx, my);
      if (!tile) continue;
      levelSet.add(Number(tile.heightStep) || 0);
      const terrainSetName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
      const terrainSet = TERRAIN_SETS[terrainSetName];
      if (terrainSet?.type) setTypes.add(terrainSet.type);

      if (tile.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD) {
        const foliageSetName = BIOME_TO_FOLIAGE[tile.biomeId];
        const foliageSet = foliageSetName ? TERRAIN_SETS[foliageSetName] : null;
        if (foliageSet?.type) setTypes.add(foliageSet.type);
      }
      if (tile.isRoad && tile.roadFeature) {
        const roadSet = TERRAIN_SETS[tile.roadFeature];
        if (roadSet?.type) setTypes.add(roadSet.type);
      }
    }
  }

  // Always include the standard terrain loop levels.
  for (let level = 0; level <= LAND_STEPS; level++) levelSet.add(level);
  // Include water levels because water pass asks at tile.heightStep (< 1).
  for (let level = -WATER_STEPS; level < 0; level++) levelSet.add(level);

  const microHBake = currentData.height * MACRO_TILE_STRIDE;
  const microWBake = currentData.width * MACRO_TILE_STRIDE;
  const roleEntries = [];
  for (const setType of setTypes) {
    for (const level of levelSet) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const isAtOrAbove = (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= level;
          const role = getRoleForCell(my, mx, microHBake, microWBake, isAtOrAbove, setType);
          roleEntries.push([setType, level, toTileKey(mx, my), role]);
        }
      }
    }
  }
  return roleEntries;
}

function toLocalSuppressionKey(mx, my) {
  const localX = ((mx % PLAY_CHUNK_SIZE) + PLAY_CHUNK_SIZE) % PLAY_CHUNK_SIZE;
  const localY = ((my % PLAY_CHUNK_SIZE) + PLAY_CHUNK_SIZE) % PLAY_CHUNK_SIZE;
  return (localY << 8) | localX;
}

function computeScatterAndSuppressionEntries(cx, cy, tileEntries) {
  if (!currentData || !Array.isArray(tileEntries) || tileEntries.length === 0) {
    return { scatterOriginEntries: [], clumpSuppressionLocalKeys: [] };
  }
  const startX = cx * PLAY_CHUNK_SIZE;
  const startY = cy * PLAY_CHUNK_SIZE;
  const endX = startX + PLAY_CHUNK_SIZE;
  const endY = startY + PLAY_CHUNK_SIZE;
  const microW = currentData.width * MACRO_TILE_STRIDE;
  const microH = currentData.height * MACRO_TILE_STRIDE;

  const tileMap = new Map();
  for (const entry of tileEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    tileMap.set(Number(entry[0]), entry[1]);
  }
  const getCachedTile = (mx, my) => tileMap.get(toTileKey(mx, my));

  // PASS 3 precompute: clump suppression keys.
  const clumpSuppression = new Set();
  const formalTreeRoots = new Set();
  const scatterCandidates = new Map();
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const t = getCachedTile(mx, my);
      if (!t || t.isRoad || t.isCity) continue;
      if ((BIOME_VEGETATION[t.biomeId] || []).length === 0) continue;
      if (foliageDensity(mx, my, currentData.seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE) > SCATTER_NOISE_THRESHOLD) {
        clumpSuppression.add(toLocalSuppressionKey(mx, my));
      }
    }
  }

  // PASS 2 precompute: scatter origin eligibility baseline (without runtime overrides).
  const scatterOrigins = new Set();
  const validOriginMemo = new Map();
  for (let my = startY - 4; my < endY; my++) {
    for (let mx = startX - 4; mx < endX; mx++) {
      if (mx < 0 || my < 0 || mx >= microW || my >= microH) continue;
      const tile = getCachedTile(mx, my);
      if (!tileSurfaceAllowsScatterVegetation(tile)) continue;
      if (
        foliageDensity(mx, my, currentData.seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE) <= SCATTER_NOISE_THRESHOLD ||
        tile.isRoad ||
        tile.urbanBuilding
      ) {
        continue;
      }

      const treeType = getTreeType(tile.biomeId, mx, my, currentData.seed);
      const isFormalRoot = (tx, ty) =>
        !!treeType && (tx + ty) % 3 === 0 && foliageDensity(tx, ty, currentData.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
      const isFormalNeighbor = (tx, ty) =>
        !!treeType && (tx + ty) % 3 === 1 && foliageDensity(tx - 1, ty, currentData.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
      if (isFormalRoot(mx, my)) {
        formalTreeRoots.add(toTileKey(mx, my));
        continue;
      }
      if (isFormalNeighbor(mx, my)) continue;

      const ok = validScatterOriginMicro(
        mx,
        my,
        currentData.seed,
        microW,
        microH,
        (c, r) => getCachedTile(c, r),
        validOriginMemo
      );
      if (ok) scatterOrigins.add(toTileKey(mx, my));
      if (ok) {
        const itemKey = resolveScatterVegetationItemKey(mx, my, tile, currentData.seed);
        if (itemKey) scatterCandidates.set(toTileKey(mx, my), itemKey);
      }
    }
  }

  return {
    scatterOriginEntries: Array.from(scatterOrigins),
    clumpSuppressionLocalKeys: Array.from(clumpSuppression),
    formalTreeRootEntries: Array.from(formalTreeRoots),
    scatterCandidateEntries: Array.from(scatterCandidates.entries())
  };
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'setData') {
    currentData = msg.data || null;
    currentRevision = Number(msg.revision) || 0;
    self.postMessage({ type: 'ready', revision: currentRevision });
    return;
  }
  if (msg.type !== 'compute') return;
  const jobId = Number(msg.jobId) || 0;
  const key = String(msg.key || '');
  const revision = Number(msg.revision) || 0;
  const precomputeProfile = String(msg.precomputeProfile || 'full');
  const allowRoles = precomputeProfile === 'full' || precomputeProfile === 'roles-lite';
  const allowScatter = precomputeProfile === 'full';
  if (!currentData || revision !== currentRevision) {
    self.postMessage({ type: 'result_chunk', jobId, key, revision, chunkIndex: 0, totalChunks: 1, tileEntries: null });
    return;
  }
  const cx = Number(msg.cx);
  const cy = Number(msg.cy);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    self.postMessage({ type: 'result_chunk', jobId, key, revision, chunkIndex: 0, totalChunks: 1, tileEntries: null });
    return;
  }
  try {
    const tileEntries = computeChunkTileEntries(cx, cy);
    const roleEntries = allowRoles ? computeRoleEntries(cx, cy, tileEntries) : null;
    const scatterData = allowScatter
      ? computeScatterAndSuppressionEntries(cx, cy, tileEntries)
      : {
          scatterOriginEntries: null,
          clumpSuppressionLocalKeys: null,
          formalTreeRootEntries: null,
          scatterCandidateEntries: null
        };
    emitResultChunks({
      jobId,
      key,
      revision,
      tileEntries,
      roleEntries,
      scatterOriginEntries: scatterData.scatterOriginEntries,
      clumpSuppressionLocalKeys: scatterData.clumpSuppressionLocalKeys,
      formalTreeRootEntries: scatterData.formalTreeRootEntries,
      scatterCandidateEntries: scatterData.scatterCandidateEntries
    });
  } catch {
    self.postMessage({ type: 'result_chunk', jobId, key, revision, chunkIndex: 0, totalChunks: 1, tileEntries: null });
  }
};
