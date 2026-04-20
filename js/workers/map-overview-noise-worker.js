import { getMicroTile, MACRO_TILE_STRIDE } from '../chunking.js';
import { BIOMES, resolveWaterLevel } from '../biomes.js';

let activeJobId = -1;

const STRIP_TILE_ROWS = 20;

function clamp01(v) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(1, n));
}

function biomeColorLut() {
  const out = new Map();
  for (const b of Object.values(BIOMES)) {
    const hex = String(b.color || '#000000').replace('#', '');
    const m = hex.match(/^[0-9a-fA-F]{6}$/);
    if (!m) {
      out.set(Number(b.id) || 0, [0, 0, 0]);
      continue;
    }
    out.set(Number(b.id) || 0, [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ]);
  }
  return out;
}

function microAtSubPixel(tile, sub, tilePx) {
  return tile * MACRO_TILE_STRIDE + Math.max(
    0,
    Math.min(
      MACRO_TILE_STRIDE - 1,
      Math.floor(((sub + 0.5) / tilePx) * MACRO_TILE_STRIDE)
    )
  );
}

async function runJob(jobId, cacheKey, payload) {
  const width = Math.max(1, Math.floor(Number(payload?.width) || 1));
  const height = Math.max(1, Math.floor(Number(payload?.height) || 1));
  const cacheTilePx = Math.max(1, Math.floor(Number(payload?.cacheTilePx) || 1));
  const viewType = String(payload?.viewType || 'biomes');
  const macroData = {
    width,
    height,
    seed: Number(payload?.seed) || 0,
    config: payload?.config || {},
    cells: payload?.cells,
    temperature: payload?.temperature,
    moisture: payload?.moisture,
    anomaly: payload?.anomaly,
    biomes: payload?.biomes,
    cityData: null,
    roadTraffic: null
  };

  const wl = resolveWaterLevel(macroData.config || {});
  const biomeLut = biomeColorLut();
  const stripRows = Math.max(1, STRIP_TILE_ROWS);

  for (let y0 = 0; y0 < height; y0 += stripRows) {
    if (activeJobId !== jobId) return;
    const rows = Math.min(stripRows, height - y0);
    const stripW = width * cacheTilePx;
    const stripH = rows * cacheTilePx;
    const buf = new Uint8ClampedArray(stripW * stripH * 4);

    for (let ly = 0; ly < rows; ly++) {
      const y = y0 + ly;
      for (let x = 0; x < width; x++) {
        for (let sy = 0; sy < cacheTilePx; sy++) {
          for (let sx = 0; sx < cacheTilePx; sx++) {
            const smx = microAtSubPixel(x, sx, cacheTilePx);
            const smy = microAtSubPixel(y, sy, cacheTilePx);
            const mt = getMicroTile(smx, smy, macroData);
            let r = 0;
            let g = 0;
            let b = 0;
            if (viewType === 'elevation') {
              const val = clamp01(mt?.elevation);
              const cv = Math.floor(val * 255);
              if (val < wl) {
                b = cv;
              } else {
                r = cv;
                g = cv;
                b = cv;
              }
            } else {
              const rgb = biomeLut.get(Number(mt?.biomeId) || 0) || [0, 0, 0];
              r = rgb[0];
              g = rgb[1];
              b = rgb[2];
            }
            const px = x * cacheTilePx + sx;
            const py = ly * cacheTilePx + sy;
            const idx = (py * stripW + px) * 4;
            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = 255;
          }
        }
      }
    }

    self.postMessage(
      {
        type: 'chunk',
        jobId,
        cacheKey,
        xPx: 0,
        yPx: y0 * cacheTilePx,
        widthPx: stripW,
        heightPx: stripH,
        buffer: buf.buffer
      },
      [buf.buffer]
    );

    await new Promise((r) => setTimeout(r, 0));
  }

  if (activeJobId !== jobId) return;
  self.postMessage({ type: 'done', jobId, cacheKey });
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'cancel') {
    activeJobId = Number(msg.jobId) || -1;
    return;
  }
  if (msg.type === 'start') {
    const jobId = Number(msg.jobId) || 0;
    activeJobId = jobId;
    runJob(jobId, String(msg.cacheKey || ''), msg.payload).catch((err) => {
      self.postMessage({ type: 'error', jobId, message: err?.message || 'noise-worker-failed' });
    });
  }
};
