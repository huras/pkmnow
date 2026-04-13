/** Max simultaneous projectiles / particles (drop oldest on overflow). */
export const MAX_PROJECTILES = 120;
export const MAX_PARTICLES = 400;

/** Match Zelda `Constants.FIRE_FRAME_*` (spritesheet slice size). */
export const FIRE_FRAME_W = 32;
export const FIRE_FRAME_H = 32;

/** burn-start.png: 5 frames of 32×32 stacked vertically. */
export const BURN_START_FRAME = 32;
export const BURN_START_FRAMES = 5;

/** Seconds between trail particles per projectile (replaces random spam). */
export const EMBER_TRAIL_INTERVAL = 0.045;
export const WATER_TRAIL_INTERVAL = 0.038;

/** Wild AI primary move interval (seconds). */
export const WILD_MOVE_COOLDOWN_DEFAULT = 1.15;

/** Broad-phase: skip hit test if farther than this (tiles). */
export const COLLISION_BROAD_PHASE_TILES = 4;
