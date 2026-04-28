import { PLAY_CHUNK_SIZE } from '../render/render-constants.js';
import { getStaticEntitiesForChunk } from '../render/static-entity-cache.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';
import { getScatterItemKeyOverride } from '../main/scatter-item-override.js';

function isCaveEntity(entity) {
  if (!entity || entity.type !== 'scatter') return false;
  return String(entity.itemKey || '').includes('cave-entrance');
}

function isBlockedCaveEntity(entity) {
  const key = String(entity?.itemKey || '');
  return key.includes('cave-entrance-blocked');
}

function isBlockedCaveStillClosed(entity) {
  if (!isBlockedCaveEntity(entity)) return false;
  const ox = Number(entity?.originX) || 0;
  const oy = Number(entity?.originY) || 0;
  const override = String(getScatterItemKeyOverride(ox, oy) || '');
  if (override.includes('cave-entrance') && !override.includes('cave-entrance-blocked')) {
    return false;
  }
  return true;
}

function buildPortalFromEntity(entity) {
  const ox = Number(entity.originX) || 0;
  const oy = Number(entity.originY) || 0;
  const cols = Math.max(1, Number(entity.cols) || 1);
  const rows = Math.max(1, Number(entity.rows) || 1);
  const itemKey = String(entity.itemKey || 'unknown');
  const worldX = ox + cols * 0.5;
  const worldY = oy + rows * 0.5;
  const interact = resolvePortalInteractPoint(itemKey, ox, oy, cols, rows, worldX, worldY);
  return {
    id: `cave:${ox},${oy}:${itemKey}`,
    itemKey,
    originX: ox,
    originY: oy,
    worldX,
    worldY,
    interactX: interact.x,
    interactY: interact.y
  };
}

export function findNearbyCavePortal(data, playerX, playerY, maxDistance = 1.15) {
  if (!data) return null;
  const fullW = data.width * MACRO_TILE_STRIDE;
  const fullH = data.height * MACRO_TILE_STRIDE;
  const px = Math.floor(Number(playerX) || 0);
  const py = Math.floor(Number(playerY) || 0);
  const baseCx = Math.floor(px / PLAY_CHUNK_SIZE);
  const baseCy = Math.floor(py / PLAY_CHUNK_SIZE);
  let best = null;
  let bestDistSq = maxDistance * maxDistance;

  for (let cy = baseCy - 1; cy <= baseCy + 1; cy++) {
    for (let cx = baseCx - 1; cx <= baseCx + 1; cx++) {
      if (cx < 0 || cy < 0) continue;
      const key = `${cx},${cy}`;
      const entities = getStaticEntitiesForChunk(cx, cy, key, data, fullW, fullH);
      for (const entity of entities) {
        if (!isCaveEntity(entity)) continue;
        if (isBlockedCaveStillClosed(entity)) {
          continue;
        }
        const portal = buildPortalFromEntity(entity);
        const dx = portal.interactX - playerX;
        const dy = portal.interactY - playerY;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestDistSq) {
          bestDistSq = d2;
          best = portal;
        }
      }
    }
  }
  return best;
}

function resolvePortalInteractPoint(itemKey, ox, oy, cols, rows, centerX, centerY) {
  const k = String(itemKey || '').toLowerCase();
  // Keep interaction on the walkable side of the cliff face.
  if (k.includes('south')) return { x: centerX, y: oy + rows + 0.35 };
  if (k.includes('north')) return { x: centerX, y: oy - 0.35 };
  if (k.includes('east')) return { x: ox + cols + 0.35, y: centerY };
  if (k.includes('west')) return { x: ox - 0.35, y: centerY };
  return { x: centerX, y: centerY };
}
