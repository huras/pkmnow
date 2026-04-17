import { MACRO_TILE_STRIDE, getMicroTile } from './chunking.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import { playChunkMap } from './render/play-chunk-cache.js';

const CUT_GRASS_REGROW_SEC = 12;
/** Seconds: animated grass alpha 1 → 0 after Cut (then stays off until regrow). */
const CUT_GRASS_FADE_OUT_SEC = 0.48;
/** Seconds: alpha 0 → 1 after regrow timer (matches tree regrow fade). */
const CUT_GRASS_FADE_IN_SEC = 0.48;
/** Below this fade factor, treat tile as cut for rustle / foot grass checks. */
const CUT_GRASS_FADE_GONE_EPS = 0.04;

const CUT_GRASS_FADE_MS = CUT_GRASS_FADE_OUT_SEC * 1000;
const CUT_GRASS_FADE_IN_MS = CUT_GRASS_FADE_IN_SEC * 1000;

/** @type {Map<string, { cutAtMs: number, regrowAtMs: number }>} */
const cutTileStates = new Map();

function tileKey(mx, my) {
  return `${mx},${my}`;
}

/** Tile still in cut→regrow window (must not reset `cutAtMs` or grass flashes visible again). */
function tileHasPendingGrassCut(mx, my, nowMs) {
  const rec = cutTileStates.get(tileKey(mx, my));
  if (!rec) return false;
  const reg = typeof rec === 'number' ? rec : rec.regrowAtMs;
  return Number.isFinite(reg) && fadeInEndMs(reg) > nowMs;
}

function fadeInEndMs(regrowAtMs) {
  return regrowAtMs + CUT_GRASS_FADE_IN_MS;
}

function cleanupExpired(nowMs) {
  if (cutTileStates.size === 0) return;
  for (const [k, rec] of cutTileStates.entries()) {
    const reg = typeof rec === 'number' ? rec : rec?.regrowAtMs;
    if (!Number.isFinite(reg) || fadeInEndMs(reg) <= nowMs) {
      cutTileStates.delete(k);
    }
  }
}

/**
 * 1 = full grass, 0 = invisible (after fade). Deletes expired entries.
 * @param {number} mx
 * @param {number} my
 * @param {number} [nowMs]
 * @returns {number}
 */
export function getGrassCutFadeoutAlpha01(mx, my, nowMs = performance.now()) {
  const k = tileKey(mx, my);
  const rec = cutTileStates.get(k);
  if (!rec) return 1;
  const regrowAtMs = typeof rec === 'number' ? rec : rec.regrowAtMs;
  const cutAtMs = typeof rec === 'number' ? regrowAtMs - CUT_GRASS_REGROW_SEC * 1000 : rec.cutAtMs;
  if (!Number.isFinite(regrowAtMs)) {
    cutTileStates.delete(k);
    return 1;
  }
  const inEnd = fadeInEndMs(regrowAtMs);
  if (nowMs >= inEnd) {
    cutTileStates.delete(k);
    return 1;
  }
  if (nowMs >= regrowAtMs) {
    const u = Math.max(0, Math.min(1, (nowMs - regrowAtMs) / CUT_GRASS_FADE_IN_MS));
    // Ease-in (cheap quad): 0 → 1
    return u * u;
  }
  const elapsed = nowMs - cutAtMs;
  if (elapsed >= CUT_GRASS_FADE_MS) return 0;
  const u = Math.max(0, Math.min(1, elapsed / CUT_GRASS_FADE_MS));
  // Ease-out so it eases into gone rather than linear only
  const ease = 1 - (1 - u) * (1 - u);
  return 1 - ease;
}

function hasCuttableGrass(mx, my, data) {
  const getTile = (x, y) => getMicroTile(x, y, data);
  const layers = getPlayAnimatedGrassLayers(mx, my, data, getTile, playChunkMap);
  return !!(layers.base || layers.top);
}

/**
 * True when PASS 5a-style animated grass would show under the player tile (not cut-suppressed).
 * Matches `drawGrass5aForCell` eligibility for rustle / footfall audio.
 */
export function playerHasAnimatedGrassUnderfoot(mx, my, data) {
  if (!data) return false;
  if (grassCutSuppressesAnimatedGrassAt(mx, my)) return false;
  return hasCuttableGrass(mx, my, data);
}

export function clearGrassCutStateForNewMap() {
  cutTileStates.clear();
}

export function grassCutSuppressesAnimatedGrassAt(mx, my) {
  const nowMs = performance.now();
  cleanupExpired(nowMs);
  return getGrassCutFadeoutAlpha01(mx, my, nowMs) < CUT_GRASS_FADE_GONE_EPS;
}

/**
 * Temporarily suppresses animated grass in a circle.
 * @param {number} worldX
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} radiusTiles
 * @param {object | null | undefined} data
 * @param {number} [pz] altitude
 * @returns {number} number of tiles cut
 */
export function cutGrassInCircle(centerX, centerY, radiusTiles, data, pz = 0) {
  if (!data) return 0;
  // If we are too high in the air, we can't cut grass on the ground.
  if (Math.abs(Number(pz) || 0) > 1.2) return 0;
  const cx = Number(centerX);
  const cy = Number(centerY);
  const radius = Math.max(0.2, Number(radiusTiles) || 0);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius)) return 0;
  const nowMs = performance.now();
  cleanupExpired(nowMs);
  const regrowAtMs = nowMs + CUT_GRASS_REGROW_SEC * 1000;
  const cutAtMs = nowMs;
  const r2 = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  let cutCount = 0;
  for (let my = minY; my <= maxY; my++) {
    for (let mx = minX; mx <= maxX; mx++) {
      if (mx < 0 || my < 0 || mx >= microW || my >= microH) continue;
      const dx = mx + 0.5 - cx;
      const dy = my + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (!hasCuttableGrass(mx, my, data)) continue;
      if (tileHasPendingGrassCut(mx, my, nowMs)) continue;
      cutTileStates.set(tileKey(mx, my), { cutAtMs, regrowAtMs });
      cutCount++;
    }
  }
  return cutCount;
}
