import { MACRO_TILE_STRIDE, foliageDensity, getMicroTile } from './chunking.js';
import { BIOME_TO_TERRAIN } from './biome-tiles.js';
import { TERRAIN_SETS } from './tessellation-data.js';
import { getRoleForCell } from './tessellation-logic.js';

/** @type {WeakMap<object, Set<string>>} */
const caveLandmarkMacroKeyCache = new WeakMap();

function getCaveLandmarkMacroKeySet(data) {
  if (!data || typeof data !== 'object') return new Set();
  const cached = caveLandmarkMacroKeyCache.get(data);
  if (cached) return cached;
  const out = new Set();
  const landmarks = Array.isArray(data.landmarks) ? data.landmarks : [];
  for (const lm of landmarks) {
    if (!lm || lm.type !== 'CAVE') continue;
    const x = Math.floor(Number(lm.x));
    const y = Math.floor(Number(lm.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.add(`${x},${y}`);
  }
  caveLandmarkMacroKeyCache.set(data, out);
  return out;
}

function roleSupportsCave(role, roleLeft, roleRight, roleTop, roleBottom) {
  if (role === 'EDGE_S' && roleLeft === 'EDGE_S' && roleRight === 'EDGE_S') return true;
  if (role === 'EDGE_E' && roleTop === 'EDGE_E' && roleBottom === 'EDGE_E') return true;
  if (role === 'EDGE_W' && roleTop === 'EDGE_W' && roleBottom === 'EDGE_W') return true;
  if (role === 'EDGE_N' && roleLeft === 'EDGE_N' && roleRight === 'EDGE_N') return true;
  return false;
}

export function isCaveEntranceCandidateAtMicro(mx, my, data) {
  if (!data) return false;
  const tile = getMicroTile(mx, my, data);
  if (!tile || tile.heightStep < 1 || tile.isRoad || tile.isCity) return false;

  const terrainKey = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
  const set = TERRAIN_SETS[terrainKey];
  if (!set) return false;

  const checkAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= tile.heightStep;
  const role = getRoleForCell(my, mx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, checkAtOrAbove, set.type);
  if (role !== 'EDGE_S' && role !== 'EDGE_N' && role !== 'EDGE_E' && role !== 'EDGE_W') return false;

  const roleLeft = getRoleForCell(my, mx - 1, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, checkAtOrAbove, set.type);
  const roleRight = getRoleForCell(my, mx + 1, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, checkAtOrAbove, set.type);
  const roleTop = getRoleForCell(my - 1, mx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, checkAtOrAbove, set.type);
  const roleBottom = getRoleForCell(my + 1, mx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, checkAtOrAbove, set.type);
  if (!roleSupportsCave(role, roleLeft, roleRight, roleTop, roleBottom)) return false;

  const macroX = Math.floor(mx / MACRO_TILE_STRIDE);
  const macroY = Math.floor(my / MACRO_TILE_STRIDE);
  const caveLandmarks = getCaveLandmarkMacroKeySet(data);
  const isLandmarkTile = caveLandmarks.has(`${macroX},${macroY}`);
  const noiseTrigger = (mx * 7 + my * 13) % 47 === 0 && foliageDensity(mx, my, data.seed + 1234, 0.1) > 0.55;
  const landmarkTrigger = isLandmarkTile && !noiseTrigger;

  return noiseTrigger || landmarkTrigger;
}

export function isCaveLandmarkCurrentlyRenderable(landmark, data) {
  if (!landmark || landmark.type !== 'CAVE' || !data) return false;
  const macroX = Math.floor(Number(landmark.x));
  const macroY = Math.floor(Number(landmark.y));
  if (!Number.isFinite(macroX) || !Number.isFinite(macroY)) return false;
  const mx0 = macroX * MACRO_TILE_STRIDE;
  const my0 = macroY * MACRO_TILE_STRIDE;
  for (let my = my0; my < my0 + MACRO_TILE_STRIDE; my++) {
    for (let mx = mx0; mx < mx0 + MACRO_TILE_STRIDE; mx++) {
      if (isCaveEntranceCandidateAtMicro(mx, my, data)) return true;
    }
  }
  return false;
}
