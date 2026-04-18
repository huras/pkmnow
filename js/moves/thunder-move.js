/**
 * Thunder / Thunderbolt move — summons a quick dark storm cell above the target tile,
 * then drops a yellow bolt that reuses the rain-lightning system (same jagged path,
 * screen flash, grass/tree ignition) but with a yellow palette and splash damage.
 *
 * Three distinct "takes" mapped to charge bar levels (see `play-charge-levels.js`):
 *   - Level 1 (tap / below first bar):   small puff, 1 thin bolt, low damage.
 *   - Level 2 (first full bar):          medium puff, 1 standard bolt, default damage.
 *   - Level 3 (second+ bar, max charge): big puff, 3 staggered bolts in a spread,
 *                                        larger splash, much higher total damage.
 *
 * Flow per cast:
 *   1. `spawnSummonedThunderCloudAt(tx, ty, { scale })` — transient dark puff at the target.
 *   2. One or more strikes are queued with `boltAtMs = now + SUMMONED_THUNDER_BOLT_DELAY_MS (+ stagger)`.
 *   3. `tickThunderStrikes(dt, wildList, data, wildSpatial)` resolves the queue:
 *        - `spawnGroundStrikeAt(...)` with `{ color: 'yellow', flashCloudSlot: false }`.
 *        - splash damage on wild pokemon in the strike's radius.
 */

import {
  spawnSummonedThunderCloudAt,
  spawnGroundStrikeAt,
  SUMMONED_THUNDER_BOLT_DELAY_MS,
  setChargingThunderPreview,
  clearChargingThunderPreview
} from '../weather/lightning.js';
import { applySplashToWild } from './moves-projectile-collision.js';
import { getChargeLevel, isChargeStrongAttackEligible } from '../main/play-charge-levels.js';
import { playThunderStrikeSfx } from '../audio/thunder-strike-sfx.js';

/** @typedef {1 | 2 | 3} ThunderLevel */

/**
 * Per-level tuning. Keep in sync with `PLAYER_THUNDER_COOLDOWN_BY_LEVEL` in moves-manager.js.
 * - `cloudScale` / `cloudDurationMs`: visual storm cell size + lifetime.
 * - `bolts`: per-bolt offset (tiles, relative to aim), extra delay (ms), damage, splash radius.
 */
const THUNDER_LEVEL_CONFIG = {
  1: {
    cloudScale: 0.7,
    cloudDurationMs: 220,
    bolts: [{ dx: 0, dy: 0, delayMs: 0, damage: 14, splashRadius: 0.95 }]
  },
  2: {
    cloudScale: 1.0,
    cloudDurationMs: 260,
    bolts: [{ dx: 0, dy: 0, delayMs: 0, damage: 26, splashRadius: 1.35 }]
  },
  3: {
    cloudScale: 1.55,
    cloudDurationMs: 420,
    bolts: [
      { dx: 0, dy: 0, delayMs: 0, damage: 34, splashRadius: 1.85 },
      { dx: -0.85, dy: 0.35, delayMs: 65, damage: 28, splashRadius: 1.55 },
      { dx: 0.9, dy: -0.3, delayMs: 130, damage: 28, splashRadius: 1.55 }
    ]
  }
};

/**
 * @typedef {object} PendingThunderStrike
 * @property {number} worldX
 * @property {number} worldY
 * @property {number} boltAtMs  Absolute `performance.now()` when the bolt should fire.
 * @property {number} splashRadius
 * @property {number} splashDamage
 * @property {object | null} sourceEntity
 * @property {boolean} fromWild
 */

/** @type {PendingThunderStrike[]} */
const pendingStrikes = [];

/** Clamp a user-supplied level to the 1..3 range (defaults to 2 = "standard thunderbolt"). */
function clampLevel(level) {
  const n = Number(level);
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return n === 2 ? 2 : 2;
}

/**
 * Schedule a Thunder strike at the target tile. Caller handles cooldown / cast visuals.
 * @param {number} targetX  world-tile X
 * @param {number} targetY  world-tile Y
 * @param {object | null} sourceEntity
 * @param {{ fromWild?: boolean, level?: ThunderLevel }} [opts]
 */
export function scheduleThunderStrike(targetX, targetY, sourceEntity = null, opts = {}) {
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;
  const level = clampLevel(opts.level ?? 2);
  const cfg = THUNDER_LEVEL_CONFIG[level];
  const now = performance.now();

  spawnSummonedThunderCloudAt(targetX, targetY, {
    color: 'yellow',
    durationMs: cfg.cloudDurationMs,
    scale: cfg.cloudScale
  });

  for (const b of cfg.bolts) {
    pendingStrikes.push({
      worldX: targetX + b.dx,
      worldY: targetY + b.dy,
      boltAtMs: now + SUMMONED_THUNDER_BOLT_DELAY_MS + b.delayMs,
      splashRadius: b.splashRadius,
      splashDamage: b.damage,
      sourceEntity: sourceEntity || null,
      fromWild: !!opts.fromWild
    });
  }
}

/**
 * Resolve any pending strikes whose delay has elapsed: fire a yellow ground bolt and
 * splash-damage wild pokemon in radius. Grass / tree ignition is handled inside
 * `spawnGroundStrikeAt` itself (it's identical to the rain-triggered bolt).
 *
 * @param {number} _dt  seconds; unused (wall clock via `performance.now()`)
 * @param {Array<object> | Iterable<object>} wildList
 * @param {object | null} data
 * @param {Map<string, any[]> | null} wildSpatial  optional spatial index from moves-manager
 */
export function tickThunderStrikes(_dt, wildList, data, wildSpatial = null) {
  if (pendingStrikes.length === 0) return;
  const now = performance.now();
  const list = Array.isArray(wildList) ? wildList : wildList ? [...wildList] : [];
  for (let i = pendingStrikes.length - 1; i >= 0; i--) {
    const strike = pendingStrikes[i];
    if (now < strike.boltAtMs) continue;
    pendingStrikes.splice(i, 1);

    spawnGroundStrikeAt(strike.worldX, strike.worldY, data, {
      color: 'yellow',
      flashCloudSlot: false
    });
    playThunderStrikeSfx({ x: strike.worldX, y: strike.worldY, z: 0 });
    // Reuse the projectile splash helper via a minimal duck-typed object (no projectile
    // actually travels — the bolt is instant by design, matching the rain lightning).
    applySplashToWild(
      {
        x: strike.worldX,
        y: strike.worldY,
        z: 0,
        splashRadius: strike.splashRadius,
        splashDamage: strike.splashDamage,
        sourceEntity: strike.sourceEntity,
        fromWild: strike.fromWild
      },
      list,
      0,
      wildSpatial
    );
  }
}

/** Drop any queued strikes (map transitions / reset). */
export function clearPendingThunderStrikes() {
  pendingStrikes.length = 0;
}

/**
 * While the player holds a Thunder-bound button, publish (or refresh) the charging cloud
 * at the current aim so the cell grows in and glimmers before the release. Level 1 tap
 * stays silent on purpose — {@link isChargeStrongAttackEligible} gates the preview on
 * reaching the first full bar, and we pick {@linkcode chargeLevel} 2 or 3 from the same
 * `getChargeLevel` ladder the release uses. This is the "stealth → tell" trade-off:
 * stronger strikes broadcast themselves, tap zaps still surprise.
 * @param {string} ownerId           per-input key (e.g. `'lmb'` / `'rmb'` / `'mmb'`)
 * @param {{ worldX: number, worldY: number, charge01: number }} opts
 */
export function publishThunderChargePreview(ownerId, opts) {
  const charge01 = Math.max(0, Math.min(1, Number(opts?.charge01) || 0));
  if (!isChargeStrongAttackEligible(charge01)) {
    clearChargingThunderPreview(ownerId);
    return;
  }
  const cl = getChargeLevel(charge01);
  const chargeLevel = cl >= 3 ? 3 : 2;
  setChargingThunderPreview(ownerId, {
    worldX: opts?.worldX,
    worldY: opts?.worldY,
    charge01,
    chargeLevel,
    color: 'yellow'
  });
}

/**
 * Withdraw an owner's preview (release / cancel / button swap). No-op on unknown ids.
 */
export function withdrawThunderChargePreview(ownerId) {
  clearChargingThunderPreview(ownerId);
}
