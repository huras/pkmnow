import { MACRO_TILE_STRIDE } from '../chunking.js';
import { entitiesByKey } from './wild-core-state.js';
import { findWalkableWildSpawnNear, allocateDebugSummonKey } from './wild-spawn-window.js';
import { clearWildPokemonFainted } from './wild-pokemon-persistence.js';

/**
 * Find nearest fainted/sleep-dead wild near player facing direction (for Strength pick-up).
 * @returns {object | null}
 */
export function findCarryableFaintedWildNear(playerX, playerY, nx = 0, ny = 1, maxDist = 2.95) {
  const px = Number(playerX) || 0;
  const py = Number(playerY) || 0;
  const nLen = Math.hypot(Number(nx) || 0, Number(ny) || 0);
  const fx = nLen > 1e-4 ? (Number(nx) || 0) / nLen : 0;
  const fy = nLen > 1e-4 ? (Number(ny) || 0) / nLen : 0;
  const maxD2 = maxDist * maxDist;
  let best = null;
  let bestDist2 = Infinity;
  let bestToward = -Infinity;
  for (const e of entitiesByKey.values()) {
    if (!e?.deadState) continue;
    if (e._strengthCarryHidden) continue;
    if ((e.spawnPhase ?? 1) < 0.5) continue;
    const dx = (Number(e.x) || 0) - px;
    const dy = (Number(e.y) || 0) - py;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxD2) continue;
    const toward = dx * fx + dy * fy;
    if (d2 < bestDist2 - 1e-6 || (Math.abs(d2 - bestDist2) <= 1e-6 && toward > bestToward)) {
      bestDist2 = d2;
      bestToward = toward;
      best = e;
    }
  }
  return best;
}

/**
 * Removes and returns a fainted wild entity by key (used while carrying).
 * @returns {object | null}
 */
export function detachFaintedWildEntityByKey(key) {
  const k = String(key || '');
  if (!k) return null;
  const e = entitiesByKey.get(k);
  if (!e?.deadState) return null;
  e._strengthCarryHidden = true;
  clearWildPokemonFainted(k); // Remove fainted record so original slot won't re-spawn a duplicate
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.animMoving = false;
  return e;
}

/**
 * Re-spawn a carried fainted wild near a landing point.
 * @returns {boolean}
 */
export function restoreCarriedFaintedWildNear(entity, landX, landY, data, radius = 10) {
  if (!entity || !data) return false;
  const px = Number(landX) || 0;
  const py = Number(landY) || 0;
  let pos = findWalkableWildSpawnNear(data, entity.dexId ?? 1, px, py);
  if (!pos) {
    const ring = Math.max(2, Math.floor(Number(radius) || 10));
    const tries = Math.max(8, ring * 12);
    for (let i = 0; i < tries && !pos; i++) {
      const ang = (i / tries) * Math.PI * 2;
      const tx = px + Math.cos(ang) * ring * 0.7;
      const ty = py + Math.sin(ang) * ring * 0.7;
      pos = findWalkableWildSpawnNear(data, entity.dexId ?? 1, tx, ty);
    }
  }
  if (!pos) return false;
  entity.x = pos.spawnX;
  entity.y = pos.spawnY;
  entity.centerX = pos.spawnX;
  entity.centerY = pos.spawnY;
  entity.vx = 0;
  entity.vy = 0;
  entity.z = 0;
  entity.vz = 0;
  entity.grounded = true;
  entity.jumping = false;
  entity.animMoving = false;
  entity._strengthCarryHidden = false;
  entity.deadState = entity.deadState || 'faint';
  entity.isDespawning = false;
  entity.deadTimer = 0;
  entity.deadAnimTimer = 0;
  entity.macroX = Math.floor(pos.spawnX / MACRO_TILE_STRIDE);
  entity.macroY = Math.floor(pos.spawnY / MACRO_TILE_STRIDE);
  if (entity.macroX >= 0 && entity.macroY >= 0 && entity.macroX < data.width && entity.macroY < data.height) {
    entity.biomeId = data.biomes[entity.macroY * data.width + entity.macroX];
  }
  entity.pickIndex = -1;
  for (const [k, v] of entitiesByKey.entries()) {
    if (v === entity) entitiesByKey.delete(k);
  }
  const key = allocateDebugSummonKey('carry');
  entity.key = key;
  entitiesByKey.set(key, entity);
  return true;
}

