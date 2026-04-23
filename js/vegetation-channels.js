/**
 * Procedural vegetation "channels": extra deterministic masks that can bias scatter picks
 * without storing per-tile state (save-neutral). Extend by appending to {@link VEGETATION_SCATTER_CHANNELS}.
 */
import { BIOMES } from './biomes.js';
import { foliageDensity } from './chunking.js';
import { seededHash } from './tessellation-logic.js';
import { BIOME_VEGETATION, BERRY_PATCH_THRESHOLD } from './biome-tiles.js';
import {
  getScatterItemKeyOverride,
  hasScatterItemKeyOverride,
  SCATTER_ITEM_KEY_OVERRIDE_EMPTY
} from './main/scatter-item-override.js';

/**
 * @typedef {{
 *   id: string,
 *   itemKey: string,
 *   biomeIds: ReadonlySet<number>,
 *   noise: { seedOffset: number, scale: number, threshold: number },
 *   blend01?: number,
 *   suppressInBerryPatch?: boolean
 * }} VegetationScatterChannel
 */

/** @type {ReadonlyArray<VegetationScatterChannel>} */
export const VEGETATION_SCATTER_CHANNELS = Object.freeze([
  {
    id: 'junglyTallGrass',
    itemKey: 'jungly tall grass [2x1]',
    biomeIds: new Set([BIOMES.JUNGLE.id]),
    noise: { seedOffset: 9921, scale: 4.25, threshold: 0.48 },
    /** Extra blend so not every high-noise cell becomes tall grass (keeps palms/vines in the mix). */
    blend01: 0.68,
    suppressInBerryPatch: true
  }
]);

/**
 * Scatter decoration itemKey at micro origin `(ox,oy)`: play overrides → vegetation channels →
 * biome vegetation RNG (berry-patch filtered), matching walkability/bake semantics.
 * @param {number} ox
 * @param {number} oy
 * @param {object | null | undefined} tile
 * @param {number} seed
 * @returns {string | null}
 */
export function resolveScatterVegetationItemKey(ox, oy, tile, seed) {
  if (!tile) return null;
  if (hasScatterItemKeyOverride(ox, oy)) {
    const forced = getScatterItemKeyOverride(ox, oy);
    if (forced === SCATTER_ITEM_KEY_OVERRIDE_EMPTY) return null;
    if (forced) return forced;
  }

  const isBerryPatchO = tile.berryPatchDensity >= BERRY_PATCH_THRESHOLD;

  for (const ch of VEGETATION_SCATTER_CHANNELS) {
    if (!ch.biomeIds.has(tile.biomeId)) continue;
    if (isBerryPatchO && ch.suppressInBerryPatch) continue;
    const { seedOffset, scale, threshold } = ch.noise;
    if (foliageDensity(ox, oy, seed + seedOffset, scale) <= threshold) continue;
    const blend = typeof ch.blend01 === 'number' && Number.isFinite(ch.blend01) ? ch.blend01 : 1;
    if (blend < 1 && seededHash(ox, oy, seed + 33441) >= blend) continue;
    return ch.itemKey;
  }

  const itemsO = BIOME_VEGETATION[tile.biomeId] || [];
  if (!itemsO.length) return null;
  const filteredO = itemsO.filter((ik) => {
    const isB = ik.includes('berry-tree-');
    return isBerryPatchO ? isB : !isB;
  });
  if (!filteredO.length) return null;
  return filteredO[Math.floor(seededHash(ox, oy, seed + 222) * filteredO.length)];
}
