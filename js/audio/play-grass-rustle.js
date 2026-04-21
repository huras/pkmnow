import { playerHasAnimatedGrassUnderfoot } from '../play-grass-cut.js';
import { speciesHasFlyingType } from '../pokemon/pokemon-type-helpers.js';
import { tryGrassWalkHostileWildSpawn } from '../wild-pokemon/grass-walk-hostile-spawn.js';
import { isPlayerUndergroundBurrowWalkActive } from '../wild-pokemon/underground-burrow.js';
import { playGrassRustleSfx } from './grass-rustle-sfx.js';

/** Seconds between rustles while moving inside the same grass tile / area. */
const WALK_RUSTLE_INTERVAL_SEC = 0.34;

let wasInGrass = false;
let rustleCooldownSec = 0;

/**
 * One shot on entering tall grass; repeats on a cadence while walking on foot in grass.
 * @param {number} dt
 * @param {import('../player.js').player} player
 * @param {object | null | undefined} data
 */
export function updatePlayGrassRustle(dt, player, data) {
  if (!player) {
    wasInGrass = false;
    rustleCooldownSec = 0;
    return;
  }
  if (!data) {
    wasInGrass = false;
    rustleCooldownSec = 0;
    return;
  }

  if (speciesHasFlyingType(player.dexId ?? 0) && player.flightActive) {
    wasInGrass = false;
    rustleCooldownSec = 0;
    return;
  }

  const spd = Math.hypot(player.vx ?? 0, player.vy ?? 0);
  const isAirborne = !!(player.jumping || (player.z ?? 0) > 0.06);
  const burrowWalk = isPlayerUndergroundBurrowWalkActive(player.dexId ?? 0, {
    isAirborne,
    grounded: !!player.grounded,
    isMoving: spd > 0.1,
    digBurrowMode: !!player.digBurrowMode
  });
  if (burrowWalk) {
    wasInGrass = false;
    rustleCooldownSec = 0;
    return;
  }

  const groundedish = !!player.grounded && (player.z ?? 0) < 0.06;
  const mx = Math.floor(player.visualX ?? player.x);
  const my = Math.floor(player.visualY ?? player.y);
  const inGrass = groundedish && playerHasAnimatedGrassUnderfoot(mx, my, data);
  const walking = spd > 0.1;

  rustleCooldownSec = Math.max(0, rustleCooldownSec - Math.max(0, dt));

  if (!inGrass) {
    wasInGrass = false;
    return;
  }

  if (!wasInGrass) {
    wasInGrass = true;
    playGrassRustleSfx(player);
    rustleCooldownSec = WALK_RUSTLE_INTERVAL_SEC;
    return;
  }

  if (walking && rustleCooldownSec <= 0) {
    playGrassRustleSfx(player);
    rustleCooldownSec = WALK_RUSTLE_INTERVAL_SEC;
    tryGrassWalkHostileWildSpawn(player, data);
  }
}
