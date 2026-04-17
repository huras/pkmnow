import { BIOMES } from '../biomes.js';
import {
  canWalkMicroTile,
  formalTreeTrunkOverlapsMicroCell,
  getFormalTreeTrunkWorldXSpan,
  scatterPhysicsCircleOverlapsMicroCellAny,
  scatterPhysicsCircleAtOrigin,
  EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER
} from '../walkability.js';
import { scatterItemKeyIsTree } from '../scatter-pass2-debug.js';
import { circleAabbIntersectsRect } from '../main/play-collider-overlay-cache.js';
import { worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import {
  drawPlayEntityFootAndAirCollider,
  drawPlayEntityCombatHurtbox
} from './render-debug-overlays.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';
import { getWorldReactionOverlayCells } from '../simulation/world-reactions.js';

const CLOUD_WRAP_PAD_PX = 220;
const CLOUD_ALPHA_GAIN = 2;
const CLOUD_SHADOW_ALPHA_RATIO = 0.68;
const CLOUD_SIZE_GAIN = 1.5;
const CLOUD_SHADOW_OFFSET_MULT = 1.5;
const CLOUD_SHADOW_OFFSET_BASE_X_TILES = 2.6;
const CLOUD_SHADOW_OFFSET_BASE_Y_TILES = 3.3;
/** Side length (power of two) of the precomputed cloud-size noise field. Small = cheap to regenerate, tile-wraps in world space. */
const CLOUD_SIZE_FIELD_N = 64;
/** Spacing between cloud slots in world-tiles. One potential cloud per slot; noise decides if/size. */
const CLOUD_SLOT_STEP_WORLD_TILES = 10;
/** World-tile span covered by each field cell. Field repeats every `N * cellWorld` world tiles. */
const CLOUD_SIZE_FIELD_CELL_WORLD_TILES = 6; // 64*6 = 384 tiles per repeat
/** Below this 0..1 noise value, the slot produces no cloud (clear sky). */
const CLOUD_SIZE_SKIP_THRESHOLD = 0.42;
/** Cloud size multiplier range, scaled from (noise - threshold)/(1 - threshold). */
const CLOUD_SIZE_MIN_MUL = 0.45;
const CLOUD_SIZE_MAX_MUL = 1.55;
/** Global wind drift applied to the whole cloud field (tiles per second). */
const CLOUD_WIND_VX_TILES_PER_SEC = 0.32;
const CLOUD_WIND_VY_TILES_PER_SEC = 0.09;
/** Per-slot position jitter (as a fraction of slot step) so the grid doesn't read as a grid. */
const CLOUD_SLOT_JITTER_FRAC = 0.55;
const SNES_CLOUD_CLUSTERS = Object.freeze([
  { seedX: 0.07, seedY: 0.12, scale: 1.14, speed: 0.020, speedY: 0.010, alpha: 0.26, puffs: [[-0.9, 0.06, 0.84], [-0.15, -0.02, 1.0], [0.72, 0.08, 0.86]] },
  { seedX: 0.21, seedY: 0.28, scale: 1.03, speed: 0.024, speedY: 0.008, alpha: 0.29, puffs: [[-0.7, 0.05, 0.74], [0.0, -0.04, 1.03], [0.8, 0.07, 0.78]] },
  { seedX: 0.34, seedY: 0.46, scale: 1.22, speed: 0.017, speedY: 0.007, alpha: 0.24, puffs: [[-0.95, 0.04, 0.92], [-0.05, -0.03, 1.08], [0.84, 0.09, 0.86]] },
  { seedX: 0.48, seedY: 0.62, scale: 0.96, speed: 0.028, speedY: 0.011, alpha: 0.25, puffs: [[-0.62, 0.05, 0.75], [0.06, -0.05, 0.97], [0.76, 0.05, 0.71]] },
  { seedX: 0.62, seedY: 0.76, scale: 1.15, speed: 0.021, speedY: 0.009, alpha: 0.28, puffs: [[-0.84, 0.07, 0.88], [-0.1, -0.04, 1.04], [0.8, 0.08, 0.82]] },
  { seedX: 0.77, seedY: 0.88, scale: 1.00, speed: 0.019, speedY: 0.012, alpha: 0.24, puffs: [[-0.7, 0.05, 0.73], [0.02, -0.04, 0.98], [0.78, 0.06, 0.72]] },
  { seedX: 0.86, seedY: 0.54, scale: 1.28, speed: 0.015, speedY: 0.006, alpha: 0.23, puffs: [[-0.96, 0.06, 0.9], [0.0, -0.03, 1.1], [0.9, 0.1, 0.84]] },
  { seedX: 0.95, seedY: 0.36, scale: 0.9, speed: 0.031, speedY: 0.013, alpha: 0.22, puffs: [[-0.56, 0.04, 0.68], [0.0, -0.05, 0.91], [0.67, 0.06, 0.69]] }
]);

let cloudSpriteCache = null;
let ghostMistCache = null;

function makeCloudSpriteFromPuffs(puffs, color) {
  const W = 320;
  const H = 220;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { alpha: true });
  g.clearRect(0, 0, W, H);
  g.fillStyle = color;

  const drawPuff = (cx, cy, w, h) => {
    g.beginPath();
    g.ellipse(cx, cy, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  };

  for (const [ox, oy, scale] of puffs) {
    const w = 82 * scale;
    const h = 62 * scale;
    const cx = W * 0.5 + ox * 62;
    const cy = H * 0.5 + oy * 52;
    drawPuff(cx, cy, w, h);

    // Add small satellites so each cloud cluster has more "balls" without runtime overhead.
    const satellites = [
      [-0.42, -0.16, 0.52],
      [0.45, -0.12, 0.47],
      [0.08, 0.21, 0.44]
    ];
    for (const [sx, sy, ss] of satellites) {
      const sw = w * ss;
      const sh = h * ss;
      drawPuff(cx + sx * w, cy + sy * h, sw, sh);
    }
  }
  return c;
}

function getCloudSpritePairForCluster(clusterIdx) {
  if (!cloudSpriteCache) cloudSpriteCache = new Map();
  if (cloudSpriteCache.has(clusterIdx)) return cloudSpriteCache.get(clusterIdx);
  const cluster = SNES_CLOUD_CLUSTERS[clusterIdx];
  const pair = {
    cloud: makeCloudSpriteFromPuffs(cluster.puffs, '#ffffff'),
    shadow: makeCloudSpriteFromPuffs(cluster.puffs, '#000000')
  };
  cloudSpriteCache.set(clusterIdx, pair);
  return pair;
}

/** Deterministic [0, 1); integer lattice hash. */
function hash01Cell(ix, iy, iz) {
  const x = ix | 0;
  const y = iy | 0;
  const z = iz | 0;
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 419.2) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep01(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

let cloudSizeField = null;
let cloudSizeFieldSeed = null;

/**
 * Builds a small toroidal 2-octave value-noise field (0..1). Cheap to regen,
 * then each cloud just does 4 array reads + bilinear — no sin per instance.
 */
function buildCloudSizeField(seed) {
  const N = CLOUD_SIZE_FIELD_N;
  const out = new Float32Array(N * N);
  const s1 = (seed | 0) % 2147483000;
  const s2 = ((seed * 1013904223) | 0) % 2147483000 ^ 0x6c078965;
  const coarseScale = 1 / 8;
  const fineScale = 1 / 3;
  const weightCoarse = 0.65;
  const weightFine = 0.35;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const coarse = octaveSampleWrap(x, y, coarseScale, N, s1);
      const fine = octaveSampleWrap(x, y, fineScale, N, s2);
      const v = weightCoarse * coarse + weightFine * fine;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
      out[y * N + x] = v;
    }
  }
  const range = Math.max(1e-6, vmax - vmin);
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] - vmin) / range;
  }
  return out;
}

function octaveSampleWrap(x, y, scale, N, seed) {
  const sx = x * scale;
  const sy = y * scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const wrapX = Math.max(1, Math.floor(N * scale));
  const wrapY = Math.max(1, Math.floor(N * scale));
  const ix0 = ((x0 % wrapX) + wrapX) % wrapX;
  const iy0 = ((y0 % wrapY) + wrapY) % wrapY;
  const ix1 = (ix0 + 1) % wrapX;
  const iy1 = (iy0 + 1) % wrapY;
  const h00 = hash01Cell(ix0, iy0, seed);
  const h10 = hash01Cell(ix1, iy0, seed);
  const h01 = hash01Cell(ix0, iy1, seed);
  const h11 = hash01Cell(ix1, iy1, seed);
  const u = smoothstep01(fx);
  const v = smoothstep01(fy);
  const a = h00 + u * (h10 - h00);
  const b = h01 + u * (h11 - h01);
  return a + v * (b - a);
}

function ensureCloudSizeField(seed) {
  if (cloudSizeField && cloudSizeFieldSeed === seed) return cloudSizeField;
  cloudSizeField = buildCloudSizeField(seed);
  cloudSizeFieldSeed = seed;
  return cloudSizeField;
}

/** Returns 0..1 via wrap-sampling the precomputed field in world-tile space (bilinear). */
function sampleCloudSizeField01(worldX, worldY, seed) {
  const field = ensureCloudSizeField(seed);
  const N = CLOUD_SIZE_FIELD_N;
  const inv = 1 / CLOUD_SIZE_FIELD_CELL_WORLD_TILES;
  const fx = worldX * inv;
  const fy = worldY * inv;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const ix0 = ((x0 % N) + N) % N;
  const iy0 = ((y0 % N) + N) % N;
  const ix1 = (ix0 + 1) % N;
  const iy1 = (iy0 + 1) % N;
  const v00 = field[iy0 * N + ix0];
  const v10 = field[iy0 * N + ix1];
  const v01 = field[iy1 * N + ix0];
  const v11 = field[iy1 * N + ix1];
  const u = smoothstep01(tx);
  const v = smoothstep01(ty);
  const a = v00 + u * (v10 - v00);
  const b = v01 + u * (v11 - v01);
  return a + v * (b - a);
}

function drawSnesCloudParallax(ctx, options) {
  const {
    ch,
    timeSec,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    cloudPresence: cloudPresenceRaw = 1,
    cloudNoiseSeed = 0
  } = options;
  const cloudPresence = Math.max(0, Math.min(1, Number(cloudPresenceRaw) || 0));
  const noiseSeed = (cloudNoiseSeed | 0) >>> 0;
  const variantCount = SNES_CLOUD_CLUSTERS.length;
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const baseScale = Math.max(0.7, Math.min(1.25, ch / 900));
  const shadowOffsetX = Math.round(tileW * CLOUD_SHADOW_OFFSET_BASE_X_TILES * CLOUD_SHADOW_OFFSET_MULT);
  const shadowOffsetY = Math.round(tileH * CLOUD_SHADOW_OFFSET_BASE_Y_TILES * CLOUD_SHADOW_OFFSET_MULT);
  const paddedStartX = startX - 30;
  const paddedEndX = endX + 30;
  const paddedStartY = startY - 24;
  const paddedEndY = endY + 24;

  // One slot grid drives the whole sky. Noise determines whether a cloud exists and its size.
  const step = CLOUD_SLOT_STEP_WORLD_TILES;
  const windX = time * CLOUD_WIND_VX_TILES_PER_SEC;
  const windY = time * CLOUD_WIND_VY_TILES_PER_SEC;

  // Visible slot range (add a margin big enough for the max-size cloud so none pop at edges).
  const maxClusterScale = 1.28;
  const maxHeightPx = tileH * 6.4 * CLOUD_SIZE_GAIN * maxClusterScale * baseScale * CLOUD_SIZE_MAX_MUL;
  const maxHalfTileH = maxHeightPx / Math.max(1e-6, tileH) * 0.5;
  // Sprite is ~320x220 so width ≈ height * 1.45; take generous margin.
  const maxHalfTileW = maxHalfTileH * 1.6;
  const jitterMargin = step * CLOUD_SLOT_JITTER_FRAC * 0.5;
  const sxMin = Math.floor((paddedStartX - windX - maxHalfTileW - jitterMargin) / step);
  const sxMax = Math.ceil((paddedEndX - windX + maxHalfTileW + jitterMargin) / step);
  const syMin = Math.floor((paddedStartY - windY - maxHalfTileH - jitterMargin) / step);
  const syMax = Math.ceil((paddedEndY - windY + maxHalfTileH + jitterMargin) / step);

  const drawLayer = (isShadow) => {
    const yNudge = isShadow ? shadowOffsetY : 0;
    const xNudge = isShadow ? shadowOffsetX : 0;
    for (let sy = syMin; sy <= syMax; sy++) {
      for (let sx = sxMin; sx <= sxMax; sx++) {
        // Slot identity (stable across frames); noise sampled here → permanent size per slot.
        const identityX = sx * step;
        const identityY = sy * step;
        const sizeNoise = sampleCloudSizeField01(identityX, identityY, noiseSeed);
        if (sizeNoise < CLOUD_SIZE_SKIP_THRESHOLD) continue;

        const variantIdx = Math.floor(hash01Cell(sx, sy, noiseSeed ^ 0x9e3779b1) * variantCount) % variantCount;
        const c = SNES_CLOUD_CLUSTERS[variantIdx];
        const spritePair = getCloudSpritePairForCluster(variantIdx);
        const sprite = isShadow ? spritePair.shadow : spritePair.cloud;

        const t01 = (sizeNoise - CLOUD_SIZE_SKIP_THRESHOLD) / (1 - CLOUD_SIZE_SKIP_THRESHOLD);
        const sizeMul = CLOUD_SIZE_MIN_MUL + t01 * (CLOUD_SIZE_MAX_MUL - CLOUD_SIZE_MIN_MUL);
        const h = Math.max(2, Math.round(tileH * 6.4 * CLOUD_SIZE_GAIN * c.scale * baseScale * sizeMul));
        const w = Math.max(2, Math.round(h * (sprite.width / Math.max(1, sprite.height))));

        // Per-slot jitter + gentle bob → not a visible grid.
        const jitterX = (hash01Cell(sx, sy, noiseSeed ^ 0x5bd1e995) - 0.5) * step * CLOUD_SLOT_JITTER_FRAC;
        const jitterY = (hash01Cell(sx, sy, noiseSeed ^ 0x27d4eb2d) - 0.5) * step * CLOUD_SLOT_JITTER_FRAC;
        const bob = Math.sin(time * 0.28 + sx * 0.81 + sy * 1.37) * (tileH * 0.5);

        const centerWorldX = identityX + windX + jitterX;
        const centerWorldY = identityY + windY + jitterY;
        const x = Math.round(centerWorldX * tileW - w * 0.5 + xNudge);
        const y = Math.round(centerWorldY * tileH - h * 0.5 + yNudge + bob);

        const cloudMinX = x / tileW;
        const cloudMaxX = (x + w) / tileW;
        const cloudMinY = y / tileH;
        const cloudMaxY = (y + h) / tileH;
        if (cloudMaxX < paddedStartX || cloudMinX > paddedEndX || cloudMaxY < paddedStartY || cloudMinY > paddedEndY) {
          continue;
        }

        const alpha = c.alpha * CLOUD_ALPHA_GAIN * cloudPresence * (isShadow ? CLOUD_SHADOW_ALPHA_RATIO : 1);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.drawImage(sprite, x, y, w, h);
      }
    }
  };

  ctx.save();
  // Keep cloud/shadow locked to world coordinates; camera translation is already active in render.js.
  ctx.imageSmoothingEnabled = false;
  if (cloudPresence > 0.001) {
    drawLayer(true);
    drawLayer(false);
  }
  ctx.restore();
}

function buildGhostMistLayer(cw, ch, lodMul) {
  const layer = document.createElement('canvas');
  layer.width = cw;
  layer.height = ch;
  const c = layer.getContext('2d', { alpha: true });

  const gcx = cw * 0.5;
  const gcy = ch * 0.46;
  const r0 = Math.min(cw, ch) * 0.16;
  const r1 = Math.hypot(cw, ch) * 0.62;
  const radial = c.createRadialGradient(gcx, gcy, r0, gcx, gcy, r1);
  radial.addColorStop(0, 'rgba(255,255,255,0)');
  radial.addColorStop(0.42, `rgba(255,255,255,${0.1 * lodMul})`);
  radial.addColorStop(1, `rgba(250,252,255,${0.32 * lodMul})`);
  c.fillStyle = radial;
  c.globalAlpha = 1;
  c.fillRect(0, 0, cw, ch);

  c.fillStyle = '#ffffff';
  c.globalAlpha = 0.1 * lodMul;
  c.fillRect(0, 0, cw, ch);

  // One-time static banding texture to fake volumetric haze cheaply.
  c.globalAlpha = 0.07 * lodMul;
  for (let y = 0; y < ch; y += 8) {
    const wave = 0.5 + 0.5 * Math.sin(y * 0.031);
    c.fillStyle = `rgba(236,242,255,${0.2 + wave * 0.4})`;
    c.fillRect(0, y, cw, 2);
  }

  return layer;
}

function getGhostMistLayer(cw, ch, lodDetail) {
  const lodMul = lodDetail >= 2 ? 0.52 : lodDetail >= 1 ? 0.82 : 1;
  if (
    ghostMistCache &&
    ghostMistCache.cw === cw &&
    ghostMistCache.ch === ch &&
    ghostMistCache.lodMul === lodMul
  ) {
    return ghostMistCache.layer;
  }
  const layer = buildGhostMistLayer(cw, ch, lodMul);
  ghostMistCache = { cw, ch, lodMul, layer };
  return layer;
}

function drawWrappedScreenLayer(ctx, layer, cw, ch, ox, oy, alpha) {
  const x = ((ox % cw) + cw) % cw;
  const y = ((oy % ch) + ch) % ch;
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, x - cw, y - ch, cw, ch);
  ctx.drawImage(layer, x, y - ch, cw, ch);
  ctx.drawImage(layer, x - cw, y, cw, ch);
  ctx.drawImage(layer, x, y, cw, ch);
}

function drawGhostMistShaderLike(ctx, cw, ch, lodDetail, time) {
  const layer = getGhostMistLayer(cw, ch, lodDetail);
  const t = Number.isFinite(time) ? time : 0;
  const oxA = Math.round(Math.sin(t * 0.19) * cw * 0.06);
  const oyA = Math.round(Math.cos(t * 0.14) * ch * 0.045);
  const oxB = Math.round(Math.cos(t * 0.11 + 1.9) * cw * 0.05);
  const oyB = Math.round(Math.sin(t * 0.16 + 0.8) * ch * 0.035);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWrappedScreenLayer(ctx, layer, cw, ch, oxA, oyA, 0.95);
  ctx.globalCompositeOperation = 'lighter';
  drawWrappedScreenLayer(ctx, layer, cw, ch, oxB, oyB, 0.32);
  ctx.restore();
}

/**
 * Draws the full world collider overlay (Pass 6).
 */
export function drawWorldColliderOverlay(ctx, options) {
  const {
    showFullColliderOverlay,
    detailColliderDbg,
    data,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    snapPx,
    imageCache,
    renderItems,
    player,
    isPlayerWalkingAnim,
    getCached,
    settings
  } = options;

  if (showFullColliderOverlay) {
    ctx.save();
    const twCell = Math.ceil(tileW);
    const thCell = Math.ceil(tileH);
    const pCol = settings?.player;
    const colliderCache = settings?.playColliderOverlayCache;
    const useColliderCache = colliderCache && colliderCache.seed === data.seed;

    if (useColliderCache) {
      const { mxMin, mxMax, myMin, myMax, stride, cellFlags } = colliderCache;
      for (let my = Math.max(startY, myMin); my < endY && my <= myMax; my++) {
        for (let mx = Math.max(startX, mxMin); mx < endX && mx <= mxMax; mx++) {
          const v = cellFlags[(my - myMin) * stride + (mx - mxMin)];
          if (v === 1) {
            ctx.fillStyle = 'rgba(220, 60, 120, 0.3)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          } else if (v === 2) {
            ctx.fillStyle = 'rgba(90, 220, 255, 0.26)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          } else if (v === 3) {
            ctx.fillStyle = 'rgba(160, 170, 255, 0.24)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          }
        }
      }

      ctx.strokeStyle = 'rgba(120, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      for (const span of colliderCache.formalEllipses) {
        if (!circleAabbIntersectsRect(span.cx, span.cy, span.radius, startX, startY, endX, endY)) continue;
        const pxCx = snapPx(span.cx * tileW);
        const pxCy = snapPx(span.cy * tileH);
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, Math.max(1, span.radius * tileW), Math.max(1, span.radius * tileH), 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const p of colliderCache.scatterEllipses) {
        if (!circleAabbIntersectsRect(p.cx, p.cy, p.radius, startX, startY, endX, endY)) continue;
        ctx.strokeStyle = p.isTree ? 'rgba(200, 140, 255, 0.9)' : 'rgba(100, 200, 255, 0.88)';
        const pxCx = snapPx(p.cx * tileW);
        const pxCy = snapPx(p.cy * tileH);
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, Math.max(1, p.radius * tileW), Math.max(1, p.radius * tileH), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // Direct (no cache) fallback
      const cx = pCol ? Math.floor(pCol.x) : startX + Math.floor((endX - startX) / 2);
      const cy = pCol ? Math.floor(pCol.y) : startY + Math.floor((endY - startY) / 2);
      const COLL_OVERLAY_RAD = 18;
      const ox0 = Math.max(startX, cx - COLL_OVERLAY_RAD);
      const ox1 = Math.min(endX, cx + COLL_OVERLAY_RAD + 1);
      const oy0 = Math.max(startY, cy - COLL_OVERLAY_RAD);
      const oy1 = Math.min(endY, cy + COLL_OVERLAY_RAD + 1);
      const overlayFeetDex = player.dexId || 94;
      
      for (let my = oy0; my < oy1; my++) {
        for (let mx = ox0; mx < ox1; mx++) {
          const ftCell = worldFeetFromPivotCell(mx, my, imageCache, overlayFeetDex, isPlayerWalkingAnim);
          const feetOk = canWalkMicroTile(ftCell.x, ftCell.y, data, ftCell.x, ftCell.y, undefined, false);
          const formalTrunk = formalTreeTrunkOverlapsMicroCell(mx, my, data);
          const scatterPhy = scatterPhysicsCircleOverlapsMicroCellAny(mx, my, data);
          if (!feetOk) {
            ctx.fillStyle = 'rgba(220, 60, 120, 0.3)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          } else if (formalTrunk || scatterPhy) {
            ctx.fillStyle = formalTrunk ? 'rgba(90, 220, 255, 0.26)' : 'rgba(160, 170, 255, 0.24)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          }
        }
      }

      ctx.strokeStyle = 'rgba(120, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      for (let my = oy0; my < oy1; my++) {
        for (let rootX = ox0 - 1; rootX < ox1; rootX++) {
          const span = getFormalTreeTrunkWorldXSpan(rootX, my, data);
          if (!span) continue;
          ctx.beginPath();
          ctx.ellipse(snapPx(span.cx * tileW), snapPx(span.cy * tileH), Math.max(1, span.radius * tileW), Math.max(1, span.radius * tileH), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      
      const scatterPhyMemo = new Map();
      for (let oxS = ox0 - 8; oxS < ox1 + 2; oxS++) {
        if (oxS < 0 || oxS >= data.width * MACRO_TILE_STRIDE) continue;
        for (let oyS = Math.max(0, oy0 - 10); oyS <= Math.min(data.height * MACRO_TILE_STRIDE - 1, oy1 + 3); oyS++) {
          const p = scatterPhysicsCircleAtOrigin(oxS, oyS, data, scatterPhyMemo, getCached);
          if (!p) continue;
          if (p.cx + p.radius <= ox0 || p.cx - p.radius >= ox1 || p.cy + p.radius <= oy0 || p.cy - p.radius >= oy1) continue;
          ctx.strokeStyle = scatterItemKeyIsTree(p.itemKey) ? 'rgba(200, 140, 255, 0.9)' : 'rgba(100, 200, 255, 0.88)';
          ctx.beginPath();
          ctx.ellipse(snapPx(p.cx * tileW), snapPx(p.cy * tileH), Math.max(1, p.radius * tileW), Math.max(1, p.radius * tileH), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    for (const item of renderItems) {
      if (item.type === 'player' || item.type === 'wild') {
        drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache);
        drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx);
      } else if (item.type === 'crystalDrop') {
        const d = item.drop;
        const r = Math.max(0.05, Number(d.pickRadius) || 0.5);
        ctx.strokeStyle = 'rgba(140, 245, 255, 0.95)';
        ctx.beginPath();
        ctx.ellipse(snapPx(d.x * tileW), snapPx(d.y * tileH), Math.max(1, r * tileW), Math.max(1, r * tileH), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  } else if (detailColliderDbg) {
    ctx.save();
    for (const item of renderItems) {
      if (item.type === 'player' || item.type === 'wild') {
        drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache);
        drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx);
      }
    }
    ctx.restore();
  }

  // Individual highlight (e.g. from context menu)
  if (detailColliderDbg?.kind === 'formal-tree') {
    const span = getFormalTreeTrunkWorldXSpan(detailColliderDbg.rootX, detailColliderDbg.my, data);
    if (span) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 210, 70, 0.98)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(snapPx(span.cx * tileW), snapPx(span.cy * tileH), Math.max(2, span.radius * tileW), Math.max(2, span.radius * tileH), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * Draw world systemic debug overlay (heat/wet/shock/danger grid).
 */
export function drawWorldReactionsOverlay(ctx, options) {
  const { showWorldReactionsOverlay, startX, startY, endX, endY, tileW, tileH, cw, ch } = options;
  if (!showWorldReactionsOverlay) return;
  const cells = getWorldReactionOverlayCells(startX, startY, endX, endY);
  if (!cells.length) return;

  ctx.save();
  for (const c of cells) {
    const px = c.cx * c.cellSizeTiles * tileW;
    const py = c.cy * c.cellSizeTiles * tileH;
    const pw = Math.ceil(c.cellSizeTiles * tileW);
    const ph = Math.ceil(c.cellSizeTiles * tileH);

    if (c.wet > 0.02) {
      ctx.fillStyle = `rgba(60, 140, 255, ${Math.min(0.46, 0.08 + c.wet * 0.42)})`;
      ctx.fillRect(px, py, pw, ph);
    }
    if (c.heat > 0.02) {
      ctx.fillStyle = `rgba(255, 96, 64, ${Math.min(0.5, 0.08 + c.heat * 0.44)})`;
      ctx.fillRect(px, py, pw, ph);
    }
    if (c.shock > 0.02) {
      ctx.fillStyle = `rgba(245, 226, 92, ${Math.min(0.48, 0.08 + c.shock * 0.4)})`;
      ctx.fillRect(px, py, pw, ph);
    }
    if (c.danger > 0.1) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.88, 0.12 + c.danger * 0.66)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, Math.max(1, pw - 1), Math.max(1, ph - 1));
    }
  }
  ctx.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const panelX = 14;
  const panelY = 12;
  const panelW = Math.min(315, Math.max(240, cw * 0.32));
  const panelH = 68;
  ctx.fillStyle = 'rgba(8, 10, 14, 0.66)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(255,255,255,0.24)';
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);
  ctx.font = '12px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8edf8';
  ctx.fillText('World Reactions Overlay (V): heat / wet / shock / danger', panelX + 10, panelY + 16);
  ctx.fillStyle = 'rgba(255, 96, 64, 0.86)';
  ctx.fillText('heat', panelX + 12, panelY + 39);
  ctx.fillStyle = 'rgba(60, 140, 255, 0.9)';
  ctx.fillText('wet', panelX + 62, panelY + 39);
  ctx.fillStyle = 'rgba(245, 226, 92, 0.9)';
  ctx.fillText('shock', panelX + 104, panelY + 39);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText('danger = bright border', panelX + 166, panelY + 39);
  ctx.fillStyle = 'rgba(230,235,245,0.78)';
  ctx.fillText(`cells visible: ${cells.length}`, panelX + 10, panelY + 56);
  ctx.restore();
}

/**
 * Draws screen-space effects like day/night tint and fog.
 * @param {number} [options.cloudPresence=1] — 0..1 global cloud opacity scale.
 * @param {number} [options.cloudNoiseSeed=0] — integer; shifts the precomputed cloud-size noise field per map.
 */
export function drawEnvironmentalEffects(ctx, options) {
  const {
    cw,
    ch,
    tint,
    mistTile,
    lodDetail,
    time,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    cloudPresence = 1,
    cloudNoiseSeed = 0
  } = options;

  if (tint && typeof tint.r === 'number') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  drawSnesCloudParallax(ctx, {
    ch,
    timeSec: time,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    cloudPresence,
    cloudNoiseSeed
  });

  if (mistTile?.biomeId === BIOMES.GHOST_WOODS.id) {
    drawGhostMistShaderLike(ctx, cw, ch, lodDetail, time);
  }
}

/**
 * Draws the charge bar for the digging ability.
 */
export function drawDigChargeBar(ctx, options) {
  const { latchGround, player, playInputState, cw, ch } = options;
  if (
    latchGround &&
    !!player.grounded &&
    playInputState.shiftLeftHeld &&
    !player.digBurrowMode &&
    player.digCharge01 > 0
  ) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pillW = Math.min(280, cw * 0.44);
    const pillH = 22;
    const rad = pillH / 2;
    const px0 = (cw - pillW) * 0.5;
    const py0 = ch - 72;
    const pad = 4;
    const prog = Math.min(1, player.digCharge01);
    ctx.beginPath();
    ctx.moveTo(px0 + rad, py0);
    ctx.arcTo(px0 + pillW, py0, px0 + pillW, py0 + pillH, rad);
    ctx.arcTo(px0 + pillW, py0 + pillH, px0, py0 + pillH, rad);
    ctx.arcTo(px0, py0 + pillH, px0, py0, rad);
    ctx.arcTo(px0, py0, px0 + pillW, py0, rad);
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (prog > 0) {
      const innerW = (pillW - pad * 2) * prog;
      ctx.beginPath();
      const ix = px0 + pad;
      const iy = py0 + pad;
      const ih = pillH - pad * 2;
      const ir = ih / 2;
      ctx.moveTo(ix + ir, iy);
      ctx.arcTo(ix + innerW, iy, ix + innerW, iy + ih, ir);
      ctx.arcTo(ix + innerW, iy + ih, ix, iy + ih, ir);
      ctx.arcTo(ix, iy + ih, ix, iy, ir);
      ctx.arcTo(ix, iy, ix + innerW, iy, ir);
      ctx.closePath();
      ctx.fillStyle = 'rgba(135, 206, 250, 0.95)';
      ctx.fill();
    }
    ctx.restore();
  }
}
