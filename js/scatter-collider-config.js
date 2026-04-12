/**
 * Tunables for scatter “stem” circles (radius multipliers + physics pivot offset)
 * and the matching formal broadleaf strip fraction (see `scatterPhysicsCircleAtOrigin`
 * / `getFormalTreeTrunkCircle` in walkability.js).
 */

/** Strip width fraction: base radius = (footprintWidthTiles × this) / 2 in micro-tile space. */
export const TRUNK_STRIP_WIDTH_FRAC = 0.3;

/** Formal broadleaf trunk span on X (micro tiles) × {@link TRUNK_STRIP_WIDTH_FRAC}. */
export const FORMAL_TRUNK_BASE_WIDTH_TILES = 2;

/** Non-tree solid scatter only: multiply stem circle radius when the prop is a crystal. */
export const SCATTER_CRYSTAL_RADIUS_MULTIPLIER = 2;

/** Same idea for rocks / cactus (defaults 1 — change in one place if you want). */
export const SCATTER_ROCK_RADIUS_MULTIPLIER = 1;
export const SCATTER_CACTUS_RADIUS_MULTIPLIER = 1;

/**
 * Extra offset (micro-tile space) added to the stem circle **center** after geometry + radius.
 * Positive dx shifts east; positive dy shifts south (same as world Y).
 */
export const SCATTER_TREE_PHYSICS_PIVOT_DX = 0;
export const SCATTER_TREE_PHYSICS_PIVOT_DY = 0;

export const SCATTER_CRYSTAL_PHYSICS_PIVOT_DX = 0;
export const SCATTER_CRYSTAL_PHYSICS_PIVOT_DY = 0;

export const SCATTER_ROCK_PHYSICS_PIVOT_DX = 0;
export const SCATTER_ROCK_PHYSICS_PIVOT_DY = 0;

export const SCATTER_CACTUS_PHYSICS_PIVOT_DX = 0;
export const SCATTER_CACTUS_PHYSICS_PIVOT_DY = 0;

/**
 * Extra radius factor for scatter stem circles (trees are ignored by callers).
 * @param {string | null | undefined} itemKey — OBJECT_SET key e.g. `large-purple-crystal [2x2]`
 * @returns {number}
 */
export function scatterSolidStemRadiusMultiplier(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  if (k.includes('crystal')) return SCATTER_CRYSTAL_RADIUS_MULTIPLIER;
  if (k.includes('rock')) return SCATTER_ROCK_RADIUS_MULTIPLIER;
  if (k.includes('cactus')) return SCATTER_CACTUS_RADIUS_MULTIPLIER;
  return 1;
}

/**
 * Physics-only pivot: shift the scatter stem circle center (micro tiles).
 * `big-cactus` uses the tree branch (narrow trunk), not the cactus solid branch.
 * @param {string | null | undefined} itemKey
 * @returns {{ dx: number, dy: number }}
 */
export function scatterStemPhysicsPivotOffsetMicroTiles(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  if (k.includes('big-cactus')) {
    return { dx: SCATTER_TREE_PHYSICS_PIVOT_DX, dy: SCATTER_TREE_PHYSICS_PIVOT_DY };
  }
  if (k.includes('crystal')) {
    return { dx: SCATTER_CRYSTAL_PHYSICS_PIVOT_DX, dy: SCATTER_CRYSTAL_PHYSICS_PIVOT_DY };
  }
  if (k.includes('rock')) {
    return { dx: SCATTER_ROCK_PHYSICS_PIVOT_DX, dy: SCATTER_ROCK_PHYSICS_PIVOT_DY };
  }
  if (k.includes('cactus')) {
    return { dx: SCATTER_CACTUS_PHYSICS_PIVOT_DX, dy: SCATTER_CACTUS_PHYSICS_PIVOT_DY };
  }
  if (k.includes('tree') || k.includes('broadleaf') || k.includes('palm')) {
    return { dx: SCATTER_TREE_PHYSICS_PIVOT_DX, dy: SCATTER_TREE_PHYSICS_PIVOT_DY };
  }
  return { dx: 0, dy: 0 };
}
