import { AnimationRenderer } from '../animation-renderer.js';
import { VEG_MULTITILE_OVERLAP_PX } from './render-constants.js';

const snap = (n) => Math.round(n);

/**
 * Pre-baked composite canopy (multi-tile tops) rotated once into an offscreen canvas.
 * Main ctx only does drawImage — avoids per-frame save/translate/rotate on many trees.
 *
 * @type {Map<string, { canvas: HTMLCanvasElement, ox: number, oy: number }>}
 */
const compositeCache = new Map();

const MAX_CACHE = 400;

function trimCache() {
  while (compositeCache.size > MAX_CACHE) {
    const k = compositeCache.keys().next().value;
    compositeCache.delete(k);
  }
}

/**
 * @param {string} key
 * @param {CanvasImageSource} img
 * @param {number} atlasCols
 * @param {number} tileW
 * @param {number} tileH
 * @param {Array<{ sx: number, sy: number, lx: number, drawY: number }>} placements
 * @param {number} angleRad
 */
function bakeComposite(key, img, atlasCols, tileW, tileH, placements, angleRad) {
  if (compositeCache.has(key)) return compositeCache.get(key);

  const twC = Math.ceil(tileW);
  const thC = Math.ceil(tileH);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const x0 = snap(p.lx);
    const y0 = snap(p.drawY);
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x0 + twC);
    maxY = Math.max(maxY, y0 + thC);
  }
  if (!Number.isFinite(minX) || placements.length === 0) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const empty = { canvas: c, ox: 0, oy: 0 };
    compositeCache.set(key, empty);
    return empty;
  }

  const bleed = 16;
  minX -= bleed;
  minY -= bleed;
  maxX += bleed;
  maxY += bleed;
  const bw = Math.max(1, Math.ceil(maxX - minX));
  const bh = Math.max(1, Math.ceil(maxY - minY));

  const canvas = document.createElement('canvas');
  canvas.width = bw;
  canvas.height = bh;
  const bctx = canvas.getContext('2d', { alpha: true });
  if (!bctx) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { canvas: c, ox: 0, oy: 0 };
  }
  bctx.imageSmoothingEnabled = false;

  const ox = -minX;
  const oy = -minY;

  bctx.save();
  bctx.translate(ox, oy);
  bctx.rotate(angleRad);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    bctx.drawImage(
      img,
      p.sx,
      p.sy,
      16,
      16,
      snap(p.lx),
      snap(p.drawY),
      twC,
      thC
    );
  }
  bctx.restore();

  const entry = { canvas, ox, oy };
  compositeCache.set(key, entry);
  trimCache();
  return entry;
}

/**
 * @param {number} time
 * @param {string} treeType
 * @param {number} originX
 * @param {number} originY
 * @param {number[]} tops
 * @param {HTMLImageElement | null} natureImg
 * @param {number} TCOLS_NATURE
 * @param {number} tileW
 * @param {number} tileH
 * @returns {{ canvas: HTMLCanvasElement, ox: number, oy: number }}
 */
export function getFormalTreeCanopyComposite(time, treeType, originX, originY, tops, natureImg, TCOLS_NATURE, tileW, tileH) {
  if (!natureImg || !tops?.length) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { canvas: c, ox: 0, oy: 0 };
  }
  const frameIndex = AnimationRenderer.getFrameIndex(time, originX, originY);
  const angle = AnimationRenderer.WIND_ANGLES[frameIndex] || 0;
  const twC = Math.ceil(tileW);
  const thC = Math.ceil(tileH);
  const canopyCols = 2;
  const canopyRows = Math.ceil(tops.length / canopyCols);
  const placements = [];
  for (let i = 0; i < tops.length; i++) {
    const id = tops[i];
    const ox = i % canopyCols;
    const row = Math.floor(i / canopyCols);
    const drawY = -(row + canopyRows) * tileH + (row + 1) * VEG_MULTITILE_OVERLAP_PX;
    const lx = ox === 0 ? -tileW : -VEG_MULTITILE_OVERLAP_PX;
    placements.push({
      sx: (id % TCOLS_NATURE) * 16,
      sy: Math.floor(id / TCOLS_NATURE) * 16,
      lx,
      drawY
    });
  }
  const key = `ft|${treeType}|${frameIndex}|${twC}|${thC}|${natureImg.src}|${tops.join(',')}`;
  return bakeComposite(key, natureImg, TCOLS_NATURE, tileW, tileH, placements, angle);
}

/**
 * @param {number} time
 * @param {string} itemKey
 * @param {number} originX
 * @param {number} originY
 * @param {{ ids: number[] }} topPart
 * @param {number} cols footprint columns
 * @param {CanvasImageSource | null} img
 * @param {number} atlasCols
 * @param {number} tileW
 * @param {number} tileH
 * @param {boolean} windSway
 */
export function getScatterTopCanopyComposite(
  time,
  itemKey,
  originX,
  originY,
  topPart,
  cols,
  img,
  atlasCols,
  tileW,
  tileH,
  windSway
) {
  if (!img || !topPart?.ids?.length) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { canvas: c, ox: 0, oy: 0 };
  }
  const frameIndex = windSway ? AnimationRenderer.getFrameIndex(time, originX, originY) : 1;
  const angle = AnimationRenderer.WIND_ANGLES[frameIndex] || 0;
  const twC = Math.ceil(tileW);
  const thC = Math.ceil(tileH);
  const topRows = Math.ceil(topPart.ids.length / cols);
  const placements = [];
  for (let idx = 0; idx < topPart.ids.length; idx++) {
    const id = topPart.ids[idx];
    const ox = idx % cols;
    const oy = Math.floor(idx / cols);
    const drawY = -(topRows - oy + 1) * tileH + (topRows - oy) * VEG_MULTITILE_OVERLAP_PX;
    const lx = ox * tileW - (cols * tileW) / 2 - ox * VEG_MULTITILE_OVERLAP_PX;
    placements.push({
      sx: (id % atlasCols) * 16,
      sy: Math.floor(id / atlasCols) * 16,
      lx,
      drawY
    });
  }
  const idsKey = topPart.ids.join(',');
  const key = `sc|${itemKey}|${cols}|${frameIndex}|${windSway ? 1 : 0}|${twC}|${thC}|${img.src || ''}|${atlasCols}|${idsKey}`;
  return bakeComposite(key, img, atlasCols, tileW, tileH, placements, angle);
}
