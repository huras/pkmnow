/**
 * @fileoverview Bridges painter JSON ↔ a `world` object via
 * `createWorldFromBiomeMap`. Also fetches the bundled `hoenn-preset.json`.
 */

import { createWorldFromBiomeMap } from 'region-map-gen/world-from-biome-map.js';
import { BIOMES, resolveWaterLevel } from 'region-map-gen/biomes.js';

/**
 * Sensible default elevation per biome so terrain visuals render correctly when
 * the painter doesn't provide an explicit elevation map.
 *
 * Values are intentionally above the default `waterLevel = 0.21`, except OCEAN.
 */
const ELEVATION_BY_BIOME = (() => {
  const tbl = new Float32Array(256);
  tbl.fill(0.5);
  tbl[BIOMES.OCEAN.id] = 0.1;
  tbl[BIOMES.BEACH.id] = 0.24;
  tbl[BIOMES.GRASSLAND.id] = 0.45;
  tbl[BIOMES.FOREST.id] = 0.55;
  tbl[BIOMES.JUNGLE.id] = 0.55;
  tbl[BIOMES.SAVANNA.id] = 0.55;
  tbl[BIOMES.DESERT.id] = 0.5;
  tbl[BIOMES.TUNDRA.id] = 0.5;
  tbl[BIOMES.TAIGA.id] = 0.55;
  tbl[BIOMES.SNOW.id] = 0.55;
  tbl[BIOMES.ICE.id] = 0.3;
  tbl[BIOMES.MOUNTAIN.id] = 0.75;
  tbl[BIOMES.PEAK.id] = 0.9;
  tbl[BIOMES.VOLCANO.id] = 0.85;
  tbl[BIOMES.GHOST_WOODS.id] = 0.55;
  tbl[BIOMES.ARCANE.id] = 0.4;
  tbl[BIOMES.FLOWER_FIELDS.id] = 0.45;
  tbl[BIOMES.CITY.id] = 0.45;
  tbl[BIOMES.CITY_STREET.id] = 0.45;
  tbl[BIOMES.TOWN.id] = 0.45;
  tbl[BIOMES.TOWN_STREET.id] = 0.45;
  return tbl;
})();

/**
 * Build a `world` from a painter snapshot JSON object (or whatever
 * `painter-state.snapshotForJson()` produced).
 *
 * @param {{ width:number, height:number, biomes:number[]|Uint8Array, seed?:string }} snapshot
 * @returns {object} world
 */
export function buildWorldFromPainterSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('buildWorldFromPainterSnapshot: invalid snapshot');
  }
  const { width, height, seed = 'painted' } = snapshot;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('buildWorldFromPainterSnapshot: invalid dimensions');
  }
  const n = width * height;
  const src = snapshot.biomes;
  if (!src || src.length !== n) {
    throw new Error(`buildWorldFromPainterSnapshot: biomes length ${src?.length} ≠ ${n}`);
  }
  const biomes = src instanceof Uint8Array ? src : Uint8Array.from(src);

  const config = {};
  const waterLevel = resolveWaterLevel(config);
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = ELEVATION_BY_BIOME[biomes[i]];
    elevation[i] = biomes[i] === BIOMES.OCEAN.id ? Math.min(e, waterLevel - 0.01) : e;
  }

  return createWorldFromBiomeMap({
    biomes,
    elevation,
    width,
    height,
    seed,
    config,
  });
}

/** Loads the bundled Hoenn preset (no `fetch` cache busting needed in dev). */
export async function loadHoennPreset() {
  const url = new URL('./hoenn-preset.json', import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading hoenn-preset.json`);
  return res.json();
}
