import { MACRO_TILE_STRIDE } from '../chunking.js';

/**
 * N×N wild spawn slots inside each biome macro cell (same `data.biomes[my * w + mx]` for all slots in that cell).
 * Prefer divisors of {@link MACRO_TILE_STRIDE} so each sub-slot spans a whole number of micro tiles (e.g. 48 → 2, 3, 4, 6).
 */
export const WILD_MACRO_SUBDIVISION = 1;

/**
 * Max wild slot keys active at once. If (2r+1)²×N² exceeds this, the **nearest** slots to the player
 * are kept (avoids despawning mons you are interacting with in favour of distant empty slots).
 */
export const WILD_MAX_SIMULTANEOUS_SLOTS = 11;

/**
 * Minimum distance (micro tiles) between **different** wild groups' spawn slot centers when placing a new leader.
 * Uses each anchor entity's `centerX` / `centerY` (leader or solo); followers are ignored. `0` disables.
 * Try ~24–48 (about 0.75–1.5× macro stride in micro tiles) so packs do not sit on adjacent slot centers.
 */
export const WILD_MIN_INTER_GROUP_CENTER_DIST = 0;

/**
 * Half-size in macro tiles of the wild slot window around the player (keep in sync with `buildWildNeededSlotKeys` R=2).
 */
export const WILD_ENCOUNTER_WINDOW_MACRO_R = 2;

/**
 * How encounter **pool indices** are deduped while filling wild slots in `syncWildPokemonWindow`.
 * - `'macro'`: per `(biomeId, macroX, macroY)` — same index can repeat in neighboring cells (original).
 * - `'near_player'`: one set per `biomeId` for the whole window around the player — fewer duplicate lines on screen.
 */
export const WILD_ENCOUNTER_PICK_SCOPE = 'near_player';

/**
 * Max wander distance from each slot's center in micro tiles (tune down when {@link WILD_MACRO_SUBDIVISION} is large).
 */
export const WILD_WANDER_RADIUS_TILES = 25;

/** Chance (0..1) per tall-grass walking footstep (rustle cadence) to spawn one hostile wild from the current biome. */
export const GRASS_WALK_HOSTILE_SPAWN_CHANCE = 0.0455;

/** Initial `wildTempAggressiveSec` for grass hostiles (decay skipped when `wildGrassHostileDeathBattle` is set on the entity). */
export const GRASS_WALK_HOSTILE_AGGRO_SEC = 22;

/** Minimum seconds between grass-hostile spawns (reduces streaky RNG). */
export const GRASS_WALK_HOSTILE_SPAWN_COOLDOWN_SEC = 10;

/** Group combat break: effective leader must stay calm this long before cohesion/follow returns. */
export const GROUP_COMBAT_CALM_EXIT_SEC = 1.85;

/** Brief non-calm streak before resetting calm progress (reduces flicker wander↔approach on the leader). */
export const GROUP_COMBAT_REARM_GRACE_SEC = 0.25;

/** Lateral offset (tiles) at Bezier control point P1 for group leader ROAM wander (quadratic arc). */
export const WILD_GROUP_LEADER_ROAM_CURVE_BULGE_TILES = 0.55;

/** Lookahead along chord parameter u in [0,1] when taking Bezier tangent (smoother steering). */
export const WILD_GROUP_LEADER_ROAM_U_LOOKAHEAD = 0.08;

/**
 * Optional lateral wiggle on P1: phase += distanceStep * this (rad/tile). `0` disables spatial waviness.
 * Wavelength in tiles ≈ 2π / freq when used with {@link WILD_GROUP_LEADER_ROAM_WAVINESS_LATERAL_TILES}.
 */
export const WILD_GROUP_LEADER_ROAM_SPATIAL_FREQ_RAD_PER_TILE = 0.5;

/** Extra lateral offset on P1 when spatial freq is non-zero: multiplied by sin(phase). */
export const WILD_GROUP_LEADER_ROAM_WAVINESS_LATERAL_TILES = 2;

/** Segments for debug polyline of the leader ROAM Bezier. */
export const WILD_GROUP_LEADER_ROAM_BEZIER_SAMPLES = 20;
