import { resolveConcConvDrawRole } from '../tessellation-logic.js';

/** Master switch: when false, terrain role mirroring is disabled. */
export const ENABLE_TERRAIN_MIRROR_OPTIMIZATION = false;

/**
 * Tile index + horizontal flip for drawing conc-conv(a|b|c) terrain from the sheet.
 * Other set types: passthrough (tileId for `role`, no flip).
 *
 * @param {{ type?: string, roles?: Record<string, number>, centerId?: number }} terrainSet
 * @param {string | null | undefined} role
 * @returns {{ tileId: number | null, flipX: boolean }}
 */
export function getConcConvATerrainTileSpec(terrainSet, role) {
  const centerId = terrainSet?.roles?.CENTER ?? terrainSet?.centerId ?? null;
  if (!terrainSet || role == null || role === '') {
    return { tileId: centerId, flipX: false };
  }
  if (!ENABLE_TERRAIN_MIRROR_OPTIMIZATION) {
    return { tileId: terrainSet.roles?.[role] ?? centerId, flipX: false };
  }
  const { drawRole, flipX } = resolveConcConvDrawRole(terrainSet.type, role);
  return { tileId: terrainSet.roles?.[drawRole] ?? centerId, flipX };
}

/**
 * Blit one square cell from a terrain / object sheet.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number} sheetCols
 * @param {number} cellPx source cell size (usually 16)
 * @param {number | null | undefined} tileId
 * @param {number} dx
 * @param {number} dy
 * @param {number} dw
 * @param {number} dh
 * @param {boolean} [flipX]
 */
export function drawTerrainCellFromSheet(ctx, img, sheetCols, cellPx, tileId, dx, dy, dw, dh, flipX = false) {
  if (!img || tileId == null || tileId < 0) return;
  const sx = (tileId % sheetCols) * cellPx;
  const sy = Math.floor(tileId / sheetCols) * cellPx;
  if (!flipX) {
    ctx.drawImage(img, sx, sy, cellPx, cellPx, dx, dy, dw, dh);
    return;
  }
  const cx = dx + dw * 0.5;
  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(-1, 1);
  ctx.translate(-cx, 0);
  ctx.drawImage(img, sx, sy, cellPx, cellPx, dx, dy, dw, dh);
  ctx.restore();
}
