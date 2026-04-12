import { BIOMES } from '../biomes.js';
import { elevationToStep } from '../chunking.js';

let mapOverviewCacheCanvas = null;
let mapOverviewCacheKey = '';

/**
 * Desenha a visão macro (biomas / elevação + overlays) com cache por chave.
 */
export function drawCachedMapOverview(ctx, params) {
  const {
    data,
    cw,
    ch,
    viewType,
    overlayPaths,
    overlayGraph,
    overlayContours,
    startX,
    startY,
    endX,
    endY
  } = params;

  const { width, height, cells, biomes, paths } = data;
  const graph = data.graph;

  const configSig = data.config != null ? JSON.stringify(data.config) : '';
  const mapCacheKey = [
    data.seed,
    configSig,
    width,
    height,
    cw,
    ch,
    viewType,
    overlayPaths ? 1 : 0,
    overlayGraph ? 1 : 0,
    overlayContours ? 1 : 0
  ].join('|');

  if (!mapOverviewCacheCanvas || mapOverviewCacheKey !== mapCacheKey) {
    mapOverviewCacheCanvas = document.createElement('canvas');
    mapOverviewCacheCanvas.width = cw;
    mapOverviewCacheCanvas.height = ch;
    mapOverviewCacheKey = mapCacheKey;
    const mctx = mapOverviewCacheCanvas.getContext('2d');
    if (mctx) {
      mctx.imageSmoothingEnabled = false;
      if (mctx.webkitImageSmoothingEnabled !== undefined) mctx.webkitImageSmoothingEnabled = false;
      mctx.fillStyle = '#111';
      mctx.fillRect(0, 0, cw, ch);

      const tileW = cw / width;
      const tileH = ch / height;
      const biomeColorById = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * width + x;
          const bId = biomes[idx];
          if (viewType === 'elevation') {
            const val = cells[idx];
            const colorVal = Math.floor(Math.max(0, Math.min(1, val)) * 255);
            mctx.fillStyle = val < 0.3 ? `rgb(0,0,${colorVal})` : `rgb(${colorVal},${colorVal},${colorVal})`;
          } else {
            mctx.fillStyle = biomeColorById.get(bId) || '#000';
          }
          mctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
        }
      }

      if (overlayPaths && paths) {
        mctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
        mctx.lineWidth = Math.max(1.5, tileW * 0.45);
        mctx.lineJoin = 'round';
        mctx.lineCap = 'round';
        for (const path of paths) {
          mctx.beginPath();
          path.forEach((p, i) => {
            const px = (p.x + 0.5) * tileW;
            const py = (p.y + 0.5) * tileH;
            if (i === 0) mctx.moveTo(px, py);
            else mctx.lineTo(px, py);
          });
          mctx.stroke();
        }
      }

      if (overlayGraph && graph) {
        for (const node of graph.nodes) {
          const px = (node.x + 0.5) * tileW;
          const py = (node.y + 0.5) * tileH;
          const r = Math.max(4, tileW * 0.75);
          mctx.shadowBlur = 6;
          mctx.shadowColor = 'rgba(0,0,0,0.8)';
          mctx.fillStyle = node.isGym ? '#ff2222' : '#ffffff';
          mctx.strokeStyle = '#000';
          mctx.lineWidth = 2;
          mctx.beginPath();
          if (node.isGym) {
            mctx.moveTo(px, py - r * 1.3);
            mctx.lineTo(px + r * 1.3, py);
            mctx.lineTo(px, py + r * 1.3);
            mctx.lineTo(px - r * 1.3, py);
            mctx.closePath();
          } else {
            mctx.arc(px, py, r, 0, Math.PI * 2);
          }
          mctx.fill();
          mctx.stroke();
          mctx.shadowBlur = 0;
          mctx.fillStyle = '#fff';
          mctx.font = `bold ${Math.max(10, tileW * 1.0)}px Outfit, Inter, sans-serif`;
          mctx.textAlign = 'center';
          mctx.lineWidth = 3;
          mctx.strokeStyle = '#000';
          mctx.strokeText(node.name, px, py - r - 6);
          mctx.fillText(node.name, px, py - r - 6);
        }
      }

      if (overlayContours) {
        mctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        mctx.lineWidth = 1;
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const hStep = elevationToStep(cells[y * width + x]);
            if (x < width - 1) {
              const hr = elevationToStep(cells[y * width + (x + 1)]);
              if (hStep !== hr) {
                mctx.beginPath();
                mctx.moveTo((x + 1) * tileW, y * tileH);
                mctx.lineTo((x + 1) * tileW, (y + 1) * tileH);
                mctx.stroke();
              }
            }
            if (y < height - 1) {
              const hd = elevationToStep(cells[(y + 1) * width + x]);
              if (hStep !== hd) {
                mctx.beginPath();
                mctx.moveTo(x * tileW, (y + 1) * tileH);
                mctx.lineTo((x + 1) * tileW, (y + 1) * tileH);
                mctx.stroke();
              }
            }
          }
        }
      }
    }
  }

  if (mapOverviewCacheCanvas) {
    ctx.drawImage(mapOverviewCacheCanvas, 0, 0);
  }
}
