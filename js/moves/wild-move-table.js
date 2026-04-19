import { POKEMON_CONFIG } from '../pokemon/pokemon-config.js';

/** @typedef {'ember' | 'waterBurst' | 'poisonSting' | 'flamethrower' | 'confusion' | 'bubble' | 'waterGun' | 'psybeam' | 'prismaticLaser' | 'poisonPowder' | 'incinerate' | 'silkShoot'} WildMoveId */

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
  [37, 'flamethrower'],
  [38, 'flamethrower'],
  [58, 'flamethrower'],
  [59, 'flamethrower'],
  [77, 'flamethrower'],
  [78, 'flamethrower'],
  [126, 'flamethrower'],
  [65, 'psybeam'],
  [64, 'confusion'],
  [63, 'confusion'],
  [150, 'prismaticLaser'],
  [151, 'prismaticLaser'],
  [249, 'prismaticLaser'],
  [250, 'prismaticLaser'],
  [251, 'prismaticLaser'],
  [377, 'prismaticLaser'],
  [378, 'prismaticLaser'],
  [379, 'prismaticLaser'],
  [380, 'prismaticLaser'],
  [381, 'prismaticLaser'],
  [382, 'prismaticLaser'],
  [383, 'prismaticLaser'],
  [384, 'prismaticLaser'],
  [385, 'prismaticLaser'],
  [386, 'prismaticLaser'],
  [480, 'prismaticLaser'],
  [481, 'prismaticLaser'],
  [482, 'prismaticLaser'],
  [483, 'prismaticLaser'],
  [484, 'prismaticLaser'],
  [485, 'prismaticLaser'],
  [486, 'prismaticLaser'],
  [487, 'prismaticLaser'],
  [488, 'prismaticLaser'],
  [489, 'prismaticLaser'],
  [490, 'prismaticLaser'],
  [491, 'prismaticLaser'],
  [492, 'prismaticLaser'],
  [493, 'prismaticLaser'],
  [7, 'bubble'],
  [8, 'waterGun'],
  [9, 'waterGun'],
  [12, 'poisonPowder'],
  [49, 'poisonPowder'],
  [10, 'silkShoot'],
  [13, 'silkShoot'],
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
  if (types.includes('fire')) return 'flamethrower';
  if (types.includes('water')) return 'waterBurst';
  if (types.includes('psychic')) return 'confusion';
  if (types.includes('steel')) return 'incinerate';
  if (types.includes('dark')) return 'incinerate';
  if (types.includes('fairy')) return 'bubble';
  if (types.includes('poison') || types.includes('bug')) return 'poisonSting';
  return 'poisonSting';
}
