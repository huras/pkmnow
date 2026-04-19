import {
  defaultPortraitSlugForBalloon,
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';
import {
  CLASSIC_BALLOON_FRAME_ANIM_SEC,
  PORTRAIT_REVEAL_AFTER_SEC
} from '../pokemon/emotion-display-timing.js';
import { ENTITY_STAMINA_MAX } from '../entity-stamina.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawDetailHitHpBar(ctx, bar, tileW, tileH, snapPx) {
  const maxHp = Math.max(1, Number(bar.hpMax) || 1);
  const hpNow = Math.max(0, Math.min(maxHp, Number(bar.hpNow) || 0));
  const hp01 = hpNow / maxHp;
  const w = Math.max(16, Math.floor(tileW * 0.95));
  const h = Math.max(3, Math.floor(tileH * 0.1));
  const x = snapPx(bar.x * tileW - w * 0.5);
  const y = snapPx(bar.y * tileH - tileH * 0.72);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = hp01 > 0.5 ? '#59e36e' : hp01 > 0.2 ? '#ffd85b' : '#ff6b6b';
  ctx.fillRect(x, y, Math.max(0, Math.floor(w * hp01)), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawDetailHitPulse(ctx, pulse, tileW, tileH, snapPx) {
  const t = Math.max(0, Math.min(1, pulse.age / Math.max(0.001, pulse.maxAge)));
  const a = 1 - t;
  const px = snapPx(pulse.x * tileW);
  const py = snapPx(pulse.y * tileH);
  const r = Math.max(6, tileW * (0.18 + 0.36 * t));
  ctx.strokeStyle = `rgba(255,235,190,${0.75 * a})`;
  ctx.lineWidth = Math.max(1.4, tileW * 0.045);
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Wild emotion: classic RPG Maker balloon (anim → hold last frame 1.2s), then portrait panel + tail.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, cy: number, pivotY: number, emotion: object, dexId: number }} em
 * @param {number} spawnYOffset
 */
export function drawWildEmotionOverlay(ctx, em, spawnYOffset, imageCache, tileW, tileH, snapPx) {
  if (!em.emotion) return;
  const spriteTopY = em.cy + spawnYOffset - em.pivotY;
  const slug = em.emotion.portraitSlug;
  const dexForFace = em.dexId;
  const portraitRevealAfterSec = PORTRAIT_REVEAL_AFTER_SEC;

  let pImg =
    slug && dexForFace != null ? getSpriteCollabPortraitImage(imageCache, dexForFace, slug) : undefined;
  if (slug && dexForFace != null && (!pImg || !pImg.naturalWidth)) {
    ensureSpriteCollabPortraitLoaded(imageCache, dexForFace, slug);
    pImg = getSpriteCollabPortraitImage(imageCache, dexForFace, slug);
  }

  /**
   * @param {{ holdLastFrame?: boolean }} [opts]
   */
  const drawRpgMakerEmotionBalloon = (opts = {}) => {
    const { holdLastFrame = false } = opts;
    const emoImg = imageCache.get('tilesets/PC _ Computer - RPG Maker VX Ace - Miscellaneous - Emotions.png');
    if (!emoImg || !emoImg.naturalWidth) return;
    const eCols = 8;
    const eRows = 10;
    const eSw = Math.floor(emoImg.naturalWidth / eCols);
    const eSh = Math.floor(emoImg.naturalHeight / eRows);
    const progress = Math.min(1.0, em.emotion.age / CLASSIC_BALLOON_FRAME_ANIM_SEC);
    const fIdx = holdLastFrame
      ? eCols - 1
      : Math.min(eCols - 1, Math.floor(progress * eCols));
    const dW = eSw * 1.25 * (tileW / 32);
    const dH = eSh * 1.25 * (tileW / 32);
    const px = snapPx(em.cx - dW * 0.5);
    const gapAboveHead = tileH * 0.06 + dH * 0.12;
    const py = snapPx(spriteTopY - dH - gapAboveHead);
    ctx.drawImage(emoImg, fIdx * eSw, em.emotion.type * eSh, eSw, eSh, px, py, Math.ceil(dW), Math.ceil(dH));
  };

  if (pImg && pImg.naturalWidth && em.emotion.age < portraitRevealAfterSec) {
    const holdLast = em.emotion.age >= CLASSIC_BALLOON_FRAME_ANIM_SEC;
    drawRpgMakerEmotionBalloon({ holdLastFrame: holdLast });
    return;
  }

  const roundRectPath = (x, y, w, h, r) => {
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
  };

  if (pImg && pImg.naturalWidth) {
    /** Panel size; stack + plate alphas composite over terrain (see fills — not opaque white). */
    const PORTRAIT_EMOTION_BOX_TILES = 1.14 * 1.25;
    /** Uniform multiplier so face + chrome all read as “glass” over the map. */
    const PORTRAIT_EMOTION_STACK_ALPHA = 0.98;
    const PORTRAIT_PLATE_FILL = 'rgba(252,250,255,0.92)';
    const PORTRAIT_SHADOW_FILL = 'rgba(6,8,14,0.45)';
    const PORTRAIT_STROKE_PLATE = 'rgba(255,255,255,0.96)';
    const PORTRAIT_STROKE_TAIL = 'rgba(255,255,255,0.85)';
    const side = tileW * PORTRAIT_EMOTION_BOX_TILES;
    const gap = tileH * 0.07;
    const bx = snapPx(em.cx - side * 0.5);
    const by = snapPx(spriteTopY - side - gap);
    const cr = Math.max(8, side * 0.09);
    const midX = bx + side * 0.5;
    const boxBottom = by + side;
    const tipY = snapPx(spriteTopY - tileH * 0.035);
    const tailHalfW = side * 0.13;

    ctx.save();
    ctx.globalAlpha = PORTRAIT_EMOTION_STACK_ALPHA;

    ctx.save();
    ctx.translate(0, 2);
    ctx.fillStyle = PORTRAIT_SHADOW_FILL;
    roundRectPath(bx, by, side, side, cr);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(bx, by, side, side, cr);
    ctx.fillStyle = PORTRAIT_PLATE_FILL;
    ctx.fill();
    roundRectPath(bx, by, side, side, cr);
    ctx.clip();
    const iw = pImg.naturalWidth;
    const ih = pImg.naturalHeight;
    const scale = Math.max(side / iw, side / ih);
    const fw = iw * scale;
    const fh = ih * scale;
    ctx.drawImage(
      pImg,
      0,
      0,
      iw,
      ih,
      snapPx(bx + (side - fw) * 0.5),
      snapPx(by + (side - fh) * 0.48),
      Math.ceil(fw),
      Math.ceil(fh)
    );
    ctx.restore();

    ctx.save();
    roundRectPath(bx, by, side, side, cr);
    ctx.strokeStyle = PORTRAIT_STROKE_PLATE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(midX - tailHalfW, boxBottom);
    ctx.lineTo(em.cx, tipY);
    ctx.lineTo(midX + tailHalfW, boxBottom);
    ctx.closePath();
    ctx.fillStyle = PORTRAIT_PLATE_FILL;
    ctx.fill();
    ctx.strokeStyle = PORTRAIT_STROKE_TAIL;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    return;
  }

  drawRpgMakerEmotionBalloon();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawWildHpBar(ctx, item, spawnYOffset, tileW, tileH) {
  if (!Number.isFinite(item.hp) || !Number.isFinite(item.maxHp) || item.maxHp <= 0) return;
  const hp01 = Math.max(0, Math.min(1, item.hp / item.maxHp));
  const boss = !!item.isBoss;
  const barW = Math.max(16, Math.floor(tileW * (boss ? 0.98 : 0.82)));
  const barH = Math.max(3, Math.floor(tileH * (boss ? 0.1 : 0.08)));
  const x = Math.floor(item.cx - barW * 0.5);
  const y = Math.floor(item.cy - item.pivotY + spawnYOffset - barH - (boss ? 8 : 6));
  if (item.sexHud) {
    const fontPx = Math.max(9, Math.floor(tileH * 0.14));
    ctx.save();
    ctx.font = `${fontPx}px 'JetBrains Mono',ui-monospace,monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = Math.max(2, Math.ceil(fontPx * 0.12));
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(item.sexHud, item.cx, y - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(item.sexHud, item.cx, y - 1);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
  if (boss) {
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y - 2, barW + 4, barH + 4);
  }
  ctx.fillStyle =
    boss && hp01 > 0.5
      ? '#7ee8ff'
      : hp01 > 0.5
        ? '#63e86f'
        : hp01 > 0.22
          ? '#ffd54a'
          : '#ff6363';
  ctx.fillRect(x, y, Math.max(0, Math.floor(barW * hp01)), barH);
}

/**
 * Stamina strip above wild HP (wild) or above the player sprite (player).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ type: string, cx: number, cy: number, pivotY: number, stamina?: number, maxStamina?: number, isBoss?: boolean }} item
 */
export function drawEntityStaminaBar(ctx, item, spawnYOffset, tileW, tileH) {
  const maxS = Math.max(1, Number(item.maxStamina) || ENTITY_STAMINA_MAX);
  const stRaw = Number(item.stamina);
  if (!Number.isFinite(stRaw)) return;
  const st = Math.max(0, Math.min(maxS, stRaw));
  const s01 = st / maxS;
  const boss = !!item.isBoss;
  const barW = Math.max(14, Math.floor(tileW * (boss ? 0.98 : 0.82)));
  const barH = Math.max(2, Math.floor(tileH * 0.055));
  const x = Math.floor(item.cx - barW * 0.5);
  const baseTop = item.cy - item.pivotY + spawnYOffset;
  const hpBarH = Math.max(3, Math.floor(tileH * (boss ? 0.1 : 0.08)));
  const hpPad = boss ? 8 : 6;
  const gap = 2;
  const y =
    item.type === 'wild'
      ? Math.floor(baseTop - hpPad - hpBarH - gap - barH)
      : Math.floor(baseTop - barH - 6);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
  ctx.fillStyle = s01 > 0.35 ? '#59e36e' : s01 > 0.12 ? '#8ecf6a' : '#b8e050';
  ctx.fillRect(x, y, Math.max(0, Math.floor(barW * s01)), barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barW, barH);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, cy: number, pivotY: number, _strengthGrabAction?: any }} item
 */
export function drawStrengthGrabProgressBar(ctx, item, tileW, tileH, snapPx) {
  const g = item?._strengthGrabAction;
  if (!g) return;
  const duration = Math.max(0.001, Number(g.durationSec) || 0.001);
  const elapsed = Math.max(0, Number(g.elapsedSec) || 0);
  const p = Math.max(0, Math.min(1, elapsed / duration));
  const w = Math.max(20, Math.floor(tileW * 0.88));
  const h = Math.max(4, Math.floor(tileH * 0.11));
  const x = snapPx(item.cx + tileW * 0.52);
  const y = snapPx(item.cy - item.pivotY + tileH * 0.52);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, '#ffe58a');
  grad.addColorStop(1, '#ffb347');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, Math.max(0, Math.floor(w * p)), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/**
 * @param {{ kind?: string, ox?: number, oy?: number, cols?: number, rows?: number, cx?: number, cy?: number } | null} prompt
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 * @param {number} timeSec
 * @returns {{ cx: number, cy: number, rx: number, ry: number, pulse: number } | null}
 */
function resolveStrengthGrabTargetOutlineGeom(prompt, tileW, tileH, snapPx, timeSec) {
  if (!prompt || (prompt.kind !== 'rock' && prompt.kind !== 'faintedWild')) return null;
  const ox = Math.floor(Number(prompt.ox) || 0);
  const oy = Math.floor(Number(prompt.oy) || 0);
  const cols = Math.max(1, Math.floor(Number(prompt.cols) || 1));
  const rows = Math.max(1, Math.floor(Number(prompt.rows) || 1));
  const hasCenter = Number.isFinite(Number(prompt.cx)) && Number.isFinite(Number(prompt.cy));

  const cx =
    prompt.kind === 'faintedWild'
      ? snapPx((hasCenter ? Number(prompt.cx) : ox + 0.5) * tileW)
      : snapPx((hasCenter ? Number(prompt.cx) : ox + cols * 0.5) * tileW);
  const cy =
    prompt.kind === 'faintedWild'
      ? snapPx((hasCenter ? Number(prompt.cy) : oy + 0.5) * tileH)
      : snapPx((hasCenter ? Number(prompt.cy) : oy + rows - 0.5) * tileH);
  const rx =
    prompt.kind === 'faintedWild'
      ? Math.max(tileW * 0.34, cols * tileW * 0.42)
      : Math.max(tileW * 0.3, cols * tileW * 0.46);
  const ry =
    prompt.kind === 'faintedWild'
      ? Math.max(tileH * 0.2, tileH * 0.28)
      : Math.max(tileH * 0.12, tileH * 0.22);
  const pulse = 0.84 + 0.16 * Math.sin((Number(timeSec) || 0) * 7.5);
  return { cx, cy, rx, ry, pulse };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} tileW
 * @param {number} timeSec
 */
function strokeStrengthGrabTargetRings(ctx, cx, cy, rx, ry, tileW, timeSec) {
  ctx.setLineDash([Math.max(3, tileW * 0.16), Math.max(2, tileW * 0.12)]);
  ctx.lineDashOffset = -((Number(timeSec) || 0) * 40) % 1000;
  ctx.strokeStyle = 'rgba(255, 235, 140, 0.98)';
  ctx.lineWidth = Math.max(1.5, tileW * 0.06);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255, 250, 220, 0.45)';
  ctx.lineWidth = Math.max(1, tileW * 0.028);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Screen-north = upper half (smaller Y); canvas angles clockwise from +X, so π→2π is the upper arc.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} tileW
 * @param {number} timeSec
 * @param {'north' | 'south'} half
 */
function strokeStrengthGrabTargetRingsHalf(ctx, cx, cy, rx, ry, tileW, timeSec, half) {
  const a0 = half === 'north' ? Math.PI : 0;
  const a1 = half === 'north' ? Math.PI * 2 : Math.PI;
  ctx.setLineDash([Math.max(3, tileW * 0.16), Math.max(2, tileW * 0.12)]);
  ctx.lineDashOffset = -((Number(timeSec) || 0) * 40) % 1000;
  ctx.strokeStyle = 'rgba(255, 235, 140, 0.98)';
  ctx.lineWidth = Math.max(1.5, tileW * 0.06);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, a0, a1);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255, 250, 220, 0.45)';
  ctx.lineWidth = Math.max(1, tileW * 0.028);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, a0, a1);
  ctx.stroke();
}

/**
 * North = smaller screen Y (map-north / “back” of the footprint); south = larger Y, in front of the prop.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ kind?: string, ox?: number, oy?: number, cols?: number, rows?: number, cx?: number, cy?: number } | null} prompt
 * @param {'north' | 'south'} half
 * @param {number} timeSec
 */
export function drawStrengthGrabTargetOutlineHalf(ctx, prompt, half, tileW, tileH, snapPx, timeSec = 0) {
  const g = resolveStrengthGrabTargetOutlineGeom(prompt, tileW, tileH, snapPx, timeSec);
  if (!g) return;
  const { cx, cy, rx, ry, pulse } = g;

  ctx.save();
  ctx.globalAlpha *= pulse;
  strokeStrengthGrabTargetRingsHalf(ctx, cx, cy, rx, ry, tileW, timeSec, half);
  ctx.restore();
}

/**
 * Dashed ellipse around the base footprint of the current Strength grab target.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ kind?: string, ox?: number, oy?: number, cols?: number, rows?: number, cx?: number, cy?: number } | null} prompt
 * @param {number} timeSec
 */
export function drawStrengthGrabTargetOutline(ctx, prompt, tileW, tileH, snapPx, timeSec = 0) {
  const g = resolveStrengthGrabTargetOutlineGeom(prompt, tileW, tileH, snapPx, timeSec);
  if (!g) return;
  const { cx, cy, rx, ry, pulse } = g;
  ctx.save();
  ctx.globalAlpha *= pulse;
  strokeStrengthGrabTargetRings(ctx, cx, cy, rx, ry, tileW, timeSec);
  ctx.restore();
}
