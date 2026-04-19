import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape } from '../tessellation-logic.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { imageCache } from '../image-cache.js';

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
  outerSpanStyle = 'vertical-align:middle;margin-right:6px'
) {
  const objSet = OBJECT_SETS[String(itemKey || '')];
  if (!objSet) return '';
  const base = objSet.parts?.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return '';
  const { cols } = parseShape(objSet.shape || '[1x1]');
  const imgPath = TessellationEngine.getImagePath(objSet.file);
  if (!imgPath) return '';
  const atlasCols = imgPath.includes('caves') ? 50 : 57;
  const gridCols = Math.max(1, cols | 0);
  const cls = extraClass ? ` class="${extraClass}"` : '';
  const safePath = String(imgPath).replace(/'/g, '%27');

  const imgEl = imageCache.get(imgPath);
  const natW = imgEl && Math.max(0, imgEl.naturalWidth || imgEl.width || 0);
  const natH = imgEl && Math.max(0, imgEl.naturalHeight || imgEl.height || 0);
  const scale = cellPx / 16;
  const useAtlasScale = natW > 0 && natH > 0;
  /** 16px source tiles → `cellPx` CSS px when the sheet is decoded in `imageCache`; else fixed 16px cells. */
  const gCell = useAtlasScale ? cellPx : 16;
  const bgSize = useAtlasScale ? `background-size:${natW * scale}px ${natH * scale}px;` : '';

  const tiles = base.ids
    .map((id) => {
      const col = id % atlasCols;
      const row = Math.floor(id / atlasCols);
      if (useAtlasScale) {
        const px = col * cellPx;
        const py = row * cellPx;
        return `<span style="display:inline-block;overflow:hidden;width:${gCell}px;height:${gCell}px;background-image:url('${safePath}');background-repeat:no-repeat;${bgSize}background-position:-${px}px -${py}px;image-rendering:pixelated;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,0.16) inset"></span>`;
      }
      const sx = col * 16;
      const sy = row * 16;
      return `<span style="display:inline-block;overflow:hidden;width:${gCell}px;height:${gCell}px;background-image:url('${safePath}');background-repeat:no-repeat;background-position:-${sx}px -${sy}px;image-rendering:pixelated;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,0.16) inset"></span>`;
    })
    .join('');
  return `<span${cls} aria-hidden="true" style="display:grid;grid-template-columns:repeat(${gridCols},${gCell}px);gap:2px;${outerSpanStyle}">${tiles}</span>`;
}
