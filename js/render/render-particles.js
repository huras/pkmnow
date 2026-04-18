import { imageCache } from '../image-cache.js';
import { BURN_START_FRAME, BURN_START_FRAMES } from '../moves/move-constants.js';

const FIELD_SPIN_WIND_TEX = 'vfx/ETF_Texture_Wind_01.png';
let fieldSpinWindTexInflight = null;

function queueFieldSpinWindTextureLoad() {
  if (imageCache.get(FIELD_SPIN_WIND_TEX)?.naturalWidth || fieldSpinWindTexInflight) return;
  fieldSpinWindTexInflight = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(FIELD_SPIN_WIND_TEX, img);
      fieldSpinWindTexInflight = null;
      resolve();
    };
    img.onerror = () => {
      fieldSpinWindTexInflight = null;
      resolve();
    };
    img.src = FIELD_SPIN_WIND_TEX;
  });
}

/**
 * Wind-arc FX for Prismatic Laser (ported from Zelda `PrismaticLaser.drawArcParticles`).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 */
function drawPrismaticWindArcParticle(ctx, p, tileW, tileH, snapPx) {
  const elapsed = p.maxLife - p.life;
  const tipXw = p.centerX + Math.cos(p.arcAngle) * p.arcSpeed * elapsed;
  const tipYw = p.centerY + Math.sin(p.arcAngle) * p.arcSpeed * elapsed;
  const cx = snapPx(p.centerX * tileW);
  const cy = snapPx(p.centerY * tileH - (p.z || 0) * tileH);
  const tx = snapPx(tipXw * tileW);
  const ty = snapPx(tipYw * tileH - (p.z || 0) * tileH);
  const fade = Math.max(0, p.life / Math.max(1e-4, p.maxLife));
  const lineA = fade * (p.lineAlphaMul ?? 0.75);
  const ellA = fade * (p.ellipseAlpha ?? 0.55);
  const r = p.ellipseRPx ?? 6;

  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${ellA})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.88, 0, 0, Math.PI * 2);
  ctx.fill();

  const midX = (cx + tx) * 0.5;
  const midY = (cy + ty) * 0.5;
  const perp = p.arcAngle + Math.PI / 2;
  const curvePx = p.arcLength * Math.min(tileW, tileH) * (p.curveIntensity ?? 0.3);
  const ctrlX = midX + Math.cos(perp) * curvePx;
  const ctrlY = midY + Math.sin(perp) * curvePx;

  ctx.strokeStyle = `rgba(255,255,255,${lineA})`;
  ctx.lineWidth = p.lineWidth ?? 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  const segments = 8;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * ctrlX + t * t * tx;
    const y = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * ctrlY + t * t * ty;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function psychicCutAlternatingPalette(p) {
  const nowMs = performance.now();
  const seed = ((Number(p?.x) || 0) + (Number(p?.y) || 0)) * 37;
  const flip = (Math.floor((nowMs + seed) / 95) & 1) === 0;
  const pink = [255, 108, 210];
  const purple = [174, 116, 255];
  return flip
    ? { glow: pink, core: [255, 196, 240], ring: purple }
    : { glow: purple, core: [231, 206, 255], ring: pink };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p
 */
export function drawBatchedParticle(ctx, p, tileW, tileH, snapPx) {
  if (p.type === 'prismaticWindArc') {
    drawPrismaticWindArcParticle(ctx, p, tileW, tileH, snapPx);
    ctx.globalAlpha = 1;
    return;
  }
  if (p.type === 'prismaticLaserSpark') {
    const px = snapPx(p.x * tileW);
    const py = snapPx(p.y * tileH - (p.z || 0) * tileH);
    const a = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * 0.92;
    const tint = String(p.tint || '#ffffff');
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.07) * (0.35 + 0.65 * a), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    return;
  }
  const px = snapPx(p.x * tileW);
  const py = snapPx(p.y * tileH - (p.z || 0) * tileH);
  const a = Math.max(0, p.life / p.maxLife);
  ctx.globalAlpha = a;
  if (p.type === 'burst') {
    const img = imageCache.get('tilesets/effects/burn-start.png');
    const fi = Math.min(BURN_START_FRAMES - 1, Math.floor((1 - a) * BURN_START_FRAMES));
    if (img && img.naturalWidth) {
      const dw = Math.ceil(tileW * 1.05);
      const dh = Math.ceil(tileH * 1.05);
      ctx.drawImage(img, 0, fi * BURN_START_FRAME, BURN_START_FRAME, BURN_START_FRAME, px - dw * 0.5, py - dh * 0.5, dw, dh);
    } else {
      ctx.fillStyle = '#ffaa66';
      ctx.beginPath();
      ctx.arc(px, py, 7 * a, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.type === 'grassFire') {
    const img = imageCache.get('tilesets/effects/burn-start.png');
    const flick = Math.floor(performance.now() / 72) % BURN_START_FRAMES;
    const fi = (Math.min(BURN_START_FRAMES - 1, Math.floor((1 - a) * BURN_START_FRAMES)) + flick) % BURN_START_FRAMES;
    if (img && img.naturalWidth) {
      const dw = Math.ceil(tileW * 1.12);
      const dh = Math.ceil(tileH * 1.12);
      ctx.globalAlpha = Math.min(1, a * 1.15);
      ctx.drawImage(
        img,
        0,
        fi * BURN_START_FRAME,
        BURN_START_FRAME,
        BURN_START_FRAME,
        px - dw * 0.5,
        py - dh * 0.5,
        dw,
        dh
      );
    } else {
      ctx.fillStyle = '#ff7722';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(4, tileW * 0.22) * a, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.type === 'flameChargeTrail' || p.type === 'flameChargeHead') {
    const tier = Number(p.tier) || 2;
    const head = p.type === 'flameChargeHead';
    const r = (head ? tileW * 0.16 : tileW * 0.11) * (0.55 + 0.45 * a) * (tier === 3 ? 1.12 : tier === 2 ? 1.04 : 1);
    const grd = ctx.createRadialGradient(px - r * 0.2, py - r * 0.25, r * 0.05, px, py, r);
    grd.addColorStop(0, head ? 'rgba(255,255,220,0.95)' : 'rgba(255,240,180,0.88)');
    grd.addColorStop(0.45, 'rgba(255,120,40,0.72)');
    grd.addColorStop(1, 'rgba(180,20,0,0.08)');
    ctx.fillStyle = grd;
    ctx.globalAlpha = Math.min(1, a * (head ? 1.05 : 0.92));
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (p.type === 'fireSpinSpark') {
    const s = Math.max(0.25, Math.min(1.2, Number(p.size01) || 0.6));
    const r = Math.max(1.5, tileW * 0.07 * s) * (0.45 + 0.55 * a);
    const grd = ctx.createRadialGradient(px - r * 0.15, py - r * 0.2, r * 0.04, px, py, r);
    grd.addColorStop(0, `rgba(255,255,200,${0.55 * a})`);
    grd.addColorStop(0.5, `rgba(255,140,40,${0.5 * a})`);
    grd.addColorStop(1, `rgba(200,40,0,${0.08 * a})`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'emberTrail') {
    ctx.fillStyle = '#ffa200';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.12) * a, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'waterTrail') {
    ctx.fillStyle = '#b8ecff';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.1) * a, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'rainFootSplash') {
    // Growing upward-opening crown (matches debug rain-splash look). Stays in place;
    // no motion is applied to this type in `moves-manager`'s particle tick.
    const t01 = Math.max(0, Math.min(1, 1 - a));
    const r = Math.max(1.2, tileW * 0.08) + t01 * Math.max(2, tileW * 0.18);
    ctx.globalAlpha = Math.max(0, (1 - t01) * 0.9);
    ctx.strokeStyle = '#eaf0ff';
    ctx.lineWidth = Math.max(1, tileW * 0.04);
    ctx.beginPath();
    ctx.arc(px, py, r, Math.PI, Math.PI * 2, false);
    ctx.stroke();
    if (p.variant !== 2) {
      ctx.fillStyle = '#eaf0ff';
      ctx.fillRect(Math.round(px - r - 0.5), Math.round(py - 0.5), 1, 1);
      ctx.fillRect(Math.round(px + r - 0.5), Math.round(py - 0.5), 1, 1);
      if (p.variant === 1 && r > Math.max(2.5, tileW * 0.12)) {
        ctx.fillRect(Math.round(px - 0.5), Math.round(py - r - 0.5), 1, 1);
      }
    }
  } else if (p.type === 'psyTrail') {
    ctx.fillStyle = '#d892ff';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.1) * a, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'powderTrail') {
    ctx.fillStyle = '#a7ff9a';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.1) * a, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'silkTrail') {
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.1) * a, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'laserTrail') {
    const hue = ((p.x + p.y) * 47 + performance.now() * 0.08) % 360;
    ctx.fillStyle = `hsla(${hue}, 92%, 68%, ${0.35 + 0.55 * a})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.095) * a, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'fieldCutVineArc') {
    const t = 1 - a;
    const ease = 1 - (1 - t) * (1 - t);
    const arcRad = ((Number(p.arcDeg) || 120) * Math.PI) / 180;
    const half = arcRad * 0.5;
    const r = Math.max(tileW * 0.55, (Number(p.radiusTiles) || 1.55) * Math.min(tileW, tileH));
    const heading = Number(p.headingRad) || 0;
    const swayBase = Math.max(0.02, 0.16 * (1 - ease * 0.58));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(heading);
    for (let strand = 0; strand < 3; strand++) {
      const strandOff = (strand - 1) * tileH * 0.03;
      const links = 12;
      ctx.beginPath();
      for (let i = 0; i < links; i++) {
        const u = i / (links - 1);
        const theta = -half + arcRad * u;
        const pendulum = Math.sin(performance.now() * 0.016 + u * 8.8 + strand * 1.4) * swayBase;
        const rr = r * (0.33 + 0.67 * u);
        const x = Math.cos(theta + pendulum) * rr;
        const y = Math.sin(theta + pendulum) * rr + strandOff;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(132, 244, 118, ${0.45 + 0.48 * a})`;
      ctx.lineWidth = Math.max(1.5, tileW * (0.072 - strand * 0.013));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const outerR = r * (0.94 + ease * 0.16);
    const innerR = outerR * 0.68;
    const tipInset = half * 0.2;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, -half, half);
    ctx.arc(0, 0, innerR, half - tipInset, -half + tipInset, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(186, 255, 162, ${0.2 + 0.35 * a})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(224, 255, 198, ${0.3 + 0.42 * a})`;
    ctx.lineWidth = Math.max(1.1, tileW * 0.032);
    ctx.stroke();
    ctx.restore();
  } else if (p.type === 'fieldCutPsychicArc' || p.type === 'fieldCutSlashArc') {
    const psychic = p.type === 'fieldCutPsychicArc';
    const t = 1 - a;
    const ease = 1 - (1 - t) * (1 - t);
    const arcRad = ((Number(p.arcDeg) || (psychic ? 120 : 108)) * Math.PI) / 180;
    const half = arcRad * 0.5;
    const r = Math.max(tileW * 0.52, (Number(p.radiusTiles) || (psychic ? 1.62 : 1.46)) * Math.min(tileW, tileH));
    const heading = Number(p.headingRad) || 0;
    const outerR = r * (0.9 + 0.2 * ease);
    const innerR = outerR * (psychic ? 0.62 : 0.7);
    const tipInset = half * (psychic ? 0.24 : 0.18);
    const psychicPal = psychic ? psychicCutAlternatingPalette(p) : null;
    const glow = psychic ? psychicPal.glow : [240, 240, 255];
    const core = psychic ? psychicPal.core : [255, 255, 255];
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.arc(0, 0, outerR, -half, half);
    ctx.arc(0, 0, innerR, half - tipInset, -half + tipInset, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(${glow[0]}, ${glow[1]}, ${glow[2]}, ${0.24 + 0.36 * a})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${0.36 + 0.52 * a})`;
    ctx.lineWidth = Math.max(1.3, tileW * (psychic ? 0.05 : 0.038));
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  } else if (p.type === 'fieldSpinAttack') {
    const t = 1 - a;
    const styleId = String(p.styleId || 'slash');
    const radius = Math.max(tileW * 0.52, (Number(p.radiusTiles) || 2) * Math.min(tileW, tileH));
    const sweepStart = (Number(p.headingRad) || 0) + t * (Math.PI * 2.2);
    const sweepSize = Math.PI * (0.95 + 0.1 * Math.sin(t * Math.PI));
    let ringColor = [245, 245, 255];
    let coreColor = [255, 255, 255];
    if (styleId === 'vine') {
      ringColor = [136, 255, 126];
      coreColor = [216, 255, 206];
    } else if (styleId === 'psychic') {
      const psychicPal = psychicCutAlternatingPalette(p);
      ringColor = psychicPal.ring;
      coreColor = psychicPal.core;
    } else if (styleId === 'strength') {
      ringColor = [255, 196, 124];
      coreColor = [255, 232, 184];
    }
    ctx.save();
    ctx.translate(px, py);
    // Full ring: wide 360 body (thicker than before).
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${ringColor[0]}, ${ringColor[1]}, ${ringColor[2]}, ${0.18 + 0.38 * a})`;
    ctx.lineWidth = Math.max(3.4, tileW * 0.17);
    ctx.stroke();

    // Rotating crescent moon slash (filled lune with tapered tips).
    const sweepEnd = sweepStart + sweepSize;
    const mid = (sweepStart + sweepEnd) * 0.5;
    const outerR = radius * 1.02;
    const innerR = outerR * 0.7;
    const tipInset = Math.max(0.08, sweepSize * 0.22);
    const crescentOffset = outerR * 0.2;
    const offX = Math.cos(mid) * crescentOffset;
    const offY = Math.sin(mid) * crescentOffset;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, sweepStart, sweepEnd);
    ctx.arc(offX, offY, innerR, sweepEnd - tipInset, sweepStart + tipInset, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(${coreColor[0]}, ${coreColor[1]}, ${coreColor[2]}, ${0.3 + 0.5 * a})`;
    ctx.fill();

    // Bright inner edge to emphasize moon-shape tips.
    ctx.beginPath();
    ctx.arc(0, 0, outerR * 0.96, sweepStart + tipInset * 0.18, sweepEnd - tipInset * 0.18);
    ctx.strokeStyle = `rgba(${coreColor[0]}, ${coreColor[1]}, ${coreColor[2]}, ${0.45 + 0.45 * a})`;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.2, tileW * 0.09);
    ctx.stroke();
    if (styleId === 'vine') {
      const links = 16;
      ctx.fillStyle = `rgba(174, 255, 150, ${0.2 + 0.36 * a})`;
      for (let i = 0; i < links; i++) {
        const u = i / links;
        const ang = sweepStart + sweepSize * u;
        const rr = radius + Math.sin(u * Math.PI * 3.2) * tileW * 0.06;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, Math.max(1.2, tileW * 0.032), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (p.windTex) {
      const windImg = imageCache.get(FIELD_SPIN_WIND_TEX);
      if (!windImg?.naturalWidth) {
        queueFieldSpinWindTextureLoad();
      } else {
        ctx.save();
        const windSpin = performance.now() * 0.0034 + sweepStart * 0.35 + t * Math.PI * 1.1;
        ctx.rotate(windSpin);
        const span = radius * 2.25;
        const prevComp = ctx.globalCompositeOperation;
        const prevAlpha = ctx.globalAlpha;
        ctx.globalCompositeOperation = 'lighter';
        const windA = Math.min(1, 0.22 + 0.3 * (1 - t * 0.45));
        ctx.globalAlpha = prevAlpha * windA;
        ctx.drawImage(windImg, -span * 0.5, -span * 0.5, span, span);
        ctx.globalCompositeOperation = prevComp;
        ctx.globalAlpha = prevAlpha;
        ctx.restore();
      }
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#ffff88';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.08) * a, 0, Math.PI * 2);
    ctx.fill();
  }
}
