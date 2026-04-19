/**
 * Dedicated volumetric-style weather particle layer (rain / snow / sand).
 * Separate pool from combat `moves-manager` particles — fixed cap, LOD + last-frame
 * timing feedback for adaptive spawn budget.
 */

import { getWindVelocityTilesPerSec, WIND_CLOUD_BLEND_BASELINE_DIR_RAD } from '../main/wind-state.js';
import {
  getWeatherSurfaceMaterialCached,
  WEATHER_SURFACE_HARD,
  worldPixelToMicroTile
} from './weather-surface-material.js';
import { getLastRenderFrameBreakdown } from '../render/render-frame-phases.js';

/** @typedef {import('../main/weather-presets.js').VolumetricWeatherMode} VolumetricWeatherMode */

const MAX_PART = 500;
const MAX_SPL = 160;

/** @type {Array<{ alive: number, x: number, y: number, vx: number, vy: number, life: number, kind: number }>} */
let parts = [];
/** @type {Array<{ alive: number, x: number, y: number, vx: number, vy: number, life: number, r: number }>} */
let splashes = [];

const surfaceFrameCache = new Map();
let lastSimTimeSec = -1;

function ensurePools() {
  if (parts.length >= MAX_PART) return;
  for (let i = parts.length; i < MAX_PART; i++) {
    parts.push({ alive: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, kind: 0 });
  }
  for (let i = splashes.length; i < MAX_SPL; i++) {
    splashes.push({ alive: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, r: 0 });
  }
}

export function resetVolumetricWeatherParticles() {
  parts.length = 0;
  splashes.length = 0;
  ensurePools();
  for (const p of parts) p.alive = 0;
  for (const s of splashes) s.alive = 0;
  lastSimTimeSec = -1;
}

ensurePools();

function allocPart() {
  for (let i = 0; i < MAX_PART; i++) {
    if (!parts[i].alive) return parts[i];
  }
  return null;
}

function allocSplash() {
  for (let i = 0; i < MAX_SPL; i++) {
    if (!splashes[i].alive) return splashes[i];
  }
  return null;
}

function countAlivePart() {
  let n = 0;
  for (let i = 0; i < MAX_PART; i++) if (parts[i].alive) n++;
  return n;
}

function adaptiveQualityMul() {
  try {
    const b = getLastRenderFrameBreakdown();
    const v = Number(b?.rndVolumetricWeatherMs) || 0;
    if (v > 3.2) return 0.5;
    if (v > 2.0) return 0.68;
    if (v > 1.25) return 0.82;
  } catch (_) {
    /* ignore */
  }
  return 1;
}

function spawnSplash(px, py, splashBias01, tw) {
  const s = allocSplash();
  if (!s) return;
  const b = Math.max(0, Math.min(1, splashBias01));
  s.alive = 1;
  s.x = px;
  s.y = py;
  const spread = 18 + 26 * b;
  s.vx = (Math.random() - 0.5) * spread;
  s.vy = -(40 + 70 * Math.random() * b);
  s.life = 0.1 + 0.11 * b;
  s.r = (2.2 + 3.8 * b) * Math.max(0.85, tw / 32);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 * @param {number} opts.timeSec
 * @param {number} opts.tileW
 * @param {number} opts.tileH
 * @param {number} opts.startX
 * @param {number} opts.startY
 * @param {number} opts.endX
 * @param {number} opts.endY
 * @param {number} opts.windDirRad
 * @param {number} opts.windIntensity01
 * @param {number} opts.lodDetail
 * @param {object} opts.macroData — map data for surface sampling
 * @param {number} opts.rainVisualI — 0..1 rain channel (existing renderer share)
 * @param {number} opts.snowVisualI — 0..1 snow channel
 * @param {number} opts.sandstormVisualI — 0..1 sand channel
 * @param {number} opts.volumetricParticleDensity
 * @param {number} opts.volumetricVolumeDepth
 * @param {number} opts.volumetricFallSpeed
 * @param {number} opts.volumetricWindCarry
 * @param {number} opts.volumetricTurbulence
 * @param {number} opts.volumetricAbsorptionBias
 * @param {number} opts.volumetricSplashBias
 * @param {VolumetricWeatherMode} [opts.weatherMode]
 */
export function updateAndDrawVolumetricWeatherParticles(ctx, opts) {
  const {
    timeSec,
    tileW,
    tileH,
    startX,
    startY,
    endX,
    endY,
    windDirRad,
    windIntensity01,
    lodDetail = 0,
    macroData,
    rainVisualI = 0,
    snowVisualI = 0,
    sandstormVisualI = 0,
    volumetricParticleDensity = 0,
    volumetricVolumeDepth = 0.5,
    volumetricFallSpeed = 0.5,
    volumetricWindCarry = 0.5,
    volumetricTurbulence = 0.2,
    volumetricAbsorptionBias = 0.5,
    volumetricSplashBias = 0.5
  } = opts;

  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const tw = Math.max(1, Number(tileW) || 32);
  const th = Math.max(1, Number(tileH) || tw);
  const wx0 = Number(startX) * tw;
  const wy0 = Number(startY) * th;
  const worldW = Math.max(1, (Number(endX) - Number(startX)) * tw);
  const worldH = Math.max(1, (Number(endY) - Number(startY)) * th);

  const volD = Math.max(0, Math.min(1, Number(volumetricParticleDensity) || 0));
  const rainCh = Math.max(0, Math.min(1, Number(rainVisualI) || 0)) * volD;
  const snowCh = Math.max(0, Math.min(1, Number(snowVisualI) || 0)) * volD;
  const sandCh = Math.max(0, Math.min(1, Number(sandstormVisualI) || 0)) * volD;
  const precip = Math.max(rainCh, snowCh, sandCh);
  if (!macroData || precip < 0.012) {
    lastSimTimeSec = time;
    for (let i = 0; i < MAX_PART; i++) parts[i].alive = 0;
    for (let i = 0; i < MAX_SPL; i++) splashes[i].alive = 0;
    return;
  }

  const dtRaw = lastSimTimeSec >= 0 ? time - lastSimTimeSec : 0;
  let dt = !Number.isFinite(dtRaw) || dtRaw < 0 || dtRaw > 0.22 ? 0 : dtRaw;
  lastSimTimeSec = time;
  if (dt <= 0) dt = 1 / 60;

  surfaceFrameCache.clear();

  const lod = Number(lodDetail) || 0;
  const lodSpawnMul = lod >= 2 ? 0.42 : lod >= 1 ? 0.68 : 1;
  const qMul = adaptiveQualityMul() * lodSpawnMul;

  const windI01 = Math.max(0, Math.min(1, Number(windIntensity01) || 0));
  const liveDir = Number.isFinite(windDirRad) ? windDirRad : WIND_CLOUD_BLEND_BASELINE_DIR_RAD;
  const wTiles = getWindVelocityTilesPerSec(windI01, liveDir);
  const windCarry = Math.max(0, Math.min(1, Number(volumetricWindCarry) || 0));
  const kWind = 34 * windCarry;
  const windVx = wTiles.vx * tw * kWind;
  const windVy = wTiles.vy * th * kWind;

  const fallS = Math.max(0.08, Math.min(1, Number(volumetricFallSpeed) || 0.5));
  const turb = Math.max(0, Math.min(1, Number(volumetricTurbulence) || 0));
  const depth01 = Math.max(0.05, Math.min(1, Number(volumetricVolumeDepth) || 0.5));
  const absorbB = Math.max(0, Math.min(1, Number(volumetricAbsorptionBias) || 0));
  const splashB = Math.max(0, Math.min(1, Number(volumetricSplashBias) || 0));

  const sumCh = rainCh + snowCh + sandCh + 1e-6;
  const wRain = rainCh / sumCh;
  const wSnow = snowCh / sumCh;
  const wSand = sandCh / sumCh;

  const maxActive = Math.floor(MAX_PART * (0.28 + 0.72 * precip) * qMul);
  const active = countAlivePart();
  const deficit = maxActive - active;
  const spawnBudget = Math.max(0, Math.min(14, Math.floor(deficit * 0.35 + precip * 6 * qMul)));

  const marginX = tw * (6 + 10 * depth01);
  const marginY = th * (8 + 14 * depth01);
  const xMin = wx0 - marginX;
  const xMax = wx0 + worldW + marginX;
  const yMin = wy0 - marginY * (0.6 + 0.5 * depth01);
  const ySpawnHi = wy0 - marginY * 0.15;

  const pickKind = () => {
    const r = Math.random();
    if (r < wRain) return 0;
    if (r < wRain + wSnow) return 1;
    return 2;
  };

  for (let n = 0; n < spawnBudget; n++) {
    const p = allocPart();
    if (!p) break;
    const kind = pickKind();
    p.alive = 1;
    p.kind = kind;
    p.x = xMin + Math.random() * (xMax - xMin);
    p.y = yMin + Math.random() * (ySpawnHi - yMin);
    const fallMul = fallS * (0.55 + 0.45 * Math.random());
    if (kind === 0) {
      p.vy = (180 + 220 * rainCh) * fallMul;
      p.vx = windVx * (0.35 + 0.65 * Math.random());
    } else if (kind === 1) {
      p.vy = (28 + 55 * snowCh) * fallMul;
      p.vx = windVx * (0.55 + 0.45 * Math.random());
    } else {
      p.vy = (10 + 38 * sandCh) * fallMul;
      p.vx = windVx * (0.65 + 0.5 * Math.random()) + (Math.random() - 0.5) * 18;
    }
    p.life = 2.2 + 3.8 * Math.random();
  }

  const turbPx = 26 * turb;

  for (let i = 0; i < MAX_PART; i++) {
    const p = parts[i];
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = 0;
      continue;
    }

    const ox = Math.sin(time * (2.1 + p.kind * 0.4) + i * 0.31) * turbPx * dt;
    const oy = Math.cos(time * (1.7 + p.kind * 0.3) + i * 0.27) * turbPx * 0.35 * dt;

    p.vx += windVx * 0.08 * dt;
    p.vy += (p.kind === 1 ? 35 : p.kind === 2 ? 12 : 140) * fallS * dt;

    p.x += (p.vx + ox) * dt;
    p.y += (p.vy + oy) * dt;

    const { mx, my } = worldPixelToMicroTile(p.x, p.y, tw, th);
    const groundY = (my + 1) * th - Math.max(1, th * 0.08);

    if (p.y >= groundY) {
      const surf = getWeatherSurfaceMaterialCached(mx, my, macroData, surfaceFrameCache);
      if (surf === WEATHER_SURFACE_HARD) {
        const splashChance = Math.max(0.08, Math.min(0.98, 0.35 + 0.55 * splashB - 0.22 * absorbB));
        const doSplash = Math.random() < splashChance;
        if (doSplash && p.kind === 0) spawnSplash(p.x, groundY, splashB, tw);
        else if (doSplash && p.kind === 1 && Math.random() < 0.25 + 0.35 * splashB) {
          spawnSplash(p.x, groundY, splashB * 0.55, tw);
        } else if (doSplash && p.kind === 2 && Math.random() < 0.2) {
          spawnSplash(p.x, groundY, splashB * 0.35, tw);
        }
      }
      p.alive = 0;
    } else if (p.x < xMin - tw * 4 || p.x > xMax + tw * 4 || p.y > wy0 + worldH + th * 10) {
      p.alive = 0;
    }
  }

  for (let i = 0; i < MAX_SPL; i++) {
    const s = splashes[i];
    if (!s.alive) continue;
    s.life -= dt;
    if (s.life <= 0) {
      s.alive = 0;
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 220 * dt;
  }

  ctx.save();
  const prevAlpha = ctx.globalAlpha;
  const prevComp = ctx.globalCompositeOperation;

  for (let i = 0; i < MAX_PART; i++) {
    const p = parts[i];
    if (!p.alive) continue;
    if (p.kind === 0) {
      ctx.globalAlpha = 0.22 + 0.28 * rainCh;
      ctx.strokeStyle = 'rgba(200, 215, 245, 0.95)';
      ctx.lineWidth = Math.max(1, 1.15 * (tw / 32));
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const dropLen = (10 + 16 * rainCh) * (tw / 32);
      ctx.lineTo(p.x - windVx * 0.006 - dropLen * 0.08, p.y - dropLen);
      ctx.stroke();
    } else if (p.kind === 1) {
      ctx.globalAlpha = 0.35 + 0.35 * snowCh;
      ctx.fillStyle = 'rgba(248, 252, 255, 0.92)';
      const rr = (1.1 + 1.6 * snowCh) * (tw / 32);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rr, rr * 0.86, 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.18 + 0.32 * sandCh;
      ctx.fillStyle = 'rgba(200, 160, 110, 0.85)';
      const w = 1.8 * (tw / 32);
      const h = 1.1 * (tw / 32);
      ctx.fillRect(p.x - w * 0.5, p.y - h * 0.5, w, h);
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < MAX_SPL; i++) {
    const s = splashes[i];
    if (!s.alive) continue;
    const u = s.life / 0.22;
    ctx.globalAlpha = 0.14 + 0.32 * u * splashB;
    ctx.fillStyle = 'rgba(210, 225, 250, 0.9)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * (1.6 - u), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = prevComp;
  ctx.globalAlpha = prevAlpha;
  ctx.restore();
}

/**
 * Full-screen warm haze for sandstorm (multiply-friendly). Caller sets ctx transform to screen if needed.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 * @param {number} intensity01
 */
export function drawSandstormVolumetricHaze(ctx, cw, ch, intensity01) {
  const t = Math.max(0, Math.min(1, Number(intensity01) || 0));
  if (t < 0.04) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createLinearGradient(0, 0, cw, ch * 0.7);
  g.addColorStop(0, `rgba(210, 175, 120, ${0.08 + 0.2 * t})`);
  g.addColorStop(1, `rgba(160, 120, 78, ${0.12 + 0.22 * t})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.12 + 0.2 * t;
  ctx.fillStyle = `rgba(230, 200, 140, ${0.15 + 0.15 * t})`;
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}
