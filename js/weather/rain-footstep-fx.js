/**
 * Water footstep splashes left behind when the player walks during rain.
 *
 * Distance-accumulator so cadence tracks the player's actual travel (frame-rate
 * independent, mirrors `advanceFootFloorStepsForDistance` from the foot SFX).
 * Pushes short-lived `rainFootSplash` particles into `activeParticles` at the
 * player's feet; those particles have no motion update (see `moves-manager.js`)
 * so they read as footprints that wet the ground.
 */

import { activeParticles } from '../moves/moves-manager.js';
import { MAX_PARTICLES } from '../moves/move-constants.js';
import { getWeatherRainIntensity } from '../main/weather-state.js';

/** Below this rain intensity, walking leaves no water trail (avoids trace-rain noise). */
const RAIN_FOOTSTEP_MIN_INTENSITY = 0.15;
/** World tiles between splashes at max rain; heavier rain shrinks the interval. */
const RAIN_FOOTSTEP_TILES_PER_SPLASH_BASE = 0.45;
/** Random lateral scatter around the feet (tiles). */
const RAIN_FOOTSTEP_SCATTER_TILES = 0.18;
/** Per-splash life in seconds (with small random jitter). */
const RAIN_FOOTSTEP_LIFE_SEC = 0.32;

/**
 * @param {{ _rainFootstepAccTiles?: number }} state  Any object; stores per-entity accumulator.
 * @param {number} distTiles  World-tile distance moved this frame.
 * @param {boolean} active    Gate: grounded, not airborne / burrow / etc.
 * @param {number} feetX      World-tile X for splash spawn.
 * @param {number} feetY      World-tile Y for splash spawn.
 */
export function advanceRainFootstepFxForDistance(state, distTiles, active, feetX, feetY) {
  if (!active) {
    state._rainFootstepAccTiles = 0;
    return;
  }
  const intensity = getWeatherRainIntensity();
  if (intensity < RAIN_FOOTSTEP_MIN_INTENSITY) {
    state._rainFootstepAccTiles = 0;
    return;
  }
  const d = Math.max(0, Number(distTiles) || 0);
  if (d <= 1e-8) return;

  // Heavier rain → shorter interval (more splashes per tile walked).
  const interval = RAIN_FOOTSTEP_TILES_PER_SPLASH_BASE / Math.max(0.35, intensity);

  let acc = (state._rainFootstepAccTiles || 0) + d;
  // Clamp runaway catch-up after pause / frame spikes so we don't burst-spawn.
  const maxAcc = interval * 4;
  if (acc > maxAcc) acc = maxAcc;

  while (acc >= interval) {
    acc -= interval;
    spawnOneSplash(feetX, feetY);
  }
  state._rainFootstepAccTiles = acc;
}

function spawnOneSplash(feetX, feetY) {
  if (activeParticles.length >= MAX_PARTICLES) return;
  const ang = Math.random() * Math.PI * 2;
  const r = Math.random() * RAIN_FOOTSTEP_SCATTER_TILES;
  const life = RAIN_FOOTSTEP_LIFE_SEC * (0.82 + Math.random() * 0.36);
  activeParticles.push({
    type: 'rainFootSplash',
    x: feetX + Math.cos(ang) * r,
    y: feetY + Math.sin(ang) * r,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life,
    maxLife: life,
    variant: (Math.random() * 3) | 0
  });
}
