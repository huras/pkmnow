/**
 * Dedicated volumetric-style weather particle layer (rain / snow / sand).
 * High-performance overhaul with Z-depth layering, batched rendering,
 * and texture-based volumetric haze.
 */

import { getWindVelocityTilesPerSec, WIND_CLOUD_BLEND_BASELINE_DIR_RAD } from '../main/wind-state.js';
import {
  getWeatherSurfaceMaterialCached,
  WEATHER_SURFACE_HARD,
  WEATHER_SURFACE_NEUTRAL,
  worldPixelToMicroTile
} from './weather-surface-material.js';
import { getLastRenderFrameBreakdown } from '../render/render-frame-phases.js';
import { imageCache } from '../image-cache.js';

/** @typedef {import('../main/weather-presets.js').VolumetricWeatherMode} VolumetricWeatherMode */

// --- Constants & Config ---
const MAX_PART = 2000; // Increased for high-performance demo
const MAX_SPL = 300;
const MAX_RING = 640;  // Expanding ground ripples (high-capacity pool for heavy rain)
const Z_LAYERS = 3;    // Background, Midground, Foreground

/** 
 * Particle Structure
 * @type {Array<{ alive: number, x: number, y: number, z: number, vx: number, vy: number, life: number, kind: number, size: number, alpha: number }>} 
 */
let parts = [];
/** @type {Array<{ alive: number, x: number, y: number, vx: number, vy: number, life: number, r: number, alpha: number }>} */
let splashes = [];
/** @type {Array<{ alive: number, x: number, y: number, life: number, r: number, maxR: number, alpha: number }>} */
let rings = [];

const surfaceFrameCache = new Map();
let lastSimTimeSec = -1;
let fogTexture = null;

function snapStrokePx(v) {
  return Math.round(Number(v) || 0) + 0.5;
}

// --- Initialization ---

function ensurePools() {
  if (parts.length >= MAX_PART) return;
  for (let i = parts.length; i < MAX_PART; i++) {
    parts.push({ alive: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, kind: 0, size: 1, alpha: 1 });
  }
  for (let i = splashes.length; i < MAX_SPL; i++) {
    splashes.push({ alive: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, r: 0, alpha: 1 });
  }
  for (let i = rings.length; i < MAX_RING; i++) {
    rings.push({ alive: 0, x: 0, y: 0, life: 0, r: 0, maxR: 4, alpha: 1 });
  }
}

export function resetVolumetricWeatherParticles() {
  parts.length = 0;
  splashes.length = 0;
  rings.length = 0;
  ensurePools();
  for (const p of parts) p.alive = 0;
  for (const s of splashes) s.alive = 0;
  for (const r of rings) r.alive = 0;
  lastSimTimeSec = -1;
}

ensurePools();

/** Loads the volumetric fog texture generated for this system. */
async function ensureFogTexture() {
  if (fogTexture) return fogTexture;
  // Note: Path is relative to the environment or pre-loaded in imageCache
  const path = 'volumetric_fog_texture_1776622118170.png'; 
  if (imageCache.has(path)) {
    fogTexture = imageCache.get(path);
    return fogTexture;
  }
  
  // Fallback: load if not in cache (though usually pre-loaded in a real app)
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      fogTexture = img;
      imageCache.set(path, img);
      resolve(img);
    };
    img.onerror = () => {
      // If texture fails, we'll use procedural fallback
      fogTexture = 'FAILED';
      resolve(null);
    };
    img.src = 'js/weather/' + path; // Adjusted path
  });
}

// Kick off loading
ensureFogTexture();

// --- Pool Management ---

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

function allocRing() {
  for (let i = 0; i < MAX_RING; i++) {
    if (!rings[i].alive) return rings[i];
  }
  return null;
}

function adaptiveQualityMul() {
  try {
    const b = getLastRenderFrameBreakdown();
    const v = Number(b?.rndVolumetricWeatherMs) || 0;
    // High-performance targets: be more aggressive if under load
    if (v > 4.0) return 0.4;
    if (v > 2.5) return 0.7;
  } catch (_) {}
  return 1;
}

function spawnSplash(px, py, splashBias01, tw) {
  const s = allocSplash();
  if (!s) return;
  const b = Math.max(0, Math.min(1, splashBias01));
  s.alive = 1;
  s.x = px;
  s.y = py;
  const spread = 20 + 30 * b;
  s.vx = (Math.random() - 0.5) * spread;
  s.vy = -(50 + 80 * Math.random() * b);
  s.life = 0.15 + 0.15 * b;
  s.r = (1.5 + 2.5 * b) * (tw / 32);
  s.alpha = 0.6 + 0.4 * b;
}

function spawnGroundRing(px, py, tw, jitterPx = 0) {
  const r = allocRing();
  if (!r) return;
  const ang = Math.random() * Math.PI * 2;
  const jr = Math.random() * Math.max(0, jitterPx);
  r.alive = 1;
  r.x = snapStrokePx(px + Math.cos(ang) * jr);
  r.y = snapStrokePx(py + Math.sin(ang) * jr);
  r.life = 0.22 + Math.random() * 0.26;
  r.r = 1.1 + Math.random() * 0.7;
  r.maxR = (4 + 8 * Math.random()) * (tw / 32);
  r.alpha = 0.4 + 0.5 * Math.random();
}

function spawnRainGroundRings(px, py, tw, rainCh, splashBias01, qMul) {
  // Heavy rain should feel denser on the ground, but quality scaling keeps it cheap under load.
  const rainI = Math.max(0, Math.min(1, Number(rainCh) || 0));
  const splashI = Math.max(0, Math.min(1, Number(splashBias01) || 0));
  const qual = Math.max(0.35, Math.min(1, Number(qMul) || 1));
  const expected =
    (0.18 + 1.65 * rainI) *
    (0.55 + 0.45 * splashI) *
    qual;
  let count = Math.floor(expected);
  if (Math.random() < expected - count) count++;
  if (count < 1) return;
  if (count > 3) count = 3;
  const jitterPx = Math.max(1, tw * 0.24);
  for (let i = 0; i < count; i++) {
    spawnGroundRing(px, py, tw, jitterPx);
  }
}

function spawnAmbientRainGroundRings(
  wx0,
  wy0,
  worldW,
  worldH,
  tw,
  th,
  dt,
  rainCh,
  splashBias01,
  qMul,
  macroData,
  surfaceFrameCache
) {
  const rainI = Math.max(0, Math.min(1, Number(rainCh) || 0));
  if (rainI < 0.02) return;
  const rainBoost = Math.sqrt(rainI);
  const splashI = Math.max(0, Math.min(1, Number(splashBias01) || 0));
  const qual = Math.max(0.35, Math.min(1, Number(qMul) || 1));
  const dtSec = Math.max(0, Math.min(0.12, Number(dt) || 0));
  if (dtSec <= 0) return;
  // Camera-size normalization keeps cadence similar across view scales.
  const viewAreaNorm = Math.max(0.55, Math.min(1.75, (worldW * worldH) / (1280 * 720)));
  const ringsPerSec =
    (220 + 980 * rainBoost) *
    (0.72 + 0.28 * splashI) *
    qual *
    viewAreaNorm;
  const expected = ringsPerSec * dtSec;
  let count = Math.floor(expected);
  if (Math.random() < expected - count) count++;
  if (count < 1) return;
  if (count > 160) count = 160;
  if (!macroData) return;
  const minMx = Math.floor(wx0 / tw);
  const maxMx = Math.max(minMx, Math.ceil((wx0 + worldW) / tw) - 1);
  const minMy = Math.floor(wy0 / th);
  const maxMy = Math.max(minMy, Math.ceil((wy0 + worldH) / th) - 1);
  const spanMx = Math.max(1, maxMx - minMx + 1);
  const spanMy = Math.max(1, maxMy - minMy + 1);
  const jitterPx = Math.max(1, tw * 0.2);
  for (let i = 0; i < count; i++) {
    const mx = minMx + ((Math.random() * spanMx) | 0);
    const my = minMy + ((Math.random() * spanMy) | 0);
    // Anchor to the tile's floor line so rings stay glued to the ground plane even during jump camera motion.
    const px = (mx + 0.14 + Math.random() * 0.72) * tw;
    const py = (my + 1) * th;
    // Ambient fake should be visible on any terrain type; precision is intentionally low-cost.
    spawnGroundRing(px, py, tw, jitterPx);
  }
}

// --- Main Loop & Draw ---

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 */
export function updateAndDrawVolumetricWeatherParticles(ctx, opts) {
  const {
    timeSec, tileW, tileH, startX, startY, endX, endY,
    windDirRad, windIntensity01, lodDetail = 0, macroData,
    rainVisualI = 0, snowVisualI = 0, sandstormVisualI = 0,
    volumetricParticleDensity = 0, volumetricVolumeDepth = 0.5,
    volumetricFallSpeed = 0.5, volumetricWindCarry = 0.5,
    volumetricTurbulence = 0.2, volumetricAbsorptionBias = 0.5,
    volumetricSplashBias = 0.5
  } = opts;

  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const tw = Math.max(1, Number(tileW) || 32);
  const th = Math.max(1, Number(tileH) || tw);
  const wx0 = Number(startX) * tw;
  const wy0 = Number(startY) * th;
  const worldW = (Number(endX) - Number(startX)) * tw;
  const worldH = (Number(endY) - Number(startY)) * th;

  const volD = Math.max(0, Math.min(1, Number(volumetricParticleDensity) || 0));
  const rainCh = rainVisualI * volD;
  const snowCh = snowVisualI * volD;
  const sandCh = sandstormVisualI * volD;
  const precip = Math.max(rainCh, snowCh, sandCh);

  // Exit if no weather or missing data
  if (!macroData || precip < 0.01) {
    lastSimTimeSec = time;
    for (let i = 0; i < MAX_PART; i++) parts[i].alive = 0;
    for (let i = 0; i < MAX_SPL; i++) splashes[i].alive = 0;
    return;
  }

  const dtRaw = lastSimTimeSec >= 0 ? time - lastSimTimeSec : 0;
  const dt = (dtRaw > 0 && dtRaw < 0.2) ? dtRaw : 1 / 60;
  lastSimTimeSec = time;

  surfaceFrameCache.clear();

  const qMul = adaptiveQualityMul() * (lodDetail >= 2 ? 0.4 : lodDetail >= 1 ? 0.7 : 1);
  const windI01 = Math.max(0, Math.min(1, Number(windIntensity01) || 0));
  const liveDir = Number.isFinite(windDirRad) ? windDirRad : WIND_CLOUD_BLEND_BASELINE_DIR_RAD;
  const wTiles = getWindVelocityTilesPerSec(windI01, liveDir);
  const windCarry = Math.max(0, Math.min(1, Number(volumetricWindCarry) || 0));
  const windVx = wTiles.vx * tw * 35 * windCarry;
  const windVy = wTiles.vy * th * 35 * windCarry;

  const fallS = Math.max(0.1, Number(volumetricFallSpeed) || 0.5);
  const turb = Math.max(0, Number(volumetricTurbulence) || 0.2);
  const depthB = Math.max(0.1, Number(volumetricVolumeDepth) || 0.5);

  // Spawn logic
  const maxActive = Math.floor(MAX_PART * precip * qMul);
  let currentlyAlive = 0;
  for (let i = 0; i < MAX_PART; i++) if (parts[i].alive) currentlyAlive++;
  
  const spawnCount = Math.min(25, Math.floor((maxActive - currentlyAlive) * 0.4));
  
  const wTotal = rainCh + snowCh + sandCh + 0.001;
  const pRain = rainCh / wTotal;
  const pSnow = snowCh / wTotal;

  for (let n = 0; n < spawnCount; n++) {
    const p = allocPart();
    if (!p) break;
    p.alive = 1;
    
    // Determine type: rain (0), snow (1), sand (2), wind streak (3)
    let k = 0;
    const r = Math.random();
    // Wind streaks spawn based on wind intensity, even if no precip, but we need precip > 0.01 to enter the loop
    const pWind = windI01 > 0.1 ? 0.05 + 0.15 * windI01 : 0;
    const norm = pRain + pSnow + pWind + 0.001;
    const threshRain = pRain / norm;
    const threshSnow = threshRain + pSnow / norm;
    const threshWind = threshSnow + pWind / norm;
    
    if (r < threshRain) k = 0;
    else if (r < threshSnow) k = 1;
    else if (r < threshWind) k = 3;
    else k = 2; // Sand

    p.kind = k;
    p.z = Math.random(); // 0 = far, 1 = near
    p.x = wx0 - 200 + Math.random() * (worldW + 400);
    p.y = wy0 - 100 + Math.random() * 200;
    p.life = 1.5 + Math.random() * 2.5;
    
    // Base physics by kind
    if (p.kind === 0) { // Rain
      p.vy = (200 + 300 * rainCh) * fallS;
      p.vx = windVx * (0.8 + 0.4 * Math.random());
    } else if (p.kind === 1) { // Snow
      p.vy = (40 + 60 * snowCh) * fallS;
      p.vx = windVx * (0.6 + 0.8 * Math.random());
    } else if (p.kind === 2) { // Sand
      p.vy = (15 + 40 * sandCh) * fallS;
      p.vx = windVx * (1.2 + 0.5 * Math.random());
    } else { // Wind streak (kind 3)
      p.vy = windVy * (1.5 + Math.random());
      p.vx = windVx * (1.5 + Math.random());
      p.life = 0.5 + Math.random() * 1.5; // Shorter life for streaks
    }
  }

  // Simulation
  const turbAmp = turb * 40;
  for (let i = 0; i < MAX_PART; i++) {
    const p = parts[i];
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) { p.alive = 0; continue; }

    // Parallax & Wind
    const zScale = 0.5 + p.z * 1.5; // Closer objects move faster and are larger
    const pTurbX = Math.sin(time * 3 + i) * turbAmp * zScale;
    const pTurbY = Math.cos(time * 2 + i) * turbAmp * 0.5 * zScale;

    p.x += (p.vx * zScale + pTurbX) * dt;
    p.y += (p.vy * zScale + pTurbY) * dt;

    // Collision (Soft Ground)
    const { mx, my } = worldPixelToMicroTile(p.x, p.y, tw, th);
    const groundY = (my + 1) * th;
    
    if (p.y > groundY - 2 && p.kind !== 3) {
      const surf = getWeatherSurfaceMaterialCached(mx, my, macroData, surfaceFrameCache);
      if (surf === WEATHER_SURFACE_HARD) {
        if (p.kind === 0) {
           if (Math.random() < 0.4 * volumetricSplashBias) {
             spawnSplash(p.x, groundY, volumetricSplashBias, tw);
           }
           // Ground rings (pingos) — denser in heavy rain, bounded for performance.
           spawnRainGroundRings(p.x, groundY, tw, rainCh, volumetricSplashBias, qMul);
        }
      }
      p.alive = 0;
    }

    // Bounds check
    if (p.x < wx0 - 400 || p.x > wx0 + worldW + 400 || p.y > wy0 + worldH + 200) {
      p.alive = 0;
    }
  }

  // Splash Simulation
  for (let i = 0; i < MAX_SPL; i++) {
    const s = splashes[i];
    if (!s.alive) continue;
    s.life -= dt;
    if (s.life <= 0) { s.alive = 0; continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 400 * dt;
    s.alpha *= 0.92;
  }

  // Ring Simulation
  for (let i = 0; i < MAX_RING; i++) {
    const r = rings[i];
    if (!r.alive) continue;
    r.life -= dt;
    if (r.life <= 0) { r.alive = 0; continue; }
    // Expand and fade
    const u = 1 - r.life / 0.7; // 0..1
    r.r += (r.maxR - r.r) * 0.15;
    r.alpha *= 0.94;
  }

  // Ambient "rain hitting ground" pass (cheap fake): does not require per-drop collision precision.
  spawnAmbientRainGroundRings(
    wx0,
    wy0,
    worldW,
    worldH,
    tw,
    th,
    dt,
    rainCh,
    volumetricSplashBias,
    qMul,
    macroData,
    surfaceFrameCache
  );

  // --- RENDERING ---
  ctx.save();
  
  // 1. Volumetric Haze / Fog Layer (The "Beauty" pass)
  drawVolumetricFog(ctx, wx0, wy0, worldW, worldH, time, precip, sandCh);

  // 2. Batched Particles by Z-Layer
  const bins = [[], [], []];
  for (let i = 0; i < MAX_PART; i++) {
    if (parts[i].alive) {
      const b = Math.min(Z_LAYERS - 1, Math.floor(parts[i].z * Z_LAYERS));
      bins[b].push(parts[i]);
    }
  }

  bins.forEach((bin, bIdx) => {
    const zFac = 0.5 + (bIdx / Z_LAYERS) * 1.5;
    ctx.globalAlpha = Math.min(1, (0.3 + 0.7 * (bIdx / Z_LAYERS)) * precip);
    
    // Draw each kind in batch
    [0, 1, 2, 3].forEach(kind => {
      ctx.beginPath();
      bin.filter(p => p.kind === kind).forEach(p => {
        if (kind === 0) { // Rain
          const len = (12 + 15 * rainCh) * zFac;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.015, p.y - len);
        } else if (kind === 1) { // Snow
          const r = (1.5 + 2 * snowCh) * zFac;
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        } else if (kind === 2) { // Sand
          const w = 2 * zFac;
          ctx.rect(p.x - w / 2, p.y - w / 2, w, w);
        } else if (kind === 3) { // Wind Streak (Wind Waker Style)
          const dx = p.vx * 0.08; 
          const dy = p.vy * 0.08;
          const len = Math.hypot(dx, dy);
          if (len < 0.1) return;
          const nx = -dy / len;
          const ny = dx / len;
          
          const segments = 12;
          const lifeFade = Math.sin(Math.min(1, p.life) * Math.PI);
          const baseWidth = 4 * zFac;

          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          
          for (let s = 1; s <= segments; s++) {
            const u = s / segments;
            const px = p.x - dx * u * 12; 
            const py = p.y - dy * u * 12;
            
            // Zelda-style "Swirl/Sweep" math
            const swirl = Math.sin(time * 4 + p.x * 0.005 + u * 2.5) * (15 * zFac * u) * lifeFade;
            const tx = px + nx * swirl;
            const ty = py + ny * swirl;
            
            ctx.lineWidth = baseWidth * (1 - u * 0.8); // Tapering
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 * lifeFade * (1 - u)})`;
            ctx.lineTo(tx, ty);
            ctx.stroke(); // Draw segment by segment for tapering
            ctx.beginPath();
            ctx.moveTo(tx, ty);
          }
        }
      });
      
      if (kind === 0) {
        ctx.strokeStyle = 'rgba(180, 210, 255, 0.6)';
        ctx.lineWidth = 1 * zFac;
        ctx.stroke();
      } else if (kind === 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fill();
      } else if (kind === 2) {
        ctx.fillStyle = 'rgba(210, 180, 120, 0.5)';
        ctx.fill();
      }
      // kind 3 is handled per-segment for tapering
    });
  });

  // 3. Splashes
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  for (let i = 0; i < MAX_SPL; i++) {
    const s = splashes[i];
    if (!s.alive) continue;
    ctx.moveTo(s.x + s.r, s.y);
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  }
  ctx.fillStyle = 'rgba(200, 230, 255, 0.3)';
  ctx.fill();

  // 4. Ground Rings (Pingos) batched by alpha bands to keep draw calls low.
  ctx.globalCompositeOperation = 'lighter';
  const ringAlphaBands = [0.16, 0.25, 0.26, 0.48];
  const ringBandPaths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  for (let i = 0; i < MAX_RING; i++) {
    const r = rings[i];
    if (!r.alive) continue;
    const rx = snapStrokePx(r.x);
    const ry = snapStrokePx(r.y);
    const rr = Math.max(0.8, Math.round(r.r * 2) / 2);
    let band = 0;
    if (r.alpha >= 0.62) band = 3;
    else if (r.alpha >= 0.46) band = 2;
    else if (r.alpha >= 0.3) band = 1;
    ringBandPaths[band].moveTo(rx + rr, ry);
    ringBandPaths[band].arc(rx, ry, rr, 0, Math.PI * 2);
  }
  ctx.lineWidth = 1;
  for (let b = 0; b < ringBandPaths.length; b++) {
    ctx.globalAlpha = ringAlphaBands[b];
    ctx.strokeStyle = 'rgba(210, 235, 255, 0.95)';
    ctx.stroke(ringBandPaths[b]);
  }

  ctx.restore();
}

/** 
 * Beautiful volumetric haze using the noise texture or procedural fallback.
 */
function drawVolumetricFog(ctx, x, y, w, h, time, precip, sandCh) {
  const intensity = precip * 0.4;
  if (intensity < 0.05) return;

  ctx.save();
  ctx.globalAlpha = intensity;
  
  if (fogTexture && fogTexture !== 'FAILED') {
    // Texture-based high-fidelity fog
    const scrollX = time * 20;
    const scrollY = Math.sin(time * 0.5) * 10;
    
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    
    // Draw two layers of scrolling noise for "volumetric" depth
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(fogTexture, (x - scrollX) % 512, y + scrollY, 512, 512, x, y, w, h);
    ctx.globalAlpha *= 0.5;
    ctx.drawImage(fogTexture, (x + scrollX * 0.5) % 512, y - scrollY, 512, 512, x, y, w, h);
  } else {
    // Procedural Fallback: Banded Gradients with Parallax
    ctx.globalCompositeOperation = 'screen';
    const layers = 2;
    for (let l = 0; l < layers; l++) {
      const lIntensity = intensity * (0.4 + 0.6 * (l / layers));
      const lScroll = (time * (10 + l * 15)) % w;
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, `rgba(200, 210, 230, 0)`);
      grad.addColorStop(0.3 + 0.1 * l, `rgba(220, 230, 250, ${lIntensity * 0.4})`);
      grad.addColorStop(0.7 - 0.1 * l, `rgba(220, 230, 250, ${lIntensity * 0.4})`);
      grad.addColorStop(1, `rgba(200, 210, 230, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }
  }

  // Sandstorm specific tint
  if (sandCh > 0.02) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(210, 160, 80, ${sandCh * 0.2})`;
    ctx.fillRect(x, y, w, h);
  }

  ctx.restore();
}

/** Legacy support for sandstorm haze */
export function drawSandstormVolumetricHaze(ctx, cw, ch, intensity01) {
  const t = Math.max(0, Math.min(1, Number(intensity01) || 0));
  if (t < 0.05) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(210, 175, 120, ${0.1 * t})`;
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}
