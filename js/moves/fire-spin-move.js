/**
 * Fire Spin — hold to channel a tightening fire ring around the Pokémon (radius wobbles on a sine
 * while spin rate ramps with charge + channel time). Release sends the gathered fire outward in a
 * burst whose reach and shot size scale with the 3-tier charge ladder (same mapping as Fire Blast).
 */

import { EMBER_TRAIL_INTERVAL, FIRE_FRAME_H, FIRE_FRAME_W } from './move-constants.js';
import { isChargeStrongAttackEligible, getChargeLevel } from '../main/play-charge-levels.js';

/** @typedef {1 | 2 | 3} FireSpinTier */

export const PLAYER_FIRE_SPIN_COOLDOWN_BY_LEVEL = Object.freeze({
  1: 0.52,
  2: 0.68,
  3: 0.84
});

const MAX_CHANNEL_SEC = 1.35;

/**
 * @param {import('../player.js').player} player
 */
export function resetFireSpinChannel(player) {
  if (!player) return;
  player.fireSpinChannelSec = 0;
  player.fireSpinOrbitAngle = 0;
  player.fireSpinParticleAcc = 0;
}

/**
 * While holding Fire Spin: advance orbit, spawn sparks on a ring with sine-modulated radius.
 * @param {import('../player.js').player} player
 * @param {number} dt
 * @param {(p: object) => void} pushParticle
 * @param {number} charge01 — bound-slot charge 0..1 (same meter as other charged moves)
 */
export function tickFireSpinHold(player, dt, pushParticle, charge01) {
  if (!player || !pushParticle) return;
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  player.fireSpinChannelSec = Math.min(MAX_CHANNEL_SEC, (player.fireSpinChannelSec || 0) + dt);
  const ch = player.fireSpinChannelSec || 0;
  const ramp = Math.min(1, ch / MAX_CHANNEL_SEC);
  const spinRate = 4.2 + cp * 6.5 + ramp * 9.0 + ch * 1.8;
  player.fireSpinOrbitAngle = (player.fireSpinOrbitAngle || 0) + spinRate * dt;
  const a = player.fireSpinOrbitAngle;
  const baseR = 0.38 + cp * 0.42 + ramp * 0.55;
  const wobble = 0.12 + cp * 0.16 + ramp * 0.22;
  const R = Math.max(0.18, baseR + Math.sin(a * 2.1) * wobble);
  const px = (player.visualX ?? player.x) + 0.5 + Math.cos(a) * R;
  const py = (player.visualY ?? player.y) + 0.5 + Math.sin(a) * R;
  const pz = Math.max(0.06, (player.z || 0) * 0.35 + 0.08);
  const interval = Math.max(0.012, 0.034 - ramp * 0.018 - cp * 0.008);
  player.fireSpinParticleAcc = (player.fireSpinParticleAcc || 0) + dt;
  while ((player.fireSpinParticleAcc || 0) >= interval) {
    player.fireSpinParticleAcc -= interval;
    const jitter = (Math.random() - 0.5) * 0.06;
    pushParticle({
      type: 'fireSpinSpark',
      x: px + jitter,
      y: py + jitter,
      z: pz + Math.random() * 0.04,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      vz: 0.15 + Math.random() * 0.2,
      life: 0.14 + ramp * 0.12 + cp * 0.08,
      maxLife: 0.14 + ramp * 0.12 + cp * 0.08,
      size01: 0.35 + ramp * 0.45 + cp * 0.25
    });
  }
  const second = a + Math.PI * 0.72;
  const R2 = Math.max(0.16, baseR * 0.82 + Math.sin(second * 1.9) * wobble * 0.9);
  if (ramp > 0.35 || cp > 0.35) {
    pushParticle({
      type: 'fireSpinSpark',
      x: (player.visualX ?? player.x) + 0.5 + Math.cos(second) * R2,
      y: (player.visualY ?? player.y) + 0.5 + Math.sin(second) * R2,
      z: pz * 0.92,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      vz: 0.12,
      life: 0.12 + ramp * 0.1,
      maxLife: 0.12 + ramp * 0.1,
      size01: 0.32 + ramp * 0.35
    });
  }
}

/**
 * @param {(p: object) => void} pushProjectile
 * @param {object | null} sourceEntity
 * @param {number} cx
 * @param {number} cy
 * @param {number} aimNx
 * @param {number} aimNy
 * @param {FireSpinTier} tier
 * @param {number} channelSec
 */
export function spawnFireSpinReleaseBurst(pushProjectile, sourceEntity, cx, cy, aimNx, aimNy, tier, channelSec) {
  const ch = Math.max(0, Math.min(1, channelSec / MAX_CHANNEL_SEC));
  const kick = 0.55 + ch * 0.95 + (tier === 3 ? 0.45 : tier === 2 ? 0.22 : 0);
  const n = tier === 3 ? 18 : tier === 2 ? 13 : 8;
  const z0 = Math.max(0.04, (sourceEntity?.z || 0) * 0.4 + 0.06);
  const baseA = Math.atan2(aimNy, aimNx);
  const dmg = tier === 3 ? 5.2 : tier === 2 ? 3.8 : 2.6;
  const rad = tier === 3 ? 0.2 : tier === 2 ? 0.17 : 0.14;
  const ttl = tier === 3 ? 0.52 : tier === 2 ? 0.45 : 0.38;
  const spdLo = 4.8 + kick * 3.6 + (tier - 1) * 1.1;
  const spdHi = spdLo + 2.4 + (tier - 1) * 0.8;
  for (let i = 0; i < n; i++) {
    const spread = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.14;
    const a = baseA + spread + (Math.random() - 0.5) * 0.2;
    const speed = spdLo + Math.random() * (spdHi - spdLo);
    pushProjectile({
      type: 'fireSpinBurst',
      x: cx,
      y: cy,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      vz: 1.1 + Math.random() * 0.55 + (tier - 1) * 0.15,
      z: z0,
      radius: rad * (0.92 + ch * 0.2),
      timeToLive: ttl + Math.random() * 0.08,
      damage: dmg * (0.92 + ch * 0.18),
      spinTier: tier,
      spinKick: kick,
      sourceEntity,
      fromWild: false,
      hitsWild: true,
      hitsPlayer: false,
      trailAcc: EMBER_TRAIL_INTERVAL * (i / Math.max(1, n - 1)),
      trailIntervalMul: tier === 3 ? 0.75 : tier === 2 ? 0.88 : 1,
      sheetFrameW: FIRE_FRAME_W,
      sheetFrameH: FIRE_FRAME_H,
      sheetFrames: 4
    });
  }
}

/**
 * Map charge meter to tier (Fire Blast / Thunder style).
 * @param {number} charge01
 * @returns {FireSpinTier}
 */
export function fireSpinTierFromCharge01(charge01) {
  const cp = Math.max(0, Math.min(1, charge01 || 0));
  if (!isChargeStrongAttackEligible(cp)) return 1;
  const cl = getChargeLevel(cp);
  return cl >= 3 ? 3 : 2;
}
