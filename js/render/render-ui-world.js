import {
  defaultPortraitSlugForBalloon,
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';
import {
  CLASSIC_BALLOON_FRAME_ANIM_SEC,
  PORTRAIT_REVEAL_AFTER_SEC
} from '../pokemon/emotion-display-timing.js';

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
    const PORTRAIT_EMOTION_STACK_ALPHA = 0.58;
    const PORTRAIT_PLATE_FILL = 'rgba(252,250,255,0.5)';
    const PORTRAIT_SHADOW_FILL = 'rgba(6,8,14,0.38)';
    const PORTRAIT_STROKE_PLATE = 'rgba(255,255,255,0.55)';
    const PORTRAIT_STROKE_TAIL = 'rgba(255,255,255,0.48)';
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
