import { BIOMES, resolveWaterLevel } from '../biomes.js';
import { elevationToStep } from '../chunking.js';

let mapOverviewCacheCanvas = null;
let mapOverviewCacheKey = '';
const MAP_OVERVIEW_CACHE_MAX_PIXELS = 3_200_000;
let mapOverviewNoiseWorker = null;
let mapOverviewNoiseJobId = 0;
let mapOverviewNoiseActiveKey = '';
let mapOverviewNoiseEnabled = true;
let mapOverviewLastProgressEmitMs = 0;

function emitMapOverviewProgress() {
  const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  if (nowMs - mapOverviewLastProgressEmitMs < 28) return;
  mapOverviewLastProgressEmitMs = nowMs;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pkmn-map-overview-noise-progress'));
  }
}

function ensureMapOverviewNoiseWorker() {
  if (!mapOverviewNoiseEnabled) return null;
  if (typeof Worker === 'undefined') return null;
  if (mapOverviewNoiseWorker) return mapOverviewNoiseWorker;
  try {
    mapOverviewNoiseWorker = new Worker(
      new URL('../workers/map-overview-noise-worker.js', import.meta.url),
      { type: 'module' }
    );
    mapOverviewNoiseWorker.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'chunk') {
        if (msg.jobId !== mapOverviewNoiseJobId) return;
        if (msg.cacheKey !== mapOverviewNoiseActiveKey) return;
        if (!mapOverviewCacheCanvas) return;
        const cctx = mapOverviewCacheCanvas.getContext('2d');
        if (!cctx) return;
        const w = Math.max(1, Number(msg.widthPx) || 0);
        const h = Math.max(1, Number(msg.heightPx) || 0);
        if (!msg.buffer) return;
        const arr = new Uint8ClampedArray(msg.buffer);
        const imageData = new ImageData(arr, w, h);
        cctx.putImageData(imageData, Number(msg.xPx) || 0, Number(msg.yPx) || 0);
        emitMapOverviewProgress();
      } else if (msg.type === 'done') {
        if (msg.jobId !== mapOverviewNoiseJobId) return;
        emitMapOverviewProgress();
      } else if (msg.type === 'error') {
        mapOverviewNoiseEnabled = false;
      }
    };
    mapOverviewNoiseWorker.onerror = () => {
      mapOverviewNoiseEnabled = false;
    };
    return mapOverviewNoiseWorker;
  } catch {
    mapOverviewNoiseEnabled = false;
    return null;
  }
}

function stopNoiseJob() {
  const worker = ensureMapOverviewNoiseWorker();
  if (!worker) return;
  mapOverviewNoiseJobId += 1;
  mapOverviewNoiseActiveKey = '';
  worker.postMessage({ type: 'cancel', jobId: mapOverviewNoiseJobId });
}

function queueNoiseSamplingJob(cacheKey, data, cacheTilePx, viewType) {
  const worker = ensureMapOverviewNoiseWorker();
  if (!worker) return false;
  mapOverviewNoiseJobId += 1;
  mapOverviewNoiseActiveKey = cacheKey;
  const jobId = mapOverviewNoiseJobId;
  worker.postMessage({
    type: 'start',
    jobId,
    cacheKey,
    payload: {
      width: data.width,
      height: data.height,
      seed: data.seed,
      config: data.config || {},
      cells: data.cells,
      temperature: data.temperature,
      moisture: data.moisture,
      anomaly: data.anomaly,
      biomes: data.biomes,
      cacheTilePx,
      viewType
    }
  });
  return true;
}

function quantizedCameraScale(camera) {
  const s = Number(camera?.scale);
  if (!Number.isFinite(s) || s <= 0) return 1;
  if (s >= 28) return 28;
  if (s >= 18) return 18;
  if (s >= 12) return 12;
  if (s >= 8) return 8;
  if (s >= 5) return 5;
  return 1;
}

function cacheTilePxForZoom(width, height, cameraScaleQ) {
  let pxPerTile = cameraScaleQ >= 18 ? 3 : cameraScaleQ >= 8 ? 2 : 1;
  while (pxPerTile > 1) {
    const total = width * height * pxPerTile * pxPerTile;
    if (total <= MAP_OVERVIEW_CACHE_MAX_PIXELS) break;
    pxPerTile -= 1;
  }
  return Math.max(1, pxPerTile);
}

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
  const cameraScaleQ = quantizedCameraScale(camera);
  const cacheTilePx = cacheTilePxForZoom(width, height, cameraScaleQ);
  const mapCacheKey = [
    data.seed,
    configSig,
    width,
    height,
    cacheTilePx,
    viewType,
    overlayContours ? 1 : 0
  ].join('|');

  if (!mapOverviewCacheCanvas || mapOverviewCacheKey !== mapCacheKey) {
    mapOverviewCacheCanvas = document.createElement('canvas');
    mapOverviewCacheCanvas.width = Math.max(1, width * cacheTilePx);
    mapOverviewCacheCanvas.height = Math.max(1, height * cacheTilePx);
    mapOverviewCacheKey = mapCacheKey;
    const mctx = mapOverviewCacheCanvas.getContext('2d');
    const wlOverview = resolveWaterLevel(data.config || {});
    if (mctx) {
      mctx.imageSmoothingEnabled = false;
      if (mctx.webkitImageSmoothingEnabled !== undefined) mctx.webkitImageSmoothingEnabled = false;
      mctx.fillStyle = '#111';
      mctx.fillRect(0, 0, width * cacheTilePx, height * cacheTilePx);

      const tileW = cacheTilePx;
      const tileH = cacheTilePx;
      const biomeColorById = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));
      const useMicroNoiseSampling = cacheTilePx > 1 && cameraScaleQ >= 8 && !overlayContours;
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
          mctx.fillRect(x * tileW, y * tileH, tileW, tileH);
        }
      }

      if (useMicroNoiseSampling) {
        queueNoiseSamplingJob(mapCacheKey, data, cacheTilePx, viewType);
      } else {
        stopNoiseJob();
      }

      if (overlayContours) {
        mctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        mctx.lineWidth = Math.max(0.08, cacheTilePx * 0.08);
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const hStep = elevationToStep(cells[y * width + x], wlOverview);
            if (x < width - 1) {
              const hr = elevationToStep(cells[y * width + (x + 1)], wlOverview);
              if (hStep !== hr) {
                mctx.beginPath();
                mctx.moveTo((x + 1) * cacheTilePx, y * cacheTilePx);
                mctx.lineTo((x + 1) * cacheTilePx, (y + 1) * cacheTilePx);
                mctx.stroke();
              }
            }
            if (y < height - 1) {
              const hd = elevationToStep(cells[(y + 1) * width + x], wlOverview);
              if (hStep !== hd) {
                mctx.beginPath();
                mctx.moveTo(x * cacheTilePx, (y + 1) * cacheTilePx);
                mctx.lineTo((x + 1) * cacheTilePx, (y + 1) * cacheTilePx);
                mctx.stroke();
              }
            }
          }
        }
      }
    }
  }

  if (mapOverviewCacheCanvas) {
    const scale = camera && Number.isFinite(camera.scale) ? Math.max(1e-6, Number(camera.scale) || 0) : (cw / width);
    const ox = camera && Number.isFinite(camera.ox) ? Number(camera.ox) || 0 : 0;
    const oy = camera && Number.isFinite(camera.oy) ? Number(camera.oy) || 0 : 0;
    if (camera && Number.isFinite(camera.scale) && Number.isFinite(camera.ox) && Number.isFinite(camera.oy)) {
      const srcW = Math.max(1, width * cacheTilePx);
      const srcH = Math.max(1, height * cacheTilePx);
      ctx.save();
      ctx.translate(-ox * scale, -oy * scale);
      ctx.drawImage(
        mapOverviewCacheCanvas,
        0,
        0,
        srcW,
        srcH,
        0,
        0,
        width * scale,
        height * scale
      );
      ctx.restore();
    } else {
      ctx.drawImage(mapOverviewCacheCanvas, 0, 0, cw, ch);
    }

    // Draw overlays after terrain so worker chunk updates never hide routes/cities.
    if (overlayPaths && paths) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 230, 115, 0.96)';
      ctx.lineWidth = Math.max(1.6, Math.min(5, scale * 0.33));
      for (const path of paths) {
        if (!Array.isArray(path) || path.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          const px = (Number(p.x) - ox + 0.5) * scale;
          const py = (Number(p.y) - oy + 0.5) * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    if (overlayGraph && graph?.nodes) {
      const nodeR = Math.max(4, Math.min(11, scale * 0.55));
      const labelPx = Math.max(12, Math.min(26, scale * 1.08));
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = `bold ${labelPx}px Outfit, Inter, sans-serif`;
      for (const node of graph.nodes) {
        const px = (Number(node.x) - ox + 0.5) * scale;
        const py = (Number(node.y) - oy + 0.5) * scale;
        if (px < -40 || py < -40 || px > cw + 40 || py > ch + 40) continue;
        ctx.shadowBlur = Math.max(0, Math.min(8, scale * 0.25));
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.fillStyle = node.isGym ? '#ff3f3f' : '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = Math.max(1.2, Math.min(3, scale * 0.18));
        ctx.beginPath();
        if (node.isGym) {
          ctx.moveTo(px, py - nodeR * 1.22);
          ctx.lineTo(px + nodeR * 1.22, py);
          ctx.lineTo(px, py + nodeR * 1.22);
          ctx.lineTo(px - nodeR * 1.22, py);
          ctx.closePath();
        } else {
          ctx.arc(px, py, nodeR, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();

        if (scale >= 6 && node.name) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(0,0,0,0.95)';
          ctx.fillStyle = '#fff';
          ctx.lineWidth = Math.max(2, Math.min(4, scale * 0.18));
          ctx.strokeText(node.name, px, py - nodeR - 5);
          ctx.fillText(node.name, px, py - nodeR - 5);
        }
      }
      ctx.restore();
    }
  }
}
