/**
 * Canonical max horizontal walk speed on the world grid (tiles per second),
 * after diagonal input is normalized to unit length — same basis as `updatePlayer` clamp.
 * Wild wander / pacing should use this so NPCs stay visually in step with the player.
 */
export const WORLD_MAX_WALK_SPEED_TILES_PER_SEC = 3.2;
