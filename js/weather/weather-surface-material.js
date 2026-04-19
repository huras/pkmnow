/**
 * Terrain surface classification for weather particles (splash vs absorb).
 * Uses existing micro-tile + terrain-set naming — no per-frame repository calls in hot loops;
 * callers pass a frame-local Map keyed by packed tile int (same convention as `render.js`).
 */

import { getMicroTile, MACRO_TILE_STRIDE } from '../chunking.js';
import { BIOMES } from '../biomes.js';
import { computeTerrainRoleAndSprite } from '../main/terrain-role-helpers.js';
import { getGrassVariant } from '../biome-tiles.js';

/** @typedef {'hard' | 'soft' | 'neutral'} WeatherSurfaceKind */

export const WEATHER_SURFACE_HARD = 'hard';
export const WEATHER_SURFACE_SOFT = 'soft';
export const WEATHER_SURFACE_NEUTRAL = 'neutral';

/** @param {number} mx */
/** @param {number} my */
export function packWeatherTileKey(mx, my) {
  const ix = mx | 0;
  const iy = my | 0;
  return (ix << 16) | (iy & 0xffff);
}

/**
 * @param {string | null | undefined} setName
 * @returns {boolean}
 */
function isHardSurfaceSetName(setName) {
  if (!setName || typeof setName !== 'string') return false;
  if (setName === 'road') return true;
  if (setName.endsWith('-pavement')) return true;
  if (setName.endsWith('-bridge')) return true;
  if (setName.startsWith('stair-')) return true;
  if (setName.startsWith('Rocky ') || setName.startsWith('Red Dirty')) return true;
  if (setName === 'rocky-volcano') return true;
  if (setName === 'cidade chao') return true;
  if (setName.startsWith('above ')) return true;
  if (setName.startsWith('Palette base — ice')) return true;
  if (setName.includes('detailed-small-bricks')) return true;
  return false;
}

/**
 * @param {string | null | undefined} setName
 * @param {number} biomeId
 * @returns {boolean}
 */
function isSoftSurfaceSetName(setName, biomeId) {
  if (getGrassVariant(biomeId)) return true;
  if (!setName || typeof setName !== 'string') return false;
  if (setName.startsWith('Palette grassy')) return true;
  if (setName.startsWith('jogador ')) return true;
  if (setName.startsWith('Dirty snowy')) return true;
  if (setName.includes('lush') || setName.includes('field') || setName.includes('light')) return true;
  if (setName.includes('sand') && !setName.includes('pavement')) return true;
  if (setName.startsWith('Yellow Dirty')) return true;
  return false;
}

/**
 * Classify ground material at micro-tile (mx, my) for precipitation impact.
 * @param {number} mx
 * @param {number} my
 * @param {object} data macro / map data for {@link getMicroTile}
 * @returns {WeatherSurfaceKind}
 */
export function classifyWeatherSurfaceMaterial(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return WEATHER_SURFACE_NEUTRAL;
  const biomeId = tile.biomeId | 0;
  if (biomeId === BIOMES.OCEAN.id) return WEATHER_SURFACE_NEUTRAL;

  const surfaceLevel = Number.isFinite(tile.heightStep) ? tile.heightStep : 0;
  const { setName } = computeTerrainRoleAndSprite(mx, my, data, surfaceLevel);

  if (isHardSurfaceSetName(setName)) return WEATHER_SURFACE_HARD;
  if (isSoftSurfaceSetName(setName, biomeId)) return WEATHER_SURFACE_SOFT;

  if (setName && setName.includes('— sand')) return WEATHER_SURFACE_SOFT;
  if (setName && (setName.startsWith('Palette base — rock') || setName.startsWith('Palette base — volcano')))
    return WEATHER_SURFACE_HARD;
  if (setName && setName.startsWith('Palette base')) return WEATHER_SURFACE_HARD;
  return WEATHER_SURFACE_NEUTRAL;
}

/**
 * Cached variant — reuses `frameCache` (Map<number, WeatherSurfaceKind>) for O(1) repeats.
 * @param {number} mx
 * @param {number} my
 * @param {object} data
 * @param {Map<number, WeatherSurfaceKind>} frameCache
 * @returns {WeatherSurfaceKind}
 */
export function getWeatherSurfaceMaterialCached(mx, my, data, frameCache) {
  const key = packWeatherTileKey(mx, my);
  if (frameCache.has(key)) return /** @type {WeatherSurfaceKind} */ (frameCache.get(key));
  const kind = classifyWeatherSurfaceMaterial(mx, my, data);
  frameCache.set(key, kind);
  return kind;
}

/**
 * World pixel (foot) to micro tile indices (same grid as render / walk).
 * @param {number} worldPx
 * @param {number} worldPy
 * @param {number} tileW
 * @param {number} tileH
 * @returns {{ mx: number, my: number }}
 */
export function worldPixelToMicroTile(worldPx, worldPy, tileW, tileH) {
  const tw = Math.max(1, Number(tileW) || 32);
  const th = Math.max(1, Number(tileH) || tw);
  return {
    mx: Math.floor(worldPx / tw),
    my: Math.floor(worldPy / th)
  };
}

export { MACRO_TILE_STRIDE };
