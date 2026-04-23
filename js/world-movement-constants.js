/**
 * Canonical max horizontal walk speed on the world grid (tiles per second),
 * after diagonal input is normalized to unit length — same basis as `updatePlayer` clamp.
 * Wild wander / pacing should use this so NPCs stay visually in step with the player.
 */
export const WORLD_MAX_WALK_SPEED_TILES_PER_SEC = 3.2;

/** Vertical gravity for entity `z` / `vz` integration (matches historical `player.js` tuning). */
export const ENTITY_GRAVITY = 9.8;

/** Initial upward `vz` for a jump at scale 1 (see `tryJumpPlayer` / `tryWildPokemonJump`). */
export const ENTITY_JUMP_IMPULSE = 4.5;

/** Max air jumps before landing (non–Flying-type player baseline). */
export const ENTITY_AIR_JUMP_MAX_GROUND = 2;

/** Flying-type player baseline while not in creative flight latch (see `tryJumpPlayer`). */
export const ENTITY_AIR_JUMP_MAX_FLYING = 6;
