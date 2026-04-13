import { POKEMON_CONFIG } from '../pokemon/pokemon-config.js';

/** @typedef {'ember' | 'waterBurst' | 'poisonSting'} WildMoveId */

/**
 * Explicit overrides (dex → move), inspired by Zelda `WILD_AGGRO_SPELLS`.
 * @type {Map<number, WildMoveId>}
 */
const DEX_OVERRIDE = new Map([
  [4, 'ember'],
  [5, 'ember'],
  [6, 'ember'],
  [7, 'waterBurst'],
  [8, 'waterBurst'],
  [9, 'waterBurst'],
  [37, 'ember'],
  [38, 'ember'],
  [58, 'ember'],
  [59, 'ember'],
  [77, 'ember'],
  [78, 'ember'],
  [126, 'ember'],
  [10, 'poisonSting'],
  [11, 'poisonSting'],
  [12, 'poisonSting'],
  [13, 'poisonSting'],
  [14, 'poisonSting'],
  [15, 'poisonSting'],
  [23, 'poisonSting'],
  [24, 'poisonSting'],
  [29, 'poisonSting'],
  [30, 'poisonSting'],
  [31, 'poisonSting'],
  [32, 'poisonSting'],
  [33, 'poisonSting'],
  [34, 'poisonSting'],
  [41, 'poisonSting'],
  [42, 'poisonSting'],
  [43, 'poisonSting'],
  [44, 'poisonSting'],
  [45, 'poisonSting'],
  [48, 'poisonSting'],
  [49, 'poisonSting'],
  [72, 'poisonSting'],
  [73, 'poisonSting'],
  [92, 'poisonSting'],
  [93, 'poisonSting'],
  [94, 'poisonSting']
]);

/**
 * @param {number} dexId
 * @returns {WildMoveId}
 */
export function resolveWildMoveIdForDex(dexId) {
  const o = DEX_OVERRIDE.get(dexId);
  if (o) return o;
  const cfg = POKEMON_CONFIG[dexId];
  const types = cfg?.types ?? [];
  if (types.includes('fire')) return 'ember';
  if (types.includes('water')) return 'waterBurst';
  if (types.includes('poison') || types.includes('bug')) return 'poisonSting';
  return 'poisonSting';
}
