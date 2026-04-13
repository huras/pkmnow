import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { speciesHasGroundType } from '../pokemon/pokemon-type-helpers.js';

/** Diglett / Dugtrio: move underground — no cliff, prop, tree or scatter colliders while burrowing. */

export function isUndergroundBurrowerDex(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  return d === 50 || d === 51;
}

/**
 * Player feet-only burrow (same walk rules as wild Diglett line).
 * - 50/51: while grounded and moving (always “under” when walking).
 * - Other Ground types: only while moving **and** holding Shift (dig input).
 *
 * @param {number} dexId
 * @param {{ isAirborne: boolean, grounded: boolean, isMoving: boolean, shiftHeld: boolean }} o
 */
export function isPlayerUndergroundBurrowWalkActive(dexId, o) {
  if (o.isAirborne || !o.grounded || !o.isMoving) return false;
  const d = Math.floor(Number(dexId) || 0);
  if (isUndergroundBurrowerDex(d)) return true;
  return speciesHasGroundType(d) && !!o.shiftHeld;
}

/**
 * Borrowed dig placeholder: Diglett (#50) if `heightTiles` &lt; 3, else Dugtrio (#51).
 * @param {number} playerDex — species currently playing (not the placeholder dex).
 */
export function getBorrowDigPlaceholderDex(playerDex) {
  const d = Math.floor(Number(playerDex) || 0);
  const cfg = getPokemonConfig(d);
  const h = cfg?.heightTiles ?? 3;
  return h < 3 ? 50 : 51;
}

/** Ground (not Diglett/Dugtrio): borrow Diglett/Dugtrio dig art while `digActive`. */
export function speciesUsesBorrowedDiglettDigVisual(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  return speciesHasGroundType(d) && !isUndergroundBurrowerDex(d);
}
