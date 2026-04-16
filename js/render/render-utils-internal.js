import { TessellationEngine } from '../tessellation-engine.js';

export const TCOLS_NATURE = 57;
export const TCOLS_CAVES = 50;

/**
 * Resolves the texture atlas and column count for a given object set.
 */
export function atlasFromObjectSet(objSet, imageCache) {
  const path = TessellationEngine.getImagePath(objSet?.file);
  const img = path ? imageCache.get(path) : null;
  const cols = path?.includes('caves') ? TCOLS_CAVES : TCOLS_NATURE;
  return { img, cols };
}

/**
 * Draws a 16x16 tile from the nature tileset.
 */
export function drawTile16(ctx, tileId, px, py, natureImg, tileW, tileH, snapPx, rotation) {
  if (!natureImg || tileId == null || tileId < 0) return;
  const tw = Math.ceil(tileW);
  const th = Math.ceil(tileH);
  const sx = (tileId % TCOLS_NATURE) * 16;
  const sy = Math.floor(tileId / TCOLS_NATURE) * 16;
  
  if (rotation) {
    ctx.save();
    ctx.translate(snapPx(px + tileW / 2), snapPx(py + tileH));
    ctx.rotate(rotation);
    ctx.drawImage(natureImg, sx, sy, 16, 16, -tw / 2, -th, tw, th);
    ctx.restore();
  } else {
    ctx.drawImage(natureImg, sx, sy, 16, 16, snapPx(px), snapPx(py), tw, th);
  }
}

/**
 * Helper to snap to pixel boundaries.
 */
export const snapPx = (n) => Math.round(n);
