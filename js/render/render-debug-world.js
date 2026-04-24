import { BIOMES } from '../biomes.js';
import {
  canWalkMicroTile,
  formalTreeTrunkOverlapsMicroCell,
  getFormalTreeTrunkWorldXSpan,
  scatterPhysicsCircleOverlapsMicroCellAny,
  scatterPhysicsCircleAtOrigin,
  EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER,
  beginWildWalkProbeCache,
  endWildWalkProbeCache,
  TREE_CANOPY_WALK_RADIUS_MULT,
  FORMAL_TREE_CANOPY_Z,
  SCATTER_TREE_CANOPY_Z
} from '../walkability.js';
import { scatterItemKeyIsTree } from '../scatter-pass2-debug.js';
import { circleAabbIntersectsRect } from '../main/play-collider-overlay-cache.js';
import { worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import {
  drawPlayEntityFootAndAirCollider,
  drawPlayEntityCombatHurtbox
} from './render-debug-overlays.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';
import { getWorldReactionOverlayCells } from '../simulation/world-reactions.js';
import { drawLightning, getCloudSlotGlow } from '../weather/lightning.js';
import { getWindVelocityTilesPerSec, WIND_CLOUD_BLEND_BASELINE_DIR_RAD } from '../main/wind-state.js';
import {
  getChargeBarProgresses,
  getChargeLevel,
  getEarthquakeChargeBarProgresses,
  getEarthquakeChargeLevel
} from '../main/play-charge-levels.js';
import { getBindableMoveLabel } from '../main/player-input-slots.js';
import { isPlayGroundDigShiftHeld } from '../main/play-input-state.js';
import { renderPhaseMs } from './render-frame-phases.js';
import {
  updateAndDrawVolumetricWeatherParticles
} from '../weather/volumetric-weather-particles.js';

const CLOUD_WRAP_PAD_PX = 220;
const CLOUD_ALPHA_GAIN = 1.25;
const CLOUD_SHADOW_ALPHA_RATIO = 0.68;
const CLOUD_SIZE_GAIN = 1.5;
const CLOUD_SHADOW_OFFSET_MULT = 2.5;
const CLOUD_SHADOW_OFFSET_BASE_X_TILES = 2.6;
const CLOUD_SHADOW_OFFSET_BASE_Y_TILES = 3.3;
/** Side length (power of two) of the precomputed cloud-size noise field. Small = cheap to regenerate, tile-wraps in world space. */
const CLOUD_SIZE_FIELD_N = 64;
/** Spacing between cloud slots in world-tiles. One potential cloud per slot; noise decides if/size. */
const CLOUD_SLOT_STEP_WORLD_TILES = 10;
/** World-tile span covered by each field cell. Field repeats every `N * cellWorld` world tiles. */
const CLOUD_SIZE_FIELD_CELL_WORLD_TILES = 6; // 64*6 = 384 tiles per repeat
/** Below this 0..1 noise value, the slot produces no cloud (clear sky). */
const CLOUD_SIZE_SKIP_THRESHOLD = 0.42;
/** Cloud size multiplier range, scaled from (noise - threshold)/(1 - threshold). */
const CLOUD_SIZE_MIN_MUL = 0.45;
const CLOUD_SIZE_MAX_MUL = 1.55;
/** White cloud sprites: full strength from this world-tile altitude upward (0 at ground). */
export const CLOUD_WHITE_LAYER_FULL_ALTITUDE_TILES = 8.3;
/**
 * Cloud drift is integrated in `cloudDriftXTiles` / `cloudDriftYTiles` using
 * {@link getWindVelocityTilesPerSec} from `wind-state.js` (same helper as rain slant).
 */
let cloudDriftXTiles = 0;
let cloudDriftYTiles = 0;
let cloudDriftLastTimeSec = -1;

/** World-pixel scroll for tiled rain — integrated like cloud drift so slant stays locked to wind. */
let rainStreakScrollPxX = 0;
let rainStreakScrollPxY = 0;
let rainStreakScrollLastSec = -1;
/** Smoothed wind snapshot shared by precipitation to avoid abrupt direction jumps. */
let envWindSmoothIntensity01 = 0;
let envWindSmoothDirX = Math.cos(WIND_CLOUD_BLEND_BASELINE_DIR_RAD);
let envWindSmoothDirY = Math.sin(WIND_CLOUD_BLEND_BASELINE_DIR_RAD);
let envWindSmoothLastSec = -1;

const CLOUD_SLOT_JITTER_FRAC = 1.55;
const SNES_CLOUD_CLUSTERS = Object.freeze([
  { seedX: 0.07, seedY: 0.12, scale: 1.14, speed: 0.020, speedY: 0.010, alpha: 0.26, puffs: [[-0.9, 0.06, 0.84], [-0.15, -0.02, 1.0], [0.72, 0.08, 0.86]] },
  { seedX: 0.21, seedY: 0.28, scale: 1.03, speed: 0.024, speedY: 0.008, alpha: 0.29, puffs: [[-0.7, 0.05, 0.74], [0.0, -0.04, 1.03], [0.8, 0.07, 0.78]] },
  { seedX: 0.34, seedY: 0.46, scale: 1.22, speed: 0.017, speedY: 0.007, alpha: 0.24, puffs: [[-0.95, 0.04, 0.92], [-0.05, -0.03, 1.08], [0.84, 0.09, 0.86]] },
  { seedX: 0.48, seedY: 0.62, scale: 0.96, speed: 0.028, speedY: 0.011, alpha: 0.25, puffs: [[-0.62, 0.05, 0.75], [0.06, -0.05, 0.97], [0.76, 0.05, 0.71]] },
  { seedX: 0.62, seedY: 0.76, scale: 1.15, speed: 0.021, speedY: 0.009, alpha: 0.28, puffs: [[-0.84, 0.07, 0.88], [-0.1, -0.04, 1.04], [0.8, 0.08, 0.82]] },
  { seedX: 0.77, seedY: 0.88, scale: 1.00, speed: 0.019, speedY: 0.012, alpha: 0.24, puffs: [[-0.7, 0.05, 0.73], [0.02, -0.04, 0.98], [0.78, 0.06, 0.72]] },
  { seedX: 0.86, seedY: 0.54, scale: 1.28, speed: 0.015, speedY: 0.006, alpha: 0.23, puffs: [[-0.96, 0.06, 0.9], [0.0, -0.03, 1.1], [0.9, 0.1, 0.84]] },
  { seedX: 0.95, seedY: 0.36, scale: 0.9, speed: 0.031, speedY: 0.013, alpha: 0.22, puffs: [[-0.56, 0.04, 0.68], [0.0, -0.05, 0.91], [0.67, 0.06, 0.69]] }
]);

let cloudSpriteCache = null;
let ghostMistCache = null;
// Offscreen buffers used by the "cloud-shadow-on-entity" billboard shift pass.
// Sized to the viewport on demand. Re-used across frames.
let entityMaskCanvas = null;
let shiftedShadowCanvas = null;

/** Attack particles that carry a gameplay radius in `radiusTiles`. */
const ATTACK_RADIUS_PARTICLE_TYPES = new Set([
  'fieldCutVineArc',
  'fieldCutPsychicArc',
  'fieldCutSlashArc',
  'fieldCutScratchArc',
  'fieldSpinAttack',
  'waterGunWaveRing',
  'prismaticWindArc',
  'steelWindArc'
]);

function drawProjectileAttackCollider(ctx, proj, tileW, tileH, snapPx) {
  if (!proj) return;
  const zLift = Math.max(0, Number(proj.z) || 0);
  const px = snapPx((Number(proj.x) || 0) * tileW);
  const py = snapPx((Number(proj.y) || 0) * tileH - zLift * tileH);
  const hitR = Math.max(0, Number(proj.radius) || 0);
  const splashR = Math.max(0, Number(proj.splashRadius) || 0);

  if (hitR > 0) {
    ctx.strokeStyle = 'rgba(255, 76, 76, 0.96)';
    ctx.fillStyle = 'rgba(255, 64, 64, 0.13)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.ellipse(px, py, Math.max(1, hitR * tileW), Math.max(1, hitR * tileH), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (splashR > 0) {
    ctx.strokeStyle = 'rgba(255, 188, 76, 0.94)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.ellipse(px, py, Math.max(1, splashR * tileW), Math.max(1, splashR * tileH), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = 'rgba(255, 248, 220, 0.95)';
  ctx.fillRect(px - 2, py - 2, 4, 4);
}

function drawParticleAttackCollider(ctx, part, tileW, tileH, snapPx) {
  if (!part || !ATTACK_RADIUS_PARTICLE_TYPES.has(String(part.type || ''))) return;
  const radiusTiles = Math.max(0, Number(part.radiusTiles) || 0);
  if (radiusTiles <= 0) return;
  const zLift = Math.max(0, Number(part.z) || 0);
  const px = snapPx((Number(part.x) || 0) * tileW);
  const py = snapPx((Number(part.y) || 0) * tileH - zLift * tileH);

  ctx.strokeStyle = 'rgba(150, 205, 255, 0.9)';
  ctx.fillStyle = 'rgba(110, 190, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.ellipse(px, py, Math.max(1, radiusTiles * tileW), Math.max(1, radiusTiles * tileH), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

function ensureEntityShadowBuffers(cw, ch) {
  if (!entityMaskCanvas || entityMaskCanvas.width !== cw || entityMaskCanvas.height !== ch) {
    entityMaskCanvas = document.createElement('canvas');
    entityMaskCanvas.width = cw;
    entityMaskCanvas.height = ch;
  }
  if (!shiftedShadowCanvas || shiftedShadowCanvas.width !== cw || shiftedShadowCanvas.height !== ch) {
    shiftedShadowCanvas = document.createElement('canvas');
    shiftedShadowCanvas.width = cw;
    shiftedShadowCanvas.height = ch;
  }
}

function makeCloudSpriteFromPuffs(puffs, color) {
  const W = 320;
  const H = 220;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { alpha: true });
  g.clearRect(0, 0, W, H);
  g.fillStyle = color;

  const drawPuff = (cx, cy, w, h) => {
    g.beginPath();
    g.ellipse(cx, cy, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  };

  for (const [ox, oy, scale] of puffs) {
    const w = 82 * scale;
    const h = 62 * scale;
    const cx = W * 0.5 + ox * 62;
    const cy = H * 0.5 + oy * 52;
    drawPuff(cx, cy, w, h);

    // Add small satellites so each cloud cluster has more "balls" without runtime overhead.
    const satellites = [
      [-0.42, -0.16, 0.52],
      [0.45, -0.12, 0.47],
      [0.08, 0.21, 0.44]
    ];
    for (const [sx, sy, ss] of satellites) {
      const sw = w * ss;
      const sh = h * ss;
      drawPuff(cx + sx * w, cy + sy * h, sw, sh);
    }
  }
  return c;
}

function getCloudSpritePairForCluster(clusterIdx) {
  if (!cloudSpriteCache) cloudSpriteCache = new Map();
  if (cloudSpriteCache.has(clusterIdx)) return cloudSpriteCache.get(clusterIdx);
  const cluster = SNES_CLOUD_CLUSTERS[clusterIdx];
  const pair = {
    cloud: makeCloudSpriteFromPuffs(cluster.puffs, '#ffffff'),
    shadow: makeCloudSpriteFromPuffs(cluster.puffs, '#000000')
  };
  cloudSpriteCache.set(clusterIdx, pair);
  return pair;
}

/** Deterministic [0, 1); integer lattice hash. */
function hash01Cell(ix, iy, iz) {
  const x = ix | 0;
  const y = iy | 0;
  const z = iz | 0;
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 419.2) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep01(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function sampleSmoothedEnvWind(timeSec, intensityRaw, dirRaw) {
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const rawI = Math.max(0, Math.min(1, Number(intensityRaw) || 0));
  const rawDir = Number.isFinite(dirRaw) ? dirRaw : WIND_CLOUD_BLEND_BASELINE_DIR_RAD;
  const rawX = Math.cos(rawDir);
  const rawY = Math.sin(rawDir);
  const dtRaw = envWindSmoothLastSec >= 0 ? time - envWindSmoothLastSec : 0;
  const dt = !Number.isFinite(dtRaw) || dtRaw < 0 || dtRaw > 0.25 ? 0 : dtRaw;
  envWindSmoothLastSec = time;
  const k = 1 - Math.exp(-dt / 0.45);
  const kk = dt > 0 ? Math.max(0, Math.min(1, k)) : 1;

  envWindSmoothIntensity01 += (rawI - envWindSmoothIntensity01) * kk;
  envWindSmoothDirX += (rawX - envWindSmoothDirX) * kk;
  envWindSmoothDirY += (rawY - envWindSmoothDirY) * kk;
  const mag = Math.hypot(envWindSmoothDirX, envWindSmoothDirY);
  if (mag > 1e-6) {
    envWindSmoothDirX /= mag;
    envWindSmoothDirY /= mag;
  } else {
    envWindSmoothDirX = Math.cos(WIND_CLOUD_BLEND_BASELINE_DIR_RAD);
    envWindSmoothDirY = Math.sin(WIND_CLOUD_BLEND_BASELINE_DIR_RAD);
  }
  return {
    intensity01: Math.max(0, Math.min(1, envWindSmoothIntensity01)),
    dirRad: Math.atan2(envWindSmoothDirY, envWindSmoothDirX)
  };
}

let cloudSizeField = null;
let cloudSizeFieldSeed = null;

/**
 * Builds a small toroidal 2-octave value-noise field (0..1). Cheap to regen,
 * then each cloud just does 4 array reads + bilinear — no sin per instance.
 */
function buildCloudSizeField(seed) {
  const N = CLOUD_SIZE_FIELD_N;
  const out = new Float32Array(N * N);
  const s1 = (seed | 0) % 2147483000;
  const s2 = ((seed * 1013904223) | 0) % 2147483000 ^ 0x6c078965;
  const coarseScale = 1 / 8;
  const fineScale = 1 / 3;
  const weightCoarse = 0.65;
  const weightFine = 0.35;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const coarse = octaveSampleWrap(x, y, coarseScale, N, s1);
      const fine = octaveSampleWrap(x, y, fineScale, N, s2);
      const v = weightCoarse * coarse + weightFine * fine;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
      out[y * N + x] = v;
    }
  }
  const range = Math.max(1e-6, vmax - vmin);
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] - vmin) / range;
  }
  return out;
}

function octaveSampleWrap(x, y, scale, N, seed) {
  const sx = x * scale;
  const sy = y * scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const wrapX = Math.max(1, Math.floor(N * scale));
  const wrapY = Math.max(1, Math.floor(N * scale));
  const ix0 = ((x0 % wrapX) + wrapX) % wrapX;
  const iy0 = ((y0 % wrapY) + wrapY) % wrapY;
  const ix1 = (ix0 + 1) % wrapX;
  const iy1 = (iy0 + 1) % wrapY;
  const h00 = hash01Cell(ix0, iy0, seed);
  const h10 = hash01Cell(ix1, iy0, seed);
  const h01 = hash01Cell(ix0, iy1, seed);
  const h11 = hash01Cell(ix1, iy1, seed);
  const u = smoothstep01(fx);
  const v = smoothstep01(fy);
  const a = h00 + u * (h10 - h00);
  const b = h01 + u * (h11 - h01);
  return a + v * (b - a);
}

function ensureCloudSizeField(seed) {
  if (cloudSizeField && cloudSizeFieldSeed === seed) return cloudSizeField;
  cloudSizeField = buildCloudSizeField(seed);
  cloudSizeFieldSeed = seed;
  return cloudSizeField;
}

/** Returns 0..1 via wrap-sampling the precomputed field in world-tile space (bilinear). */
function sampleCloudSizeField01(worldX, worldY, seed) {
  const field = ensureCloudSizeField(seed);
  const N = CLOUD_SIZE_FIELD_N;
  const inv = 1 / CLOUD_SIZE_FIELD_CELL_WORLD_TILES;
  const fx = worldX * inv;
  const fy = worldY * inv;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const ix0 = ((x0 % N) + N) % N;
  const iy0 = ((y0 % N) + N) % N;
  const ix1 = (ix0 + 1) % N;
  const iy1 = (iy0 + 1) % N;
  const v00 = field[iy0 * N + ix0];
  const v10 = field[iy0 * N + ix1];
  const v01 = field[iy1 * N + ix0];
  const v11 = field[iy1 * N + ix1];
  const u = smoothstep01(tx);
  const v = smoothstep01(ty);
  const a = v00 + u * (v10 - v00);
  const b = v01 + u * (v11 - v01);
  return a + v * (b - a);
}

/**
 * Time-of-day response for cloud-ground shadow projection.
 * @param {number} worldHoursWrapped hour in [0, 24)
 * @param {number} baseOffsetXPx
 * @param {number} baseOffsetYPx
 * @returns {{ offsetX: number, offsetY: number, shadowAlphaMul: number }}
 */
function getCloudShadowProjectionByDay(worldHoursWrapped, baseOffsetXPx, baseOffsetYPx) {
  const h = Number(worldHoursWrapped);
  if (!Number.isFinite(h)) {
    return { offsetX: Math.round(baseOffsetXPx), offsetY: Math.round(baseOffsetYPx), shadowAlphaMul: 1 };
  }

  let x = h % 24;
  if (x < 0) x += 24;

  // Light probes:
  // - Sun:  peak at 12h, horizon at 6h/18h.
  // - Moon: peak at 00h, horizon at 18h/6h (complementary to sun).
  const sunElev01 = smoothstep01(Math.max(0, Math.cos((x - 12) * (Math.PI / 12))));
  const moonElev01 = smoothstep01(Math.max(0, Math.cos(x * (Math.PI / 12))));
  // Moonlit cloud shadows must exist, but remain much softer than daytime.
  const sunLightW = sunElev01;
  const moonLightW = moonElev01 * 0.34;
  // Keep a tiny always-on ambient contribution so shadows never fully disappear
  // during exact sun/moon horizon crossover (e.g. around 6:00 and 18:00).
  const ambientLightW = 0.14;
  const lightSum = sunLightW + moonLightW + ambientLightW;

  const baseLen = Math.hypot(baseOffsetXPx, baseOffsetYPx);
  const baseAng = Math.atan2(baseOffsetYPx, baseOffsetXPx);
  // Blend sun+moon azimuth so dusk/night transitions stay continuous.
  const sunSwing = Math.sin((x - 12) * (Math.PI / 12));
  const moonSwing = Math.sin(x * (Math.PI / 12));
  const ambientSwing = Math.sin((x - 9) * (Math.PI / 12));
  const ang =
    baseAng +
    ((sunSwing * 0.55 * sunLightW + moonSwing * 0.42 * moonLightW + ambientSwing * 0.14 * ambientLightW) /
      Math.max(1e-6, lightSum));

  // Day: short at noon, long at low sun.
  const sunLenMul = 0.68 + (1 - sunElev01) * 1.42;
  // Night: generally longer and softer than daytime.
  const moonLenMul = 1.15 + (1 - moonElev01) * 1.1;
  const ambientLenMul = 1.22;
  const lenMul =
    (sunLenMul * sunLightW + moonLenMul * moonLightW + ambientLenMul * ambientLightW) / Math.max(1e-6, lightSum);
  const len = baseLen * lenMul;

  // Keep moon shadows visible without overpowering scene tinting.
  const alpha =
    Math.max(0.12, Math.min(1, 0.12 + sunLightW + moonLightW * 0.82));

  return {
    offsetX: Math.round(Math.cos(ang) * len),
    offsetY: Math.round(Math.sin(ang) * len),
    shadowAlphaMul: alpha
  };
}

function drawSnesCloudParallax(ctx, options) {
  const {
    ch,
    timeSec,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    cloudPresence: cloudPresenceRaw = 1,
    cloudNoiseSeed = 0,
    cloudThreshold: cloudThresholdOpt,
    cloudMinMul: cloudMinMulOpt,
    cloudMaxMul: cloudMaxMulOpt,
    cloudAlphaMul: cloudAlphaMulOpt,
    cloudDarken01 = 0,
    windDirRad = 0,
    windIntensity = 0,
    cw = 0,
    worldHours,
    entityShadowSprites = null,
    /** 0..1 scales white cloud pass (shadows ignore this). Default 1 = editor / non-play. */
    whiteLayerAlphaMul = 1
  } = options;
  const darken = Math.max(0, Math.min(0.75, Number(cloudDarken01) || 0));
  const cloudPresence = Math.max(0, Math.min(1, Number(cloudPresenceRaw) || 0));
  const noiseSeed = (cloudNoiseSeed | 0) >>> 0;
  const variantCount = SNES_CLOUD_CLUSTERS.length;
  // DevTools override (window.__cloudDebug) > per-call option > constant default.
  const dbg = typeof window !== 'undefined' ? window.__cloudDebug : null;
  const pickNum = (dbgVal, optVal, fallback) => {
    if (dbg && Number.isFinite(dbgVal)) return dbgVal;
    if (Number.isFinite(optVal)) return optVal;
    return fallback;
  };
  const threshold = pickNum(dbg?.threshold, cloudThresholdOpt, CLOUD_SIZE_SKIP_THRESHOLD);
  const minMul = pickNum(dbg?.minMul, cloudMinMulOpt, CLOUD_SIZE_MIN_MUL);
  const maxMul = pickNum(dbg?.maxMul, cloudMaxMulOpt, CLOUD_SIZE_MAX_MUL);
  const alphaMul = pickNum(dbg?.alphaMul, cloudAlphaMulOpt, 1);
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const baseScale = Math.max(0.7, Math.min(1.25, ch / 900));
  const baseShadowOffsetX = tileW * CLOUD_SHADOW_OFFSET_BASE_X_TILES * CLOUD_SHADOW_OFFSET_MULT;
  const baseShadowOffsetY = tileH * CLOUD_SHADOW_OFFSET_BASE_Y_TILES * CLOUD_SHADOW_OFFSET_MULT;
  const shadowProjection = getCloudShadowProjectionByDay(worldHours, baseShadowOffsetX, baseShadowOffsetY);
  const shadowOffsetX = shadowProjection.offsetX;
  const shadowOffsetY = shadowProjection.offsetY;
  const shadowAlphaMul = shadowProjection.shadowAlphaMul;
  const paddedStartX = startX - 30;
  const paddedEndX = endX + 30;
  const paddedStartY = startY - 24;
  const paddedEndY = endY + 24;

  // One slot grid drives the whole sky. Noise determines whether a cloud exists and its size.
  const step = CLOUD_SLOT_STEP_WORLD_TILES;
  // Integrate cloud drift in world-tile space so changes to live wind never snap the field.
  // When wind is weak we still advect slowly along a hard-coded baseline direction so clear
  // skies don't look frozen; as wind ramps up we blend the direction toward the live vector.
  const windState = getWindVelocityTilesPerSec(windIntensity, windDirRad);
  const velXTiles = windState.vx;
  const velYTiles = windState.vy;
  const dtRaw = cloudDriftLastTimeSec >= 0 ? time - cloudDriftLastTimeSec : 0;
  // Pause/tab-switch/seek guard: drop dt outside a sane per-frame range so clouds don't teleport.
  const driftDt = !Number.isFinite(dtRaw) || dtRaw < 0 || dtRaw > 0.25 ? 0 : dtRaw;
  cloudDriftXTiles += velXTiles * driftDt;
  cloudDriftYTiles += velYTiles * driftDt;
  cloudDriftLastTimeSec = time;
  const windX = cloudDriftXTiles;
  const windY = cloudDriftYTiles;

  // Visible slot range (add a margin big enough for the max-size cloud so none pop at edges).
  const maxClusterScale = 1.28;
  const maxHeightPx = tileH * 6.4 * CLOUD_SIZE_GAIN * maxClusterScale * baseScale * maxMul;
  const maxHalfTileH = maxHeightPx / Math.max(1e-6, tileH) * 0.5;
  // Sprite is ~320x220 so width ≈ height * 1.45; take generous margin.
  const maxHalfTileW = maxHalfTileH * 1.6;
  const jitterMargin = step * CLOUD_SLOT_JITTER_FRAC * 0.5;
  const sxMin = Math.floor((paddedStartX - windX - maxHalfTileW - jitterMargin) / step);
  const sxMax = Math.ceil((paddedEndX - windX + maxHalfTileW + jitterMargin) / step);
  const syMin = Math.floor((paddedStartY - windY - maxHalfTileH - jitterMargin) / step);
  const syMax = Math.ceil((paddedEndY - windY + maxHalfTileH + jitterMargin) / step);

  // --- PRE-CALCULATE VISIBLE SLOTS ---
  const visibleSlots = [];
  for (let sy = syMin; sy <= syMax; sy++) {
    for (let sx = sxMin; sx <= sxMax; sx++) {
      const identityX = sx * step;
      const identityY = sy * step;
      const sizeNoise = sampleCloudSizeField01(identityX, identityY, noiseSeed);
      if (sizeNoise < threshold) continue;

      const variantIdx = Math.floor(hash01Cell(sx, sy, noiseSeed ^ 0x9e3779b1) * variantCount) % variantCount;
      const c = SNES_CLOUD_CLUSTERS[variantIdx];
      const t01 = (sizeNoise - threshold) / Math.max(1e-6, 1 - threshold);
      const sizeMul = minMul + t01 * (maxMul - minMul);
      const jitterX = (hash01Cell(sx, sy, noiseSeed ^ 0x5bd1e995) - 0.5) * step * CLOUD_SLOT_JITTER_FRAC;
      const jitterY = (hash01Cell(sx, sy, noiseSeed ^ 0x27d4eb2d) - 0.5) * step * CLOUD_SLOT_JITTER_FRAC;
      const bob = Math.sin(time * 0.28 + sx * 0.81 + sy * 1.37) * (tileH * 0.5);

      visibleSlots.push({
        sx, sy, variantIdx, c, sizeMul, jitterX, jitterY, bob, identityX, identityY
      });
    }
  }

  const drawLayer = (isShadow, targetCtx = ctx, extraNudgeX = 0, extraNudgeY = 0, whiteAlphaMul = 1) => {
    const yNudge = (isShadow ? shadowOffsetY : 0) + extraNudgeY;
    const xNudge = (isShadow ? shadowOffsetX : 0) + extraNudgeX;
    const wMul = isShadow ? 1 : Math.max(0, Math.min(1, Number(whiteAlphaMul) || 0));

    for (const slot of visibleSlots) {
      const { sx, sy, variantIdx, c, sizeMul, jitterX, jitterY, bob, identityX, identityY } = slot;
      const spritePair = getCloudSpritePairForCluster(variantIdx);
      const sprite = isShadow ? spritePair.shadow : spritePair.cloud;

      const h = Math.max(2, Math.round(tileH * 6.4 * CLOUD_SIZE_GAIN * c.scale * baseScale * sizeMul));
      const w = Math.max(2, Math.round(h * (sprite.width / Math.max(1, sprite.height))));

      const centerWorldX = identityX + windX + jitterX;
      const centerWorldY = identityY + windY + jitterY;
      const x = Math.round(centerWorldX * tileW - w * 0.5 + xNudge);
      const y = Math.round(centerWorldY * tileH - h * 0.5 + yNudge + bob);

      const cloudMaxX = (x + w) / tileW;
      const cloudMinX = x / tileW;
      const cloudMaxY = (y + h) / tileH;
      const cloudMinY = y / tileH;
      if (cloudMaxX < paddedStartX || cloudMinX > paddedEndX || cloudMaxY < paddedStartY || cloudMinY > paddedEndY) {
        continue;
      }

      const alpha =
        c.alpha *
        CLOUD_ALPHA_GAIN *
        cloudPresence *
        alphaMul *
        (isShadow ? CLOUD_SHADOW_ALPHA_RATIO * shadowAlphaMul : 1) *
        wMul;
      const clampedAlpha = Math.max(0, Math.min(1, alpha));
      targetCtx.globalAlpha = clampedAlpha;
      targetCtx.drawImage(sprite, x, y, w, h);

      if (!isShadow) {
        const glow = getCloudSlotGlow(sx, sy);
        const darkAlpha = darken * clampedAlpha * (1 - glow);
        if (darkAlpha > 0.005) {
          targetCtx.globalAlpha = Math.min(1, darkAlpha);
          targetCtx.drawImage(spritePair.shadow, x, y, w, h);
        }
        if (glow > 0.01) {
          targetCtx.globalCompositeOperation = 'lighter';
          targetCtx.globalAlpha = Math.min(1, glow * clampedAlpha * 2.2);
          targetCtx.drawImage(sprite, x, y, w, h);
          targetCtx.globalCompositeOperation = 'source-over';
        }
      }
    }
  };

  ctx.save();
  // Keep cloud/shadow locked to world coordinates; camera translation is already active in render.js.
  ctx.imageSmoothingEnabled = false;
  if (cloudPresence > 0.001 && visibleSlots.length > 0) {
    drawLayer(true);

    // Billboard-shift pass
    const entities = Array.isArray(entityShadowSprites) ? entityShadowSprites : null;
    if (entities && entities.length > 0 && cw > 0 && ch > 0) {
      const shLen = Math.hypot(shadowOffsetX, shadowOffsetY) || 1;
      const shiftMag = tileH;
      const towardCloudX = -shadowOffsetX / shLen * shiftMag;
      const towardCloudY = -shadowOffsetY / shLen * shiftMag;

      ensureEntityShadowBuffers(cw, ch);
      const maskCtx = entityMaskCanvas.getContext('2d');
      const buffCtx = shiftedShadowCanvas.getContext('2d');

      const worldTransform = ctx.getTransform();
      maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      maskCtx.clearRect(0, 0, cw, ch);
      maskCtx.setTransform(worldTransform);
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.imageSmoothingEnabled = false;
      for (const e of entities) {
        if (!e || !e.sheet) continue;
        maskCtx.globalAlpha = e.alpha ?? 1;
        maskCtx.drawImage(e.sheet, e.sx, e.sy, e.sw, e.sh, e.pxL, e.pxT, e.pxW, e.pxH);
      }
      maskCtx.globalAlpha = 1;

      buffCtx.setTransform(1, 0, 0, 1, 0, 0);
      buffCtx.clearRect(0, 0, cw, ch);
      buffCtx.setTransform(worldTransform);
      buffCtx.imageSmoothingEnabled = false;
      buffCtx.globalCompositeOperation = 'source-over';
      drawLayer(true, buffCtx, towardCloudX, towardCloudY);
      buffCtx.setTransform(1, 0, 0, 1, 0, 0);
      buffCtx.globalAlpha = 1;
      buffCtx.globalCompositeOperation = 'destination-in';
      buffCtx.drawImage(entityMaskCanvas, 0, 0);
      buffCtx.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(shiftedShadowCanvas, 0, 0);
      ctx.restore();
    }

    if (whiteLayerAlphaMul > 0.002) {
      drawLayer(false, ctx, 0, 0, whiteLayerAlphaMul);
    }
  }
  ctx.restore();
}

function buildGhostMistLayer(cw, ch, lodMul) {
  const layer = document.createElement('canvas');
  layer.width = cw;
  layer.height = ch;
  const c = layer.getContext('2d', { alpha: true });

  const gcx = cw * 0.5;
  const gcy = ch * 0.46;
  const r0 = Math.min(cw, ch) * 0.16;
  const r1 = Math.hypot(cw, ch) * 0.62;
  const radial = c.createRadialGradient(gcx, gcy, r0, gcx, gcy, r1);
  radial.addColorStop(0, 'rgba(255,255,255,0)');
  radial.addColorStop(0.42, `rgba(255,255,255,${0.1 * lodMul})`);
  radial.addColorStop(1, `rgba(250,252,255,${0.32 * lodMul})`);
  c.fillStyle = radial;
  c.globalAlpha = 1;
  c.fillRect(0, 0, cw, ch);

  c.fillStyle = '#ffffff';
  c.globalAlpha = 0.1 * lodMul;
  c.fillRect(0, 0, cw, ch);

  // One-time static banding texture to fake volumetric haze cheaply.
  c.globalAlpha = 0.07 * lodMul;
  for (let y = 0; y < ch; y += 8) {
    const wave = 0.5 + 0.5 * Math.sin(y * 0.031);
    c.fillStyle = `rgba(236,242,255,${0.2 + wave * 0.4})`;
    c.fillRect(0, y, cw, 2);
  }

  return layer;
}

function getGhostMistLayer(cw, ch, lodDetail) {
  const lodMul = lodDetail >= 2 ? 0.52 : lodDetail >= 1 ? 0.82 : 1;
  if (
    ghostMistCache &&
    ghostMistCache.cw === cw &&
    ghostMistCache.ch === ch &&
    ghostMistCache.lodMul === lodMul
  ) {
    return ghostMistCache.layer;
  }
  const layer = buildGhostMistLayer(cw, ch, lodMul);
  ghostMistCache = { cw, ch, lodMul, layer };
  return layer;
}

function drawWrappedScreenLayer(ctx, layer, cw, ch, ox, oy, alpha) {
  const x = ((ox % cw) + cw) % cw;
  const y = ((oy % ch) + ch) % ch;
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, x - cw, y - ch, cw, ch);
  ctx.drawImage(layer, x, y - ch, cw, ch);
  ctx.drawImage(layer, x - cw, y, cw, ch);
  ctx.drawImage(layer, x, y, cw, ch);
}

function drawGhostMistShaderLike(ctx, cw, ch, lodDetail, time) {
  const layer = getGhostMistLayer(cw, ch, lodDetail);
  const t = Number.isFinite(time) ? time : 0;
  const oxA = Math.round(Math.sin(t * 0.19) * cw * 0.06);
  const oyA = Math.round(Math.cos(t * 0.14) * ch * 0.045);
  const oxB = Math.round(Math.cos(t * 0.11 + 1.9) * cw * 0.05);
  const oyB = Math.round(Math.sin(t * 0.16 + 0.8) * ch * 0.035);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWrappedScreenLayer(ctx, layer, cw, ch, oxA, oyA, 0.95);
  ctx.globalCompositeOperation = 'lighter';
  drawWrappedScreenLayer(ctx, layer, cw, ch, oxB, oyB, 0.32);
  ctx.restore();
}

/**
 * Draws the full world collider overlay (Pass 6).
 */
export function drawWorldColliderOverlay(ctx, options) {
  const {
    showFullColliderOverlay,
    detailColliderDbg,
    data,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    snapPx,
    imageCache,
    renderItems,
    player,
    isPlayerWalkingAnim,
    getCached,
    settings
  } = options;

  if (showFullColliderOverlay) {
    ctx.save();
    const twCell = Math.ceil(tileW);
    const thCell = Math.ceil(tileH);
    const pCol = settings?.player;
    const colliderCache = settings?.playColliderOverlayCache;
    const useColliderCache = colliderCache && colliderCache.seed === data.seed;

    if (useColliderCache) {
      const { mxMin, mxMax, myMin, myMax, stride, cellFlags } = colliderCache;
      for (let my = Math.max(startY, myMin); my < endY && my <= myMax; my++) {
        for (let mx = Math.max(startX, mxMin); mx < endX && mx <= mxMax; mx++) {
          const v = cellFlags[(my - myMin) * stride + (mx - mxMin)];
          if (v === 1) {
            ctx.fillStyle = 'rgba(220, 60, 120, 0.3)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          } else if (v === 2) {
            ctx.fillStyle = 'rgba(90, 220, 255, 0.26)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          } else if (v === 3) {
            ctx.fillStyle = 'rgba(160, 170, 255, 0.24)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          }
        }
      }

      // Draw tree trunk frusta: base ellipse, top ellipse, four side rulings (matches linear r(z) physics).
      ctx.lineWidth = 2;
      for (const span of colliderCache.formalEllipses) {
        const rTopF = span.radiusTop != null ? span.radiusTop : span.radius;
        const rCull = Math.max(span.radius, rTopF);
        if (!circleAabbIntersectsRect(span.cx, span.cy, rCull, startX, startY, endX, endY)) continue;
        const pxCx = snapPx(span.cx * tileW);
        const pxCy = snapPx(span.cy * tileH);
        const rwB = Math.max(1, span.radius * tileW);
        const rhB = Math.max(1, span.radius * tileH);
        const rwT = Math.max(1, rTopF * tileW);
        const rhT = Math.max(1, rTopF * tileH);
        const topOff = (span.topZ || 0) * tileH;
        const pxCyTop = pxCy - topOff;
        // Base ellipse
        ctx.strokeStyle = 'rgba(120, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, rwB, rhB, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (topOff > 0) {
          // Top ellipse
          ctx.strokeStyle = 'rgba(120, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.ellipse(pxCx, pxCyTop, rwT, rhT, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(120, 255, 255, 0.35)';
          ctx.beginPath();
          ctx.moveTo(pxCx - rwB, pxCy); ctx.lineTo(pxCx - rwT, pxCyTop);
          ctx.moveTo(pxCx + rwB, pxCy); ctx.lineTo(pxCx + rwT, pxCyTop);
          ctx.moveTo(pxCx, pxCy - rhB); ctx.lineTo(pxCx, pxCyTop - rhT);
          ctx.moveTo(pxCx, pxCy + rhB); ctx.lineTo(pxCx, pxCyTop + rhT);
          ctx.stroke();
        }
      }

      for (const p of colliderCache.scatterEllipses) {
        const rTopS = p.radiusTop != null ? p.radiusTop : p.radius;
        const rCullS = Math.max(p.radius, rTopS);
        if (!circleAabbIntersectsRect(p.cx, p.cy, rCullS, startX, startY, endX, endY)) continue;
        const pxCx = snapPx(p.cx * tileW);
        const pxCy = snapPx(p.cy * tileH);
        const rwB = Math.max(1, p.radius * tileW);
        const rhB = Math.max(1, p.radius * tileH);
        const rwT = Math.max(1, rTopS * tileW);
        const rhT = Math.max(1, rTopS * tileH);
        const topOff = (p.topZ || 0) * tileH;
        const pxCyTop = pxCy - topOff;
        // Base ellipse
        ctx.strokeStyle = p.isTree ? 'rgba(200, 140, 255, 0.9)' : 'rgba(100, 200, 255, 0.88)';
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, rwB, rhB, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (topOff > 0) {
          // Top ellipse
          ctx.strokeStyle = p.isTree ? 'rgba(200, 140, 255, 0.5)' : 'rgba(100, 200, 255, 0.45)';
          ctx.beginPath();
          ctx.ellipse(pxCx, pxCyTop, rwT, rhT, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = p.isTree ? 'rgba(200, 140, 255, 0.3)' : 'rgba(100, 200, 255, 0.3)';
          ctx.beginPath();
          ctx.moveTo(pxCx - rwB, pxCy); ctx.lineTo(pxCx - rwT, pxCyTop);
          ctx.moveTo(pxCx + rwB, pxCy); ctx.lineTo(pxCx + rwT, pxCyTop);
          ctx.moveTo(pxCx, pxCy - rhB); ctx.lineTo(pxCx, pxCyTop - rhT);
          ctx.moveTo(pxCx, pxCy + rhB); ctx.lineTo(pxCx, pxCyTop + rhT);
          ctx.stroke();
        }
      }

      // Treetop walk / groundZ: larger dashed discs (getTreeCanopyZAtPoint), not trunk hit.
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(72, 235, 150, 0.78)';
      for (const span of colliderCache.formalEllipses) {
        const rTopWalk = span.radiusTop != null ? span.radiusTop : span.radius;
        const cr = rTopWalk * TREE_CANOPY_WALK_RADIUS_MULT;
        if (!circleAabbIntersectsRect(span.cx, span.cy, cr, startX, startY, endX, endY)) continue;
        const pxCx = snapPx(span.cx * tileW);
        const pxCy = snapPx(span.cy * tileH);
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, Math.max(1, cr * tileW), Math.max(1, cr * tileH), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(235, 255, 92, 0.74)';
      for (const p of colliderCache.scatterEllipses) {
        if (!p.isTree) continue;
        const rTopWalkS = p.radiusTop != null ? p.radiusTop : p.radius;
        const cr = rTopWalkS * TREE_CANOPY_WALK_RADIUS_MULT;
        if (!circleAabbIntersectsRect(p.cx, p.cy, cr, startX, startY, endX, endY)) continue;
        const pxCx = snapPx(p.cx * tileW);
        const pxCy = snapPx(p.cy * tileH);
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, Math.max(1, cr * tileW), Math.max(1, cr * tileH), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Direct (no cache) fallback
      const cx = pCol ? Math.floor(pCol.x) : startX + Math.floor((endX - startX) / 2);
      const cy = pCol ? Math.floor(pCol.y) : startY + Math.floor((endY - startY) / 2);
      const COLL_OVERLAY_RAD = 18;
      const ox0 = Math.max(startX, cx - COLL_OVERLAY_RAD);
      const ox1 = Math.min(endX, cx + COLL_OVERLAY_RAD + 1);
      const oy0 = Math.max(startY, cy - COLL_OVERLAY_RAD);
      const oy1 = Math.min(endY, cy + COLL_OVERLAY_RAD + 1);
      const overlayFeetDex = player.dexId || 94;

      beginWildWalkProbeCache();
      try {
        for (let my = oy0; my < oy1; my++) {
          for (let mx = ox0; mx < ox1; mx++) {
            const ftCell = worldFeetFromPivotCell(mx, my, imageCache, overlayFeetDex, isPlayerWalkingAnim);
            const feetOk = canWalkMicroTile(ftCell.x, ftCell.y, data, ftCell.x, ftCell.y, undefined, false);
            const formalTrunk = formalTreeTrunkOverlapsMicroCell(mx, my, data);
            const scatterPhy = scatterPhysicsCircleOverlapsMicroCellAny(mx, my, data);
            if (!feetOk) {
              ctx.fillStyle = 'rgba(220, 60, 120, 0.3)';
              ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
            } else if (formalTrunk || scatterPhy) {
              ctx.fillStyle = formalTrunk ? 'rgba(90, 220, 255, 0.26)' : 'rgba(160, 170, 255, 0.24)';
              ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
            }
          }
        }

        ctx.lineWidth = 2;
        for (let my = oy0; my < oy1; my++) {
          for (let rootX = ox0 - 1; rootX < ox1; rootX++) {
            const span = getFormalTreeTrunkWorldXSpan(rootX, my, data);
            if (!span) continue;
            const pxCx = snapPx(span.cx * tileW);
            const pxCy = snapPx(span.cy * tileH);
            const rTopF = span.radiusTop != null ? span.radiusTop : span.radius;
            const rwB = Math.max(1, span.radius * tileW);
            const rhB = Math.max(1, span.radius * tileH);
            const rwT = Math.max(1, rTopF * tileW);
            const rhT = Math.max(1, rTopF * tileH);
            const topOff = FORMAL_TREE_CANOPY_Z * tileH;
            const pxCyTop = pxCy - topOff;
            ctx.strokeStyle = 'rgba(120, 255, 255, 0.85)';
            ctx.beginPath();
            ctx.ellipse(pxCx, pxCy, rwB, rhB, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(120, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.ellipse(pxCx, pxCyTop, rwT, rhT, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(120, 255, 255, 0.35)';
            ctx.beginPath();
            ctx.moveTo(pxCx - rwB, pxCy); ctx.lineTo(pxCx - rwT, pxCyTop);
            ctx.moveTo(pxCx + rwB, pxCy); ctx.lineTo(pxCx + rwT, pxCyTop);
            ctx.moveTo(pxCx, pxCy - rhB); ctx.lineTo(pxCx, pxCyTop - rhT);
            ctx.moveTo(pxCx, pxCy + rhB); ctx.lineTo(pxCx, pxCyTop + rhT);
            ctx.stroke();
          }
        }

        for (let oxS = ox0 - 8; oxS < ox1 + 2; oxS++) {
          if (oxS < 0 || oxS >= data.width * MACRO_TILE_STRIDE) continue;
          for (let oyS = Math.max(0, oy0 - 10); oyS <= Math.min(data.height * MACRO_TILE_STRIDE - 1, oy1 + 3); oyS++) {
            const p = scatterPhysicsCircleAtOrigin(oxS, oyS, data, null, getCached);
            if (!p) continue;
            const rMax = Math.max(p.radius, p.radiusTop);
            if (p.cx + rMax <= ox0 || p.cx - rMax >= ox1 || p.cy + rMax <= oy0 || p.cy - rMax >= oy1) continue;
            const pxCx = snapPx(p.cx * tileW);
            const pxCy = snapPx(p.cy * tileH);
            const rwB = Math.max(1, p.radius * tileW);
            const rhB = Math.max(1, p.radius * tileH);
            const rwT = Math.max(1, p.radiusTop * tileW);
            const rhT = Math.max(1, p.radiusTop * tileH);
            const isTree = scatterItemKeyIsTree(p.itemKey);
            const topOff = isTree ? SCATTER_TREE_CANOPY_Z * tileH : 0;
            const pxCyTop = pxCy - topOff;
            ctx.strokeStyle = isTree ? 'rgba(200, 140, 255, 0.9)' : 'rgba(100, 200, 255, 0.88)';
            ctx.beginPath();
            ctx.ellipse(pxCx, pxCy, rwB, rhB, 0, 0, Math.PI * 2);
            ctx.stroke();
            if (topOff > 0) {
              ctx.strokeStyle = 'rgba(200, 140, 255, 0.5)';
              ctx.beginPath();
              ctx.ellipse(pxCx, pxCyTop, rwT, rhT, 0, 0, Math.PI * 2);
              ctx.stroke();
              ctx.strokeStyle = 'rgba(200, 140, 255, 0.3)';
              ctx.beginPath();
              ctx.moveTo(pxCx - rwB, pxCy); ctx.lineTo(pxCx - rwT, pxCyTop);
              ctx.moveTo(pxCx + rwB, pxCy); ctx.lineTo(pxCx + rwT, pxCyTop);
              ctx.moveTo(pxCx, pxCy - rhB); ctx.lineTo(pxCx, pxCyTop - rhT);
              ctx.moveTo(pxCx, pxCy + rhB); ctx.lineTo(pxCx, pxCyTop + rhT);
              ctx.stroke();
            }
          }
        }

        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(72, 235, 150, 0.78)';
        for (let my = oy0; my < oy1; my++) {
          for (let rootX = ox0 - 1; rootX < ox1; rootX++) {
            const span = getFormalTreeTrunkWorldXSpan(rootX, my, data);
            if (!span) continue;
            const rTopWalk = span.radiusTop != null ? span.radiusTop : span.radius;
            const cr = rTopWalk * TREE_CANOPY_WALK_RADIUS_MULT;
            if (!circleAabbIntersectsRect(span.cx, span.cy, cr, startX, startY, endX, endY)) continue;
            ctx.beginPath();
            ctx.ellipse(
              snapPx(span.cx * tileW),
              snapPx(span.cy * tileH),
              Math.max(1, cr * tileW),
              Math.max(1, cr * tileH),
              0,
              0,
              Math.PI * 2
            );
            ctx.stroke();
          }
        }
        ctx.strokeStyle = 'rgba(235, 255, 92, 0.74)';
        for (let oxS = ox0 - 8; oxS < ox1 + 2; oxS++) {
          if (oxS < 0 || oxS >= data.width * MACRO_TILE_STRIDE) continue;
          for (let oyS = Math.max(0, oy0 - 10); oyS <= Math.min(data.height * MACRO_TILE_STRIDE - 1, oy1 + 3); oyS++) {
            const p = scatterPhysicsCircleAtOrigin(oxS, oyS, data, null, getCached);
            if (!p || !scatterItemKeyIsTree(p.itemKey)) continue;
            const rTopWalkS = p.radiusTop != null ? p.radiusTop : p.radius;
            const cr = rTopWalkS * TREE_CANOPY_WALK_RADIUS_MULT;
            if (!circleAabbIntersectsRect(p.cx, p.cy, cr, startX, startY, endX, endY)) continue;
            ctx.beginPath();
            ctx.ellipse(snapPx(p.cx * tileW), snapPx(p.cy * tileH), Math.max(1, cr * tileW), Math.max(1, cr * tileH), 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      } finally {
        endWildWalkProbeCache();
      }
    }

    for (const item of renderItems) {
      if (item.type === 'player' || item.type === 'wild') {
        drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache);
        drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx);
      } else if (item.type === 'projectile') {
        drawProjectileAttackCollider(ctx, item.proj, tileW, tileH, snapPx);
      } else if (item.type === 'particle') {
        drawParticleAttackCollider(ctx, item.part, tileW, tileH, snapPx);
      } else if (item.type === 'crystalDrop') {
        const d = item.drop;
        const r = Math.max(0.05, Number(d.pickRadius) || 0.5);
        ctx.strokeStyle = 'rgba(140, 245, 255, 0.95)';
        ctx.beginPath();
        ctx.ellipse(snapPx(d.x * tileW), snapPx(d.y * tileH), Math.max(1, r * tileW), Math.max(1, r * tileH), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  } else if (detailColliderDbg) {
    ctx.save();
    for (const item of renderItems) {
      if (item.type === 'player' || item.type === 'wild') {
        drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache);
        drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx);
      } else if (item.type === 'projectile') {
        drawProjectileAttackCollider(ctx, item.proj, tileW, tileH, snapPx);
      } else if (item.type === 'particle') {
        drawParticleAttackCollider(ctx, item.part, tileW, tileH, snapPx);
      }
    }
    ctx.restore();
  }

  // Individual highlight (e.g. from context menu)
  if (detailColliderDbg?.kind === 'formal-tree') {
    const span = getFormalTreeTrunkWorldXSpan(detailColliderDbg.rootX, detailColliderDbg.my, data);
    if (span) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 210, 70, 0.98)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(snapPx(span.cx * tileW), snapPx(span.cy * tileH), Math.max(2, span.radius * tileW), Math.max(2, span.radius * tileH), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * Draw world systemic debug overlay (heat/wet/shock/danger grid).
 */
export function drawWorldReactionsOverlay(ctx, options) {
  const { showWorldReactionsOverlay, startX, startY, endX, endY, tileW, tileH, cw, ch } = options;
  if (!showWorldReactionsOverlay) return;
  const cells = getWorldReactionOverlayCells(startX, startY, endX, endY);
  if (!cells.length) return;

  ctx.save();
  for (const c of cells) {
    const px = c.cx * c.cellSizeTiles * tileW;
    const py = c.cy * c.cellSizeTiles * tileH;
    const pw = Math.ceil(c.cellSizeTiles * tileW);
    const ph = Math.ceil(c.cellSizeTiles * tileH);

    if (c.wet > 0.02) {
      ctx.fillStyle = `rgba(60, 140, 255, ${Math.min(0.46, 0.08 + c.wet * 0.42)})`;
      ctx.fillRect(px, py, pw, ph);
    }
    if (c.heat > 0.02) {
      ctx.fillStyle = `rgba(255, 96, 64, ${Math.min(0.5, 0.08 + c.heat * 0.44)})`;
      ctx.fillRect(px, py, pw, ph);
    }
    if (c.shock > 0.02) {
      ctx.fillStyle = `rgba(245, 226, 92, ${Math.min(0.48, 0.08 + c.shock * 0.4)})`;
      ctx.fillRect(px, py, pw, ph);
    }
    if (c.danger > 0.1) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.88, 0.12 + c.danger * 0.66)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, Math.max(1, pw - 1), Math.max(1, ph - 1));
    }
  }
  ctx.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const panelX = 14;
  const panelY = 12;
  const panelW = Math.min(315, Math.max(240, cw * 0.32));
  const panelH = 68;
  ctx.fillStyle = 'rgba(8, 10, 14, 0.66)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(255,255,255,0.24)';
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);
  ctx.font = '12px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8edf8';
  ctx.fillText('World Reactions Overlay (V): heat / wet / shock / danger', panelX + 10, panelY + 16);
  ctx.fillStyle = 'rgba(255, 96, 64, 0.86)';
  ctx.fillText('heat', panelX + 12, panelY + 39);
  ctx.fillStyle = 'rgba(60, 140, 255, 0.9)';
  ctx.fillText('wet', panelX + 62, panelY + 39);
  ctx.fillStyle = 'rgba(245, 226, 92, 0.9)';
  ctx.fillText('shock', panelX + 104, panelY + 39);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText('danger = bright border', panelX + 166, panelY + 39);
  ctx.fillStyle = 'rgba(230,235,245,0.78)';
  ctx.fillText(`cells visible: ${cells.length}`, panelX + 10, panelY + 56);
  ctx.restore();
}

/**
 * Draws screen-space effects like day/night tint and fog.
 * @param {number} [options.cloudPresence=1] — 0..1 global cloud opacity scale.
 * @param {number} [options.cloudNoiseSeed=0] — integer; shifts the precomputed cloud-size noise field per map.
 * @param {number} [options.cloudThreshold] — 0..1 density floor (below = no cloud).
 * @param {number} [options.cloudMinMul] / @param {number} [options.cloudMaxMul] — cloud size range.
 * @param {number} [options.cloudAlphaMul] — extra cloud alpha multiplier.
 * @param {number} [options.rainIntensity=0] — 0..1 rain VFX intensity.
 * @param {number} [options.windIntensity=0] — 0..1 wind VFX intensity (cloud drift, rain slant, blizzard drift).
 * @param {number} [options.windDirRad=0] — wind direction in radians (0 = east, +π/2 = south).
 * @param {'clear' | 'cloudy' | 'rain' | 'blizzard' | 'sandstorm' | string} [options.weatherPreset='clear'] — current weather preset id.
 * @param {number} [options.weatherBlizzardBlend01=0] — smoothed 0..1 blend into blizzard precipitation.
 * @param {{r:number,g:number,b:number,a:number}} [options.screenTint] — extra multiply tint applied after day tint.
 * @param {Array<{x:number,yTop:number,w:number,h:number}>} [options.splashTargets]
 *        Entity world-pixel anchors (same space ctx uses for entities) to spawn rain splashes on.
 * @param {number} [options.earthquakeVisual01=0] — smoothed 0..1 ground-shake layer (independent of sky weather).
 * @param {number} [options.sunLightRaysIntensity01=0] — smoothed 0..1 additive sunlight shafts + halo/lens flare.
 * @param {number} [options.moonLightRaysIntensity01=0] — smoothed 0..1 additive moonlight shafts from the opposite side.
 * @param {number} [options.cloudWhiteLayerAlphaMul=1] — 0..1 scales procedural *white* clouds (shadows unchanged). Play passes altitude ramp from `render.js`.
 * @param {number} [options.worldHours] — wrapped world hour in [0,24); used to evolve cloud-shadow projection through the day.
 */
export function drawEnvironmentalEffects(ctx, options) {
  const {
    cw,
    ch,
    tint,
    mistTile,
    lodDetail,
    time,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    cloudPresence = 1,
    cloudNoiseSeed = 0,
    cloudThreshold,
    cloudMinMul,
    cloudMaxMul,
    cloudAlphaMul,
    weatherPreset = 'clear',
    weatherBlizzardBlend01 = 0,
    rainIntensity = 0,
    windIntensity = 0,
    windDirRad = 0,
    screenTint,
    splashTargets,
    entityShadowSprites,
    earthquakeVisual01 = 0,
    sunLightRaysIntensity01 = 0,
    moonLightRaysIntensity01 = 0,
    cloudWhiteLayerAlphaMul = 1,
    worldHours
  } = options;
  // Clouds go gray with rain. Scales 0..~0.55 so even light rain starts feeling overcast.
  const rainI01 = Math.max(0, Math.min(1, Number(rainIntensity) || 0));
  const cloudDarken01 = rainI01 * 0.6;

  if (tint && typeof tint.r === 'number') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  const smoothWind = sampleSmoothedEnvWind(time, windIntensity, windDirRad);
  const windI01 = smoothWind.intensity01;
  const windDir = smoothWind.dirRad;

  drawSnesCloudParallax(ctx, {
    ch,
    timeSec: time,
    startX,
    startY,
    endX,
    endY,
    tileW,
    tileH,
    cloudPresence,
    cloudNoiseSeed,
    cloudThreshold,
    cloudMinMul,
    cloudMaxMul,
    cloudAlphaMul,
    cloudDarken01,
    windDirRad: windDir,
    windIntensity: windI01,
    cw,
    ch,
    worldHours,
    entityShadowSprites,
    whiteLayerAlphaMul: cloudWhiteLayerAlphaMul
  });

  // Lightning (both in-cloud flashes have already been baked into the clouds above,
  // so this call only handles ground bolts + screen flash).
  drawLightning(ctx, { cw, ch, tileW, tileH });

  if (mistTile?.biomeId === BIOMES.GHOST_WOODS.id) {
    drawGhostMistShaderLike(ctx, cw, ch, lodDetail, time);
  }

  const rainI = Math.max(0, Math.min(1, Number(rainIntensity) || 0));
  const blendRaw = Number(weatherBlizzardBlend01);
  const blizzardBlend = Math.max(
    0,
    Math.min(1, Number.isFinite(blendRaw) ? blendRaw : (weatherPreset === 'blizzard' ? 1 : 0))
  );
  const rainShare = 1 - blizzardBlend;
  const rainVisualI = rainI * rainShare;
  const snowVisualI = rainI * blizzardBlend;
  if (rainI > 0.001) {
    if (snowVisualI > 0.001) {
      // Blizzard precipitation: dense, wind-drifted flakes (not rain splashes/streak lines).
      drawBlizzardSnowflakes(ctx, time, snowVisualI, tileW, tileH, windDir, windI01, startX, startY, endX, endY, lodDetail);
    }
    if (rainVisualI > 0.001) {
      // World-space splashes on entities (ctx transform = camera world pixels).
      tickAndDrawRainSplashes(ctx, time, rainVisualI, splashTargets);
      // World-space streaks (same ctx transform as splashes / entities) so slant matches puddles.
      drawRainStreaks(ctx, time, rainVisualI, tileW, tileH, windDir, windI01, startX, startY, endX, endY, lodDetail);
    } else {
      rainSplashes.length = 0;
      rainSplashSpawnDebt = 0;
      rainLastTimeSec = -1;
      rainStreakScrollLastSec = -1;
      rainStreakScrollPxX = 0;
      rainStreakScrollPxY = 0;
    }  
  } else {
    rainSplashes.length = 0;
    rainSplashSpawnDebt = 0;
    rainLastTimeSec = -1;
    rainStreakScrollLastSec = -1;
    rainStreakScrollPxX = 0;
    rainStreakScrollPxY = 0;
  }

  if (screenTint && typeof screenTint.r === 'number' && (screenTint.a ?? 1) > 0.001) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.max(0, Math.min(1, screenTint.a ?? 1));
    ctx.fillStyle = `rgb(${screenTint.r | 0},${screenTint.g | 0},${screenTint.b | 0})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  const sunRayI = Math.max(0, Math.min(1, Number(sunLightRaysIntensity01) || 0));
  if (sunRayI > 0.004) {
    const cloudP = Math.max(0, Math.min(1, Number(cloudPresence) || 0));
    drawSunLightRaysScreenFx(ctx, cw, ch, time, sunRayI, cloudP, lodDetail);
  }
  const moonRayI = Math.max(0, Math.min(1, Number(moonLightRaysIntensity01) || 0));
  if (moonRayI > 0.004) {
    const cloudP = Math.max(0, Math.min(1, Number(cloudPresence) || 0));
    drawMoonLightRaysScreenFx(ctx, cw, ch, time, moonRayI, cloudP, lodDetail);
  }

  const eqVis = Math.max(0, Math.min(1, Number(earthquakeVisual01) || 0));
  if (eqVis > 0.008) {
    drawEarthquakeScreenFx(ctx, cw, ch, time, eqVis);
  }
}

/**
 * Volumetric-style weather layer (dense particles + sandstorm haze), timed as {@link rndVolumetricWeatherMs}.
 * Invoked from `render.js` after {@link drawEnvironmentalEffects} so perf HUD splits base weather vs volumetric cost.
 *
 * @param {CanvasRenderingContext2D} ctx — same world transform as precipitation passes.
 * @param {object} options
 * @param {number} options.cw
 * @param {number} options.ch
 * @param {number} options.time
 * @param {number} options.startX
 * @param {number} options.startY
 * @param {number} options.endX
 * @param {number} options.endY
 * @param {number} options.tileW
 * @param {number} options.tileH
 * @param {number} [options.lodDetail=0]
 * @param {object | null | undefined} options.macroData — map data for surface sampling.
 * @param {'clear' | 'cloudy' | 'rain' | 'blizzard' | 'sandstorm' | string} [options.weatherPreset]
 * @param {number} [options.weatherBlizzardBlend01=0]
 * @param {number} [options.weatherSandstormBlend01=0]
 * @param {number} [options.rainIntensity=0]
 * @param {number} [options.windIntensity=0]
 * @param {number} [options.windDirRad=0]
 * @param {number} [options.volumetricParticleDensity=0]
 * @param {number} [options.volumetricVolumeDepth=0.5]
 * @param {number} [options.volumetricFallSpeed=0.5]
 * @param {number} [options.volumetricWindCarry=0.5]
 * @param {number} [options.volumetricTurbulence=0.2]
 * @param {number} [options.volumetricAbsorptionBias=0.5]
 * @param {number} [options.volumetricSplashBias=0.5]
 * @param {'clear' | 'rain' | 'snow' | 'sandstorm'} [options.weatherVolumetricMode]
 */
export function drawVolumetricEnvironmentalLayer(ctx, options) {
  return renderPhaseMs('rndVolumetricWeatherMs', () => {
    const {
      cw,
      ch,
      time,
      startX,
      startY,
      endX,
      endY,
      tileW,
      tileH,
      lodDetail = 0,
      macroData,
      weatherPreset = 'clear',
      weatherBlizzardBlend01 = 0,
      weatherSandstormBlend01 = 0,
      rainIntensity = 0,
      windIntensity = 0,
      windDirRad = 0,
      volumetricParticleDensity = 0,
      volumetricVolumeDepth = 0.5,
      volumetricFallSpeed = 0.5,
      volumetricWindCarry = 0.5,
      volumetricTurbulence = 0.2,
      volumetricAbsorptionBias = 0.5,
      volumetricSplashBias = 0.5,
      weatherVolumetricMode = 'clear'
    } = options;

    const rainI = Math.max(0, Math.min(1, Number(rainIntensity) || 0));
    const vpd = Math.max(0, Math.min(1, Number(volumetricParticleDensity) || 0));
    const blendRaw = Number(weatherBlizzardBlend01);
    const blizzardBlend = Math.max(
      0,
      Math.min(1, Number.isFinite(blendRaw) ? blendRaw : weatherPreset === 'blizzard' ? 1 : 0)
    );
    const rainShare = 1 - blizzardBlend;
    const rainVisualI = rainI * rainShare;
    const snowVisualI = rainI * blizzardBlend;
    const ssb = Math.max(0, Math.min(1, Number(weatherSandstormBlend01) || 0));
    const sandstormVisualI = ssb;
    const precip = Math.max(rainVisualI * vpd, snowVisualI * vpd, sandstormVisualI * vpd);
    if (precip < 0.012 || !macroData) return;

    updateAndDrawVolumetricWeatherParticles(ctx, {
      timeSec: time,
      tileW,
      tileH,
      startX,
      startY,
      endX,
      endY,
      windDirRad,
      windIntensity01: windIntensity,
      lodDetail,
      macroData,
      rainVisualI,
      snowVisualI,
      sandstormVisualI,
      volumetricParticleDensity: vpd,
      volumetricVolumeDepth,
      volumetricFallSpeed,
      volumetricWindCarry,
      volumetricTurbulence,
      volumetricAbsorptionBias,
      volumetricSplashBias,
      weatherMode: weatherVolumetricMode
    });
  });
}

/**
 * Additive sunlight shafts with warm halo + lens flare circles.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 * @param {number} timeSec
 * @param {number} intensity01
 * @param {number} [cloudPresence01=0]
 * @param {number} [lodDetail=0]
 */
function drawSunLightRaysScreenFx(ctx, cw, ch, timeSec, intensity01, cloudPresence01 = 0, lodDetail = 0) {
  const inten = Math.max(0, Math.min(1, Number(intensity01) || 0));
  if (inten < 0.003) return;
  const clouds = Math.max(0, Math.min(1, Number(cloudPresence01) || 0));
  const cloudDamp = 1 - clouds * 0.42;
  const lod = Number(lodDetail) || 0;
  const nRays = lod >= 2 ? 6 : lod >= 1 ? 8 : 10;
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const tick = Math.floor(time * 8);
  const swayRaw = Math.sin(time * 0.38) * 10 + Math.sin(time * 0.73 + 1.1) * 5;
  const sway = Math.round(swayRaw / 4) * 4;
  const reach = Math.hypot(cw, ch) * 1.6;
  const sx = -cw * 0.14 + sway * 0.35;
  const sy = -ch * 0.1 + Math.round(Math.sin(time * 0.21) * 3);

  const baseAlpha = (0.1 + inten * 0.23) * inten * cloudDamp;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';

  // Main shafts.
  for (let i = 0; i < nRays; i++) {
    const u = nRays <= 1 ? 0.5 : i / (nRays - 1);
    const j = hash01Cell(i, tick, 0x71e4);
    const ang0 = 0.46 + u * 0.64 + (j - 0.5) * 0.055;
    const wedge = (0.038 + inten * 0.05) * (0.85 + 0.15 * hash01Cell(i * 5, tick, 0x88c1));
    const ang1 = ang0 + wedge;
    const c0 = Math.cos(ang0);
    const s0 = Math.sin(ang0);
    const c1 = Math.cos(ang1);
    const s1 = Math.sin(ang1);
    const x0 = sx + c0 * reach;
    const y0 = sy + s0 * reach;
    const x1 = sx + c1 * reach;
    const y1 = sy + s1 * reach;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const g = ctx.createLinearGradient(sx, sy, mx, my);
    const peak = baseAlpha * (0.52 + 0.48 * hash01Cell(i * 13, tick + 3, 0x4a39));
    g.addColorStop(0, 'rgba(255,252,240,0)');
    g.addColorStop(0.2, `rgba(255,244,210,${peak * 0.32})`);
    g.addColorStop(0.45, `rgba(255,236,175,${peak})`);
    g.addColorStop(0.74, `rgba(255,228,160,${peak * 0.55})`);
    g.addColorStop(1, 'rgba(255,215,140,0)');
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }

  // Sun core + broad halo.
  const haloR0 = Math.max(cw, ch) * (0.05 + 0.02 * inten);
  const haloR1 = Math.max(cw, ch) * (0.36 + 0.08 * inten);
  const halo = ctx.createRadialGradient(sx, sy, haloR0, sx, sy, haloR1);
  halo.addColorStop(0, `rgba(255,250,228,${Math.min(0.8, baseAlpha * 2.8)})`);
  halo.addColorStop(0.28, `rgba(255,236,185,${Math.min(0.62, baseAlpha * 1.9)})`);
  halo.addColorStop(0.62, `rgba(255,220,150,${Math.min(0.35, baseAlpha * 1.2)})`);
  halo.addColorStop(1, 'rgba(255,205,130,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, cw, ch);

  // Lens flare circles on optical axis (sun only).
  const cx = cw * 0.5;
  const cy = ch * 0.5;
  const ax = cx - sx;
  const ay = cy - sy;
  const axisLen = Math.hypot(ax, ay) || 1;
  const ux = ax / axisLen;
  const uy = ay / axisLen;
  const flareCount = lod >= 2 ? 2 : 3;
  for (let i = 0; i < flareCount; i++) {
    const t = 0.34 + i * 0.28;
    const fx = sx + ux * axisLen * t;
    const fy = sy + uy * axisLen * t;
    const fr = Math.max(8, Math.min(cw, ch) * (0.024 + (flareCount - i) * 0.009));
    const fg = ctx.createRadialGradient(fx, fy, fr * 0.08, fx, fy, fr);
    const a = baseAlpha * (0.2 + (flareCount - i) * 0.1);
    fg.addColorStop(0, `rgba(255,244,210,${Math.min(0.28, a)})`);
    fg.addColorStop(0.45, `rgba(255,232,176,${Math.min(0.16, a * 0.7)})`);
    fg.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }

  ctx.globalAlpha = Math.min(1, baseAlpha * 0.85);
  const wx0 = Math.round(sway * 0.5 / 8) * 8;
  const wash = ctx.createLinearGradient(wx0, 0, cw * 0.62 + wx0, ch);
  wash.addColorStop(0, 'rgba(255,248,220,0.42)');
  wash.addColorStop(0.28, 'rgba(255,238,190,0.14)');
  wash.addColorStop(0.55, 'rgba(255,230,170,0.05)');
  wash.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, cw, ch);

  ctx.restore();
}

/**
 * Additive moonlight shafts (cool tint), emitted from the opposite side of sunlight.
 * Intentionally avoids lens-flare circles to keep a softer nocturnal look.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 * @param {number} timeSec
 * @param {number} intensity01
 * @param {number} [cloudPresence01=0]
 * @param {number} [lodDetail=0]
 */
function drawMoonLightRaysScreenFx(ctx, cw, ch, timeSec, intensity01, cloudPresence01 = 0, lodDetail = 0) {
  const inten = Math.max(0, Math.min(1, Number(intensity01) || 0));
  if (inten < 0.003) return;
  const clouds = Math.max(0, Math.min(1, Number(cloudPresence01) || 0));
  const cloudDamp = 1 - clouds * 0.35;
  const lod = Number(lodDetail) || 0;
  const nRays = lod >= 2 ? 4 : lod >= 1 ? 5 : 6;
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const tick = Math.floor(time * 6.4);
  const swayRaw = Math.sin(time * 0.21 + 0.9) * 8 + Math.sin(time * 0.43 + 1.8) * 4;
  const sway = Math.round(swayRaw / 4) * 4;
  const reach = Math.hypot(cw, ch) * 1.5;
  const sx = cw * 1.14 + sway * 0.28;
  const sy = -ch * 0.08 + Math.round(Math.sin(time * 0.14) * 2);
  const baseAlpha = (0.06 + inten * 0.14) * inten * cloudDamp;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';

  for (let i = 0; i < nRays; i++) {
    const u = nRays <= 1 ? 0.5 : i / (nRays - 1);
    const j = hash01Cell(i, tick, 0x7f31);
    const ang0 = 2.03 + u * 0.56 + (j - 0.5) * 0.05;
    const wedge = (0.032 + inten * 0.035) * (0.86 + 0.14 * hash01Cell(i * 7, tick, 0x31d9));
    const ang1 = ang0 + wedge;
    const c0 = Math.cos(ang0);
    const s0 = Math.sin(ang0);
    const c1 = Math.cos(ang1);
    const s1 = Math.sin(ang1);
    const x0 = sx + c0 * reach;
    const y0 = sy + s0 * reach;
    const x1 = sx + c1 * reach;
    const y1 = sy + s1 * reach;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const g = ctx.createLinearGradient(sx, sy, mx, my);
    const peak = baseAlpha * (0.54 + 0.46 * hash01Cell(i * 11, tick + 2, 0x58cb));
    g.addColorStop(0, 'rgba(232,242,255,0)');
    g.addColorStop(0.24, `rgba(198,220,255,${peak * 0.32})`);
    g.addColorStop(0.5, `rgba(176,206,255,${peak})`);
    g.addColorStop(0.76, `rgba(160,188,244,${peak * 0.55})`);
    g.addColorStop(1, 'rgba(150,176,234,0)');
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }

  const haloR0 = Math.max(cw, ch) * (0.045 + 0.015 * inten);
  const haloR1 = Math.max(cw, ch) * (0.28 + 0.06 * inten);
  const halo = ctx.createRadialGradient(sx, sy, haloR0, sx, sy, haloR1);
  halo.addColorStop(0, `rgba(224,236,255,${Math.min(0.42, baseAlpha * 2.0)})`);
  halo.addColorStop(0.44, `rgba(170,196,238,${Math.min(0.2, baseAlpha * 0.95)})`);
  halo.addColorStop(1, 'rgba(148,174,224,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, cw, ch);

  ctx.globalAlpha = Math.min(1, baseAlpha * 0.9);
  const wx0 = Math.round(sway * 0.42 / 8) * 8;
  const wash = ctx.createLinearGradient(cw - wx0, 0, cw * 0.36 - wx0, ch);
  wash.addColorStop(0, 'rgba(190,214,255,0.26)');
  wash.addColorStop(0.3, 'rgba(168,196,240,0.12)');
  wash.addColorStop(0.62, 'rgba(146,174,220,0.04)');
  wash.addColorStop(1, 'rgba(132,162,208,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, cw, ch);

  ctx.restore();
}

/**
 * Cheap full-screen multiply vignette + a few horizontal scanlines (32-bit era vibe).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 * @param {number} timeSec
 * @param {number} intensity01
 */
function drawEarthquakeScreenFx(ctx, cw, ch, timeSec, intensity01) {
  const t = Math.max(0, Math.min(1, intensity01));
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const tScroll = Math.floor(time * 3.1);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const vignetteA = 0.035 * t + 0.11 * t * t;
  if (vignetteA > 0.002) {
    const cx = cw * 0.5;
    const cy = ch * 0.52;
    const r0 = Math.min(cw, ch) * (0.1 + 0.04 * t);
    const r1 = Math.max(cw, ch) * (0.62 + 0.08 * t);
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(72, 58, 48, 0)');
    g.addColorStop(1, `rgba(22, 18, 14, ${vignetteA})`);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }

  const nLines = 11;
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < nLines; i++) {
    const hy = hash01Cell(i, tScroll, 0x5e77 + i) * (ch - 2) + 1;
    const flicker =
      (0.012 + 0.055 * t) * (0.45 + 0.55 * hash01Cell(i * 3, Math.floor(time * 17.3), 0x91a3));
    const phase = (time * (3.8 + i * 0.55) + i * 2.17) % (Math.PI * 2);
    const alpha = flicker * (0.25 + 0.75 * Math.abs(Math.sin(phase)));
    ctx.fillStyle = `rgba(18, 16, 14, ${Math.max(0, Math.min(0.22, alpha))})`;
    ctx.fillRect(0, hy, cw, 1);
  }
  ctx.restore();
}

function wrapToSpan(v, min, max) {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 1e-6) return min;
  return min + ((((v - min) % span) + span) % span);
}

/**
 * Blizzard precipitation rendered as drifting snowflakes in world space.
 * Uses a hashed slot field + wrapped advection so flakes never "pop" at camera edges.
 */
function drawBlizzardSnowflakes(
  ctx,
  timeSec,
  intensity,
  tileW,
  tileH,
  windDirRad,
  windIntensity,
  startX,
  startY,
  endX,
  endY,
  lodDetail = 0
) {
  const time = Number.isFinite(timeSec) ? timeSec : 0;

  const tw = Math.max(1, Number(tileW) || 32);
  const th = Math.max(1, Number(tileH) || tw);
  const windI01 = Math.max(0, Math.min(1, Number(windIntensity) || 0));
  const liveDir = Number.isFinite(windDirRad) ? windDirRad : WIND_CLOUD_BLEND_BASELINE_DIR_RAD;
  const windTiles = getWindVelocityTilesPerSec(windI01, liveDir);

  const marginTiles = 7 + 6 * intensity;
  const xMin = Number(startX) - marginTiles;
  const xMax = Number(endX) + marginTiles;
  const yMin = Number(startY) - marginTiles;
  const yMax = Number(endY) + marginTiles;

  const lod = Number(lodDetail) || 0;
  const slotStep = lod >= 2 ? 2.05 : lod >= 1 ? 1.8 : 1.55;
  const threshold = Math.min(0.83, 0.33 + intensity * 0.42);
  const velX = windTiles.vx * (0.95 + intensity * 0.5);
  const velY = 2.6 + intensity * 1.9 + windTiles.vy * 0.45;
  const wiggleMagTiles = 0.06 + 0.2 * intensity;
  const spriteScale = 0.8 + intensity * 1.2;
  const alphaBase = 0.26 + intensity * 0.5;

  const sx0 = Math.floor(xMin / slotStep);
  const sx1 = Math.ceil(xMax / slotStep);
  const sy0 = Math.floor(yMin / slotStep);
  const sy1 = Math.ceil(yMax / slotStep);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'lighter';
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      const hExist = hash01Cell(sx, sy, 0x54f1);
      if (hExist > threshold) continue;
      const hJx = hash01Cell(sx, sy, 0x22ab);
      const hJy = hash01Cell(sx, sy, 0x6d13);
      const hSize = hash01Cell(sx, sy, 0x9911);
      const hTwinkle = hash01Cell(sx, sy, 0x39c1);
      const hPhase = hash01Cell(sx, sy, 0x1495);

      const baseX = sx * slotStep + (hJx - 0.5) * slotStep * 0.95;
      const baseY = sy * slotStep + (hJy - 0.5) * slotStep * 0.95;
      const wiggle = Math.sin(time * (1.35 + hTwinkle * 1.9) + hPhase * Math.PI * 2) * wiggleMagTiles;
      const advX = baseX + time * velX + wiggle;
      const advY = baseY + time * velY;
      const wx = wrapToSpan(advX, xMin, xMax);
      const wy = wrapToSpan(advY, yMin, yMax);

      const px = wx * tw;
      const py = wy * th;
      const flakeR = (0.75 + hSize * 1.45) * spriteScale;
      const twinkle = 0.72 + 0.28 * Math.sin(time * (2.2 + hTwinkle * 1.7) + hPhase * Math.PI * 2);
      ctx.globalAlpha = alphaBase * (0.65 + hTwinkle * 0.55) * twinkle;
      ctx.fillStyle = '#f8fcff';

      if (flakeR < 1.15) {
        ctx.fillRect(Math.round(px - 0.5), Math.round(py - 0.5), 1, 1);
      } else {
        const arm = flakeR * (1.45 + hSize * 0.5);
        const d = Math.max(1, Math.round(arm * 0.66));
        ctx.fillRect(Math.round(px - arm), Math.round(py - 0.5), Math.max(1, Math.round(arm * 2)), 1);
        ctx.fillRect(Math.round(px - 0.5), Math.round(py - arm), 1, Math.max(1, Math.round(arm * 2)));
        ctx.fillRect(Math.round(px - d), Math.round(py - d), Math.max(1, d * 2), 1);
        ctx.fillRect(Math.round(px - d), Math.round(py + d), Math.max(1, d * 2), 1);
      }
    }
  }
  ctx.restore();
}

const RAIN_HASH_CACHE = [];
/** Precomputed hash slots for rain streaks baked into the repeating tile. */
const RAIN_MAX_STREAKS = 900;

/** World-pixel period for tiled rain (one offscreen bake; viewport = many cheap `drawImage`). */
const RAIN_TILE_PX = 384;

let rainTileCanvas = null;
let rainTileCtx = null;
/** Rebuild offscreen tile when wind / intensity / LOD / tile scale bucket changes. */
let rainTileCacheKey = '';

function ensureRainHashCache() {
  if (RAIN_HASH_CACHE.length >= RAIN_MAX_STREAKS) return;
  for (let i = RAIN_HASH_CACHE.length; i < RAIN_MAX_STREAKS; i++) {
    // We cache 2 passes worth of hashes
    const pHashes = [];
    for (let pass = 0; pass < 2; pass++) {
      pHashes.push({
        hx: hash01Cell(i, 7919, 1 + pass * 11),
        hy: hash01Cell(i, 104729, 2 + pass * 11),
        hs: hash01Cell(i, 31337, 3 + pass * 11),
        hl: hash01Cell(i, 15485863, 4 + pass * 11)
      });
    }
    RAIN_HASH_CACHE.push(pHashes);
  }
}

function ensureRainTileCanvas() {
  if (typeof document === 'undefined') return;
  if (rainTileCanvas && rainTileCanvas.width === RAIN_TILE_PX) return;
  rainTileCanvas = document.createElement('canvas');
  rainTileCanvas.width = RAIN_TILE_PX;
  rainTileCanvas.height = RAIN_TILE_PX;
  rainTileCtx = rainTileCanvas.getContext('2d');
  if (rainTileCtx) {
    rainTileCtx.imageSmoothingEnabled = false;
  }
}

/**
 * Bakes a toroidal rain streak field into {@link rainTileCanvas}. Motion comes later from
 * scrolling tile placement (same slant vector as live wind + gravity).
 */
function rebuildRainTileIfStale(cacheKey, spec) {
  ensureRainTileCanvas();
  if (!rainTileCtx || cacheKey === rainTileCacheKey) return;
  rainTileCacheKey = cacheKey;

  const {
    intensity,
    dx,
    dy,
    vecMag,
    baseLen,
    horizontalBleed,
    passes,
    heavyPass,
    streakCount
  } = spec;

  const CW = RAIN_TILE_PX;
  const CH = RAIN_TILE_PX;
  const spanW = CW + horizontalBleed * 2 + 30;
  const spanH = CH + baseLen * 2 + 30;
  const wx0 = 0;
  const wy0 = 0;

  const tctx = rainTileCtx;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, CW, CH);
  tctx.save();
  tctx.beginPath();
  tctx.rect(0, 0, CW, CH);
  tctx.clip();

  ensureRainHashCache();
  const count = Math.max(24, Math.min(streakCount, RAIN_MAX_STREAKS));

  for (let pass = 0; pass < passes; pass++) {
    const isUnder = pass === 0 && heavyPass;
    tctx.globalAlpha = isUnder ? 0.14 + 0.22 * intensity : 0.3 + 0.5 * intensity;
    tctx.strokeStyle = isUnder ? '#b6c6e2' : '#d9e3f3';
    tctx.lineWidth = isUnder
      ? Math.max(1.4, 1.4 + 0.9 * intensity)
      : Math.max(1, 1 + 0.8 * intensity);
    tctx.lineCap = 'round';
    tctx.beginPath();

    for (let i = 0; i < count; i++) {
      const h = RAIN_HASH_CACHE[i][pass];
      const { hx, hy, hl } = h;
      const rawX = hx * spanW;
      const rawY = hy * spanH;
      const px = wx0 + ((rawX % spanW) + spanW) % spanW - horizontalBleed - 15;
      const py = wy0 + ((rawY % spanH) + spanH) % spanH - baseLen - 15;
      const len = baseLen * (0.8 + hl * 0.45);
      tctx.moveTo(px, py);
      tctx.lineTo(px - dx * len, py - dy * len);
    }
    tctx.stroke();
  }

  tctx.restore();
}

/**
 * Rain streaks in **world pixel space** (camera-translated ctx), matching splashes / wind.
 * Uses a **repeating offscreen tile**: expensive `stroke()` only when the look-bucket changes;
 * each frame we `drawImage` a small grid of tiles with a scroll offset (same motion as before).
 */
function drawRainStreaks(
  ctx,
  timeSec,
  intensity,
  tileW,
  tileH,
  windDirRad,
  windIntensity,
  startX,
  startY,
  endX,
  endY,
  lodDetail = 0
) {
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const tw = Math.max(1, Number(tileW) || 32);
  const th = Math.max(1, Number(tileH) || tw);
  const wx0 = Number(startX) * tw;
  const wy0 = Number(startY) * th;
  const worldW = Math.max(1, (Number(endX) - Number(startX)) * tw);
  const worldH = Math.max(1, (Number(endY) - Number(startY)) * th);

  const densityT = intensity * (1 + 0.55 * intensity);
  const lod = Number(lodDetail) || 0;
  const streakInTile = lod >= 2 ? 120 : lod >= 1 ? 200 : 280;

  const gravityPxSec = 850 + 520 * intensity;
  const windI01 = Math.max(0, Math.min(1, Number(windIntensity) || 0));
  const liveDir = Number.isFinite(windDirRad) ? windDirRad : WIND_CLOUD_BLEND_BASELINE_DIR_RAD;
  const wTiles = getWindVelocityTilesPerSec(windI01, liveDir);
  const k = 38;
  const windVxPxSec = wTiles.vx * tw * k;
  const windVyPxSec = wTiles.vy * th * k;
  const vx = windVxPxSec;
  const vy = Math.max(gravityPxSec * 0.2, gravityPxSec + windVyPxSec);
  const vecMag = Math.sqrt(vx * vx + vy * vy);
  const dx = vx / vecMag;
  const dy = vy / vecMag;

  const baseLen = 14 + 18 * intensity;
  const horizontalBleed = Math.abs(dx) * baseLen + Math.abs(vx) * 0.05;
  const heavyPass = intensity > 0.52 && lod < 2;
  const passes = heavyPass ? 2 : 1;

  const iBucket = Math.round(intensity * 14);
  const wBucket = Math.round(windI01 * 9);
  const dirBucket = Math.round(liveDir * 12);
  const twBucket = Math.round(tw);
  const cacheKey = `${lod}|${iBucket}|${wBucket}|${dirBucket}|${twBucket}|${passes}|${streakInTile}`;

  rebuildRainTileIfStale(cacheKey, {
    intensity,
    dx,
    dy,
    vecMag,
    baseLen,
    horizontalBleed,
    passes,
    heavyPass,
    streakCount: Math.min(
      RAIN_MAX_STREAKS,
      Math.round(streakInTile * Math.min(1.55, Math.max(0.75, densityT)))
    )
  });

  if (!rainTileCanvas) {
    return;
  }

  const CW = RAIN_TILE_PX;
  const CH = RAIN_TILE_PX;

  const margin = CW + horizontalBleed + baseLen;
  const xMin = wx0 - margin;
  const xMax = wx0 + worldW + margin;
  const yMin = wy0 - margin;
  const yMax = wy0 + worldH + margin;

  const dtRaw = rainStreakScrollLastSec >= 0 ? time - rainStreakScrollLastSec : 0;
  const driftDt = !Number.isFinite(dtRaw) || dtRaw < 0 || dtRaw > 0.25 ? 0 : dtRaw;
  rainStreakScrollLastSec = time;
  const scrollMul = 0.82;
  rainStreakScrollPxX += vx * driftDt * scrollMul;
  rainStreakScrollPxY += vy * driftDt * scrollMul;

  const ox = rainStreakScrollPxX;
  const oy = rainStreakScrollPxY;
  const startI = Math.floor((xMin - ox) / CW);
  const endI = Math.ceil((xMax - ox) / CW);
  const startJ = Math.floor((yMin - oy) / CH);
  const endJ = Math.ceil((yMax - oy) / CH);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let j = startJ; j <= endJ; j++) {
    for (let i = startI; i <= endI; i++) {
      ctx.drawImage(rainTileCanvas, i * CW + ox, j * CH + oy);
    }
  }
  ctx.restore();
}

// ====================================================================
// Rain splash particles — cheap entity-bound droplet hits.
// Kept as a small pooled array (≤ RAIN_SPLASH_MAX) so memory is flat.
// ====================================================================
/** @type {Array<{x:number,y:number,t0:number,life:number,variant:number}>} */
const rainSplashes = [];
const RAIN_SPLASH_MAX = 72;
const RAIN_SPLASH_LIFE_SEC = 0.34;
let rainSplashSpawnDebt = 0;
let rainLastTimeSec = -1;

function tickAndDrawRainSplashes(ctx, timeSec, intensity, splashTargets) {
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  let dt = rainLastTimeSec >= 0 ? time - rainLastTimeSec : 0;
  if (!Number.isFinite(dt) || dt < 0 || dt > 0.25) dt = 0; // pause/seek guard
  rainLastTimeSec = time;

  // Age out expired splashes (swap-remove).
  for (let i = rainSplashes.length - 1; i >= 0; i--) {
    if (time - rainSplashes[i].t0 >= rainSplashes[i].life) {
      rainSplashes[i] = rainSplashes[rainSplashes.length - 1];
      rainSplashes.pop();
    }
  }

  // Spawn new splashes proportional to rain × entities × dt.
  const targets = Array.isArray(splashTargets) ? splashTargets : null;
  if (dt > 0 && targets && targets.length > 0) {
    // Per-entity rate grows with intensity; cap total so crowded scenes don't explode.
    const ratePerSec = Math.min(42, 2.2 * intensity * targets.length);
    rainSplashSpawnDebt += ratePerSec * dt;
    while (rainSplashSpawnDebt >= 1 && rainSplashes.length < RAIN_SPLASH_MAX) {
      rainSplashSpawnDebt -= 1;
      const tgt = targets[(Math.random() * targets.length) | 0];
      if (!tgt) continue;
      const offX = (Math.random() - 0.5) * (tgt.w || 16) * 0.85;
      const offY = (Math.random() * 0.35 - 0.05) * (tgt.h || 24);
      rainSplashes.push({
        x: (tgt.x || 0) + offX,
        y: (tgt.yTop || 0) + offY,
        t0: time,
        life: RAIN_SPLASH_LIFE_SEC * (0.75 + Math.random() * 0.5),
        variant: (Math.random() * 3) | 0
      });
    }
  } else {
    rainSplashSpawnDebt = 0;
  }

  if (rainSplashes.length === 0) return;

  // Draw in world-pixel space (ctx transform comes from render.js camera).
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#eaf0ff';
  ctx.fillStyle = '#eaf0ff';
  for (const s of rainSplashes) {
    const t01 = Math.max(0, Math.min(1, (time - s.t0) / Math.max(1e-4, s.life)));
    if (t01 >= 1) continue;
    const r = 1 + t01 * 4.2;
    const a = (1 - t01) * 0.85;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, Math.PI, Math.PI * 2, false); // upward-opening crown
    ctx.stroke();
    if (s.variant !== 2) {
      ctx.fillRect(Math.round(s.x - r - 0.5), Math.round(s.y - 0.5), 1, 1);
      ctx.fillRect(Math.round(s.x + r - 0.5), Math.round(s.y - 0.5), 1, 1);
      if (s.variant === 1 && r > 2.5) {
        ctx.fillRect(Math.round(s.x - 0.5), Math.round(s.y - r - 0.5), 1, 1);
      }
    }
  }
  ctx.restore();
}

/**
 * Draws the charge bar for the digging ability.
 */
export function drawDigChargeBar(ctx, options) {
  const { latchGround, player, cw, ch } = options;
  if (
    latchGround &&
    !!player.grounded &&
    isPlayGroundDigShiftHeld() &&
    !player.digBurrowMode &&
    player.digCharge01 > 0
  ) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pillW = Math.min(280, cw * 0.44);
    const pillH = 22;
    const rad = pillH / 2;
    const px0 = (cw - pillW) * 0.5;
    const py0 = ch - 72;
    const pad = 4;
    const prog = Math.min(1, player.digCharge01);
    ctx.beginPath();
    ctx.moveTo(px0 + rad, py0);
    ctx.arcTo(px0 + pillW, py0, px0 + pillW, py0 + pillH, rad);
    ctx.arcTo(px0 + pillW, py0 + pillH, px0, py0 + pillH, rad);
    ctx.arcTo(px0, py0 + pillH, px0, py0, rad);
    ctx.arcTo(px0, py0, px0 + pillW, py0, rad);
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (prog > 0) {
      const innerW = (pillW - pad * 2) * prog;
      ctx.beginPath();
      const ix = px0 + pad;
      const iy = py0 + pad;
      const ih = pillH - pad * 2;
      const ir = ih / 2;
      ctx.moveTo(ix + ir, iy);
      ctx.arcTo(ix + innerW, iy, ix + innerW, iy + ih, ir);
      ctx.arcTo(ix + innerW, iy + ih, ix, iy + ih, ir);
      ctx.arcTo(ix, iy + ih, ix, iy, ir);
      ctx.arcTo(ix, iy, ix + innerW, iy, ir);
      ctx.closePath();
      ctx.fillStyle = 'rgba(135, 206, 250, 0.95)';
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Segment fill colors aligned with `character-selector.css` `.player-field-charge__fill--n`. */
const FIELD_CHARGE_SEG_STYLE = [
  { a: 'rgba(120,210,255,0.92)', b: 'rgba(160,230,255,0.92)' },
  { a: 'rgba(255,197,116,0.94)', b: 'rgba(255,225,146,0.94)' },
  { a: 'rgba(255,116,116,0.94)', b: 'rgba(255,165,126,0.94)' },
  { a: 'rgba(200,140,255,0.94)', b: 'rgba(255,210,255,0.94)' },
  /** Earthquake tier-5 bar — hot rim + white core (reads as “overcharge”). */
  { a: 'rgba(255,248,200,0.96)', b: 'rgba(255,255,255,0.98)' }
];

/**
 * Field charge meter on the play canvas (4 segments by default; Earthquake uses 5).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ appMode: string, playInputState: import('../main/play-input-state.js').playInputState, cw: number, ch: number, timeSec?: number }} options
 */
export function drawFieldCombatChargeBar(ctx, options) {
  const { appMode, playInputState, cw, ch, timeSec = 0 } = options;
  if (appMode !== 'play') return;
  const snap = playInputState.fieldChargeUiActive;
  if (!snap || typeof snap.moveId !== 'string') return;
  const p = Math.max(0, Math.min(1, Number(snap.charge01) || 0));
  if (p <= 0.005) return;

  const isEarthquake = snap.moveId === 'earthquake';
  const progresses = isEarthquake ? getEarthquakeChargeBarProgresses(p) : getChargeBarProgresses(p);
  const lvl = isEarthquake ? getEarthquakeChargeLevel(p) : getChargeLevel(p);
  const slotLab = snap.slot === 'l' ? 'LMB' : snap.slot === 'r' ? 'RMB' : 'MMB';
  const moveLab =
    snap.moveId === 'cut' ? 'Cut' : snap.moveId === 'tackle' ? 'Tackle' : getBindableMoveLabel(snap.moveId);
  const scale = Math.min(1.9, Math.max(1.12, ch / 450, cw / 1280));
  const barW = Math.min(
    Math.round((isEarthquake ? 400 : 360) * Math.min(scale, 1.32)),
    cw * 0.6
  );
  const barH = Math.max(20, Math.round(16 * scale));
  const gap = Math.max(2, Math.round(3 * scale));
  const pad = Math.max(2, Math.round(2 * scale));
  const labelPx = Math.min(28, Math.max(18, Math.round(14 * scale)));
  const px0 = (cw - barW) * 0.5;
  const py0 = ch - Math.round(132 + barH * 0.55 + labelPx);
  const label = `${slotLab} · ${moveLab}  L${lvl}  ${Math.round(p * 100)}%`;
  const nSeg = isEarthquake ? 5 : 4;
  const segW = (barW - pad * 2 - gap * (nSeg - 1)) / nSeg;
  const pulse = 0.5 + 0.5 * Math.sin((timeSec || 0) * 6.8);
  const FULL = 0.994;
  const t = timeSec || 0;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = Math.max(2, Math.round(2 * scale));
  ctx.beginPath();
  const outerR = Math.min(11, Math.max(6, Math.round(barH * 0.48)));
  ctx.moveTo(px0 + outerR, py0);
  ctx.arcTo(px0 + barW, py0, px0 + barW, py0 + barH, outerR);
  ctx.arcTo(px0 + barW, py0 + barH, px0, py0 + barH, outerR);
  ctx.arcTo(px0, py0 + barH, px0, py0, outerR);
  ctx.arcTo(px0, py0, px0 + barW, py0, outerR);
  ctx.closePath();
  ctx.stroke();

  for (let i = 0; i < nSeg; i++) {
    const sx = px0 + pad + i * (segW + gap);
    const sy = py0 + pad;
    const sh = barH - pad * 2;
    const pn = progresses[i];
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    const ir = Math.min(6, sh / 2);
    ctx.moveTo(sx + ir, sy);
    ctx.arcTo(sx + segW, sy, sx + segW, sy + sh, ir);
    ctx.arcTo(sx + segW, sy + sh, sx, sy + sh, ir);
    ctx.arcTo(sx, sy + sh, sx, sy, ir);
    ctx.arcTo(sx, sy, sx + segW, sy, ir);
    ctx.closePath();
    ctx.fill();

    if (pn > 0.002) {
      const fillW = Math.max(0, segW * pn);
      const g = ctx.createLinearGradient(sx, sy, sx + fillW, sy);
      const st = FIELD_CHARGE_SEG_STYLE[Math.min(i, FIELD_CHARGE_SEG_STYLE.length - 1)];
      const isFifth = isEarthquake && i === 4;
      const pulseHi = 0.5 + 0.5 * Math.sin(t * 16.5);
      const strobe = isFifth && pn >= FULL ? (Math.floor(t * 11) % 2 === 0 ? 1 : 0) : 0;
      const boost =
        pn >= FULL
          ? isFifth
            ? 0.1 + 0.38 * pulseHi + strobe * 0.42
            : 0.06 + 0.1 * pulse
          : 0;
      g.addColorStop(0, st.a);
      g.addColorStop(1, st.b);
      ctx.fillStyle = g;
      ctx.globalAlpha = Math.min(1, 0.88 + boost);
      ctx.beginPath();
      ctx.moveTo(sx + ir, sy);
      ctx.arcTo(sx + fillW, sy, sx + fillW, sy + sh, ir);
      ctx.arcTo(sx + fillW, sy + sh, sx, sy + sh, ir);
      ctx.arcTo(sx, sy + sh, sx, sy, ir);
      ctx.arcTo(sx, sy, sx + fillW, sy, ir);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${labelPx}px system-ui,Segoe UI,sans-serif`;
  ctx.fillStyle = 'rgba(225,240,255,0.92)';
  ctx.strokeStyle = 'rgba(0,20,40,0.55)';
  ctx.lineWidth = Math.max(3, Math.round(labelPx * 0.24));
  const labelY = py0 + barH + Math.round(6 * scale);
  ctx.strokeText(label, cw * 0.5, labelY);
  ctx.fillText(label, cw * 0.5, labelY);
  ctx.restore();
}

/**
 * One-shot diagonal “shine” sweep on the player sprite when a field-charge HUD segment completes.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   pxL: number,
 *   pxT: number,
 *   pxW: number,
 *   pxH: number,
 *   shineStartMs?: number,
 *   shineDurMs?: number,
 *   alphaMul?: number
 * }} opts
 */
export function drawPlayerFieldChargeShineOverlay(ctx, opts) {
  const pxL = Number(opts.pxL);
  const pxT = Number(opts.pxT);
  const pxW = Number(opts.pxW);
  const pxH = Number(opts.pxH);
  const start = Number(opts.shineStartMs);
  if (!Number.isFinite(pxL) || !Number.isFinite(pxT) || !Number.isFinite(pxW) || !Number.isFinite(pxH)) return;
  if (!Number.isFinite(start)) return;
  const dur = Math.max(80, Number(opts.shineDurMs) || 340);
  const u = (performance.now() - start) / dur;
  if (u < 0 || u > 1) return;
  const alphaM = Math.max(0, Math.min(1, Number(opts.alphaMul) || 1));
  const envelope = (1 - u) * (1 - u);
  const peak = 0.9 * envelope * alphaM;
  if (peak <= 0.002) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pxL, pxT, pxW, pxH);
  ctx.clip();

  const sweep = u;
  const x0 = pxL - pxW * 0.55 + pxW * 1.35 * sweep;
  const y0 = pxT - pxH * 0.08;
  const x1 = x0 + pxW * 0.9;
  const y1 = pxT + pxH * 1.08;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.46, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,252,230,${peak})`);
  g.addColorStop(0.54, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 1;
  ctx.fillRect(pxL - 4, pxT - 4, pxW + 8, pxH + 8);
  ctx.restore();
}
