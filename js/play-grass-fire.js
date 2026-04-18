import { getMicroTile } from './chunking.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import { playChunkMap } from './render/play-chunk-cache.js';
import { isRainExtinguishing, FIRE_RAIN_EXTINGUISH_GRACE_SEC } from './main/weather-state.js';

/** Seconds active burn (orange fire look) before switching to charred black. */
export const GRASS_FIRE_BURN_PHASE_SEC = 10;
/** Grass-fire particle lifetime (slightly longer than burn so flames don’t vanish first). */
export const GRASS_FIRE_PARTICLE_SEC = GRASS_FIRE_BURN_PHASE_SEC + 0.85;
/** Full black charred look before regrowth blend begins. */
export const GRASS_FIRE_CHARRED_SOLID_SEC = 2.5;
/** Seconds to blend charred → normal grass (not instant). */
export const GRASS_FIRE_REGROW_BLEND_SEC = 12;
/** Max |z| (tiles) for projectile end to count as ground impact. */
const GROUND_Z_MAX = 0.55;

const FIRE_PROJECTILE_TYPES = new Set(['ember', 'flamethrowerShot', 'incinerateShard', 'incinerateCore', 'lightningStrike']);
const WATER_PROJECTILE_TYPES = new Set(['waterShot', 'waterGunShot', 'bubbleShot']);

/** @typedef {{ phase: 'burning', phaseEndAt: number, startedAtMs: number } | { phase: 'charred', startedAtMs: number }} GrassFireTileState */

/** @type {Map<string, GrassFireTileState>} */
const tileStates = new Map();

let throttleAccSec = 0;
const UPDATE_INTERVAL_SEC = 0.12;

export function clearGrassFireStateForNewMap() {
  tileStates.clear();
  throttleAccSec = 0;
}

/**
 * While burning or charred, animated grass for this cell is skipped (replaced by scorched overlay).
 */
export function grassFireSuppressesAnimatedGrassAt(mx, my) {
  return tileStates.has(tileKey(mx, my));
}

/** @returns {'burning' | 'charred' | null} */
export function grassFireVisualPhaseAt(mx, my) {
  return tileStates.get(tileKey(mx, my))?.phase ?? null;
}

/**
 * During `charred`: 0 = solid black window, (0,1) = regrowth blend, 1 = fully restored (tile cleared next tick).
 * @returns {number | null} null if not charred
 */
export function grassFireCharredRegrowth01(mx, my) {
  const st = tileStates.get(tileKey(mx, my));
  if (!st || st.phase !== 'charred') return null;
  const elapsed = (performance.now() - st.startedAtMs) / 1000;
  if (elapsed < GRASS_FIRE_CHARRED_SOLID_SEC) return 0;
  const blendT = elapsed - GRASS_FIRE_CHARRED_SOLID_SEC;
  if (blendT >= GRASS_FIRE_REGROW_BLEND_SEC) return 1;
  return blendT / GRASS_FIRE_REGROW_BLEND_SEC;
}

function tileKey(mx, my) {
  return `${mx},${my}`;
}

function tryIgnite(mx, my, data) {
  const getTile = (x, y) => getMicroTile(x, y, data);
  if (!isPlayGrassFlammableInner(mx, my, data, getTile, playChunkMap)) return false;

  const now = performance.now();
  const k = tileKey(mx, my);
  const burnEnd = now + GRASS_FIRE_BURN_PHASE_SEC * 1000;
  const existing = tileStates.get(k);
  if (existing?.phase === 'burning' && existing.phaseEndAt > now) {
    // Preserve the original ignition time so rain's grace period stays honest on re-ignite.
    tileStates.set(k, {
      phase: 'burning',
      phaseEndAt: Math.max(existing.phaseEndAt, burnEnd),
      startedAtMs: existing.startedAtMs
    });
    return false;
  }
  tileStates.set(k, { phase: 'burning', phaseEndAt: burnEnd, startedAtMs: now });
  return true;
}

function isPlayGrassFlammableInner(mx, my, data, getTile, playChunkMap) {
  const { base, top } = getPlayAnimatedGrassLayers(mx, my, data, getTile, playChunkMap);
  return base || top;
}

/**
 * @param {object} data map macro data
 * @returns {boolean} true if grass caught fire (caller may spawn FX).
 */
export function grassFireTryIgniteAt(worldX, worldY, projZ, projType, data) {
  if (!data || !FIRE_PROJECTILE_TYPES.has(projType)) return false;
  if (Math.abs(Number(projZ) || 0) > GROUND_Z_MAX) return false;
  const mx = Math.floor(worldX);
  const my = Math.floor(worldY);
  return tryIgnite(mx, my, data);
}

/**
 * Remove burning/charred state on tile (water hit).
 */
export function grassFireTryExtinguishAt(worldX, worldY, projZ, projType, data) {
  if (!data || !WATER_PROJECTILE_TYPES.has(projType)) return false;
  if (Math.abs(Number(projZ) || 0) > GROUND_Z_MAX) return false;
  const mx = Math.floor(worldX);
  const my = Math.floor(worldY);
  const getTile = (x, y) => getMicroTile(x, y, data);
  if (!isPlayGrassFlammableInner(mx, my, data, getTile, playChunkMap)) return false;
  const k = tileKey(mx, my);
  if (!tileStates.has(k)) return false;
  tileStates.delete(k);
  return true;
}

/**
 * Throttled phase transitions (burn uses `phaseEndAt`; charred uses `startedAtMs` + solid + blend duration).
 * @param {number} dt
 * @param {object | null} _data unused; reserved for future biome rules
 */
export function updateGrassFire(dt, _data, _playerX, _playerY) {
  const now = performance.now();
  const isRaining = isRainExtinguishing();

  // Rain snuffing runs every frame so dousing feels responsive (not gated by the 120ms throttle).
  if (isRaining && tileStates.size > 0) {
    const graceMs = FIRE_RAIN_EXTINGUISH_GRACE_SEC * 1000;
    for (const [k, st] of tileStates) {
      if (st.phase !== 'burning') continue;
      if (now - st.startedAtMs < graceMs) continue;
      tileStates.set(k, { phase: 'charred', startedAtMs: now });
    }
  }

  throttleAccSec += dt;
  if (throttleAccSec < UPDATE_INTERVAL_SEC) return;
  throttleAccSec = 0;

  const charredTotalSec = GRASS_FIRE_CHARRED_SOLID_SEC + GRASS_FIRE_REGROW_BLEND_SEC;
  const entries = [...tileStates.entries()];
  for (const [k, st] of entries) {
    if (st.phase === 'burning') {
      if (now < st.phaseEndAt) continue;
      tileStates.set(k, { phase: 'charred', startedAtMs: now });
      continue;
    }
    if (st.phase === 'charred') {
      const elapsed = (now - st.startedAtMs) / 1000;
      if (elapsed >= charredTotalSec) tileStates.delete(k);
    }
  }
}
