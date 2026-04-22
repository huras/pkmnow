import { MACRO_TILE_STRIDE } from '../chunking.js';

/**
 * N×N wild spawn slots inside each biome macro cell (same `data.biomes[my * w + mx]` for all slots in that cell).
 * Prefer divisors of {@link MACRO_TILE_STRIDE} so each sub-slot spans a whole number of micro tiles (e.g. 48 → 2, 3, 4, 6).
 */
export const WILD_MACRO_SUBDIVISION = 0.95;

/**
 * Max wild slot keys active at once. If (2r+1)²×N² exceeds this, the **nearest** slots to the player
 * are kept (avoids despawning mons you are interacting with in favour of distant empty slots).
 */
export const WILD_MAX_SIMULTANEOUS_SLOTS = 15;

/**
 * Max wander distance from each slot's center in micro tiles (tune down when {@link WILD_MACRO_SUBDIVISION} is large).
 */
export const WILD_WANDER_RADIUS_TILES = 15;

/** Chance (0..1) per tall-grass walking footstep (rustle cadence) to spawn one hostile wild from the current biome. */
export const GRASS_WALK_HOSTILE_SPAWN_CHANCE = 0.0155;

/** Initial `wildTempAggressiveSec` for grass hostiles (decay skipped when `wildGrassHostileDeathBattle` is set on the entity). */
export const GRASS_WALK_HOSTILE_AGGRO_SEC = 22;

/** Minimum seconds between grass-hostile spawns (reduces streaky RNG). */
export const GRASS_WALK_HOSTILE_SPAWN_COOLDOWN_SEC = 10;

/**
 * WAR mode: radial offset (tiles) around the target for group flanking.
 * Higher values produce wider circles and less clumping.
 */
export const WILD_WAR_FLANK_RADIUS_BASE = 0.8;

/**
 * WAR mode: extra radius added to alternating members (odd/even slots) for layered rings.
 * Higher values make the formation less compact and less "chain-like".
 */
export const WILD_WAR_FLANK_RADIUS_ALT = 0.35;

/**
 * WAR mode: max random angular jitter (radians) per member.
 * Higher values make members feel more independent and less perfectly synchronized.
 */
export const WILD_WAR_FLANK_ANGLE_JITTER_RAD = 0.8;

/** WAR mode: per-member orbit speed around the target (radians/sec). */
export const WILD_WAR_ORBIT_SPEED_RAD_PER_SEC = 1.35;

/** WAR mode: min/max seconds between personal flank retarget jitter updates. */
export const WILD_WAR_REPATH_MIN_SEC = 0.1;
export const WILD_WAR_REPATH_MAX_SEC = 0.28;

/** WAR mode: distance threshold to consider the flank point reached. */
export const WILD_WAR_FLANK_REACH_EPS = 0.26;

/** WAR mode: attack allowance beyond stopDist while circling. */
export const WILD_WAR_ATTACK_EXTRA_DIST = 0.85;
