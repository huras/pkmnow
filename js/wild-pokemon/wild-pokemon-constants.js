import { MACRO_TILE_STRIDE } from '../chunking.js';

/**
 * N×N wild spawn slots inside each biome macro cell (same `data.biomes[my * w + mx]` for all slots in that cell).
 * Prefer divisors of {@link MACRO_TILE_STRIDE} so each sub-slot spans a whole number of micro tiles (e.g. 48 → 2, 3, 4, 6).
 */
export const WILD_MACRO_SUBDIVISION = 4;

/**
 * Max wild slot keys active at once. If (2r+1)²×N² exceeds this, the **nearest** slots to the player
 * are kept (avoids despawning mons you are interacting with in favour of distant empty slots).
 */
export const WILD_MAX_SIMULTANEOUS_SLOTS = 24;

/**
 * Max wander distance from each slot's center in micro tiles (tune down when {@link WILD_MACRO_SUBDIVISION} is large).
 */
export const WILD_WANDER_RADIUS_TILES = 20;
