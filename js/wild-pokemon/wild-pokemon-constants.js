import { MACRO_TILE_STRIDE } from '../chunking.js';

/**
 * N×N wild spawn slots inside each biome macro cell (same `data.biomes[my * w + mx]` for all slots in that cell).
 * Prefer divisors of {@link MACRO_TILE_STRIDE} so each sub-slot spans a whole number of micro tiles (e.g. 48 → 2, 3, 4, 6).
 */
export const WILD_MACRO_SUBDIVISION = 0.25;

/**
 * Max wild slot keys active at once. If (2r+1)²×N² exceeds this, the **nearest** slots to the player
 * are kept (avoids despawning mons you are interacting with in favour of distant empty slots).
 */
export const WILD_MAX_SIMULTANEOUS_SLOTS = 15;

/**
 * Minimum distance (micro tiles) between **different** wild groups' spawn slot centers when placing a new leader.
 * Uses each anchor entity's `centerX` / `centerY` (leader or solo); followers are ignored. `0` disables.
 * Try ~24–48 (about 0.75–1.5× macro stride in micro tiles) so packs do not sit on adjacent slot centers.
 */
export const WILD_MIN_INTER_GROUP_CENTER_DIST = 0;

/**
 * Max wander distance from each slot's center in micro tiles (tune down when {@link WILD_MACRO_SUBDIVISION} is large).
 */
export const WILD_WANDER_RADIUS_TILES = 25;

/** Chance (0..1) per tall-grass walking footstep (rustle cadence) to spawn one hostile wild from the current biome. */
export const GRASS_WALK_HOSTILE_SPAWN_CHANCE = 0.0155;

/** Initial `wildTempAggressiveSec` for grass hostiles (decay skipped when `wildGrassHostileDeathBattle` is set on the entity). */
export const GRASS_WALK_HOSTILE_AGGRO_SEC = 22;

/** Minimum seconds between grass-hostile spawns (reduces streaky RNG). */
export const GRASS_WALK_HOSTILE_SPAWN_COOLDOWN_SEC = 10;

/** Group combat break: effective leader must stay calm this long before cohesion/follow returns. */
export const GROUP_COMBAT_CALM_EXIT_SEC = 1.85;

/** Brief non-calm streak before resetting calm progress (reduces flicker wander↔approach on the leader). */
export const GROUP_COMBAT_REARM_GRACE_SEC = 0.25;
