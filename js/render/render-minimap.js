import { BIOMES } from '../biomes.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';

// ---------------------------------------------------------------------------
// Zoom level definitions
// ---------------------------------------------------------------------------
/** @type {Record<string, number>} half-radius in macro tiles; 0 = show whole map */
const ZOOM_RADIUS = {
  far: 0,   // whole-map overview, no panning
  mid: 20,  // ~40-tile window centred on player (default)
  close: 10 // ~20-tile window — fine detail
};

const ZOOM_ORDER = ['far', 'mid', 'close'];

// ---------------------------------------------------------------------------
// Offscreen base-layer cache (biomes + routes + cities).
// Keyed by data object identity + zoom level so we skip rebuilds each frame.
// ---------------------------------------------------------------------------
/** @type {HTMLCanvasElement | null} */
let baseCacheCanvas = null;
let baseCacheData = null;
let baseCacheZoom = '';
let baseCacheW = 0;
let baseCacheH = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getZoom(canvas) {
  const z = canvas.dataset.zoom;
  return ZOOM_RADIUS.hasOwnProperty(z) ? z : 'mid';
}

/**
 * Compute the pixel-space transform for the current view.
 * Returns {ox, oy, scale} where world macro-tile (tx, ty) maps to
 *   screen pixel ( (tx - ox + 0.5) * scale,  (ty - oy + 0.5) * scale )
 *
 * @param {number} w canvas width
 * @param {number} h canvas height
 * @param {number} dataW world width in macro tiles
 * @param {number} dataH world height in macro tiles
 * @param {number} playerMacroX
 * @param {number} playerMacroY
 * @param {string} zoom
 */
function computeTransform(w, h, dataW, dataH, playerMacroX, playerMacroY, zoom) {
  const radius = ZOOM_RADIUS[zoom];

  if (radius === 0) {
    // Full map — no panning
    return {
      scale: Math.min(w / dataW, h / dataH),
      ox: 0,
      oy: 0
    };
  }

  const diameter = radius * 2;
  const scale = Math.min(w / diameter, h / diameter);

  // Centre of view = player position (clamped to world bounds)
  let cx = Math.floor(playerMacroX);
  let cy = Math.floor(playerMacroY);

  // Clamp so the viewport doesn't go outside the world
  const halfW = w / scale / 2;
  const halfH = h / scale / 2;
  cx = Math.max(halfW, Math.min(dataW - halfW, cx + 0.5));
  cy = Math.max(halfH, Math.min(dataH - halfH, cy + 0.5));

  // ox/oy is the top-left world coordinate of the visible window
  const ox = cx - halfW;
  const oy = cy - halfH;

  return { scale, ox, oy };
}

// ---------------------------------------------------------------------------
// Base-layer (re)build
// ---------------------------------------------------------------------------
function rebuildBase(w, h, data, zoom) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;

  const { width: dataW, height: dataH, biomes, paths, graph } = data;

  // Player is not available when building the base — we treat full-map as
  // the build target. Panning/zooming is applied when compositing.
  // For 'far' the base IS the final image (no panning).
  // For mid/close we over-render the full world at the correct scale and
  // then blit only the visible sub-region.

  // Biome background
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  const colorByBiomeId = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));

  const tileW = w / dataW;
  const tileH = h / dataH;

  for (let y = 0; y < dataH; y++) {
    for (let x = 0; x < dataW; x++) {
      const bId = biomes[y * dataW + x];
      ctx.fillStyle = colorByBiomeId.get(bId) || '#222';
      ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
    }
  }

  // Routes — golden lines
  if (paths && paths.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 210, 60, 0.82)';
    ctx.lineWidth = Math.max(1, tileW * 0.6);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const path of paths) {
      if (!path || path.length < 2) continue;
      ctx.beginPath();
      path.forEach((p, i) => {
        const px = (p.x + 0.5) * tileW;
        const py = (p.y + 0.5) * tileH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  // Cities / Gyms
  if (graph && graph.nodes && graph.nodes.length) {
    const r = Math.max(2.5, tileW * 0.8);
    const fontSize = Math.max(6, Math.min(10, tileW * 1.1));
    ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    for (const node of graph.nodes) {
      const px = (node.x + 0.5) * tileW;
      const py = (node.y + 0.5) * tileH;

      // Shadow
      ctx.save();
      ctx.shadowBlur = 4;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';

      if (node.isGym) {
        // Diamond — red
        ctx.fillStyle = '#ff3c3c';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py - r * 1.4);
        ctx.lineTo(px + r * 1.4, py);
        ctx.lineTo(px, py + r * 1.4);
        ctx.lineTo(px - r * 1.4, py);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Circle — white
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // Label (only if tileW large enough to be legible)
      if (tileW >= 5 && node.name) {
        ctx.save();
        ctx.shadowBlur = 3;
        ctx.shadowColor = 'rgba(0,0,0,1)';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText(node.name, px, py - r - 1);
        ctx.fillText(node.name, px, py - r - 1);
        ctx.restore();
      }
    }
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Public API — same signature as before
// ---------------------------------------------------------------------------
/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} data  world data (biomes, width, height, paths, graph, …)
 * @param {object} player  {x, y} in micro-tile coordinates
 */
export function renderMinimap(canvas, data, player) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.imageSmoothingEnabled = false;
  if (ctx.webkitImageSmoothingEnabled !== undefined) ctx.webkitImageSmoothingEnabled = false;

  const zoom = getZoom(canvas);

  // --- Base layer cache ---
  const needsRebuild =
    !baseCacheCanvas ||
    baseCacheData !== data ||
    baseCacheZoom !== zoom ||
    baseCacheW !== w ||
    baseCacheH !== h;

  if (needsRebuild) {
    baseCacheCanvas = rebuildBase(w, h, data, zoom);
    baseCacheData = data;
    baseCacheZoom = zoom;
    baseCacheW = w;
    baseCacheH = h;
  }

  // Player position in macro-tile space
  const playerMacroX = player.x / MACRO_TILE_STRIDE;
  const playerMacroY = player.y / MACRO_TILE_STRIDE;

  const { scale, ox, oy } = computeTransform(
    w, h, data.width, data.height, playerMacroX, playerMacroY, zoom
  );

  // --- Composite base layer with panning ---
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(-ox * scale, -oy * scale);
  ctx.drawImage(baseCacheCanvas, 0, 0, data.width * scale, data.height * scale);
  ctx.restore();

  // --- Viewport border pulse for close zoom ---
  if (zoom === 'close') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,80,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.restore();
  }

  // --- Player marker (always screen-centred for mid/close zoom) ---
  const playerScreenX = (playerMacroX - ox + 0.5) * scale;
  const playerScreenY = (playerMacroY - oy + 0.5) * scale;

  const dotR = Math.max(3, Math.min(5, scale * 0.6));

  // Outer glow
  ctx.save();
  ctx.shadowBlur = 8;
  ctx.shadowColor = 'rgba(255, 80, 80, 0.9)';
  ctx.fillStyle = '#ff2222';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(playerScreenX, playerScreenY, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Direction tick (small white line in movement direction — optional, skipped if speed unknown)
  // (kept simple for now — just the dot)

  // --- City labels for mid/close (re-render on top so they survive clipping) ---
  // Already in the base cache; visible automatically once tileW is large enough.
}

// ---------------------------------------------------------------------------
// Exported helper: cycle zoom level on user click
// ---------------------------------------------------------------------------
/**
 * Advances the minimap canvas to the next zoom level and returns the new zoom string.
 * @param {HTMLCanvasElement} canvas
 * @returns {string}
 */
export function cycleMinimapZoom(canvas) {
  const current = getZoom(canvas);
  const idx = ZOOM_ORDER.indexOf(current);
  const next = ZOOM_ORDER[(idx + 1) % ZOOM_ORDER.length];
  canvas.dataset.zoom = next;
  // Invalidate base cache (zoom changed)
  baseCacheData = null;
  return next;
}
