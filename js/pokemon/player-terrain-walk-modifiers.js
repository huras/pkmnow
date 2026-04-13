import { pivotCellHeightTraversalOk, pivotCellHeightStepDelta } from '../walkability.js';

/** Default slow while burrowing upward through blocked height (Diglett line; override via modifiers). */
export const DEFAULT_UNDERGROUND_CLIFF_UP_SLOW_MULT = 0.1;

/**
 * @typedef {{
 *   dexId: number,
 *   grounded: boolean,
 *   airborne: boolean,
 *   spd: number,
 *   data: object,
 *   ox: number,
 *   oy: number,
 *   tx: number,
 *   ty: number,
 *   burrowFeetWalkActive: boolean,
 *   burrowFeetTileExists: (x: number, y: number, d: object) => boolean
 * }} TerrainWalkModifierContext
 */

/**
 * Underground burrow: slow only when climbing (dest height > src) through a pivot transition
 * that would block normal grounded movement.
 * @param {TerrainWalkModifierContext} ctx
 * @returns {number} multiplier in (0,1], or 1 if no effect
 */
function undergroundBurrowCliffAscendSlow(ctx) {
  const { grounded, airborne, spd, data, ox, oy, tx, ty, burrowFeetWalkActive, burrowFeetTileExists } = ctx;
  if (!data || !grounded || airborne || spd <= 0.1) return 1;
  if (!burrowFeetWalkActive) return 1;
  if (!burrowFeetTileExists(tx, ty, data)) return 1;
  if (pivotCellHeightTraversalOk(tx, ty, ox, oy, data)) return 1;
  const dh = pivotCellHeightStepDelta(tx, ty, ox, oy, data);
  if (dh == null || dh <= 0) return 1;
  return DEFAULT_UNDERGROUND_CLIFF_UP_SLOW_MULT;
}

/**
 * Chainable terrain walk speed caps (multiply). Register more handlers here as species grow.
 * @type {ReadonlyArray<(ctx: TerrainWalkModifierContext) => number>}
 */
const TERRAIN_WALK_SPEED_MULTIPLIERS = [undergroundBurrowCliffAscendSlow];

/**
 * @param {TerrainWalkModifierContext} ctx
 * @returns {number} product of all modifiers (each should return 1 when inactive)
 */
export function resolveTerrainWalkSpeedCapMultiplier(ctx) {
  let m = 1;
  for (const fn of TERRAIN_WALK_SPEED_MULTIPLIERS) {
    m *= fn(ctx);
  }
  return m;
}
