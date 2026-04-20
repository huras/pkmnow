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

/** True if species has Flying — creative-style flight in play (see `player.js`). */
export function speciesHasFlyingType(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  if (
    d === 150 ||
    d === 151 ||
    d === 249 ||
    d === 250 ||
    d === 251 ||
    d === 380 ||
    d === 381 ||
    d === 384 ||
    d === 385 ||
    d === 386 ||
    ((d >= 480 && d <= 488) || (d >= 491 && d <= 493))
  )
    return true; // legend / mythical — levitation-style when secondary Flying absent
  return speciesHasType(dexId, 'flying');
}

/** Mewtwo / Mew: smoother creative flight + walk cycle while aloft (see `player.js` / `render.js`). */
export function speciesHasSmoothLevitationFlight(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  return (
    d === 150 ||
    d === 151 ||
    d === 249 ||
    d === 250 ||
    d === 251 ||
    d === 380 ||
    d === 381 ||
    d === 384 ||
    d === 385 ||
    d === 386 ||
    ((d >= 480 && d <= 488) || (d >= 491 && d <= 493))
  );
}
