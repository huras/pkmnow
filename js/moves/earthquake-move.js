/**
 * Earthquake — charged Normal ground move: one hop; impact ring damages trees / breakables /
 * ground crystal drops (not decorative grass scatter), hits wilds in radius, and drives the
 * global earthquake shake layer + timed aftershocks on high charge (up to 5 charge tiers).
 */

import { getEarthquakeChargeLevel, getEarthquakeChargeRange01 } from '../main/play-charge-levels.js';
import { tryBreakDetailsInCircle } from '../main/play-crystal-tackle.js';
import { shatterCrystalDropsInRadius } from '../main/play-crystal-drops.js';
import { tryPlayerCutHitWildCircle } from '../wild-pokemon/wild-player-interactions.js';
import { enqueueEarthquakeMovePulse } from '../main/earthquake-layer.js';

/**
 * @param {number} chargeLevel 1..5
 * @param {number} charge01
 */
function earthquakeRadiusTiles(chargeLevel, charge01) {
  const lv = Math.max(1, Math.min(5, Math.floor(chargeLevel) || 1));
  const range01 = getEarthquakeChargeRange01(charge01);
  return 3.2 + (lv - 1) * 2.85 + range01 * 2.1;
}

/** Screen / audio rumble length by charge level (seconds). Max tier ≈ 8.2s. */
function earthquakeSustainSecForLevel(level) {
  const lv = Math.max(1, Math.min(5, Math.floor(Number(level)) || 1));
  const table = { 1: 2.0, 2: 3.6, 3: 5.2, 4: 7.0, 5: 8.2 };
  return table[lv] ?? 8.2;
}

/** Aftershock count scales with tier; L5 adds one more than L4. */
function earthquakeAftershockCountForLevel(level) {
  const lv = Math.max(1, Math.min(5, Math.floor(Number(level)) || 1));
  if (lv <= 1) return 0;
  if (lv === 2) return 2;
  if (lv === 3) return 4;
  if (lv === 4) return 5;
  return 6;
}

/**
 * Call from `player.js` when the player lands after a vertical hop (`z` hits floor).
 * @param {import('../player.js').player} player
 * @param {object | null} data
 * @param {number} zJumpPrev z at start of the landing physics step (before gravity + dz).
 * @param {number} gameTimeSec world / game time seconds (aftershocks + layer tick clock).
 * @param {number} [vzBeforeLand] vertical velocity after gravity, before applying dz (tiles/s scale).
 *   Strong charged jumps can cross the floor in one step from very small z; then zJumpPrev is tiny but fall speed is real.
 */
export function onPlayerEarthquakeLanding(player, data, zJumpPrev, gameTimeSec, vzBeforeLand = 0) {
  if (!player?.earthquakeAwaitingLand) return;
  const zp = Number(zJumpPrev) || 0;
  const vz = Number(vzBeforeLand);
  const hadRealImpact =
    zp > 0.04 || (Number.isFinite(vz) && vz < -0.65);
  if (!hadRealImpact) {
    player.earthquakeAwaitingLand = false;
    return;
  }
  player.earthquakeAwaitingLand = false;
  const c01 = Math.max(0, Math.min(1, Number(player.earthquakeStoredCharge01) || 0));
  player.earthquakeStoredCharge01 = 0;
  const lvl = Math.max(1, Math.min(5, getEarthquakeChargeLevel(c01)));
  const px = Number(player.x);
  const py = Number(player.y);
  if (!data || !Number.isFinite(px) || !Number.isFinite(py)) return;

  const radius = earthquakeRadiusTiles(lvl, c01);
  const pz = Number(player.z) || 0;

  tryBreakDetailsInCircle(px, py, radius, data, {
    hitSource: 'tackle',
    detailCharge01: c01,
    pz,
    excludePureGrassScatterHits: true,
    treeDemolishOneShot: lvl >= 5
  });
  shatterCrystalDropsInRadius(px, py, radius * 0.92, data);

  const wildDmg = 22 + lvl * 14;
  const wildKb = 3.4 + lvl * 0.75;
  tryPlayerCutHitWildCircle(player, data, px, py, radius, {
    damage: wildDmg,
    knockback: wildKb,
    cutWildHitSound: false,
    ignoreProjectileZForGroundWave: true
  });

  const mainPeak = Math.min(1, 0.52 + lvl * 0.1 + c01 * 0.18);
  const nAfter = earthquakeAftershockCountForLevel(lvl);
  const afterPeaks = [];
  let decay = 0.5;
  for (let i = 0; i < nAfter; i++) {
    afterPeaks.push(mainPeak * decay);
    decay *= 0.58;
  }
  const t0 =
    gameTimeSec != null && Number.isFinite(gameTimeSec)
      ? gameTimeSec
      : typeof performance !== 'undefined'
        ? performance.now() * 0.001
        : 0;
  enqueueEarthquakeMovePulse(mainPeak, afterPeaks, t0, {
    sustainSec: earthquakeSustainSecForLevel(lvl)
  });
}
