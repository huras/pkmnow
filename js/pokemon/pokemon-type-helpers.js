import { getPokemonConfig } from './pokemon-config.js';

/**
 * @param {number} dexId
 * @param {import('./pokemon-config.js').PokemonTypeSlug} typeSlug
 */
export function speciesHasType(dexId, typeSlug) {
  const cfg = getPokemonConfig(dexId);
  if (!cfg?.types) return false;
  return cfg.types.includes(typeSlug);
}

/** True if species has Ground as primary or secondary (Gen1 config). Dig / burrow visuals use this. */
export function speciesHasGroundType(dexId) {
  return speciesHasType(dexId, 'ground');
}

/** True if species has Ghost (Shift “phase” through blocked height like dig, but translucent). */
export function speciesHasGhostType(dexId) {
  return speciesHasType(dexId, 'ghost');
}
