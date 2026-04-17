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
import { imageCache } from '../image-cache.js';
import {
  drawPlayEntityFootAndAirCollider,
  drawPlayEntityCombatHurtbox
} from './render-debug-overlays.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';
import { getWorldReactionOverlayCells } from '../simulation/world-reactions.js';

const CLOUD_TEXTURE_SRC = 'vfx/ETF_Texture_Glow_01.png';
const CLOUD_WRAP_PAD_PX = 220;
const SNES_CLOUD_CLUSTERS = Object.freeze([
  { seedX: 0.07, yFrac: 0.13, scale: 1.14, speed: 0.020, alpha: 0.20, puffs: [[-0.9, 0.06, 0.84], [-0.15, -0.02, 1.0], [0.72, 0.08, 0.86]] },
  { seedX: 0.21, yFrac: 0.20, scale: 1.03, speed: 0.024, alpha: 0.23, puffs: [[-0.7, 0.05, 0.74], [0.0, -0.04, 1.03], [0.8, 0.07, 0.78]] },
  { seedX: 0.34, yFrac: 0.16, scale: 1.22, speed: 0.017, alpha: 0.18, puffs: [[-0.95, 0.04, 0.92], [-0.05, -0.03, 1.08], [0.84, 0.09, 0.86]] },
  { seedX: 0.48, yFrac: 0.25, scale: 0.96, speed: 0.028, alpha: 0.19, puffs: [[-0.62, 0.05, 0.75], [0.06, -0.05, 0.97], [0.76, 0.05, 0.71]] },
  { seedX: 0.62, yFrac: 0.18, scale: 1.15, speed: 0.021, alpha: 0.22, puffs: [[-0.84, 0.07, 0.88], [-0.1, -0.04, 1.04], [0.8, 0.08, 0.82]] },
  { seedX: 0.77, yFrac: 0.23, scale: 1.00, speed: 0.019, alpha: 0.18, puffs: [[-0.7, 0.05, 0.73], [0.02, -0.04, 0.98], [0.78, 0.06, 0.72]] },
  { seedX: 0.86, yFrac: 0.15, scale: 1.28, speed: 0.015, alpha: 0.17, puffs: [[-0.96, 0.06, 0.9], [0.0, -0.03, 1.1], [0.9, 0.1, 0.84]] },
  { seedX: 0.95, yFrac: 0.28, scale: 0.9, speed: 0.031, alpha: 0.16, puffs: [[-0.56, 0.04, 0.68], [0.0, -0.05, 0.91], [0.67, 0.06, 0.69]] }
]);

let snesCloudTextureCache = null;

function buildCloudSpriteMasks(img) {
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w <= 0 || h <= 0) return null;

  const cloudMask = document.createElement('canvas');
  cloudMask.width = w;
  cloudMask.height = h;
  const cloudCtx = cloudMask.getContext('2d', { alpha: true });
  cloudCtx.drawImage(img, 0, 0);

  const shadowMask = document.createElement('canvas');
  shadowMask.width = w;
  shadowMask.height = h;
  const shadowCtx = shadowMask.getContext('2d', { alpha: true });

  const src = cloudCtx.getImageData(0, 0, w, h);
  const dstCloud = cloudCtx.createImageData(w, h);
  const dstShadow = shadowCtx.createImageData(w, h);
  const s = src.data;
  const a = dstCloud.data;
  const b = dstShadow.data;
  for (let i = 0; i < s.length; i += 4) {
    const srcAlpha = s[i + 3] / 255;
    const lum = Math.max(s[i], s[i + 1], s[i + 2]) / 255;
    const outAlpha = Math.round(255 * srcAlpha * lum);
    a[i] = 255;
    a[i + 1] = 255;
    a[i + 2] = 255;
    a[i + 3] = outAlpha;
    b[i] = 0;
    b[i + 1] = 0;
    b[i + 2] = 0;
    b[i + 3] = Math.round(outAlpha * 0.8);
  }
  cloudCtx.putImageData(dstCloud, 0, 0);
  shadowCtx.putImageData(dstShadow, 0, 0);
  return { cloudMask, shadowMask };
}

function getSnesCloudMasks() {
  const img = imageCache.get(CLOUD_TEXTURE_SRC);
  if (!img || !img.complete || !(img.naturalWidth || img.width)) return null;
  if (snesCloudTextureCache && snesCloudTextureCache.source === img) return snesCloudTextureCache;
  const masks = buildCloudSpriteMasks(img);
  if (!masks) return null;
  snesCloudTextureCache = { ...masks, source: img };
  return snesCloudTextureCache;
}

function drawSnesCloudParallax(ctx, cw, ch, lodDetail, timeSec) {
  const masks = getSnesCloudMasks();
  if (!masks) return;

  const lodMul = lodDetail >= 2 ? 0.54 : lodDetail >= 1 ? 0.78 : 1;
  const activeClusters = lodDetail >= 2 ? 3 : lodDetail >= 1 ? 5 : SNES_CLOUD_CLUSTERS.length;
  const spriteW = Math.max(1, masks.cloudMask.width);
  const spriteH = Math.max(1, masks.cloudMask.height);
  const span = cw + CLOUD_WRAP_PAD_PX * 2;
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const baseScale = Math.max(0.42, Math.min(0.8, cw / 1920));
  const shadowOffsetX = Math.round(cw * 0.028);
  const shadowOffsetY = Math.round(ch * 0.036);

  const drawLayer = (sprite, isShadow) => {
    for (let i = 0; i < activeClusters; i++) {
      const c = SNES_CLOUD_CLUSTERS[i];
      const travel = ((time * c.speed * cw) + c.seedX * span) % span;
      const xAnchor = span - travel - CLOUD_WRAP_PAD_PX;
      const yAnchor = ch * c.yFrac + Math.sin(time * (0.26 + i * 0.03) + c.seedX * 6.2831) * (ch * 0.004);
      const alphaCluster = c.alpha * (isShadow ? 0.52 : 1) * lodMul;
      const yNudge = isShadow ? shadowOffsetY : 0;
      const xNudge = isShadow ? shadowOffsetX : 0;

      for (const [ox, oy, scale] of c.puffs) {
        const size = Math.round(ch * 0.14 * c.scale * scale * baseScale);
        if (size < 2) continue;
        const w = Math.max(1, Math.round(size * (spriteW / spriteH)));
        const h = size;
        const x = Math.round(xAnchor + ox * w + xNudge);
        const y = Math.round(yAnchor + oy * h + yNudge);
        if (x + w < -2 || x > cw + 2 || y + h < -2 || y > ch * 0.62) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, alphaCluster));
        ctx.drawImage(sprite, x, y, w, h);
      }
    }
  };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  drawLayer(masks.shadowMask, true);
  drawLayer(masks.cloudMask, false);
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
 */
export function drawEnvironmentalEffects(ctx, options) {
  const { cw, ch, tint, mistTile, lodDetail, time } = options;

  if (tint && typeof tint.r === 'number') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  if (mistTile?.biomeId !== BIOMES.GHOST_WOODS.id) {
    drawSnesCloudParallax(ctx, cw, ch, lodDetail, time);
  }

  if (mistTile?.biomeId === BIOMES.GHOST_WOODS.id) {
    const fogLodMul = lodDetail >= 2 ? 0.52 : lodDetail >= 1 ? 0.82 : 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const mt = (time || 0) * 0.26;
    const gcx = cw * 0.5 + Math.sin(mt) * cw * 0.065;
    const gcy = ch * 0.46 + Math.cos(mt * 0.88) * ch * 0.038;
    const r0 = Math.min(cw, ch) * 0.16;
    const r1 = Math.hypot(cw, ch) * 0.62;
    const g = ctx.createRadialGradient(gcx, gcy, r0, gcx, gcy, r1);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.42, `rgba(255,255,255,${0.1 * fogLodMul})`);
    g.addColorStop(1, `rgba(250,252,255,${0.32 * fogLodMul})`);
    ctx.fillStyle = g;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.globalAlpha = 0.1 * fogLodMul;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
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
