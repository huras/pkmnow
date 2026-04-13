import { getMicroTile } from './chunking.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import { playChunkMap } from './render/play-chunk-cache.js';

/** Seconds active burn before switching to charred (gameplay + scorched “burning” look). */
export const GRASS_FIRE_BURN_PHASE_SEC = 3.25;
/** Grass-fire particle lifetime (slightly longer than burn so flames don’t vanish first). */
export const GRASS_FIRE_PARTICLE_SEC = GRASS_FIRE_BURN_PHASE_SEC + 0.65;
/** Seconds charred ground before regrowth. */
const CHARRED_REGROW_SEC = 16;
/** Max |z| (tiles) for projectile end to count as ground impact. */
const GROUND_Z_MAX = 0.55;

const FIRE_PROJECTILE_TYPES = new Set(['ember', 'flamethrowerShot', 'incinerateShard', 'incinerateCore']);
const WATER_PROJECTILE_TYPES = new Set(['waterShot', 'waterGunShot', 'bubbleShot']);

/** @typedef {{ phase: 'burning' | 'charred', phaseEndAt: number }} GrassFireTileState */

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
    tileStates.set(k, { phase: 'burning', phaseEndAt: Math.max(existing.phaseEndAt, burnEnd) });
    return false;
  }
  tileStates.set(k, { phase: 'burning', phaseEndAt: burnEnd });
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
 * Throttled phase transitions (wall-clock `phaseEndAt`, safe when off-screen).
 * @param {number} dt
 * @param {object | null} _data unused; reserved for future biome rules
 */
export function updateGrassFire(dt, _data, _playerX, _playerY) {
  throttleAccSec += dt;
  if (throttleAccSec < UPDATE_INTERVAL_SEC) return;
  throttleAccSec = 0;

  const now = performance.now();
  const entries = [...tileStates.entries()];
  for (const [k, st] of entries) {
    if (now < st.phaseEndAt) continue;
    if (st.phase === 'burning') {
      tileStates.set(k, { phase: 'charred', phaseEndAt: now + CHARRED_REGROW_SEC * 1000 });
    } else {
      tileStates.delete(k);
    }
  }
}
