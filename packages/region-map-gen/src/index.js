/**
 * @fileoverview Public entry for `region-map-gen` — procedural region `generate()` plus shared terrain helpers.
 */

export { generate, DEFAULT_CONFIG, normalizeSeed } from './generator.js';
export { createWorldFromBiomeMap, defaultElevationForBiome } from './world-from-biome-map.js';
export { createRng, stringToSeed } from './rng.js';
export * from './chunking.js';
export * from './biomes.js';
export * from './tessellation-logic.js';
export { PluginRegistry } from './core/plugin-registry.js';
