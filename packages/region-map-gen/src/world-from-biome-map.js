/**
 * @fileoverview Build a `world` object equivalent to `generate()`'s output from a
 * hand-painted biome map (one biome id per macro tile). Bypasses FBM noise so
 * downstream consumers (chunking, autotile, render, walkability) work unchanged.
 */

import { BIOMES, resolveWaterLevel, BEACH_ELEVATION_BAND, DEFAULT_WATER_LEVEL } from './biomes.js';
import { normalizeSeed } from './generator.js';

/**
 * Maps a biome id to a sensible default elevation in 0..1, calibrated against
 * `getBiome` / `elevationToStep` thresholds so chunking produces matching steps.
 * Painters can override per-cell via `elevation`.
 */
export function defaultElevationForBiome(biomeId, waterLevel) {
  const beachUpper = waterLevel + BEACH_ELEVATION_BAND;
  switch (biomeId) {
    case BIOMES.OCEAN.id:
      return Math.max(0, waterLevel - 0.06);
    case BIOMES.BEACH.id:
      return Math.min(beachUpper - 0.005, waterLevel + BEACH_ELEVATION_BAND * 0.5);
    case BIOMES.MOUNTAIN.id:
      return 0.74;
    case BIOMES.PEAK.id:
    case BIOMES.VOLCANO.id:
      return 0.86;
    case BIOMES.SNOW.id:
    case BIOMES.ICE.id:
      return 0.55;
    case BIOMES.CITY.id:
    case BIOMES.CITY_STREET.id:
    case BIOMES.TOWN.id:
    case BIOMES.TOWN_STREET.id:
      return Math.max(beachUpper + 0.02, 0.4);
    default:
      return Math.max(beachUpper + 0.05, 0.5);
  }
}

/**
 * Empty city-data with the exact shape `chunking.js` / consumers expect, so
 * `cd.footprintSet.has(...)` and friends never throw on painted worlds. The
 * painter places `BIOMES.CITY/TOWN/...` directly as macro biomes; we don't
 * fabricate the procedural city layout that `buildCityLayouts` produces.
 */
function emptyCityData() {
  return {
    layouts: [],
    byNodeIndex: new Map(),
    footprintSet: new Set(),
    pathTilesSet: new Set(),
    buildingFootprintSet: new Set(),
    cityHeightMap: new Map(),
  };
}

function asUint8Biomes(biomes, expectedLength) {
  if (biomes instanceof Uint8Array) {
    if (biomes.length !== expectedLength) {
      throw new Error(`createWorldFromBiomeMap: biomes length ${biomes.length} != width*height ${expectedLength}`);
    }
    return biomes;
  }
  if (Array.isArray(biomes)) {
    if (biomes.length !== expectedLength) {
      throw new Error(`createWorldFromBiomeMap: biomes length ${biomes.length} != width*height ${expectedLength}`);
    }
    return Uint8Array.from(biomes);
  }
  throw new Error('createWorldFromBiomeMap: biomes must be Uint8Array or number[]');
}

function asFloat32Elevation(elevation, biomes, width, height, waterLevel) {
  const n = width * height;
  if (elevation == null) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = defaultElevationForBiome(biomes[i], waterLevel);
    }
    return out;
  }
  if (elevation instanceof Float32Array) {
    if (elevation.length !== n) {
      throw new Error(`createWorldFromBiomeMap: elevation length ${elevation.length} != width*height ${n}`);
    }
    return elevation;
  }
  if (Array.isArray(elevation)) {
    if (elevation.length !== n) {
      throw new Error(`createWorldFromBiomeMap: elevation length ${elevation.length} != width*height ${n}`);
    }
    return Float32Array.from(elevation);
  }
  throw new Error('createWorldFromBiomeMap: elevation must be Float32Array, number[], or omitted');
}

/**
 * Build a `world` object from a hand-painted biome grid. Returns the same
 * shape as `generate()`: `{ width, height, cells, biomes, temperature, moisture,
 * anomaly, paths, graph, roadTraffic, roadMasks, cellImportance, landmarks,
 * cityData, config, seed, version, phase }`. Generator-only fields
 * (paths/graph/cities/landmarks) are empty no-ops.
 *
 * @param {object} input
 * @param {Uint8Array|number[]} input.biomes - biome ids, length = width*height
 * @param {number} input.width
 * @param {number} input.height
 * @param {Float32Array|number[]} [input.elevation] - 0..1 per cell; defaulted from biomes
 * @param {Float32Array|number[]} [input.temperature] - 0..1 per cell; defaulted to 0.5
 * @param {Float32Array|number[]} [input.moisture] - 0..1 per cell; defaulted to 0.5
 * @param {Float32Array|number[]} [input.anomaly] - 0..1 per cell; defaulted to 0
 * @param {number|string} [input.seed='painted']
 * @param {object} [input.config] - merged on top of `{ waterLevel: DEFAULT_WATER_LEVEL }`
 */
export function createWorldFromBiomeMap(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('createWorldFromBiomeMap: input object is required');
  }
  const width = Number(input.width);
  const height = Number(input.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('createWorldFromBiomeMap: width/height must be positive numbers');
  }
  const n = width * height;
  const config = { waterLevel: DEFAULT_WATER_LEVEL, ...(input.config || {}) };
  const waterLevel = resolveWaterLevel(config);
  const seedSnapshot = normalizeSeed(input.seed ?? 'painted');

  const biomes = asUint8Biomes(input.biomes, n);
  const cells = asFloat32Elevation(input.elevation, biomes, width, height, waterLevel);

  const fillUniform = (src, fallback) => {
    if (src == null) {
      const out = new Float32Array(n);
      if (fallback !== 0) out.fill(fallback);
      return out;
    }
    if (src instanceof Float32Array) {
      if (src.length !== n) throw new Error(`createWorldFromBiomeMap: array length ${src.length} != width*height ${n}`);
      return src;
    }
    if (Array.isArray(src)) {
      if (src.length !== n) throw new Error(`createWorldFromBiomeMap: array length ${src.length} != width*height ${n}`);
      return Float32Array.from(src);
    }
    throw new Error('createWorldFromBiomeMap: temperature/moisture/anomaly must be Float32Array, number[], or omitted');
  };

  const temperature = fillUniform(input.temperature, 0.5);
  const moisture = fillUniform(input.moisture, 0.5);
  const anomaly = fillUniform(input.anomaly, 0);

  return {
    version: 1,
    phase: 4.0,
    seed: seedSnapshot,
    width,
    height,
    cells,
    temperature,
    moisture,
    anomaly,
    biomes,
    graph: { nodes: [], edges: [] },
    paths: [],
    roadTraffic: new Uint8Array(n),
    roadMasks: new Uint32Array(n),
    cellImportance: new Uint16Array(n),
    landmarks: [],
    cityData: emptyCityData(),
    config,
    source: 'painted',
  };
}
