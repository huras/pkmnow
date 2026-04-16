import { imageCache } from '../image-cache.js';
import { FIRE_FRAME_W, FIRE_FRAME_H } from '../moves/move-constants.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p
 */
export function drawBatchedProjectile(ctx, p, tileW, tileH, snapPx, time) {
  const px = snapPx(p.x * tileW);
  const py = snapPx(p.y * tileH - (p.z || 0) * tileH);
  if (p.type === 'ember') {
    const img = imageCache.get('tilesets/effects/actual-fire.png');
    const fh = p.sheetFrameH || FIRE_FRAME_H;
    const fw = p.sheetFrameW || FIRE_FRAME_W;
    const n = p.sheetFrames || 4;
    const frame = Math.floor(time * 14) % n;
    const dw = Math.ceil(tileW * 1.35);
    const dh = Math.ceil(tileH * 1.35);
    if (img && img.naturalWidth) {
      ctx.drawImage(img, 0, frame * fh, fw, fh, px - dw * 0.5, py - dh * 0.5, dw, dh);
    } else {
      ctx.fillStyle = '#ff8800';
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.type === 'waterShot') {
    ctx.fillStyle = 'rgba(140,210,255,0.9)';
    ctx.beginPath();
    const r = Math.max(4, tileW * 0.19);
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'waterGunShot' || p.type === 'bubbleShot' || p.type === 'bubbleBeamShot') {
    if (p.type === 'bubbleShot') {
      ctx.fillStyle = 'rgba(235,248,255,0.6)';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      const r = Math.max(5, tileW * 0.22);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (p.type === 'bubbleBeamShot') {
      const vx = Number(p.vx) || 0;
      const vy = Number(p.vy) || 0;
      const speed = Math.hypot(vx, vy);
      const wiggle = Math.sin(time * 22 + (p.x ?? 0) * 8 + (p.y ?? 0) * 5) * 0.18;
      const outerR = Math.max(5.6, tileW * 0.23);
      const innerR = Math.max(2.6, outerR * 0.5);
      const haloR = outerR * 1.32;
      ctx.save();
      ctx.translate(px, py);
      if (speed > 1e-4) ctx.rotate(Math.atan2(vy, vx));
      if (speed > 1e-4) ctx.translate(Math.max(0, tileW * 0.03 + wiggle), 0);

      // Soft outer aura for "beam" readability at long range.
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(220,240,255,0.22)';
      ctx.fill();

      // White ring.
      ctx.beginPath();
      ctx.arc(0, 0, outerR, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2.1, tileW * 0.085);
      ctx.strokeStyle = 'rgba(252,252,255,0.96)';
      ctx.stroke();

      // Transparent center (clear "hollow bubble").
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(0, 0, innerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Small specular glint.
      ctx.beginPath();
      ctx.ellipse(-outerR * 0.28, -outerR * 0.34, outerR * 0.18, outerR * 0.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.restore();
    } else {
      const vx = Number(p.vx) || 0;
      const vy = Number(p.vy) || 0;
      const ang = Math.atan2(vy, vx || 1e-6);
      const bodyR = Math.max(3.2, tileW * 0.145);
      const tailLen = Math.max(4.5, tileW * 0.24);

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.beginPath();
      // Tear drop profile (pointed tip toward travel direction).
      ctx.moveTo(bodyR + tailLen, 0);
      ctx.quadraticCurveTo(bodyR * 0.95, bodyR * 1.05, -bodyR * 1.05, bodyR * 0.68);
      ctx.quadraticCurveTo(-bodyR * 1.5, 0, -bodyR * 1.05, -bodyR * 0.68);
      ctx.quadraticCurveTo(bodyR * 0.95, -bodyR * 1.05, bodyR + tailLen, 0);
      ctx.closePath();
      ctx.fillStyle = 'rgba(86,170,255,0.92)';
      ctx.fill();

      // Inner gloss highlight.
      ctx.beginPath();
      ctx.ellipse(-bodyR * 0.15, -bodyR * 0.2, bodyR * 0.45, bodyR * 0.28, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(214,240,255,0.78)';
      ctx.fill();
      ctx.restore();
    }
  } else if (p.type === 'flamethrowerShot' || p.type === 'incinerateCore' || p.type === 'incinerateShard') {
    if (p.type === 'flamethrowerShot') {
      const img = imageCache.get('tilesets/effects/actual-fire.png');
      const fh = p.sheetFrameH || FIRE_FRAME_H;
      const fw = p.sheetFrameW || FIRE_FRAME_W;
      const n = p.sheetFrames || 4;
      const frame = Math.floor((time * 18 + (p.x + p.y) * 2.3) % n);
      const dw = Math.ceil(tileW * 1.02);
      const dh = Math.ceil(tileH * 1.02);
      if (img && img.naturalWidth) {
        ctx.drawImage(img, 0, frame * fh, fw, fh, px - dw * 0.5, py - dh * 0.5, dw, dh);
      } else {
        ctx.fillStyle = '#ff6a00';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(3, tileW * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#ff4500';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3, tileW * (p.type === 'incinerateShard' ? 0.1 : 0.14)), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.type === 'confusionOrb') {
    ctx.fillStyle = 'rgba(164,94,255,0.65)';
    ctx.strokeStyle = 'rgba(222,171,255,0.95)';
    ctx.lineWidth = 2;
    const r = Math.max(5, tileW * 0.2);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (p.type === 'psybeamBeam') {
    const x0 = snapPx(p.beamStartX * tileW);
    const y0 = snapPx(p.beamStartY * tileH - (p.z || 0) * tileH);
    const x1 = snapPx(p.beamEndX * tileW);
    const y1 = snapPx(p.beamEndY * tileH - (p.z || 0) * tileH);
    const maxT = p.beamTtlMax || 0.28;
    const ttl = Math.max(0, p.timeToLive ?? maxT);
    const a = Math.max(0.06, Math.min(1, (ttl / maxT) * 0.9 + 0.1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const th = Math.max(6, tileH * 0.22);
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    const halfL = len * 0.5;
    const grd = ctx.createLinearGradient(-halfL, 0, halfL, 0);
    grd.addColorStop(0, `rgba(255,105,185,${0.52 * a})`);
    grd.addColorStop(0.35, `rgba(255,75,170,${0.92 * a})`);
    grd.addColorStop(0.5, `rgba(255,55,160,${0.98 * a})`);
    grd.addColorStop(0.65, `rgba(255,80,178,${0.92 * a})`);
    grd.addColorStop(1, `rgba(230,50,150,${0.48 * a})`);
    /* Soft outer halo without ctx.shadowBlur (very expensive with `lighter` compositing). */
    ctx.fillStyle = `rgba(255, 75, 175, ${0.22 * a})`;
    ctx.fillRect(-halfL, -th * 0.72, len, th * 1.44);
    ctx.fillStyle = grd;
    ctx.fillRect(-halfL, -th * 0.5, len, th);
    /* Narrow “core” read — hot pink / magenta, not white */
    ctx.fillStyle = `rgba(255, 165, 220, ${0.58 * a})`;
    ctx.fillRect(-halfL, -th * 0.14, len, th * 0.28);
    ctx.fillStyle = `rgba(255, 110, 195, ${0.45 * a})`;
    ctx.fillRect(-halfL, -th * 0.08, len, th * 0.16);
    ctx.restore();
  } else if (p.type === 'prismaticShot') {
    const ang = Math.atan2(p.vy || 0, p.vx || 1);
    const hueBase = (Number(p.rainbowHue0) || 0) + time * 220;
    if (p.laserStream) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      const len = Math.max(10, tileW * 0.62);
      const th = Math.max(2.2, tileH * 0.055);
      const h0 = hueBase % 360;
      const h1 = (hueBase + 72) % 360;
      const h2 = (hueBase + 144) % 360;
      const grd = ctx.createLinearGradient(-len * 0.5, 0, len * 0.5, 0);
      grd.addColorStop(0, `hsla(${h0}, 100%, 62%, 0.25)`);
      grd.addColorStop(0.35, `hsla(${h1}, 100%, 56%, 0.92)`);
      grd.addColorStop(0.65, `hsla(${h2}, 100%, 64%, 0.92)`);
      grd.addColorStop(1, `hsla(${(h0 + 200) % 360}, 95%, 58%, 0.22)`);
      ctx.fillStyle = `hsla(${(h1 + 40) % 360}, 100%, 60%, 0.18)`;
      ctx.fillRect(-len * 0.5, -th * 0.85, len, th * 1.7);
      ctx.fillStyle = grd;
      ctx.fillRect(-len * 0.5, -th * 0.5, len, th);
      ctx.strokeStyle = `hsla(${(h2 + 30) % 360}, 100%, 78%, 0.55)`;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-len * 0.5, -th * 0.5, len, th);
      ctx.restore();
    } else {
      const colors = ['#ff1744', '#ff9100', '#ffee58', '#40c4ff', '#7c4dff'];
      const idx = Math.floor(((time * 25 + (p.rainbowHue0 || 0)) % colors.length + colors.length) % colors.length);
      ctx.fillStyle = colors[idx];
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3, tileW * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.type === 'poisonPowderShot') {
    ctx.fillStyle = 'rgba(120,255,140,0.55)';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(4, tileW * 0.16), 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'silkShot') {
    ctx.fillStyle = 'rgba(245,245,245,0.85)';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(3, tileW * 0.12), 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'poisonSting') {
    const ang = p.stingAngle ?? 0;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(170,90,230,0.94)';
    ctx.beginPath();
    ctx.moveTo(tileW * 0.3, 0);
    ctx.lineTo(-tileW * 0.2, -tileH * 0.2);
    ctx.lineTo(-tileW * 0.14, tileH * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
