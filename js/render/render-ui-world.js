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
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
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
 * League-of-Legends–style meter: rounded shell, inset fill, vertical chunk ticks, soft gloss.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} hp01
 * @param {{ hi: string, mid: string, lo: string }} fill
 * @param {{ boss?: boolean }} [opts]
 */
function drawPokemonHpMeterBar(ctx, x, y, w, h, hp01, fill, opts = {}) {
  const boss = !!opts.boss;
  const r = Math.max(3, Math.floor(Math.min(h, w) * 0.42));
  const inset = Math.max(2, Math.floor(h * 0.18));
  const iw = Math.max(1, w - inset * 2);
  const ih = Math.max(1, h - inset * 2);
  const ix = x + inset;
  const iy = y + inset;
  const ir = Math.max(1.5, r - inset * 0.65);
  const fillW = Math.max(0, Math.floor(iw * hp01));

  if (boss) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.92)';
    ctx.lineWidth = 2.5;
    roundRectPath(ctx, x - 2, y - 2, w + 4, h + 4, r + 1.5);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(12, 14, 22, 0.92)';
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, ix, iy, iw, ih, ir);
  ctx.clip();
  const g = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
  g.addColorStop(0, fill.hi);
  g.addColorStop(0.45, fill.mid);
  g.addColorStop(1, fill.lo);
  ctx.fillStyle = g;
  ctx.fillRect(ix, iy, fillW, ih);
  const gloss = ctx.createLinearGradient(ix, iy, ix, iy + ih);
  gloss.addColorStop(0, 'rgba(255,255,255,0.22)');
  gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = gloss;
  ctx.fillRect(ix, iy, fillW, ih);
  ctx.restore();

  const segments = Math.min(22, Math.max(5, Math.floor(iw / 9)));
  ctx.save();
  roundRectPath(ctx, ix, iy, iw, ih, ir);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.lineWidth = 1;
  for (let i = 1; i < segments; i++) {
    const sx = ix + (iw * i) / segments;
    const px = Math.floor(sx) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, iy);
    ctx.lineTo(px, iy + ih);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = boss ? 'rgba(255, 248, 220, 0.5)' : 'rgba(210, 218, 235, 0.55)';
  ctx.lineWidth = boss ? 1.75 : 1.35;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

function wildPokemonHpBarMetrics(tileW, tileH, boss) {
  const barW = Math.max(18, Math.floor(tileW * (boss ? 0.98 : 0.84)));
  const barH = Math.max(9, Math.floor(tileH * (boss ? 0.16 : 0.145)));
  const hpPad = boss ? 10 : 7;
  return { barW, barH, hpPad };
}

function playerPokemonHpBarMetrics(tileW, tileH) {
  const barW = Math.max(18, Math.floor(tileW * 0.9));
  const barH = Math.max(9, Math.floor(tileH * 0.145));
  return { barW, barH };
}

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
 * Cheap “flashlight on grass” under the player on level-up: two screen-blended radials (no per-tile loop).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   cx: number,
 *   feetYPx: number,
 *   levelUpGlowSec: number,
 *   glowDurationSec: number,
 *   tileW: number,
 *   alphaMul?: number
 * }} p
 */
export function drawPlayerLevelUpTerrainGlow(ctx, p) {
  const dur = Math.max(0.001, Number(p.glowDurationSec) || 0.7);
  const t = Math.max(0, Number(p.levelUpGlowSec) || 0);
  const glow01 = Math.max(0, Math.min(1, t / dur));
  if (glow01 <= 0.004) return;
  const cx = p.cx;
  const fy = p.feetYPx;
  const tileW = Math.max(1, Number(p.tileW) || 32);
  const alphaMul = Math.max(0, Math.min(1, Number(p.alphaMul) ?? 1));
  // Slight overshoot at the very start, then decay (feels like a burst + lingering spill).
  const pulse = glow01 * (1 + 0.22 * (1 - glow01));
  const a0 = 0.26 * pulse * alphaMul;
  const a1 = 0.1 * pulse * alphaMul;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const drawPool = (scaleY, rMul, innerA, midA) => {
    ctx.save();
    ctx.translate(cx, fy);
    ctx.scale(1, scaleY);
    const r = tileW * rMul * (0.92 + 0.14 * glow01);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(255,255,252,${innerA})`);
    g.addColorStop(0.38, `rgba(255,248,228,${midA})`);
    g.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  drawPool(0.36, 2.15, a0 * 1.05, a0 * 0.42);
  drawPool(0.5, 3.25, a1 * 0.75, a1 * 0.35);

  ctx.restore();
}

/**
 * Additive white pass over the player sprite (clipped when partially buried).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} sheet
 * @param {{
 *   sx: number, sy: number, sw: number, sh: number,
 *   dx: number, dy: number, dw: number, dh: number,
 *   levelUpGlowSec: number, glowDurationSec: number, alphaMul?: number,
 *   clip?: { x: number, y: number, w: number, h: number } | null
 * }} o
 */
export function drawPlayerLevelUpSpriteGlow(ctx, sheet, o) {
  const dur = Math.max(0.001, Number(o.glowDurationSec) || 0.7);
  const t = Math.max(0, Number(o.levelUpGlowSec) || 0);
  const glow01 = Math.max(0, Math.min(1, t / dur));
  if (glow01 <= 0.004) return;
  const alphaMul = Math.max(0, Math.min(1, Number(o.alphaMul) ?? 1));
  const a = alphaMul * (0.38 + 0.52 * glow01);

  ctx.save();
  if (o.clip && o.clip.w > 1 && o.clip.h > 1) {
    ctx.beginPath();
    ctx.rect(o.clip.x, o.clip.y, o.clip.w, o.clip.h);
    ctx.clip();
  }
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = a;
  ctx.filter = 'brightness(2.35) saturate(0) contrast(1.05)';
  ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, o.dx, o.dy, o.dw, o.dh);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
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
  const { barW, barH, hpPad } = wildPokemonHpBarMetrics(tileW, tileH, boss);
  const x = Math.floor(item.cx - barW * 0.5);
  const y = Math.floor(item.cy - item.pivotY + spawnYOffset - barH - hpPad);
  const wildLv = Math.max(1, Math.floor(Number(item.level) || 1));
  const lvText = `Lv.${wildLv}`;
  const lvBaselineY = y + barH - Math.max(2, Math.floor(barH * 0.2));
  const fill =
    boss && hp01 > 0.5
      ? { hi: '#b8f6ff', mid: '#62d9f0', lo: '#2aa8c4' }
      : hp01 > 0.5
        ? { hi: '#a6ffba', mid: '#52e070', lo: '#2a9c45' }
        : hp01 > 0.22
          ? { hi: '#ffe9a0', mid: '#f0c23a', lo: '#c48a12' }
          : { hi: '#ffb3b3', mid: '#f05555', lo: '#b02028' };
  drawPokemonHpMeterBar(ctx, x, y, barW, barH, hp01, fill, { boss });
  {
    const lvFont = Math.max(12, Math.floor(tileH * 0.172));
    ctx.save();
    ctx.font = `${lvFont}px 'JetBrains Mono',ui-monospace,monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = Math.max(1.5, Math.ceil(lvFont * 0.11));
    ctx.strokeStyle = 'rgba(0,0,0,0.58)';
    ctx.strokeText(lvText, x - 3, lvBaselineY);
    ctx.fillStyle = boss ? 'rgba(255,232,160,0.95)' : 'rgba(240,248,255,0.92)';
    ctx.fillText(lvText, x - 3, lvBaselineY);
    ctx.restore();
  }
  if (item.sexHud) {
    const fontPx = Math.max(13, Math.floor(tileH * 0.2));
    ctx.save();
    ctx.font = `${fontPx}px 'JetBrains Mono',ui-monospace,monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = Math.max(2, Math.ceil(fontPx * 0.12));
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(item.sexHud, item.cx, y - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(item.sexHud, item.cx, y - 2);
    ctx.restore();
  }
}

/**
 * Player world HP strip. Drawn above the stamina bar.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, cy: number, pivotY: number, hp?: number, maxHp?: number }} item
 */
export function drawPlayerHpBar(ctx, item, spawnYOffset, tileW, tileH) {
  const maxHp = Math.max(1, Number(item.maxHp) || 100);
  const hpRaw = Number(item.hp);
  if (!Number.isFinite(hpRaw)) return;
  const hp = Math.max(0, Math.min(maxHp, hpRaw));
  const hp01 = hp / maxHp;
  const { barW, barH } = playerPokemonHpBarMetrics(tileW, tileH);
  const x = Math.floor(item.cx - barW * 0.5);
  const baseTop = item.cy - item.pivotY + spawnYOffset;
  const staminaH = Math.max(3, Math.floor(tileH * 0.085));
  const expH = Math.max(3, Math.floor(tileH * 0.07));
  const gap = 2;
  const y = Math.floor(baseTop - 6 - staminaH - gap - expH - gap - barH);
  const fill =
    hp01 > 0.5
      ? { hi: '#a6ffba', mid: '#52e070', lo: '#2a9c45' }
      : hp01 > 0.22
        ? { hi: '#ffe9a0', mid: '#f0c23a', lo: '#c48a12' }
        : { hi: '#ffb3b3', mid: '#f05555', lo: '#b02028' };
  drawPokemonHpMeterBar(ctx, x, y, barW, barH, hp01, fill, { boss: false });
}

/**
 * Player world EXP strip. Drawn between HP and stamina bars.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, cy: number, pivotY: number, exp?: number, expToNext?: number }} item
 */
export function drawPlayerExpBar(ctx, item, spawnYOffset, tileW, tileH) {
  const need = Math.max(1, Math.floor(Number(item.expToNext) || 100));
  const expRaw = Number(item.exp);
  if (!Number.isFinite(expRaw)) return;
  const exp = Math.max(0, Math.min(need, expRaw));
  const exp01 = exp / need;
  const barW = Math.max(14, Math.floor(tileW * 0.86));
  const barH = Math.max(3, Math.floor(tileH * 0.07));
  const x = Math.floor(item.cx - barW * 0.5);
  const baseTop = item.cy - item.pivotY + spawnYOffset;
  const staminaH = Math.max(3, Math.floor(tileH * 0.085));
  const { barH: hpH } = playerPokemonHpBarMetrics(tileW, tileH);
  const gap = 2;
  const y = Math.floor(baseTop - 6 - staminaH - gap - barH - gap - hpH);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
  ctx.fillStyle = '#6ca1ff';
  ctx.fillRect(x, y, Math.max(0, Math.floor(barW * exp01)), barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barW, barH);
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
  const barH = Math.max(3, Math.floor(tileH * (item.type === 'player' ? 0.085 : 0.06)));
  const x = Math.floor(item.cx - barW * 0.5);
  const baseTop = item.cy - item.pivotY + spawnYOffset;
  const { barH: hpBarH, hpPad } =
    item.type === 'wild' ? wildPokemonHpBarMetrics(tileW, tileH, boss) : { barH: 0, hpPad: 0 };
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

/**
 * World-space drop target indicator shown while dragging an item from the inventory HUD.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ ox?: number, oy?: number, cols?: number, rows?: number, canDrop?: boolean } | null | undefined} preview
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 * @param {number} timeSec
 */
export function drawInventoryGroundDropPreview(ctx, preview, tileW, tileH, snapPx, timeSec = 0) {
  if (!preview) return;
  const ox = Math.floor(Number(preview.ox) || 0);
  const oy = Math.floor(Number(preview.oy) || 0);
  const cols = Math.max(1, Math.floor(Number(preview.cols) || 1));
  const rows = Math.max(1, Math.floor(Number(preview.rows) || 1));
  const canDrop = !!preview.canDrop;
  const px = snapPx(ox * tileW);
  const py = snapPx(oy * tileH);
  const pw = Math.max(1, Math.ceil(cols * tileW));
  const ph = Math.max(1, Math.ceil(rows * tileH));
  const pulse = 0.74 + 0.26 * Math.sin((Number(timeSec) || 0) * 10.5);

  ctx.save();
  ctx.globalAlpha *= canDrop ? pulse : 0.95;
  ctx.fillStyle = canDrop ? 'rgba(120, 255, 190, 0.14)' : 'rgba(255, 110, 110, 0.14)';
  ctx.fillRect(px, py, pw, ph);
  ctx.setLineDash([Math.max(4, tileW * 0.18), Math.max(3, tileW * 0.14)]);
  ctx.lineDashOffset = -((Number(timeSec) || 0) * 28) % 1000;
  ctx.lineWidth = Math.max(1.5, tileW * 0.055);
  ctx.strokeStyle = canDrop ? 'rgba(150, 255, 210, 0.98)' : 'rgba(255, 130, 130, 0.98)';
  ctx.strokeRect(px + 0.5, py + 0.5, Math.max(1, pw - 1), Math.max(1, ph - 1));
  ctx.restore();
}
