/**
 * @fileoverview Lazy-baked chunk renderer for the editor canvas. Draws the
 * finite `world` window onto the canvas at an arbitrary zoom, blits cached
 * bake chunks, and paints overlays for the brush hover preview and the rect
 * marquee in-flight selection.
 *
 * Coordinate system (single source of truth):
 *  - painter-pixel space: 1 unit = 1 px at zoom 1, origin = painter (0,0)
 *  - canvas-pixel space:  derived from painter-pixel by camera + zoom
 *
 *      canvasX = (painterPx - camera.x) * zoom + canvasW / 2
 *      painterPx = (canvasX - canvasW / 2) / zoom + camera.x
 *
 *  - PAINTER_PX_PER_MACRO = MACRO_TILE_STRIDE * PLAY_BAKE_TILE_PX
 */

import { BIOMES } from 'region-map-gen/biomes.js';
import { MACRO_TILE_STRIDE } from 'region-map-gen/chunking.js';
import { bakeChunk } from 'region-render-2d/play-chunk-bake.js';
import { drawChunkFormalTreeCanopies } from 'region-render-2d/play-chunk-canopy.js';
import { PLAY_CHUNK_SIZE, PLAY_BAKE_TILE_PX } from 'region-render-2d/render-constants.js';

const TILE_PX = PLAY_BAKE_TILE_PX;
const CHUNK_MICRO = PLAY_CHUNK_SIZE;
const CHUNK_PX = CHUNK_MICRO * TILE_PX;

export const PAINTER_PX_PER_MICRO = TILE_PX;
export const PAINTER_PX_PER_MACRO = MACRO_TILE_STRIDE * TILE_PX;

/** Cap so a single frame can't lock the main thread on a giant first paint. */
const MAX_BAKES_PER_FRAME = 2;

/**
 * Below this zoom, the renderer skips the (expensive) per-chunk tile bake and
 * shows only flat biome-color placeholders. Useful for low-zoom overview where
 * the user wants to see large-scale layout, not individual tiles. Cached bakes
 * are still drawn when present so panning around in mid zoom stays smooth.
 */
const PLACEHOLDER_ONLY_BELOW_ZOOM = 0.4;

const BIOME_COLOR_BY_ID = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));

export class EditorRenderer {
  constructor() {
    /** @type {Map<string, { canvas: HTMLCanvasElement, bitmap: ImageBitmap | null }>} */
    this._bakeCache = new Map();
    this._currentOrigin = null;
    this._currentSize = 0;
    this._bakesThisFrame = 0;
  }

  /** Drop every cached chunk bake (call on origin change or full reload). */
  clearCache() {
    this._bakeCache.clear();
  }

  /**
   * Invalidate bake cache for the bake-chunks that overlap a specific macro
   * tile rectangle (inclusive, in painter coords). Use after a setRect or
   * brush stroke so subsequent renders re-bake only the touched cells.
   */
  invalidateMacroRect(painterX0, painterY0, painterX1, painterY1, origin, size) {
    if (!origin) return;
    const minX = Math.min(painterX0, painterX1);
    const maxX = Math.max(painterX0, painterX1);
    const minY = Math.min(painterY0, painterY1);
    const maxY = Math.max(painterY0, painterY1);
    const minWX = Math.max(0, minX - origin.mx) * MACRO_TILE_STRIDE;
    const minWY = Math.max(0, minY - origin.my) * MACRO_TILE_STRIDE;
    const maxWX = Math.min(size, maxX - origin.mx + 1) * MACRO_TILE_STRIDE - 1;
    const maxWY = Math.min(size, maxY - origin.my + 1) * MACRO_TILE_STRIDE - 1;
    if (minWX > maxWX || minWY > maxWY) return;
    const minCX = Math.floor(minWX / CHUNK_MICRO);
    const minCY = Math.floor(minWY / CHUNK_MICRO);
    const maxCX = Math.floor(maxWX / CHUNK_MICRO);
    const maxCY = Math.floor(maxWY / CHUNK_MICRO);
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        this._bakeCache.delete(`${cx},${cy}`);
      }
    }
  }

  _ensureOriginMatches(origin, size) {
    if (
      !this._currentOrigin ||
      this._currentOrigin.mx !== origin.mx ||
      this._currentOrigin.my !== origin.my ||
      this._currentSize !== size
    ) {
      this.clearCache();
      this._currentOrigin = { mx: origin.mx, my: origin.my };
      this._currentSize = size;
    }
  }

  _getOrBake(world, cx, cy) {
    const key = `${cx},${cy}`;
    const hit = this._bakeCache.get(key);
    if (hit) return hit;
    if (this._bakesThisFrame >= MAX_BAKES_PER_FRAME) return null;
    this._bakesThisFrame++;
    const { canvas } = bakeChunk(cx, cy, world, TILE_PX, TILE_PX, null);
    const entry = { canvas, bitmap: null };
    this._bakeCache.set(key, entry);
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(canvas).then((bmp) => {
        const cur = this._bakeCache.get(key);
        if (cur === entry) cur.bitmap = bmp;
      }).catch(() => { /* fall back to canvas blit */ });
    }
    return entry;
  }

  /**
   * Draw the current frame.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} world           - finite world from buildWindowWorld
   * @param {{ mx: number, my: number }} origin - painter macro coord at world (0,0)
   * @param {number} size            - finite world side in macro tiles
   * @param {{ x: number, y: number, zoom: number }} camera - painter-pixel + zoom
   * @param {{ width: number, height: number }} viewport
   * @param {object} [overlays]
   * @param {{ macroX: number, macroY: number, size: number } | null} [overlays.brush]
   * @param {{ macroX0: number, macroY0: number, macroX1: number, macroY1: number } | null} [overlays.rect]
   * @param {boolean} [overlays.showGrid]
   * @param {{ minX: number, minY: number, maxX: number, maxY: number } | null} [overlays.paintedBounds]
   */
  renderFrame(ctx, world, origin, size, camera, viewport, overlays = {}) {
    this._bakesThisFrame = 0;
    this._ensureOriginMatches(origin, size);

    const { width: vw, height: vh } = viewport;
    const zoom = camera.zoom || 1;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, vw, vh);

    // Compute canvas-pixel offset such that painter (camera.x, camera.y) → viewport center.
    const offsetX = Math.round(vw / 2 - camera.x * zoom);
    const offsetY = Math.round(vh / 2 - camera.y * zoom);
    const originPainterPxX = origin.mx * PAINTER_PX_PER_MACRO;
    const originPainterPxY = origin.my * PAINTER_PX_PER_MACRO;
    const baseX = offsetX + originPainterPxX * zoom;
    const baseY = offsetY + originPainterPxY * zoom;

    const microW = size * MACRO_TILE_STRIDE;
    const microH = size * MACRO_TILE_STRIDE;
    const chunksX = Math.ceil(microW / CHUNK_MICRO);
    const chunksY = Math.ceil(microH / CHUNK_MICRO);

    const chunkScreenPx = CHUNK_PX * zoom;
    const minCx = Math.max(0, Math.floor(-baseX / chunkScreenPx) - 1);
    const minCy = Math.max(0, Math.floor(-baseY / chunkScreenPx) - 1);
    const maxCx = Math.min(chunksX - 1, Math.floor((vw - baseX) / chunkScreenPx) + 1);
    const maxCy = Math.min(chunksY - 1, Math.floor((vh - baseY) / chunkScreenPx) + 1);

    const placeholderOnly = zoom < PLACEHOLDER_ONLY_BELOW_ZOOM;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const drawX = baseX + cx * chunkScreenPx;
        const drawY = baseY + cy * chunkScreenPx;
        // Skip bake at very low zoom, but still blit any chunk that happens
        // to be cached from previous higher-zoom inspections.
        const entry = placeholderOnly ? this._bakeCache.get(`${cx},${cy}`) : this._getOrBake(world, cx, cy);
        if (entry) {
          const src = entry.bitmap || entry.canvas;
          ctx.drawImage(src, drawX, drawY, chunkScreenPx, chunkScreenPx);
        } else {
          drawChunkColorPlaceholder(ctx, world, size, cx, cy, drawX, drawY, chunkScreenPx);
        }
      }
    }

    // Canopy pass on top of baked terrain. Skipped at low zoom because the
    // baked trunks themselves are not drawn there.
    if (!placeholderOnly) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const drawX = baseX + cx * chunkScreenPx;
          const drawY = baseY + cy * chunkScreenPx;
          drawChunkFormalTreeCanopies(ctx, cx, cy, world, TILE_PX, TILE_PX, drawX, drawY, zoom);
        }
      }
    }

    if (overlays.paintedBounds) drawPaintedBounds(ctx, overlays.paintedBounds, camera, vw, vh);
    if (overlays.brush) drawBrushOverlay(ctx, overlays.brush, camera, vw, vh);
    if (overlays.rect) drawRectOverlay(ctx, overlays.rect, camera, vw, vh);
    drawCrosshair(ctx, vw, vh);
  }
}

function painterMacroToCanvas(macroX, macroY, camera, vw, vh) {
  const zoom = camera.zoom || 1;
  const px = macroX * PAINTER_PX_PER_MACRO;
  const py = macroY * PAINTER_PX_PER_MACRO;
  return {
    x: (px - camera.x) * zoom + vw / 2,
    y: (py - camera.y) * zoom + vh / 2,
    cell: PAINTER_PX_PER_MACRO * zoom,
  };
}

function drawChunkColorPlaceholder(ctx, world, size, cx, cy, x, y, sizePx) {
  // Sample biome at the chunk's center micro tile to pick a representative color.
  const centerMicroX = cx * CHUNK_MICRO + (CHUNK_MICRO >> 1);
  const centerMicroY = cy * CHUNK_MICRO + (CHUNK_MICRO >> 1);
  const macroX = Math.floor(centerMicroX / MACRO_TILE_STRIDE);
  const macroY = Math.floor(centerMicroY / MACRO_TILE_STRIDE);
  if (macroX < 0 || macroY < 0 || macroX >= size || macroY >= size) {
    ctx.fillStyle = '#070b14';
    ctx.fillRect(x, y, sizePx, sizePx);
    return;
  }
  const id = world.biomes[macroY * size + macroX];
  ctx.fillStyle = BIOME_COLOR_BY_ID.get(id) || '#222';
  ctx.fillRect(x, y, sizePx, sizePx);
}

function drawBrushOverlay(ctx, brush, camera, vw, vh) {
  const half = (brush.size - 1) >> 1;
  const tl = painterMacroToCanvas(brush.macroX - half, brush.macroY - half, camera, vw, vh);
  const sz = tl.cell * brush.size;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#69b6ff';
  ctx.fillStyle = 'rgba(105, 182, 255, 0.18)';
  ctx.fillRect(tl.x, tl.y, sz, sz);
  ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, sz - 1, sz - 1);
  ctx.restore();
}

function drawRectOverlay(ctx, rect, camera, vw, vh) {
  const minX = Math.min(rect.macroX0, rect.macroX1);
  const maxX = Math.max(rect.macroX0, rect.macroX1);
  const minY = Math.min(rect.macroY0, rect.macroY1);
  const maxY = Math.max(rect.macroY0, rect.macroY1);
  const tl = painterMacroToCanvas(minX, minY, camera, vw, vh);
  const w = (maxX - minX + 1) * tl.cell;
  const h = (maxY - minY + 1) * tl.cell;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffd24a';
  ctx.fillStyle = 'rgba(255, 210, 74, 0.22)';
  ctx.fillRect(tl.x, tl.y, w, h);
  ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w - 1, h - 1);
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = '#ffd24a';
  ctx.fillText(`${maxX - minX + 1} × ${maxY - minY + 1}`, tl.x + 4, tl.y - 4);
  ctx.restore();
}

function drawPaintedBounds(ctx, bounds, camera, vw, vh) {
  const tl = painterMacroToCanvas(bounds.minX, bounds.minY, camera, vw, vh);
  const w = (bounds.maxX - bounds.minX + 1) * tl.cell;
  const h = (bounds.maxY - bounds.minY + 1) * tl.cell;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w - 1, h - 1);
  ctx.restore();
}

function drawCrosshair(ctx, vw, vh) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.floor(vw / 2) + 0.5, 0);
  ctx.lineTo(Math.floor(vw / 2) + 0.5, vh);
  ctx.moveTo(0, Math.floor(vh / 2) + 0.5);
  ctx.lineTo(vw, Math.floor(vh / 2) + 0.5);
  ctx.stroke();
  ctx.restore();
}

/**
 * Convert a canvas-pixel point to painter macro coords (integer, can be negative).
 */
export function canvasToPainterMacro(canvasX, canvasY, camera, viewport) {
  const zoom = camera.zoom || 1;
  const painterPxX = (canvasX - viewport.width / 2) / zoom + camera.x;
  const painterPxY = (canvasY - viewport.height / 2) / zoom + camera.y;
  return {
    macroX: Math.floor(painterPxX / PAINTER_PX_PER_MACRO),
    macroY: Math.floor(painterPxY / PAINTER_PX_PER_MACRO),
  };
}
