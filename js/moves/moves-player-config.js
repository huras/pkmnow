/**
 * Player move timing: stream cadences, weather swaps, and other values that belong next to
 * gameplay tuning (not scattered through `moves-manager.js`). Import this module when adding
 * a new hold-stream or cooldown so HUD + cast logic stay aligned.
 */

/** Visual window for optional `shoot` PMD slice after a successful player cast. */
export const MOVE_CAST_VIS_SEC = 0.48;

// --- Flamethrower (hold stream) ---
/** Seconds between stream puffs at low projectile pressure. */
export const FLAMETHROWER_STREAM_INTERVAL = 0.104;
/** Adaptive upper cadence under heavy projectile/particle load. */
export const FLAMETHROWER_STREAM_INTERVAL_MAX = 0.176;
/** Collision cadence for stream shots (render stays at full FPS). */
export const FLAMETHROWER_STREAM_HIT_TICK_SEC = 1 / 30;

// --- Water Gun / Bubble Beam (hold streams) ---
export const WATER_GUN_STREAM_INTERVAL = 0.074;
export const BUBBLE_BEAM_STREAM_INTERVAL = 0.078;

// --- Prismatic Laser (hold stream) ---
export const PRISMATIC_STREAM_INTERVAL = 0.25;
/** Min seconds between stream segment damage ticks to the same wild (overlapping puffs). */
export const PRISMATIC_STREAM_WILD_HIT_COOLDOWN_SEC = 0.3;

// --- Thunder (tap / charge tiers) ---
/** Default cooldown — Level 2 tap; see {@link PLAYER_THUNDER_COOLDOWN_BY_LEVEL}. */
export const PLAYER_THUNDER_COOLDOWN_SEC = 0.95;
/** Per-charge-level cooldowns (tap/L1, L2, L3). */
export const PLAYER_THUNDER_COOLDOWN_BY_LEVEL = Object.freeze({ 1: 0.55, 2: 0.95, 3: 1.55 });

// --- Weather swaps ---
export const PLAYER_WEATHER_SWAP_COOLDOWN_SEC = 4.5;
