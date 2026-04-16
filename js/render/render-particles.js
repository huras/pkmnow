import { imageCache } from '../image-cache.js';
import { BURN_START_FRAME, BURN_START_FRAMES } from '../moves/move-constants.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p
 */
export function drawBatchedParticle(ctx, p, tileW, tileH, snapPx) {
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
    const glow = psychic ? [255, 122, 220] : [240, 240, 255];
    const core = psychic ? [255, 84, 190] : [255, 255, 255];
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
      ringColor = [255, 116, 216];
      coreColor = [255, 182, 232];
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
    ctx.restore();
  } else {
    ctx.fillStyle = '#ffff88';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.08) * a, 0, Math.PI * 2);
    ctx.fill();
  }
}
