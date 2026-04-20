import { imageCache } from '../image-cache.js';
import { FIRE_FRAME_W, FIRE_FRAME_H } from '../moves/move-constants.js';

/**
 * Full-length Prismatic Laser stream gradient (mouth → aim). Used by merged hold-beam and per-projectile fallback.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ laserBeamSx: number, laserBeamSy: number, laserBeamSz?: number, laserBeamEx: number, laserBeamEy: number, laserBeamEz?: number, rainbowHue0?: number }} beam
 */
/**
 * Thick silver optic-beam (Steel Beam hold stream). Same geometry contract as {@link drawPrismaticStreamGradientBeam}.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ laserBeamSx: number, laserBeamSy: number, laserBeamSz?: number, laserBeamEx: number, laserBeamEy: number, laserBeamEz?: number }} beam
 */
export function drawSteelStreamGradientBeam(ctx, beam, tileW, tileH, snapPx, time) {
  const sx = Number(beam.laserBeamSx);
  const sy = Number(beam.laserBeamSy);
  const sz = Number(beam.laserBeamSz) || 0;
  const ex = Number(beam.laserBeamEx);
  const ey = Number(beam.laserBeamEy);
  const ez = Number(beam.laserBeamEz) || 0;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return;

  const x0 = snapPx(sx * tileW);
  const y0 = snapPx(sy * tileH - sz * tileH);
  const x1 = snapPx(ex * tileW);
  const y1 = snapPx(ey * tileH - ez * tileH);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenPx = Math.max(10, Math.hypot(dx, dy));
  const midX = (x0 + x1) * 0.5;
  const midY = (y0 + y1) * 0.5;
  const beamAng = Math.atan2(dy, dx);
  const th = Math.max(5, tileH * 0.11) * 7;
  const halfLen = lenPx * 0.5;
  const pulse = 0.5 + 0.5 * Math.sin(time * 38 + midX * 0.04);

  const grd = ctx.createLinearGradient(-halfLen, 0, halfLen, 0);
  grd.addColorStop(0, `rgba(200,210,225,${0.22 + 0.12 * pulse})`);
  grd.addColorStop(0.22, 'rgba(230,236,245,0.92)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.98)');
  grd.addColorStop(0.78, 'rgba(185,198,214,0.9)');
  grd.addColorStop(1, `rgba(160,175,195,${0.2 + 0.1 * pulse})`);

  /** Beam along +x in local space; origin at -halfLen gets a round cap (mouth side). */
  const steelBeamRoundOriginPath = (halfH, arcR) => {
    ctx.beginPath();
    ctx.moveTo(-halfLen, -halfH);
    ctx.arc(-halfLen, 0, arcR, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(halfLen, halfH);
    ctx.lineTo(halfLen, -halfH);
    ctx.closePath();
  };

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(beamAng);
  const halfHalo = th * 1.05;
  ctx.fillStyle = 'rgba(140,155,175,0.22)';
  steelBeamRoundOriginPath(halfHalo, halfHalo);
  ctx.fill();
  const halfBody = th * 0.52;
  ctx.fillStyle = grd;
  steelBeamRoundOriginPath(halfBody, halfBody);
  ctx.fill();
  ctx.strokeStyle = `rgba(240,248,255,${0.35 + 0.25 * pulse})`;
  ctx.lineWidth = Math.max(4, tileW * 0.09);
  steelBeamRoundOriginPath(halfBody, halfBody);
  ctx.stroke();
  const coreH = th * (0.22 + 0.1 * pulse);
  const halfCore = coreH * 0.5;
  ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * pulse})`;
  steelBeamRoundOriginPath(halfCore, halfCore);
  ctx.fill();
  ctx.restore();
}

/**
 * Thick blue waterfall-style beam (Water Cannon). Non-additive; caller should not force `lighter`.
 * Same geometry contract as {@link drawSteelStreamGradientBeam}.
 */
export function drawWaterCannonStreamBeam(ctx, beam, tileW, tileH, snapPx, time) {
  const sx = Number(beam.laserBeamSx);
  const sy = Number(beam.laserBeamSy);
  const sz = Number(beam.laserBeamSz) || 0;
  const ex = Number(beam.laserBeamEx);
  const ey = Number(beam.laserBeamEy);
  const ez = Number(beam.laserBeamEz) || 0;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return;

  const x0 = snapPx(sx * tileW);
  const y0 = snapPx(sy * tileH - sz * tileH);
  const x1 = snapPx(ex * tileW);
  const y1 = snapPx(ey * tileH - ez * tileH);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenPx = Math.max(10, Math.hypot(dx, dy));
  const midX = (x0 + x1) * 0.5;
  const midY = (y0 + y1) * 0.5;
  const beamAng = Math.atan2(dy, dx);
  const halfLen = lenPx * 0.5;
  const baseTh = Math.max(5.5, tileH * 0.088) * 5.4;
  const waveA = Math.max(2.2, tileH * 0.026);
  const segs = Math.max(32, Math.min(96, Math.floor(lenPx / 6)));

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(beamAng);
  ctx.globalCompositeOperation = 'source-over';

  const topPts = [];
  const botPts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = -halfLen + t * lenPx;
    const w =
      Math.sin(t * Math.PI * 5.2 + time * 5.4) * waveA +
      Math.sin(t * Math.PI * 11 + time * 2.9) * waveA * 0.42;
    const hb = baseTh * (0.4 + 0.11 * Math.sin(t * Math.PI * 4.2 + time * 1.6));
    topPts.push({ x, y: w - hb });
    botPts.push({ x, y: w + hb });
  }

  ctx.beginPath();
  ctx.moveTo(topPts[0].x, topPts[0].y);
  for (let i = 1; i < topPts.length; i++) ctx.lineTo(topPts[i].x, topPts[i].y);
  for (let i = botPts.length - 1; i >= 0; i--) ctx.lineTo(botPts[i].x, botPts[i].y);
  ctx.closePath();

  const grd = ctx.createLinearGradient(-halfLen, 0, halfLen, 0);
  grd.addColorStop(0, 'rgba(28, 95, 190, 0.42)');
  grd.addColorStop(0.28, 'rgba(55, 150, 235, 0.88)');
  grd.addColorStop(0.52, 'rgba(190, 235, 255, 0.94)');
  grd.addColorStop(0.74, 'rgba(40, 130, 220, 0.82)');
  grd.addColorStop(1, 'rgba(22, 88, 175, 0.38)');
  ctx.fillStyle = grd;
  ctx.fill();

  const w0 =
    Math.sin(0 * Math.PI * 5.2 + time * 5.4) * waveA +
    Math.sin(0 * Math.PI * 11 + time * 2.9) * waveA * 0.42;
  const hb0 = baseTh * (0.4 + 0.11 * Math.sin(0 * Math.PI * 4.2 + time * 1.6));
  const capR = Math.max(hb0 * 0.95, 4);
  ctx.beginPath();
  ctx.arc(-halfLen, w0, capR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120, 200, 255, 0.55)';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(topPts[0].x, topPts[0].y);
  for (let i = 1; i < topPts.length; i++) ctx.lineTo(topPts[i].x, topPts[i].y);
  for (let i = botPts.length - 1; i >= 0; i--) ctx.lineTo(botPts[i].x, botPts[i].y);
  ctx.closePath();
  ctx.clip();

  const scroll = time * 12;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1, tileW * 0.016);
  const nLines = 10;
  for (let k = 0; k < nLines; k++) {
    const lane = ((k + 0.5) / nLines - 0.5) * baseTh * 0.82;
    ctx.beginPath();
    for (let j = 0; j <= segs; j++) {
      const t = j / segs;
      const x = -halfLen + t * lenPx;
      const w =
        Math.sin(t * Math.PI * 5.2 + time * 5.4) * waveA +
        Math.sin(t * Math.PI * 11 + time * 2.9) * waveA * 0.42;
      const flow = Math.sin(t * 28 - scroll + k * 1.4) * (baseTh * 0.07);
      const y = w + lane + flow;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(topPts[0].x, topPts[0].y);
  for (let i = 1; i < topPts.length; i++) ctx.lineTo(topPts[i].x, topPts[i].y);
  for (let i = botPts.length - 1; i >= 0; i--) ctx.lineTo(botPts[i].x, botPts[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(230, 248, 255, 0.36)';
  ctx.lineWidth = Math.max(1.4, tileW * 0.024);
  ctx.stroke();

  ctx.restore();
}

export function drawPrismaticStreamGradientBeam(ctx, beam, tileW, tileH, snapPx, time) {
  const sx = Number(beam.laserBeamSx);
  const sy = Number(beam.laserBeamSy);
  const sz = Number(beam.laserBeamSz) || 0;
  const ex = Number(beam.laserBeamEx);
  const ey = Number(beam.laserBeamEy);
  const ez = Number(beam.laserBeamEz) || 0;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return;

  const hueBase = (Number(beam.rainbowHue0) || 0) + time * 220;
  const h0 = hueBase % 360;
  const h1 = (hueBase + 72) % 360;
  const h2 = (hueBase + 144) % 360;
  const h3 = (hueBase + 216) % 360;

  const x0 = snapPx(sx * tileW);
  const y0 = snapPx(sy * tileH - sz * tileH);
  const x1 = snapPx(ex * tileW);
  const y1 = snapPx(ey * tileH - ez * tileH);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenPx = Math.max(10, Math.hypot(dx, dy));
  const midX = (x0 + x1) * 0.5;
  const midY = (y0 + y1) * 0.5;
  const beamAng = Math.atan2(dy, dx);
  const th = Math.max(3, tileH * 0.072);
  const halfLen = lenPx * 0.5;

  const grd = ctx.createLinearGradient(-halfLen, 0, halfLen, 0);
  grd.addColorStop(0, `hsla(${h0}, 100%, 62%, 0.28)`);
  grd.addColorStop(0.28, `hsla(${h1}, 100%, 56%, 0.95)`);
  grd.addColorStop(0.52, `hsla(${h2}, 100%, 60%, 0.98)`);
  grd.addColorStop(0.76, `hsla(${h3}, 100%, 58%, 0.92)`);
  grd.addColorStop(1, `hsla(${(h0 + 200) % 360}, 95%, 58%, 0.26)`);

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(beamAng);
  ctx.fillStyle = `hsla(${(h1 + 40) % 360}, 100%, 60%, 0.16)`;
  ctx.fillRect(-halfLen, -th * 0.92, lenPx, th * 1.84);
  ctx.fillStyle = grd;
  ctx.fillRect(-halfLen, -th * 0.5, lenPx, th);
  ctx.strokeStyle = `hsla(${(h2 + 30) % 360}, 100%, 78%, 0.5)`;
  ctx.lineWidth = Math.max(1.1, tileW * 0.02);
  ctx.strokeRect(-halfLen, -th * 0.5, lenPx, th);
  // Hot white core in the middle of the rainbow — strobes on/off (irregular gate + smooth bursts).
  const gate =
    0.5 * Math.sin(time * 44 + midX * 0.05 + midY * 0.04) +
    0.35 * Math.sin(time * 71 + lenPx * 0.015);
  const strobe = (Math.floor(time * 13.7 + midX * 0.08) & 1) === 0;
  const on = strobe && gate > -0.08;
  const burst = Math.max(0, Math.sin(time * 88 + midY * 0.06)) ** 3;
  const whiteA = on ? Math.min(0.97, 0.58 + 0.38 * burst + 0.12 * Math.max(0, gate)) : 0.02 + 0.04 * burst;
  const coreH = th * (on ? 0.18 + 0.12 * burst : 0.09);
  ctx.fillStyle = `rgba(255,255,255,${whiteA})`;
  ctx.fillRect(-halfLen, -coreH * 0.5, lenPx, coreH);
  ctx.restore();
}

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
  } else if (p.type === 'waterGunBall') {
    const tier = Number(p.wgTier) || 1;
    const baseR = Math.max(6, tileW * (0.38 + tier * 0.1));
    const pulse = 0.94 + 0.06 * Math.sin(time * 26 + (p.x ?? 0) * 5.5);
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, baseR * pulse, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(px - baseR * 0.38, py - baseR * 0.38, baseR * 0.1, px, py, baseR * 1.08);
    g.addColorStop(0, 'rgba(236,252,255,0.98)');
    g.addColorStop(0.42, 'rgba(120,200,255,0.9)');
    g.addColorStop(0.78, 'rgba(50,140,230,0.72)');
    g.addColorStop(1, 'rgba(30,100,200,0.45)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,240,255,0.82)';
    ctx.lineWidth = Math.max(1.2, tileW * 0.042);
    ctx.stroke();
    ctx.restore();
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
  } else if (
    p.type === 'flamethrowerShot' ||
    p.type === 'fireSpinBurst' ||
    p.type === 'incinerateCore' ||
    p.type === 'incinerateShard' ||
    p.type === 'fireBlastCore' ||
    p.type === 'fireBlastShard'
  ) {
    if (p.type === 'flamethrowerShot' || p.type === 'fireSpinBurst') {
      const img = imageCache.get('tilesets/effects/actual-fire.png');
      const fh = p.sheetFrameH || FIRE_FRAME_H;
      const fw = p.sheetFrameW || FIRE_FRAME_W;
      const n = p.sheetFrames || 4;
      const frame = Math.floor((time * 18 + (p.x + p.y) * 2.3) % n);
      const tier = p.type === 'fireSpinBurst' ? Number(p.spinTier) || 1 : 0;
      const kick = p.type === 'fireSpinBurst' ? Math.min(1.85, Number(p.spinKick) || 1) : 1;
      const spinMul = p.type === 'fireSpinBurst' ? (0.72 + tier * 0.14) * (0.85 + kick * 0.12) : 1;
      const dw = Math.ceil(tileW * 1.02 * spinMul);
      const dh = Math.ceil(tileH * 1.02 * spinMul);
      if (img && img.naturalWidth) {
        ctx.drawImage(img, 0, frame * fh, fw, fh, px - dw * 0.5, py - dh * 0.5, dw, dh);
      } else {
        ctx.fillStyle = '#ff6a00';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(3, tileW * 0.12 * spinMul), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.type === 'fireBlastCore') {
      const img = imageCache.get('tilesets/effects/actual-fire.png');
      const fh = p.sheetFrameH || FIRE_FRAME_H;
      const fw = p.sheetFrameW || FIRE_FRAME_W;
      const n = p.sheetFrames || 4;
      const frame = Math.floor((time * 20 + (p.x + p.y) * 2.7) % n);
      const tier = Number(p.blastTier) || 2;
      const scale = tier === 3 ? 1.88 : tier === 2 ? 1.48 : 1.2;
      const dw = Math.ceil(tileW * 1.34 * scale);
      const dh = Math.ceil(tileH * 1.34 * scale);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (img && img.naturalWidth) {
        ctx.globalAlpha = 0.92;
        ctx.drawImage(img, 0, frame * fh, fw, fh, px - dw * 0.5, py - dh * 0.5, dw, dh);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(img, 0, ((frame + 1) % n) * fh, fw, fh, px - dw * 0.58, py - dh * 0.58, dw * 1.16, dh * 1.16);
      } else {
        ctx.fillStyle = '#ff3a00';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(6, tileW * 0.2 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (p.type === 'fireBlastShard') {
      const img = imageCache.get('tilesets/effects/actual-fire.png');
      const fh = FIRE_FRAME_H;
      const fw = FIRE_FRAME_W;
      const frame = Math.floor((time * 22 + (p.x + p.y) * 3.1) % 4);
      const dw = Math.ceil(tileW * 0.86);
      const dh = Math.ceil(tileH * 0.86);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (img && img.naturalWidth) {
        ctx.globalAlpha = 0.88;
        ctx.drawImage(img, 0, frame * fh, fw, fh, px - dw * 0.5, py - dh * 0.5, dw, dh);
      } else {
        ctx.fillStyle = '#ff6600';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.5, tileW * 0.09), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
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
  } else if (p.type === 'thunderShockBeam') {
    // Jagged yellow lightning arc between caster and aim point. The polyline is re-rolled
    // every frame so the bolt crackles naturally; three passes (outer glow → warm body →
    // hot white core) give depth without needing `ctx.shadowBlur` (too expensive when
    // combined with `lighter` compositing). A second "fork" bolt lands next to the primary
    // for that classic split-lightning look.
    const x0 = snapPx(p.beamStartX * tileW);
    const y0 = snapPx(p.beamStartY * tileH - (p.z || 0) * tileH);
    const x1 = snapPx(p.beamEndX * tileW);
    const y1 = snapPx(p.beamEndY * tileH - (p.z || 0) * tileH);
    const maxT = p.beamTtlMax || 0.11;
    const ttl = Math.max(0, p.timeToLive ?? maxT);
    // Per-puff life envelope: snap bright right at spawn, soften as it ages. A single
    // sine on top gives a subtle per-frame flicker on top of the age decay.
    const lifeT = Math.max(0, Math.min(1, ttl / maxT));
    const flicker = 0.72 + Math.sin(time * 58 + (p.jagSeed || 0)) * 0.28;
    const a = Math.max(0.25, lifeT * 0.95 + 0.1) * flicker;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    // Segment count scales with length: short zaps stay snappy, long arcs get more jags.
    const segments = Math.max(6, Math.min(18, Math.round(len / Math.max(8, tileW * 0.32))));
    // Perpendicular jitter amplitude; scaled by tile size so it reads the same at any zoom.
    const jagAmp = Math.max(1.6, tileH * 0.16);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    const drawBolt = (amp, extraBias) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 1; i < segments; i++) {
        const tt = i / segments;
        // Sine taper keeps the endpoints pinned and lets the middle wobble hardest.
        const taper = Math.sin(tt * Math.PI);
        // `Math.random()` is fine here — jag regenerates per frame, so any bias is
        // invisible. Keeping it simple avoids the cost of a seeded PRNG.
        const jag = (Math.random() - 0.5) * 2 * amp * taper + extraBias * taper;
        ctx.lineTo(tt * len, jag);
      }
      ctx.lineTo(len, 0);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 1. Outer amber halo (soft, wide). source-over so it reads on any background.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.32 * a;
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = Math.max(5, tileH * 0.22);
    drawBolt(jagAmp * 1.15, 0);
    // 2. Warm yellow body (additive). Slightly tighter jag amplitude so it doesn't
    //    perfectly trace the halo — reads as volumetric rather than a single line.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 * a;
    ctx.strokeStyle = '#ffe870';
    ctx.lineWidth = Math.max(2.4, tileH * 0.1);
    drawBolt(jagAmp * 0.85, 0);
    // 3. Hot white core (additive), narrow, crisp.
    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.2, tileH * 0.045);
    drawBolt(jagAmp * 0.55, 0);
    // 4. Occasional fork — a second small bolt that branches beside the main one. Reads
    //    as the classic lightning "splitter" without doubling the cost.
    if ((p.jagSeed & 3) !== 0) {
      ctx.globalAlpha = 0.55 * a;
      ctx.strokeStyle = '#fff4a8';
      ctx.lineWidth = Math.max(1.2, tileH * 0.05);
      const forkOffset = (Math.random() - 0.5) * jagAmp * 1.8;
      drawBolt(jagAmp * 0.9, forkOffset);
    }
    ctx.restore();
  } else if (p.type === 'thunderBoltArc') {
    // Yellow lightning bolt drawn along a parabolic air path between caster and target.
    // The arc is sampled into N points via a quadratic curve (endpoints on the ground
    // plane, mid control point lifted by `arcPeakZ`), then each segment gets its own
    // jagged perpendicular jitter. Like `thunderShockBeam`, the path is rerolled every
    // frame (seeded on `jagSeed`) so the bolt crackles instead of sitting static.
    //
    // The draw is done in *screen space* (not rotated-to-chord like Thundershock) because
    // the arc's curvature needs true world-Y for the peak; we pre-project each sample to
    // screen XY and stroke the polyline directly.
    const maxT = p.beamTtlMax || 0.22;
    const ttl = Math.max(0, p.timeToLive ?? maxT);
    const lifeT = Math.max(0, Math.min(1, ttl / maxT));
    // Per-frame flicker keeps the bolt "alive" for its whole (short) lifetime; the
    // envelope holds near-full brightness most of the TTL and then drops off fast so
    // the trailing frames don't look like a dead stroke lingering on screen.
    const flicker = 0.72 + Math.sin(time * 72 + (p.jagSeed || 0)) * 0.28;
    const a = Math.max(0.2, Math.min(1, lifeT * 1.1)) * flicker;
    const sxw = p.beamStartX;
    const syw = p.beamStartY;
    const exw = p.beamEndX;
    const eyw = p.beamEndY;
    const szw = p.beamStartZ || 0;
    const peakZ = Math.max(0.2, p.arcPeakZ || 1);
    const chord = Math.hypot(exw - sxw, eyw - syw) || 1;
    // Segment count scales with chord length so long bolts get more wiggle than short
    // ones, but we cap the range so very-close casts stay crisp and very-far casts don't
    // pay for unused subdivisions (the arc's curvature eats high-frequency detail anyway).
    const segments = Math.max(10, Math.min(26, Math.round(chord * 2.4)));
    // Perpendicular jag amplitude in screen pixels. Kept a touch tighter than Thundershock's
    // because the arc's macro shape already provides visual interest — too much jitter
    // flattens the parabola into noise.
    const jagAmp = Math.max(1.3, tileH * 0.12);
    /** Pre-compute sample points along the quadratic Bezier with midpoint lift. */
    const points = new Array(segments + 1);
    for (let i = 0; i <= segments; i++) {
      const tt = i / segments;
      const wx = sxw + (exw - sxw) * tt;
      const wy = syw + (eyw - syw) * tt;
      // Quadratic ease with ends pinned to start/end elevation (`szw` → 0), midpoint
      // lifted by `peakZ`. The `4 * tt * (1 - tt)` term gives a clean parabola (0→1→0).
      const arc = 4 * tt * (1 - tt);
      const wz = szw * (1 - tt) + arc * peakZ;
      points[i] = {
        sx: snapPx(wx * tileW),
        sy: snapPx(wy * tileH - wz * tileH)
      };
    }
    /**
     * Stroke the arc with per-segment jitter. `extraBias` shifts the whole polyline by a
     * perpendicular-to-chord offset so the forks land *beside* the main bolt without
     * manually rotating.
     */
    const drawArc = (amp, extraBias) => {
      ctx.beginPath();
      ctx.moveTo(points[0].sx, points[0].sy);
      for (let i = 1; i < segments; i++) {
        const a0 = points[i - 1];
        const a1 = points[i];
        // Perpendicular unit vector (screen space), used to push jitter off the tangent
        // so the wiggle reads perpendicular to the arc's local heading.
        const tx = a1.sx - a0.sx;
        const ty = a1.sy - a0.sy;
        const segLen = Math.hypot(tx, ty) || 1;
        const nxs = -ty / segLen;
        const nys = tx / segLen;
        // Sine taper pins the endpoints (0 and N) and maximises jitter near the middle.
        const tt = i / segments;
        const taper = Math.sin(tt * Math.PI);
        const off = ((Math.random() - 0.5) * 2 * amp + extraBias) * taper;
        ctx.lineTo(a1.sx + nxs * off, a1.sy + nys * off);
      }
      const last = points[segments];
      ctx.lineTo(last.sx, last.sy);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 1. Outer amber halo — source-over so the bolt reads on bright or dark backgrounds.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.34 * a;
    ctx.strokeStyle = '#ffc63a';
    ctx.lineWidth = Math.max(5.5, tileH * 0.24);
    drawArc(jagAmp * 1.1, 0);
    // 2. Warm yellow body (additive). Thinner jag than the halo so the two strokes don't
    //    perfectly overlap — reads as volumetric rather than a single fat line.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.78 * a;
    ctx.strokeStyle = '#ffe460';
    ctx.lineWidth = Math.max(2.6, tileH * 0.11);
    drawArc(jagAmp * 0.8, 0);
    // 3. Hot white core — narrow, crisp, makes the bolt pop through its own halo.
    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.3, tileH * 0.05);
    drawArc(jagAmp * 0.5, 0);
    // 4. Optional fork — a thin secondary bolt offset to one side. Gated on `jagSeed`
    //    so roughly 75% of frames get a fork (the dry frame keeps it from reading too
    //    "busy", like real photographed lightning).
    if ((p.jagSeed & 3) !== 0) {
      ctx.globalAlpha = 0.5 * a;
      ctx.strokeStyle = '#fff1a0';
      ctx.lineWidth = Math.max(1.3, tileH * 0.055);
      const forkOffset = (Math.random() - 0.5) * jagAmp * 1.7;
      drawArc(jagAmp * 0.85, forkOffset);
    }
    ctx.restore();
  } else if (p.type === 'steelBeamShot') {
    const ang = Math.atan2(p.vy || 0, p.vx || 1);
    if (p.laserStream) {
      if (!p.laserStreamHidePerProjectileBeam) {
        if (p.laserBeamGradient) {
          drawSteelStreamGradientBeam(ctx, p, tileW, tileH, snapPx, time);
        } else {
        const speed = Math.hypot(p.vx || 0, p.vy || 0);
        const lenPx = Math.max(16, Math.min(tileW * 2.55, tileW * (0.78 + speed * 0.03)));
        const th = Math.max(3.2, tileH * 0.085) * 7;
        const halfLen = lenPx * 0.5;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        const grd = ctx.createLinearGradient(-halfLen, 0, halfLen, 0);
        grd.addColorStop(0, 'rgba(190,200,215,0.35)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0.9)');
        grd.addColorStop(1, 'rgba(165,180,200,0.32)');
        const roundSteel = (halfH, arcR) => {
          ctx.beginPath();
          ctx.moveTo(-halfLen, -halfH);
          ctx.arc(-halfLen, 0, arcR, -Math.PI / 2, Math.PI / 2, true);
          ctx.lineTo(halfLen, halfH);
          ctx.lineTo(halfLen, -halfH);
          ctx.closePath();
        };
        const hh = th * 0.95;
        ctx.fillStyle = 'rgba(130,145,165,0.2)';
        roundSteel(hh, hh);
        ctx.fill();
        ctx.fillStyle = grd;
        roundSteel(th * 0.5, th * 0.5);
        ctx.fill();
        ctx.restore();
        }
      }
    } else {
      ctx.fillStyle = 'rgba(230,238,248,0.95)';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3.2, tileW * 0.13), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.type === 'waterCannonShot') {
    const ang = Math.atan2(p.vy || 0, p.vx || 1);
    if (p.laserStream) {
      if (!p.laserStreamHidePerProjectileBeam) {
        if (p.laserBeamGradient) {
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          drawWaterCannonStreamBeam(ctx, p, tileW, tileH, snapPx, time);
          ctx.restore();
        } else {
          const speed = Math.hypot(p.vx || 0, p.vy || 0);
          const lenPx = Math.max(16, Math.min(tileW * 2.65, tileW * (0.8 + speed * 0.028)));
          const th = Math.max(3.4, tileH * 0.09) * 6.2;
          const halfLen = lenPx * 0.5;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(ang);
          const grd = ctx.createLinearGradient(-halfLen, 0, halfLen, 0);
          grd.addColorStop(0, 'rgba(50,130,210,0.45)');
          grd.addColorStop(0.5, 'rgba(200,240,255,0.88)');
          grd.addColorStop(1, 'rgba(35,110,200,0.4)');
          const roundW = (halfH, arcR) => {
            ctx.beginPath();
            ctx.moveTo(-halfLen, -halfH);
            ctx.arc(-halfLen, 0, arcR, -Math.PI / 2, Math.PI / 2, true);
            ctx.lineTo(halfLen, halfH);
            ctx.lineTo(halfLen, -halfH);
            ctx.closePath();
          };
          ctx.fillStyle = 'rgba(40,100,180,0.22)';
          roundW(th * 0.92, th * 0.92);
          ctx.fill();
          ctx.fillStyle = grd;
          roundW(th * 0.48, th * 0.48);
          ctx.fill();
          ctx.restore();
        }
      }
    } else {
      ctx.fillStyle = 'rgba(200, 235, 255, 0.92)';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3.2, tileW * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.type === 'prismaticShot') {
    const ang = Math.atan2(p.vy || 0, p.vx || 1);
    if (p.laserStream) {
      if (!p.laserStreamHidePerProjectileBeam) {
        if (p.laserBeamGradient) {
          drawPrismaticStreamGradientBeam(ctx, p, tileW, tileH, snapPx, time);
        } else {
        const speed = Math.hypot(p.vx || 0, p.vy || 0);
        const lenPx = Math.max(14, Math.min(tileW * 2.35, tileW * (0.72 + speed * 0.028)));
        const th = Math.max(2.2, tileH * 0.055);
        const halfLen = lenPx * 0.5;
        const hueBase = (Number(p.rainbowHue0) || 0) + time * 220;
        const h0 = hueBase % 360;
        const h1 = (hueBase + 72) % 360;
        const h2 = (hueBase + 144) % 360;
        const h3 = (hueBase + 216) % 360;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        const grd = ctx.createLinearGradient(-halfLen, 0, halfLen, 0);
        grd.addColorStop(0, `hsla(${h0}, 100%, 62%, 0.28)`);
        grd.addColorStop(0.28, `hsla(${h1}, 100%, 56%, 0.95)`);
        grd.addColorStop(0.52, `hsla(${h2}, 100%, 60%, 0.98)`);
        grd.addColorStop(0.76, `hsla(${h3}, 100%, 58%, 0.92)`);
        grd.addColorStop(1, `hsla(${(h0 + 200) % 360}, 95%, 58%, 0.26)`);
        ctx.fillStyle = `hsla(${(h1 + 40) % 360}, 100%, 60%, 0.16)`;
        ctx.fillRect(-halfLen, -th * 0.92, lenPx, th * 1.84);
        ctx.fillStyle = grd;
        ctx.fillRect(-halfLen, -th * 0.5, lenPx, th);
        ctx.strokeStyle = `hsla(${(h2 + 30) % 360}, 100%, 78%, 0.5)`;
        ctx.lineWidth = Math.max(1.1, tileW * 0.02);
        ctx.strokeRect(-halfLen, -th * 0.5, lenPx, th);
        const midPx = px;
        const midPy = py;
        const lenP2 = lenPx;
        const gate2 =
          0.5 * Math.sin(time * 44 + midPx * 0.05 + midPy * 0.04) +
          0.35 * Math.sin(time * 71 + lenP2 * 0.015);
        const strobe2 = (Math.floor(time * 13.7 + midPx * 0.08) & 1) === 0;
        const on2 = strobe2 && gate2 > -0.08;
        const burst2 = Math.max(0, Math.sin(time * 88 + midPy * 0.06)) ** 3;
        const whiteA2 = on2 ? Math.min(0.97, 0.58 + 0.38 * burst2 + 0.12 * Math.max(0, gate2)) : 0.02 + 0.04 * burst2;
        const coreH2 = th * (on2 ? 0.18 + 0.12 * burst2 : 0.09);
        ctx.fillStyle = `rgba(255,255,255,${whiteA2})`;
        ctx.fillRect(-halfLen, -coreH2 * 0.5, lenPx, coreH2);
        ctx.restore();
        }
      }
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
