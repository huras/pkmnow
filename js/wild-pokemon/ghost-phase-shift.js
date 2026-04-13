/**
 * Ghost-type “phase shift”: **Left Shift** (same side as dig), feet-only burrow while held (moving or not),
 * semi-transparent sprite (no Diglett placeholder art). Wired from `underground-burrow.js` + `player.js`.
 */

import { playInputState } from '../main/play-input-state.js';
import { speciesHasGhostType } from '../pokemon/pokemon-type-helpers.js';

/** Sprite alpha while phasing (Left Shift on the ground). */
export const GHOST_PHASE_SHIFT_DRAW_ALPHA = 0.48;

/**
 * Species may use ghost phase-shift burrow (Shift, feet-only path when applicable).
 * @param {number} dexId
 */
export function isGhostPhaseShiftBurrowEligibleDex(dexId) {
  return speciesHasGhostType(dexId);
}

/**
 * @param {{ grounded: boolean, dexId: number }} p
 * @returns {number} 1 = opaque, else {@link GHOST_PHASE_SHIFT_DRAW_ALPHA}
 */
export function computeGhostPhaseShiftDrawAlpha(p) {
  const { grounded, dexId } = p;
  if (!grounded || !speciesHasGhostType(dexId) || !playInputState.shiftLeftHeld) return 1;
  return GHOST_PHASE_SHIFT_DRAW_ALPHA;
}

/** Ghost burrow / phase uses Left Shift only (same key as Ground dig / underground-burrow). */
export function isGhostPhaseShiftLeftHeld() {
  return !!playInputState.shiftLeftHeld;
}
