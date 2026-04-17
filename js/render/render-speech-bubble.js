import { getResolvedSheets } from '../pokemon/pokemon-asset-loader.js';
import { resolvePmdFrameSpecForSlice } from '../pokemon/pmd-layout-metrics.js';
import { POKEMON_HEIGHTS } from '../pokemon/pokemon-heights.js';
import { getSpriteCollabPortraitImage } from '../pokemon/spritecollab-portraits.js';

/**
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {CanvasRenderingContext2D} ctx
 */
function roundRectPath(ctx, x, y, w, h, r) {
  let rad = r;
  if (w < 2 * rad) rad = w / 2;
  if (h < 2 * rad) rad = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, cy: number, pivotY: number, dexId: number, speechBubble: object }} em
 * @param {number} spawnYOffset
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 */
export function drawWildSpeechBubbleOverlay(ctx, em, spawnYOffset, imageCache, tileW, tileH, snapPx) {
  const b = em.speechBubble;
  if (!b?.segments?.length) return;

  const spriteTopY = em.cy + spawnYOffset - em.pivotY;
  const tipX = em.cx;
  const tipY = snapPx(spriteTopY - tileH * 0.02);

  const scaleT = tileW / 32;
  const fontPx = Math.max(11, Math.round(tileH * 0.13));
  const emojiPx = Math.round(fontPx * 1.22);
  const itemPx = Math.round(fontPx * 2.0);
  const monPx = Math.round(fontPx * 2.35);
  const portraitPx = Math.round(fontPx * 2.05);
  const pad = Math.max(8, Math.round(9 * scaleT));
  const maxInnerW = tileW * 5.2;
  const lineGap = Math.max(2, Math.round(3 * scaleT));

  const kind = b.kind === 'think' ? 'think' : 'say';
  const age = Math.max(0, Number(b.ageSec) || 0);
  const dur = Math.max(0.5, Number(b.durationSec) || 4);
  const fadeIn = Math.min(1, age / 0.1);
  const fadeOut = Math.min(1, Math.max(0, (dur - age) / 0.15));
  const alpha = 0.65 + 0.35 * fadeIn * fadeOut;

  ctx.save();
  ctx.globalAlpha = alpha;

  const textFont = `${fontPx}px Inter, system-ui, sans-serif`;
  const emojiFont = `${emojiPx}px Inter, system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.font = textFont;

  /** @type {Array<Array<{ kind: string, w: number, h: number, text?: string, slug?: string }>>} */
  const lines = [];
  /** @type {Array<{ kind: string, w: number, h: number, text?: string, slug?: string }>} */
  let line = [];
  let lineW = 0;
  const spaceW = ctx.measureText(' ').width;

  const flushLine = () => {
    if (line.length) {
      lines.push(line);
      line = [];
      lineW = 0;
    }
  };

  const pushAtom = (atom) => {
    const gap = line.length ? spaceW : 0;
    if (lineW + gap + atom.w > maxInnerW && line.length) flushLine();
    if (line.length) lineW += spaceW;
    line.push(atom);
    lineW += atom.w;
  };

  for (const seg of b.segments) {
    if (seg.kind === 'text') {
      const words = String(seg.text || '').split(/\s+/).filter(Boolean);
      for (const w of words) {
        ctx.font = textFont;
        const tw = ctx.measureText(w).width;
        pushAtom({ kind: 'word', text: w, w: tw, h: fontPx * 1.25 });
      }
    } else if (seg.kind === 'emoji') {
      ctx.font = emojiFont;
      const t = String(seg.text || '').slice(0, 4);
      const tw = Math.max(ctx.measureText(t).width, emojiPx * 0.85);
      pushAtom({ kind: 'emoji', text: t, w: tw + 2, h: emojiPx * 1.1 });
    } else if (seg.kind === 'item') {
      pushAtom({
        kind: 'item',
        slug: String(seg.slug || '').toLowerCase(),
        w: itemPx + 2,
        h: itemPx,
        _src: /** @type {{ _iconPath?: string }} */ (seg)
      });
    } else if (seg.kind === 'portrait') {
      const slugSafe =
        String(/** @type {{ slug?: string }} */ (seg).slug || 'Normal')
          .replace(/[^\w.-]/g, '')
          .trim() || 'Normal';
      const fe = /** @type {{ fallbackEmoji?: string }} */ (seg).fallbackEmoji;
      pushAtom({
        kind: 'portrait',
        slug: slugSafe,
        fallbackEmoji: typeof fe === 'string' ? fe : undefined,
        w: portraitPx + 2,
        h: portraitPx
      });
    } else if (seg.kind === 'monsprite') {
      pushAtom({ kind: 'monsprite', w: monPx + 2, h: monPx });
    }
  }
  flushLine();

  if (!lines.length) {
    ctx.restore();
    return;
  }

  let innerH = 0;
  let innerW = 0;
  for (const ln of lines) {
    const lw = ln.reduce((a, x) => a + x.w, 0) + Math.max(0, ln.length - 1) * spaceW;
    innerW = Math.max(innerW, lw);
    const lh = ln.reduce((m, x) => Math.max(m, x.h), 0);
    innerH += lh + lineGap;
  }
  innerH -= lineGap;

  const bw = snapPx(Math.ceil(innerW + pad * 2));
  const bh = snapPx(Math.ceil(innerH + pad * 2));
  const bx = snapPx(em.cx - bw * 0.5);
  const by = snapPx(spriteTopY - bh - tileH * 0.14 - 10 * scaleT);

  const cornerR = Math.max(10, Math.min(18, Math.floor(12 * scaleT)));

  const midX = bx + bw * 0.5;
  const boxBottom = by + bh;

  const dx = tipX - midX;
  const dy = tipY - boxBottom;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const c1x = midX + ux * (dist * 0.22);
  const c1y = boxBottom + uy * (dist * 0.22);
  const c2x = midX + ux * (dist * 0.48);
  const c2y = boxBottom + uy * (dist * 0.48);
  const rDot = Math.max(3.5, 4.2 * scaleT);

  ctx.save();
  ctx.translate(0, 1.5 * scaleT);
  ctx.fillStyle = 'rgba(8,10,18,0.22)';
  ctx.beginPath();
  ctx.arc(c1x, c1y, rDot + 0.5, 0, Math.PI * 2);
  ctx.arc(c2x, c2y, rDot + 0.5, 0, Math.PI * 2);
  ctx.fill();
  roundRectPath(ctx, bx + 1, by + 1, bw, bh, cornerR);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = 'rgba(255,255,255,0.98)';
  ctx.lineWidth = Math.max(1.5, 2 * scaleT);
  roundRectPath(ctx, bx, by, bw, bh, cornerR);
  ctx.fill();
  if (kind === 'think') ctx.setLineDash([5 * scaleT, 4 * scaleT]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(30,40,55,0.18)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, bx, by, bw, bh, cornerR);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1, 1.3 * scaleT);
  ctx.beginPath();
  ctx.arc(c1x, c1y, rDot, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c2x, c2y, rDot, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const baseW = Math.max(8, 11 * scaleT);
  const triH = Math.max(7, 9 * scaleT);
  const baseMidX = c2x + ux * (rDot + 1);
  const baseMidY = c2y + uy * (rDot + 1);
  const perpX = -uy;
  const perpY = ux;
  ctx.beginPath();
  ctx.moveTo(baseMidX + perpX * baseW * 0.5, baseMidY + perpY * baseW * 0.5);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(baseMidX - perpX * baseW * 0.5, baseMidY - perpY * baseW * 0.5);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();

  let penY = by + pad;
  for (const ln of lines) {
    const lineH = ln.reduce((m, x) => Math.max(m, x.h), 0);
    let penX = bx + pad + (bw - pad * 2 - ln.reduce((a, x) => a + x.w, 0) - Math.max(0, ln.length - 1) * spaceW) * 0.5;
    for (let i = 0; i < ln.length; i++) {
      const atom = ln[i];
      if (i > 0) penX += spaceW;
      const baseline = penY + lineH * 0.78;
      if (atom.kind === 'word') {
        ctx.font = textFont;
        ctx.fillStyle = 'rgba(18,22,32,0.94)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(atom.text || '', penX, baseline);
      } else if (atom.kind === 'emoji') {
        ctx.font = emojiFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(atom.text || '', penX, baseline);
      } else if (atom.kind === 'item') {
        const path = /** @type {{ _src?: { _iconPath?: string } }} */ (atom)._src?._iconPath;
        const img = path ? imageCache.get(path) : null;
        const iy = penY + (lineH - itemPx) * 0.5;
        if (img && img.naturalWidth) {
          ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, penX, iy, itemPx, itemPx);
        } else {
          ctx.fillStyle = 'rgba(180,190,210,0.35)';
          ctx.fillRect(penX, iy, itemPx, itemPx);
        }
      } else if (atom.kind === 'portrait') {
        const dex = Math.max(1, Math.floor(Number(em.dexId) || 1));
        const slug = String(atom.slug || 'Normal').replace(/[^\w.-]/g, '') || 'Normal';
        const pimg = getSpriteCollabPortraitImage(imageCache, dex, slug);
        const box = portraitPx;
        const iy = penY + (lineH - box) * 0.5;
        if (pimg && pimg.naturalWidth) {
          const iw = pimg.naturalWidth;
          const ih = pimg.naturalHeight;
          const sc = Math.min(box / iw, box / ih);
          const dw = iw * sc;
          const dh = ih * sc;
          ctx.drawImage(
            pimg,
            snapPx(penX + (box - dw) * 0.5),
            snapPx(iy + (box - dh) * 0.5),
            Math.ceil(dw),
            Math.ceil(dh)
          );
        } else if (atom.fallbackEmoji) {
          ctx.font = emojiFont;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = 'rgba(18,22,32,0.94)';
          ctx.fillText(String(atom.fallbackEmoji).slice(0, 4), penX, baseline);
        } else {
          ctx.fillStyle = 'rgba(180,190,210,0.35)';
          ctx.fillRect(penX, iy, box, box);
        }
      } else if (atom.kind === 'monsprite') {
        const dex = Math.max(1, Math.floor(Number(em.dexId) || 1));
        const { idle: wIdle, walk: wWalk } = getResolvedSheets(imageCache, dex);
        const sheet = wIdle || wWalk;
        const iy = penY + (lineH - monPx) * 0.5;
        if (sheet) {
          const { sw, sh, animCols } = resolvePmdFrameSpecForSlice(sheet, dex, 'idle');
          const canonicalH = sh;
          const targetH = (POKEMON_HEIGHTS[dex] || 1.1) * tileH * 0.42;
          const sc = targetH / Math.max(1, canonicalH);
          const dw = sw * sc;
          const dh = sh * sc;
          ctx.drawImage(
            sheet,
            0,
            0,
            sw,
            sh,
            snapPx(penX + (monPx - dw) * 0.5),
            snapPx(iy + (monPx - dh) * 0.5),
            Math.ceil(dw),
            Math.ceil(dh)
          );
        } else {
          ctx.fillStyle = 'rgba(180,190,210,0.35)';
          ctx.fillRect(penX, iy, monPx, monPx);
        }
      }
      penX += atom.w;
    }
    penY += lineH + lineGap;
  }

  ctx.restore();
}
