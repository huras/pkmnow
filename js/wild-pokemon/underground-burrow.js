import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { speciesHasGroundType } from '../pokemon/pokemon-type-helpers.js';
import { isGhostPhaseShiftBurrowEligibleDex, isGhostPhaseShiftLeftHeld } from './ghost-phase-shift.js';

/** Diglett / Dugtrio: move underground — no cliff, prop, tree or scatter colliders while burrowing. */

export function isUndergroundBurrowerDex(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  return d === 50 || d === 51;
}

/**
 * Player feet-only burrow.
 * - Ghost: **Left Shift** only (phase), not latched — see `ghost-phase-shift.js`.
 * - Ground (non-Ghost): only while **`digBurrowMode`** after charge completes (no hold).
 * - Diglett / Dugtrio: same latch; when latched, idle or moving keeps burrow feet path.
 *
 * @param {number} dexId
 * @param {{ isAirborne: boolean, grounded: boolean, isMoving: boolean, digBurrowMode?: boolean }} o
 */
export function isPlayerUndergroundBurrowWalkActive(dexId, o) {
  if (o.isAirborne || !o.grounded) return false;
  const d = Math.floor(Number(dexId) || 0);
  if (isGhostPhaseShiftBurrowEligibleDex(d)) return isGhostPhaseShiftLeftHeld();
  if (!o.digBurrowMode) return false;
  if (isUndergroundBurrowerDex(d)) return true;
  return speciesHasGroundType(d);
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
