import { BIOMES } from '../biomes.js';
import { MACRO_TILE_STRIDE, foliageDensity, getMicroTile } from '../chunking.js';
import {
  BIOME_VEGETATION,
  FOLIAGE_DENSITY_THRESHOLD,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  getTreeType
} from '../biome-tiles.js';
import { PLAY_CHUNK_SIZE } from './render-constants.js';
import { hasPlayChunk, getPlayChunkCacheRevision } from './play-chunk-cache.js';
import { seededHash } from '../tessellation-logic.js';
import { imageCache } from '../image-cache.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';
import {
  defaultPortraitSlugForBalloon,
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';

// ---------------------------------------------------------------------------
// Zoom level definitions
// ---------------------------------------------------------------------------
/** @type {Record<string, number>} half-radius in macro tiles; 0 = show whole map */
const SAFE_MACRO_STRIDE = Math.max(1, Number(MACRO_TILE_STRIDE) || 1);
const MICRO_RADIUS = {
  mid: 320, // Keep a medium tactical view in micro tiles
  close: Math.round(80 / 1.5) // +50% zoom-in versus previous close level
};
const ZOOM_RADIUS = {
  far: 0,   // whole-map overview, no panning
  mid: Math.max(2, Math.round(MICRO_RADIUS.mid / SAFE_MACRO_STRIDE)),
  close: Math.max(1, Math.round(MICRO_RADIUS.close / SAFE_MACRO_STRIDE))
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
/** @type {Set<string>} */
const minimapPortraitRequests = new Set();
const minimapBiomeRgbCache = new Map();

/** Far wilds (`_distanceInactivated`) show this instead of a species portrait. */
const UNKNOWN_POKEMON_MINIMAP_PATH = 'map-icons/unknown-pokemon.png';
/** @type {Promise<void> | null} */
let unknownPokemonMinimapInflight = null;

function queueUnknownPokemonMinimapIconLoad() {
  if (imageCache.get(UNKNOWN_POKEMON_MINIMAP_PATH)?.naturalWidth || unknownPokemonMinimapInflight) return;
  unknownPokemonMinimapInflight = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(UNKNOWN_POKEMON_MINIMAP_PATH, img);
      unknownPokemonMinimapInflight = null;
      resolve();
    };
    img.onerror = () => {
      unknownPokemonMinimapInflight = null;
      resolve();
    };
    img.src = UNKNOWN_POKEMON_MINIMAP_PATH;
  });
}
const LOCAL_MINIMAP_REBUILD_MIN_MS = 80;

/**
 * Close minimap: outline each 8×8 micro play-chunk region.
 * Green = present in bake cache; magenta dashed = in view but not baked yet.
 * Also: set `globalThis.__DEBUG_MINIMAP_PLAY_CHUNKS__ = true` in the console (no reload if you flip after load — you need a re-render tick; pan once).
 */
const DEBUG_MINIMAP_PLAY_CHUNK_OVERLAY = false;

function minimapPlayChunkDebugOn() {
  return (
    DEBUG_MINIMAP_PLAY_CHUNK_OVERLAY ||
    (typeof globalThis !== 'undefined' && globalThis.__DEBUG_MINIMAP_PLAY_CHUNKS__ === true)
  );
}

/** @type {HTMLCanvasElement | null} */
let localMinimapCacheCanvas = null;
let localMinimapCacheData = null;
let localMinimapCacheW = 0;
let localMinimapCacheH = 0;
let localMinimapCacheOriginX = 0;
let localMinimapCacheOriginY = 0;
let localMinimapCacheChunkRevision = -1;
let localMinimapCacheLastRebuildAtMs = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getZoom(canvas) {
  const z = canvas.dataset.zoom;
  return ZOOM_RADIUS.hasOwnProperty(z) ? z : 'close';
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

function hexToRgb(hexLike) {
  const s = String(hexLike || '').trim();
  const m = s.match(/^#?([a-fA-F0-9]{6})$/);
  if (!m) return { r: 100, g: 130, b: 100 };
  const h = m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

function biomeRgb(biomeId) {
  const key = Number(biomeId) || 0;
  if (minimapBiomeRgbCache.has(key)) return minimapBiomeRgbCache.get(key);
  const biome = Object.values(BIOMES).find((b) => b.id === key);
  const rgb = hexToRgb(biome?.color);
  minimapBiomeRgbCache.set(key, rgb);
  return rgb;
}

function mixRgb(a, b, t) {
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  return {
    r: Math.round(a.r * (1 - k) + b.r * k),
    g: Math.round(a.g * (1 - k) + b.g * k),
    b: Math.round(a.b * (1 - k) + b.b * k)
  };
}

const MM_TILE_BARE = 1;
const MM_TILE_GRASS = 2;
const MM_TILE_TREE = 3;
const MM_TILE_ROCK = 4;
const MM_TILE_CRYSTAL = 5;

function classifyLocalMinimapTile(mx, my, tile, data) {
  if (!tile) return MM_TILE_BARE;

  const treeType = getTreeType(tile.biomeId, mx, my, data.seed);
  const treeNoise = foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE);
  const treeWestNoise = foliageDensity(mx - 1, my, data.seed + 5555, TREE_NOISE_SCALE);
  const isTreeRoot = !!treeType && (mx + my) % 3 === 0 && treeNoise >= TREE_DENSITY_THRESHOLD;
  const isTreeRight = !!treeType && (mx + my) % 3 === 1 && treeWestNoise >= TREE_DENSITY_THRESHOLD;
  if (isTreeRoot || isTreeRight) return MM_TILE_TREE;

  if (!tile.isRoad && !tile.isCity && !tile.urbanBuilding) {
    const scatterNoise = foliageDensity(mx, my, data.seed + 111, 2.5);
    if (scatterNoise > 0.82) {
      const items = BIOME_VEGETATION[tile.biomeId] || [];
      if (items.length) {
        const itemKey = items[Math.floor(seededHash(mx, my, data.seed + 222) * items.length)] || '';
        const item = String(itemKey).toLowerCase();
        if (item.includes('crystal')) return MM_TILE_CRYSTAL;
        if (item.includes('rock')) return MM_TILE_ROCK;
      }
    }
  }

  const hasGrass = !tile.isRoad && !tile.isCity && tile.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD;
  return hasGrass ? MM_TILE_GRASS : MM_TILE_BARE;
}

function localMinimapColor(biomeId, tileKind) {
  const base = biomeRgb(biomeId);
  if (tileKind === MM_TILE_TREE) return mixRgb(base, { r: 28, g: 95, b: 38 }, 0.62);
  if (tileKind === MM_TILE_GRASS) return mixRgb(base, { r: 92, g: 180, b: 82 }, 0.5);
  if (tileKind === MM_TILE_ROCK) return mixRgb(base, { r: 130, g: 130, b: 130 }, 0.72);
  if (tileKind === MM_TILE_CRYSTAL) return mixRgb(base, { r: 175, g: 226, b: 255 }, 0.76);
  return mixRgb(base, { r: 20, g: 20, b: 20 }, 0.35);
}

/**
 * Local minimap at close zoom:
 * 1 screen pixel = 1 micro sprite-tile, only where chunks are currently loaded.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} data
 * @param {number} playerX micro X
 * @param {number} playerY micro Y
 * @param {{ w: number, h: number }} canvasSize
 */
function drawLocalLoadedSpriteTileMinimap(ctx, data, playerX, playerY, canvasSize) {
  const w = canvasSize.w;
  const h = canvasSize.h;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const originX = Math.floor(playerX - w * 0.5);
  const originY = Math.floor(playerY - h * 0.5);
  const chunkRevision = getPlayChunkCacheRevision();
  const nowMs = performance.now();
  const needsRebuild =
    !localMinimapCacheCanvas ||
    localMinimapCacheData !== data ||
    localMinimapCacheW !== w ||
    localMinimapCacheH !== h ||
    localMinimapCacheOriginX !== originX ||
    localMinimapCacheOriginY !== originY ||
    localMinimapCacheChunkRevision !== chunkRevision;

  if (!needsRebuild) {
    ctx.drawImage(localMinimapCacheCanvas, 0, 0);
    return;
  }

  const canThrottle =
    localMinimapCacheCanvas &&
    localMinimapCacheData === data &&
    localMinimapCacheW === w &&
    localMinimapCacheH === h &&
    nowMs - localMinimapCacheLastRebuildAtMs < LOCAL_MINIMAP_REBUILD_MIN_MS;
  if (canThrottle) {
    ctx.drawImage(localMinimapCacheCanvas, 0, 0);
    return;
  }

  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = w;
  cacheCanvas.height = h;
  const cctx = cacheCanvas.getContext('2d');
  if (!cctx) return;

  const img = cctx.createImageData(w, h);
  const pix = img.data;
  for (let i = 0; i < pix.length; i += 4) {
    pix[i] = 8;
    pix[i + 1] = 12;
    pix[i + 2] = 20;
    pix[i + 3] = 230;
  }

  const startX = Math.max(0, originX);
  const startY = Math.max(0, originY);
  const endX = Math.min(microW, originX + w);
  const endY = Math.min(microH, originY + h);
  if (startX < endX && startY < endY) {
    const startCx = Math.floor(startX / PLAY_CHUNK_SIZE);
    const startCy = Math.floor(startY / PLAY_CHUNK_SIZE);
    const endCx = Math.floor((endX - 1) / PLAY_CHUNK_SIZE);
    const endCy = Math.floor((endY - 1) / PLAY_CHUNK_SIZE);

    for (let cy = startCy; cy <= endCy; cy++) {
      for (let cx = startCx; cx <= endCx; cx++) {
        const key = `${cx},${cy}`;
        if (!hasPlayChunk(key)) continue;

        const chunkX0 = cx * PLAY_CHUNK_SIZE;
        const chunkY0 = cy * PLAY_CHUNK_SIZE;
        const x0 = Math.max(startX, chunkX0);
        const y0 = Math.max(startY, chunkY0);
        const x1 = Math.min(endX, chunkX0 + PLAY_CHUNK_SIZE);
        const y1 = Math.min(endY, chunkY0 + PLAY_CHUNK_SIZE);

        for (let my = y0; my < y1; my++) {
          const sy = my - originY;
          for (let mx = x0; mx < x1; mx++) {
            const sx = mx - originX;
            const tile = getMicroTile(mx, my, data);
            const kind = classifyLocalMinimapTile(mx, my, tile, data);
            const color = localMinimapColor(tile?.biomeId, kind);
            const p = (sy * w + sx) * 4;
            pix[p] = color.r;
            pix[p + 1] = color.g;
            pix[p + 2] = color.b;
            pix[p + 3] = 255;
          }
        }
      }
    }
  }

  cctx.putImageData(img, 0, 0);
  localMinimapCacheCanvas = cacheCanvas;
  localMinimapCacheData = data;
  localMinimapCacheW = w;
  localMinimapCacheH = h;
  localMinimapCacheOriginX = originX;
  localMinimapCacheOriginY = originY;
  localMinimapCacheChunkRevision = chunkRevision;
  localMinimapCacheLastRebuildAtMs = nowMs;
  ctx.drawImage(cacheCanvas, 0, 0);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} data
 * @param {number} playerX micro X
 * @param {number} playerY micro Y
 * @param {number} w
 * @param {number} h
 */
function drawPlayChunkBakeDebugOverlay(ctx, data, playerX, playerY, w, h) {
  if (!minimapPlayChunkDebugOn()) return;

  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const originX = Math.floor(playerX - w * 0.5);
  const originY = Math.floor(playerY - h * 0.5);
  const startX = Math.max(0, originX);
  const startY = Math.max(0, originY);
  const endX = Math.min(microW, originX + w);
  const endY = Math.min(microH, originY + h);
  if (startX >= endX || startY >= endY) return;

  const startCx = Math.floor(startX / PLAY_CHUNK_SIZE);
  const startCy = Math.floor(startY / PLAY_CHUNK_SIZE);
  const endCx = Math.floor((endX - 1) / PLAY_CHUNK_SIZE);
  const endCy = Math.floor((endY - 1) / PLAY_CHUNK_SIZE);

  ctx.save();
  ctx.lineWidth = 1;
  for (let cy = startCy; cy <= endCy; cy++) {
    for (let cx = startCx; cx <= endCx; cx++) {
      const key = `${cx},${cy}`;
      const chunkX0 = cx * PLAY_CHUNK_SIZE;
      const chunkY0 = cy * PLAY_CHUNK_SIZE;
      const sx0 = chunkX0 - originX;
      const sy0 = chunkY0 - originY;
      const sx1 = sx0 + PLAY_CHUNK_SIZE;
      const sy1 = sy0 + PLAY_CHUNK_SIZE;
      const rx0 = Math.max(0, sx0);
      const ry0 = Math.max(0, sy0);
      const rx1 = Math.min(w, sx1);
      const ry1 = Math.min(h, sy1);
      if (rx0 >= rx1 || ry0 >= ry1) continue;
      const rw = rx1 - rx0;
      const rh = ry1 - ry0;
      if (hasPlayChunk(key)) {
        ctx.strokeStyle = 'rgba(72, 255, 140, 0.92)';
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(255, 72, 210, 0.88)';
        ctx.setLineDash([2, 2]);
      }
      ctx.strokeRect(rx0 + 0.5, ry0 + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
    }
  }
  ctx.restore();
}

/**
 * Draws wild spawn markers with portrait heads on minimap.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ scale: number, ox: number, oy: number }} tf
 * @param {{ x: number, y: number }} playerMacro
 * @param {{ w: number, h: number }} canvasSize
 */
function drawWildSpawnPortraitMarkers(ctx, tf, playerMacro, canvasSize) {
  const markers = [];
  for (const ent of entitiesByKey.values()) {
    if (!ent || ent.isDespawning || ent.deadState) continue;
    if (!Number.isFinite(ent.x) || !Number.isFinite(ent.y) || !Number.isFinite(ent.dexId)) continue;
    const mx = ent.x / MACRO_TILE_STRIDE;
    const my = ent.y / MACRO_TILE_STRIDE;
    const distSq = (mx - playerMacro.x) ** 2 + (my - playerMacro.y) ** 2;
    markers.push({ ent, mx, my, distSq });
  }
  markers.sort((a, b) => a.distSq - b.distSq);
  const visibleMax = 24;
  const markerR = Math.max(4, Math.min(8, tf.scale * 0.52));
  const screenPad = markerR + 2;

  for (let i = 0; i < Math.min(visibleMax, markers.length); i++) {
    const m = markers[i];
    const isDistanceEstimate = !!m.ent._distanceInactivated;
    const sx = (m.mx - tf.ox + 0.5) * tf.scale;
    const sy = (m.my - tf.oy + 0.5) * tf.scale;
    if (sx < -screenPad || sy < -screenPad || sx > canvasSize.w + screenPad || sy > canvasSize.h + screenPad) {
      continue;
    }

    const dexId = Math.floor(Number(m.ent.dexId) || 0);
    const portraitSlug = m.ent.emotionPortraitSlug || defaultPortraitSlugForBalloon(m.ent.emotionType ?? 9);
    if (isDistanceEstimate) {
      queueUnknownPokemonMinimapIconLoad();
    }
    const unknownImg = isDistanceEstimate ? imageCache.get(UNKNOWN_POKEMON_MINIMAP_PATH) : null;
    const img = isDistanceEstimate
      ? null
      : getSpriteCollabPortraitImage(imageCache, dexId, portraitSlug);
    if (!isDistanceEstimate && (!img || !img.naturalWidth)) {
      const reqKey = `${dexId}:${portraitSlug}`;
      if (!minimapPortraitRequests.has(reqKey)) {
        minimapPortraitRequests.add(reqKey);
        ensureSpriteCollabPortraitLoaded(imageCache, dexId, portraitSlug).catch(() => {});
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, markerR, 0, Math.PI * 2);
    ctx.fillStyle = isDistanceEstimate ? 'rgba(2, 4, 9, 0.97)' : 'rgba(4, 7, 14, 0.9)';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = isDistanceEstimate ? 'rgba(180, 190, 208, 0.7)' : 'rgba(255,255,255,0.85)';
    ctx.stroke();

    const drawClippedRoundPortrait = (tex) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, markerR - 1.1, 0, Math.PI * 2);
      ctx.clip();
      const iw = tex.naturalWidth;
      const ih = tex.naturalHeight;
      const side = (markerR - 1.1) * 2;
      const scale = Math.max(side / iw, side / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(tex, sx - dw * 0.5, sy - dh * 0.46, dw, dh);
      ctx.restore();
    };

    if (unknownImg?.naturalWidth) {
      drawClippedRoundPortrait(unknownImg);
    } else if (img && img.naturalWidth) {
      drawClippedRoundPortrait(img);
    } else {
      ctx.fillStyle = isDistanceEstimate ? 'rgba(95, 140, 175, 0.9)' : 'rgba(140, 205, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.8, markerR * 0.38), 0, Math.PI * 2);
      ctx.fill();
    }

    if (isDistanceEstimate && !unknownImg?.naturalWidth) {
      const qx = sx + markerR * 0.55;
      const qy = sy + markerR * 0.55;
      const qSize = Math.max(7, markerR * 1.05);
      ctx.font = `700 ${qSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(1.6, markerR * 0.26);
      ctx.strokeStyle = 'rgba(0,0,0,0.88)';
      ctx.fillStyle = 'rgba(255,236,170,0.98)';
      ctx.strokeText('?', qx, qy);
      ctx.fillText('?', qx, qy);
    }

    if (m.ent.spawnPhase > 0.02) {
      ctx.globalAlpha = Math.max(0.2, Math.min(0.8, m.ent.spawnPhase));
      ctx.strokeStyle = 'rgba(115, 231, 255, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx, sy, markerR + 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
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
  let tfScale = scale;
  let tfOx = ox;
  let tfOy = oy;
  if (zoom === 'close') {
    tfScale = MACRO_TILE_STRIDE; // 1 screen px == 1 micro tile
    tfOx = playerMacroX + 0.5 - w / (2 * tfScale);
    tfOy = playerMacroY + 0.5 - h / (2 * tfScale);
  }

  // --- Composite base layer with panning ---
  ctx.clearRect(0, 0, w, h);
  if (zoom === 'close') {
    drawLocalLoadedSpriteTileMinimap(ctx, data, player.x, player.y, { w, h });
    drawPlayChunkBakeDebugOverlay(ctx, data, player.x, player.y, w, h);
  } else {
    ctx.save();
    ctx.translate(-tfOx * tfScale, -tfOy * tfScale);
    ctx.drawImage(baseCacheCanvas, 0, 0, data.width * tfScale, data.height * tfScale);
    ctx.restore();
  }

  // --- Viewport border pulse for close zoom ---
  if (zoom === 'close') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,80,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.restore();
  }

  // --- Player marker (always screen-centred for mid/close zoom) ---
  const playerScreenX = (playerMacroX - tfOx + 0.5) * tfScale;
  const playerScreenY = (playerMacroY - tfOy + 0.5) * tfScale;

  const dotR = Math.max(3, Math.min(5, tfScale * 0.6));

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

  drawWildSpawnPortraitMarkers(
    ctx,
    { scale: tfScale, ox: tfOx, oy: tfOy },
    { x: playerMacroX, y: playerMacroY },
    { w, h }
  );

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
