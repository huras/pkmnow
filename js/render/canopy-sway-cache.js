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

/**
 * Aumentado de 400 → 1500: em biomas densos (Jungle, Ghost Woods) com 60+ canopies visíveis
 * × 9 wind frames × 2 escalas de LOD, o cache antigo sofria thrashing (re-bake constante).
 * 1500 entries ≈ 15MB RAM no pior caso; elimina thrashing completamente.
 */
const MAX_CACHE = 1500;

/**
 * LRU trim: `Map` em JS preserva ordem de inserção. Em cada `get()` com hit, re-inserimos
 * a entry (delete + set) pra marcá-la como "mais recente". `trimCache` remove as do começo
 * (menos recentes). Substitui o FIFO antigo que podia evictar canopies renderizadas toda frame.
 */
function touchLRU(key, entry) {
  compositeCache.delete(key);
  compositeCache.set(key, entry);
}

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
  const cached = compositeCache.get(key);
  if (cached) {
    touchLRU(key, cached);
    return cached;
  }

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
  const twC = Math.ceil(tileW);
  const thC = Math.ceil(tileH);

  // Fast-path: tenta cache hit ANTES de alocar placements[] e computar canopyRows.
  // treeType identifica unicamente `tops` (são derivados determinísticamente), então
  // tops.join(',') é redundante na key — removido (eliminava ~60 string allocs/frame em Jungle).
  const key = `ft|${treeType}|${frameIndex}|${twC}|${thC}|${natureImg.src}`;
  const cached = compositeCache.get(key);
  if (cached) {
    touchLRU(key, cached);
    return cached;
  }

  // Cache miss: agora sim aloca placements pra bake.
  const angle = AnimationRenderer.WIND_ANGLES[frameIndex] || 0;
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
  // Frame 3 (meio do array de 7) = ângulo 0 rad. Default estático para itens sem sway (crystal, rock, shell).
  const WIND_CENTER_IDX = Math.floor(AnimationRenderer.WIND_ANGLES.length / 2);
  const frameIndex = windSway ? AnimationRenderer.getFrameIndex(time, originX, originY) : WIND_CENTER_IDX;
  const twC = Math.ceil(tileW);
  const thC = Math.ceil(tileH);

  // Fast-path: tenta cache hit ANTES de alocar placements. itemKey identifica topPart.ids
  // determinísticamente, então idsKey era redundante — removido (eliminava mais ~60 string allocs/frame).
  const key = `sc|${itemKey}|${cols}|${frameIndex}|${windSway ? 1 : 0}|${twC}|${thC}|${img.src || ''}|${atlasCols}`;
  const cached = compositeCache.get(key);
  if (cached) {
    touchLRU(key, cached);
    return cached;
  }

  const angle = AnimationRenderer.WIND_ANGLES[frameIndex] || 0;
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
  return bakeComposite(key, img, atlasCols, tileW, tileH, placements, angle);
}
