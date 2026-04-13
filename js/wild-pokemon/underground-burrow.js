import { playInputState } from '../main/play-input-state.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { speciesHasGroundType } from '../pokemon/pokemon-type-helpers.js';
import { isGhostPhaseShiftBurrowEligibleDex, isGhostPhaseShiftLeftHeld } from './ghost-phase-shift.js';

/** Diglett / Dugtrio: move underground — no cliff, prop, tree or scatter colliders while burrowing. */

export function isUndergroundBurrowerDex(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  return d === 50 || d === 51;
}

/**
 * Player feet-only burrow (same walk rules as wild Diglett line).
 * - 50/51: while grounded and moving, or **Left Shift** while still (idle burrow).
 * - Other Ground types: **Left Shift** on the ground (moving or not).
 * - Ghost types: **Left Shift** — see `ghost-phase-shift.js`.
 *
 * @param {number} dexId
 * @param {{ isAirborne: boolean, grounded: boolean, isMoving: boolean }} o
 */
export function isPlayerUndergroundBurrowWalkActive(dexId, o) {
  if (o.isAirborne || !o.grounded) return false;
  const d = Math.floor(Number(dexId) || 0);
  const leftDig = !!playInputState.shiftLeftHeld;
  if (isUndergroundBurrowerDex(d)) return !!o.isMoving || leftDig;
  if (isGhostPhaseShiftBurrowEligibleDex(d)) return isGhostPhaseShiftLeftHeld();
  return speciesHasGroundType(d) && leftDig;
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
