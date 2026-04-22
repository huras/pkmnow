import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape } from '../tessellation-logic.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { imageCache } from '../image-cache.js';

/**
 * @param {string} itemKey
 * @param {number} cellPx
 * @param {{ seamless?: boolean, gapPx?: number } | null} [previewOpts]
 * @returns {{
 *   imgPath: string,
 *   atlasCols: number,
 *   gridCols: number,
 *   gridRows: number,
 *   gapPx: number,
 *   gCell: number,
 *   useAtlasScale: boolean,
 *   bgSize: string,
 *   safePath: string,
 *   seamless: boolean,
 *   pickId: (row: number, col: number) => number | null
 * } | null}
 */
function getScatterPreviewGrid(itemKey, cellPx, previewOpts = null) {
  const objSet = OBJECT_SETS[String(itemKey || '')];
  if (!objSet) return null;
  const base = objSet.parts?.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  const top = objSet.parts?.find((p) => p.role === 'top' || p.role === 'tops');
  if (!base?.ids?.length && !top?.ids?.length) return null;
  const { rows, cols } = parseShape(objSet.shape || '[1x1]');
  const imgPath = TessellationEngine.getImagePath(objSet.file);
  if (!imgPath) return null;
  const atlasCols = imgPath.includes('caves') ? 50 : 57;
  const gridCols = Math.max(1, cols | 0);
  // Compute actual visual rows: top rows (from top part ids) + base rows (from base part ids).
  // The shape rows may not always reflect the full visual height (e.g. small-cactus [1x1]
  // has shape rows=1 but top+base = 2 visual rows).
  const topRows = top?.ids?.length ? Math.ceil(top.ids.length / gridCols) : 0;
  const baseRows = base?.ids?.length ? Math.ceil(base.ids.length / gridCols) : Math.max(1, rows | 0);
  const gridRows = topRows + baseRows;
  const seamless = !!(previewOpts && previewOpts.seamless);
  const gapPxRaw = previewOpts && Number(previewOpts.gapPx);
  const gapPx = Number.isFinite(gapPxRaw) ? Math.max(0, Math.floor(gapPxRaw)) : 2;
  const safePath = String(imgPath).replace(/'/g, '%27');

  const imgEl = imageCache.get(imgPath);
  const natW = imgEl && Math.max(0, imgEl.naturalWidth || imgEl.width || 0);
  const natH = imgEl && Math.max(0, imgEl.naturalHeight || imgEl.height || 0);
  const scale = cellPx / 16;
  const useAtlasScale = natW > 0 && natH > 0;
  const gCell = useAtlasScale ? cellPx : 16;
  const bgSize = useAtlasScale ? `background-size:${natW * scale}px ${natH * scale}px;` : '';

  const pickId = (row, col) => {
    const idx = row * gridCols + col;
    if (row < topRows && top?.ids?.length) {
      return top.ids[idx] ?? null;
    }
    if (row >= topRows && base?.ids?.length) {
      const baseIdx = (row - topRows) * gridCols + col;
      return base.ids[baseIdx] ?? null;
    }
    return null;
  };

  return {
    imgPath,
    atlasCols,
    gridCols,
    gridRows,
    gapPx,
    gCell,
    useAtlasScale,
    bgSize,
    safePath,
    seamless,
    pickId
  };
}

/**
 * Canvas equivalent of {@link detailScatterGridPreviewHtml} (play HUD / speech bubble fallback).
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} itemKey OBJECT_SETS key
 * @param {number} destX left
 * @param {number} destY top
 * @param {number} boxPx max width/height of the whole grid (same packing idea as HUD)
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {(n: number) => number} snapPx
 * @param {{ seamless?: boolean, gapPx?: number } | null} [previewOpts]
 * @returns {boolean} true if something was drawn
 */
export function drawDetailScatterGridPreviewCanvas(
  ctx,
  itemKey,
  destX,
  destY,
  boxPx,
  imageCache,
  snapPx,
  previewOpts = null
) {
  const gap = Number.isFinite(/** @type {number} */ (previewOpts?.gapPx))
    ? Math.max(0, Math.floor(Number(previewOpts?.gapPx)))
    : 2;
  const g = getScatterPreviewGrid(itemKey, 16, { ...previewOpts, gapPx: gap });
  if (!g) return false;
  const { gridCols, gridRows, imgPath, atlasCols, seamless, pickId } = g;
  const img = imageCache.get(imgPath);
  if (!img?.naturalWidth) return false;

  const cellByCols = Math.floor((boxPx - gap * (gridCols - 1)) / gridCols);
  const cellByRows = Math.floor((boxPx - gap * (gridRows - 1)) / gridRows);
  const cellPx = Math.max(6, Math.min(cellByCols, cellByRows));

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  let y = destY;
  for (let row = 0; row < gridRows; row++) {
    let x = destX;
    for (let col = 0; col < gridCols; col++) {
      const id = pickId(row, col);
      if (Number.isFinite(id)) {
        const atlasCol = /** @type {number} */ (id) % atlasCols;
        const atlasRow = Math.floor(/** @type {number} */ (id) / atlasCols);
        const sx = atlasCol * 16;
        const sy = atlasRow * 16;
        ctx.drawImage(
          img,
          sx,
          sy,
          16,
          16,
          snapPx(x),
          snapPx(y),
          Math.ceil(cellPx),
          Math.ceil(cellPx)
        );
        if (!seamless) {
          ctx.strokeStyle = 'rgba(255,255,255,0.16)';
          ctx.lineWidth = 1;
          ctx.strokeRect(snapPx(x) + 0.5, snapPx(y) + 0.5, Math.ceil(cellPx) - 1, Math.ceil(cellPx) - 1);
        }
      }
      x += cellPx + gap;
    }
    y += cellPx + gap;
  }
  ctx.restore();
  return true;
}

/**
 * Multi-tile scatter preview: grid matches object `shape` so crystals read as one piece, not a strip.
 * When `cellPx` ≠ 16, each tile must scale the atlas with `background-size` + shifted `background-position`
 * (same 16px source step → `cellPx` CSS px), otherwise neighboring tiles bleed into the box.
 * @param {string} itemKey OBJECT_SETS key
 * @param {number} cellPx CSS pixel size per tile cell in the preview grid
 * @param {string} [extraClass] optional CSS class on the wrapper
 * @param {string} [outerSpanStyle] inline style on wrapper (default matches strength / HUD hints)
 */
export function detailScatterGridPreviewHtml(
  itemKey,
  cellPx,
  extraClass = '',
  outerSpanStyle = 'vertical-align:middle;margin-right:6px',
  previewOpts = null
) {
  const g = getScatterPreviewGrid(itemKey, cellPx, previewOpts);
  if (!g) return '';
  const { gridCols, gridRows, gapPx, gCell, useAtlasScale, bgSize, safePath, seamless } = g;
  const cls = extraClass ? ` class="${extraClass}"` : '';

  const tiles = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const id = g.pickId(row, col);
      if (!Number.isFinite(id)) {
        tiles.push(`<span style="display:inline-block;overflow:hidden;width:${gCell}px;height:${gCell}px"></span>`);
        continue;
      }
      const tileChrome = seamless
        ? ''
        : 'border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,0.16) inset';
      const atlasCol = /** @type {number} */ (id) % g.atlasCols;
      const atlasRow = Math.floor(/** @type {number} */ (id) / g.atlasCols);
      if (useAtlasScale) {
        const px = atlasCol * cellPx;
        const py = atlasRow * cellPx;
        tiles.push(`<span style="display:inline-block;overflow:hidden;width:${gCell}px;height:${gCell}px;background-image:url('${safePath}');background-repeat:no-repeat;${bgSize}background-position:-${px}px -${py}px;image-rendering:pixelated;${tileChrome}"></span>`);
        continue;
      }
      const sx = atlasCol * 16;
      const sy = atlasRow * 16;
      tiles.push(`<span style="display:inline-block;overflow:hidden;width:${gCell}px;height:${gCell}px;background-image:url('${safePath}');background-repeat:no-repeat;background-position:-${sx}px -${sy}px;image-rendering:pixelated;${tileChrome}"></span>`);
    }
  }
  return `<span${cls} aria-hidden="true" style="display:grid;grid-template-columns:repeat(${gridCols},${gCell}px);gap:${gapPx}px;${outerSpanStyle}">${tiles.join('')}</span>`;
}
