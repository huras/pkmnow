import { BIOMES, resolveWaterLevel } from '../biomes.js';
import { elevationToStep } from '../chunking.js';

let mapOverviewCacheCanvas = null;
let mapOverviewCacheKey = '';

/**
 * Desenha a visão macro (biomas / elevação + overlays) com cache por chave.
 */
export function drawCachedMapOverview(ctx, params) {
  const {
    data,
    viewType,
    overlayPaths,
    overlayGraph,
    overlayContours,
    cw,
    ch,
    camera,
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
    viewType,
    overlayPaths ? 1 : 0,
    overlayGraph ? 1 : 0,
    overlayContours ? 1 : 0
  ].join('|');

  if (!mapOverviewCacheCanvas || mapOverviewCacheKey !== mapCacheKey) {
    mapOverviewCacheCanvas = document.createElement('canvas');
    mapOverviewCacheCanvas.width = Math.max(1, width);
    mapOverviewCacheCanvas.height = Math.max(1, height);
    mapOverviewCacheKey = mapCacheKey;
    const mctx = mapOverviewCacheCanvas.getContext('2d');
    const wlOverview = resolveWaterLevel(data.config || {});
    if (mctx) {
      mctx.imageSmoothingEnabled = false;
      if (mctx.webkitImageSmoothingEnabled !== undefined) mctx.webkitImageSmoothingEnabled = false;
      mctx.fillStyle = '#111';
      mctx.fillRect(0, 0, width, height);

      const tileW = 1;
      const tileH = 1;
      const biomeColorById = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * width + x;
          const bId = biomes[idx];
          if (viewType === 'elevation') {
            const val = cells[idx];
            const colorVal = Math.floor(Math.max(0, Math.min(1, val)) * 255);
            mctx.fillStyle = val < wlOverview ? `rgb(0,0,${colorVal})` : `rgb(${colorVal},${colorVal},${colorVal})`;
          } else {
            mctx.fillStyle = biomeColorById.get(bId) || '#000';
          }
          mctx.fillRect(x, y, tileW, tileH);
        }
      }

      if (overlayPaths && paths) {
        mctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
        mctx.lineWidth = 0.35;
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
          const r = 0.35;
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
          mctx.font = 'bold 1px Outfit, Inter, sans-serif';
          mctx.textAlign = 'center';
          mctx.lineWidth = 3;
          mctx.strokeStyle = '#000';
          mctx.strokeText(node.name, px, py - r - 0.55);
          mctx.fillText(node.name, px, py - r - 0.55);
        }
      }

      if (overlayContours) {
        mctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        mctx.lineWidth = 0.08;
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const hStep = elevationToStep(cells[y * width + x], wlOverview);
            if (x < width - 1) {
              const hr = elevationToStep(cells[y * width + (x + 1)], wlOverview);
              if (hStep !== hr) {
                mctx.beginPath();
                mctx.moveTo(x + 1, y);
                mctx.lineTo(x + 1, y + 1);
                mctx.stroke();
              }
            }
            if (y < height - 1) {
              const hd = elevationToStep(cells[(y + 1) * width + x], wlOverview);
              if (hStep !== hd) {
                mctx.beginPath();
                mctx.moveTo(x, y + 1);
                mctx.lineTo(x + 1, y + 1);
                mctx.stroke();
              }
            }
          }
        }
      }
    }
  }

  if (mapOverviewCacheCanvas) {
    if (camera && Number.isFinite(camera.scale) && Number.isFinite(camera.ox) && Number.isFinite(camera.oy)) {
      const scale = Math.max(1e-6, Number(camera.scale) || 0);
      const ox = Number(camera.ox) || 0;
      const oy = Number(camera.oy) || 0;
      ctx.save();
      ctx.translate(-ox * scale, -oy * scale);
      ctx.drawImage(mapOverviewCacheCanvas, 0, 0, width * scale, height * scale);
      ctx.restore();
    } else {
      ctx.drawImage(mapOverviewCacheCanvas, 0, 0, cw, ch);
    }
  }
}
