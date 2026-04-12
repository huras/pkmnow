import { BIOMES } from '../biomes.js';
import { CHUNK_SIZE } from '../chunking.js';

let minimapBaseCacheCanvas = null;
let minimapBaseCacheData = null;
let minimapBaseCacheW = 0;
let minimapBaseCacheH = 0;

export function renderMinimap(canvas, data, player) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.imageSmoothingEnabled = false;
  if (ctx.webkitImageSmoothingEnabled !== undefined) ctx.webkitImageSmoothingEnabled = false;

  const needsRebuild =
    !minimapBaseCacheCanvas ||
    minimapBaseCacheData !== data ||
    minimapBaseCacheW !== w ||
    minimapBaseCacheH !== h;

  if (needsRebuild) {
    minimapBaseCacheCanvas = document.createElement('canvas');
    minimapBaseCacheCanvas.width = w;
    minimapBaseCacheCanvas.height = h;
    minimapBaseCacheData = data;
    minimapBaseCacheW = w;
    minimapBaseCacheH = h;

    const bctx = minimapBaseCacheCanvas.getContext('2d');
    if (!bctx) return;
    bctx.imageSmoothingEnabled = false;
    if (bctx.webkitImageSmoothingEnabled !== undefined) bctx.webkitImageSmoothingEnabled = false;
    bctx.fillStyle = '#111';
    bctx.fillRect(0, 0, w, h);

    const tileWb = w / data.width;
    const tileHb = h / data.height;
    const colorByBiomeId = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));
    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) {
        const idx = y * data.width + x;
        const bId = data.biomes[idx];
        bctx.fillStyle = colorByBiomeId.get(bId) || '#000';
        bctx.fillRect(Math.floor(x * tileWb), Math.floor(y * tileHb), Math.ceil(tileWb), Math.ceil(tileHb));
      }
    }
  }

  ctx.drawImage(minimapBaseCacheCanvas, 0, 0);

  const tileW = w / data.width;
  const tileH = h / data.height;
  const macroPx = player.x / CHUNK_SIZE;
  const macroPy = player.y / CHUNK_SIZE;
  ctx.fillStyle = '#ff0000';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc((macroPx + 0.5) * tileW, (macroPy + 0.5) * tileH, Math.max(3, tileW * 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
