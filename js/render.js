import { BIOMES } from './biomes.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell, seededHash, parseShape } from './tessellation-logic.js';
import { AnimationRenderer } from './animation-renderer.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_VEGETATION,
  GRASS_TILES,
  TREE_TILES,
  getGrassVariant,
  getTreeType,
  getGrassParams,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  scatterHasWindSway,
  isSortableScatter,
  tileSurfaceAllowsScatterVegetation
} from './biome-tiles.js';
import { getMicroTile, MACRO_TILE_STRIDE, foliageDensity, foliageType } from './chunking.js';
import {
  canWalkMicroTile,
  formalTreeTrunkOverlapsMicroCell,
  getFormalTreeTrunkWorldXSpan,
  scatterPhysicsCircleOverlapsMicroCellAny,
  scatterPhysicsCircleAtOrigin,
  EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER
} from './walkability.js';
import { validScatterOriginMicro, scatterItemKeyIsTree } from './scatter-pass2-debug.js';
import { circleAabbIntersectsRect } from './main/play-collider-overlay-cache.js';
import { isGroundDigLatchEligible, isPlayerIdleOnWaitingFrame } from './player.js';
import { imageCache } from './image-cache.js';
import { POKEMON_HEIGHTS } from './pokemon/pokemon-heights.js';
import { wildSexHudLabel } from './pokemon/pokemon-sex.js';
import { getWildPokemonEntities } from './wild-pokemon/wild-pokemon-manager.js';
import { activeProjectiles, activeParticles } from './moves/moves-manager.js';
import {
  ensurePokemonSheetsLoaded,
  getResolvedSheets,
  resolvePlayerLmbAttackSheetAndSlice
} from './pokemon/pokemon-asset-loader.js';
import { PMD_MON_SHEET } from './pokemon/pmd-default-timing.js';
import {
  resolvePmdFrameSpecForSlice,
  resolveCanonicalPmdH,
  worldFeetFromPivotCell
} from './pokemon/pmd-layout-metrics.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles
} from './pokemon/pokemon-combat-hurtbox.js';
import {
  speciesHasFlyingType,
  speciesHasGroundType,
  speciesHasSmoothLevitationFlight
} from './pokemon/pokemon-type-helpers.js';
import { isGhostPhaseShiftBurrowEligibleDex } from './wild-pokemon/ghost-phase-shift.js';
import { playInputState } from './main/play-input-state.js';
import { aimAtCursor } from './main/play-mouse-combat.js';
import {
  activeCrystalDrops,
  activeCrystalShards,
  getActiveDetailHitPulses,
  getDetailHitShake01,
  getActiveDetailHitHpBars,
  activeSpawnedSmallCrystals,
  isPlayDetailScatterOriginDestroyed
} from './main/play-crystal-tackle.js';
import {
  getBorrowDigPlaceholderDex,
  isUndergroundBurrowerDex,
  speciesUsesBorrowedDiglettDigVisual
} from './wild-pokemon/underground-burrow.js';
import {
  defaultPortraitSlugForBalloon,
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from './pokemon/spritecollab-portraits.js';
import {
  CLASSIC_BALLOON_FRAME_ANIM_SEC,
  PORTRAIT_REVEAL_AFTER_SEC
} from './pokemon/emotion-display-timing.js';

import {
  PLAY_CHUNK_SIZE,
  PLAY_BAKE_TILE_PX,
  WATER_ANIM_SRC_W,
  WATER_ANIM_SRC_H,
  PLAY_SEA_OVERLAY_ALPHA_LOD01,
  VEG_MULTITILE_OVERLAP_PX,
  GRASS_DEFER_AROUND_PLAYER_DELTAS,
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render/render-constants.js';
import { computePlayViewState } from './render/play-view-camera.js';
import { setPlayCameraSnapshot, clearPlayCameraSnapshot } from './render/play-camera-snapshot.js';
import {
  syncPlayChunkCache,
  playChunkMap,
  enqueuePlayChunkBake,
  dequeuePlayChunkBakes,
  getPlayChunkBakeQueueSize
} from './render/play-chunk-cache.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import {
  clearGrassFireStateForNewMap,
  grassFireVisualPhaseAt,
  grassFireCharredRegrowth01
} from './play-grass-fire.js';
import { bakeChunk } from './render/play-chunk-bake.js';
import { drawCachedMapOverview } from './render/map-overview-cache.js';
import { renderMinimap } from './render/render-minimap.js';
import { getFormalTreeCanopyComposite, getScatterTopCanopyComposite } from './render/canopy-sway-cache.js';
import {
  FIRE_FRAME_W,
  FIRE_FRAME_H,
  BURN_START_FRAME,
  BURN_START_FRAMES
} from './moves/move-constants.js';

import './render/render-debug-hotkeys.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p
 */
function drawBatchedProjectile(ctx, p, tileW, tileH, snapPx, time) {
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
  } else if (p.type === 'waterGunShot' || p.type === 'bubbleShot') {
    ctx.fillStyle = p.type === 'bubbleShot' ? 'rgba(235,248,255,0.6)' : 'rgba(110,185,255,0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    const r = p.type === 'bubbleShot' ? Math.max(5, tileW * 0.22) : Math.max(4, tileW * 0.17);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    if (p.type === 'bubbleShot') ctx.stroke();
  } else if (p.type === 'flamethrowerShot' || p.type === 'incinerateCore' || p.type === 'incinerateShard') {
    ctx.fillStyle = p.type === 'flamethrowerShot' ? '#ff6a00' : '#ff4500';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(3, tileW * (p.type === 'incinerateShard' ? 0.1 : 0.14)), 0, Math.PI * 2);
    ctx.fill();
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

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p
 */
function drawBatchedParticle(ctx, p, tileW, tileH, snapPx) {
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
  } else {
    ctx.fillStyle = '#ffff88';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.08) * a, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Play collider overlay: walk feet on the ground plane + optional dashed Z axis + body circle
 * at `item.airZ` tiles high (matches sprite / projectile `z` convention).
 * @param {{ type: string, x: number, y: number, dexId?: number, animMoving?: boolean, airZ?: number, showAirGroundTether?: boolean }} item
 */
function drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache) {
  const zLift = Math.max(0, Number(item.airZ) || 0);
  const r = 0.32 * Math.min(tileW, tileH);
  const dex = item.dexId ?? 94;
  const ft = worldFeetFromPivotCell(item.x, item.y, imageCache, dex, !!item.animMoving);
  const fcx = snapPx(ft.x * tileW);
  const fcyGround = snapPx(ft.y * tileH);
  const fcyBody = snapPx(ft.y * tileH - zLift * tileH);

  const showAirTether =
    item.showAirGroundTether !== undefined ? !!item.showAirGroundTether : zLift > 0.02;

  if (zLift > 0.02 && showAirTether) {
    ctx.strokeStyle = 'rgba(200, 255, 220, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(fcx, fcyGround);
    ctx.lineTo(fcx, fcyBody);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(0, 255, 140, 0.3)';
    ctx.fillStyle = 'rgba(0, 255, 140, 0.05)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(fcx, fcyGround, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(0, 255, 140, 0.58)';
  ctx.fillStyle = 'rgba(0, 255, 140, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(fcx, fcyBody, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(fcx - 2, fcyBody - 2, 4, 4);
}

/** Combat hurtbox (damage) — sprite-centered XY, same z lift as body circle; not walk feet. */
function drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx) {
  const zLift = Math.max(0, Number(item.airZ) || 0);
  const dex = item.dexId ?? 94;
  const { hx, hy } = getPokemonHurtboxCenterWorldXY(item.x, item.y, dex);
  const hr = getPokemonHurtboxRadiusTiles(dex);
  const hcx = snapPx(hx * tileW);
  const hcy = snapPx(hy * tileH - zLift * tileH);
  const rx = Math.max(2, hr * tileW);
  const ry = Math.max(2, hr * tileH);

  ctx.strokeStyle = 'rgba(255, 130, 55, 0.92)';
  ctx.fillStyle = 'rgba(255, 100, 40, 0.07)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.ellipse(hcx, hcy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 200, 140, 0.95)';
  ctx.fillRect(hcx - 2, hcy - 2, 4, 4);
}

function drawDetailHitHpBar(ctx, bar, tileW, tileH, snapPx) {
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

function drawDetailHitPulse(ctx, pulse, tileW, tileH, snapPx) {
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

export {
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_TOP_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render/render-constants.js';

export { loadTilesetImages } from './render/load-tileset-images.js';

let didWarnTerrainSetRoles = false;
/** @type {Map<string, number>} */
const jumpSerialByEntityKey = new Map();
/** @type {Array<{ x: number, y: number, age: number, maxAge: number, seed: number }>} */
const activeJumpRings = [];
let jumpRingLastTimeSec = null;
/** @type {Array<{ x: number, y: number, vx: number, vy: number, age: number, maxAge: number, seed: number }>} */
const activeRunDustPuffs = [];
/** @type {Map<string, number>} */
const runDustLastSpawnByEntityKey = new Map();
let runDustLastTimeSec = null;
let lastPlayChunkFrameStats = {
  mode: 'idle',
  totalVisible: 0,
  drawnVisible: 0,
  missingVisible: 0,
  bakedThisFrame: 0,
  bakeBudget: 0,
  bakeBoost: 0,
  queueSize: 0
};
let playChunkBakeBoost = 0;
let playChunkBakeStableFrames = 0;

function resetPlayChunkBakeAutoTuner() {
  playChunkBakeBoost = 0;
  playChunkBakeStableFrames = 0;
}

function getAdaptivePlayChunkBakeBudget({
  lodDetail,
  cachedVisibleChunks,
  missingVisibleChunks,
  queueSize,
  totalVisibleChunks
}) {
  let budget = lodDetail >= 2 ? 1 : 2;
  if (cachedVisibleChunks === 0 && missingVisibleChunks > 0) budget = Math.max(budget, 8);
  else if (missingVisibleChunks >= 10) budget = Math.max(budget, 4);
  if (queueSize >= 48) budget = Math.max(budget, 3);

  const severeMissing = Math.max(10, Math.floor(totalVisibleChunks * 0.45));
  const severeQueue = queueSize >= 96;
  const mediumPressure = missingVisibleChunks >= 6 || queueSize >= 36;
  const highPressure = missingVisibleChunks >= severeMissing || severeQueue;
  const coldStart = cachedVisibleChunks === 0 && missingVisibleChunks > 0;
  const steadyState = missingVisibleChunks === 0 && queueSize === 0;

  if (coldStart) playChunkBakeBoost = Math.max(playChunkBakeBoost, 6);
  if (highPressure) playChunkBakeBoost = Math.min(8, playChunkBakeBoost + 2);
  else if (mediumPressure) playChunkBakeBoost = Math.min(8, playChunkBakeBoost + 1);

  if (steadyState) {
    playChunkBakeStableFrames++;
    if (playChunkBakeStableFrames >= 10 && playChunkBakeBoost > 0) {
      playChunkBakeBoost -= 1;
      playChunkBakeStableFrames = 0;
    }
  } else {
    playChunkBakeStableFrames = 0;
    if (!mediumPressure && playChunkBakeBoost > 0) {
      playChunkBakeBoost -= 1;
    }
  }

  budget = Math.max(budget, budget + playChunkBakeBoost);
  return Math.min(12, Math.max(1, budget));
}

export function getPlayChunkFrameStats() {
  return lastPlayChunkFrameStats;
}

function spawnJumpRingAt(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  activeJumpRings.push({
    x,
    y,
    age: 0,
    maxAge: 0.34,
    seed: (x * 92821.11 + y * 71933.07) % 1
  });
  if (activeJumpRings.length > 72) {
    activeJumpRings.splice(0, activeJumpRings.length - 72);
  }
}

function updateJumpRings(timeSec) {
  const t = Number(timeSec) || 0;
  const dt =
    jumpRingLastTimeSec == null ? 0 : Math.max(0, Math.min(0.08, t - jumpRingLastTimeSec));
  jumpRingLastTimeSec = t;
  if (dt <= 0) return;
  for (let i = activeJumpRings.length - 1; i >= 0; i--) {
    const fx = activeJumpRings[i];
    fx.age += dt;
    if (fx.age >= fx.maxAge) activeJumpRings.splice(i, 1);
  }
}

function trackJumpStartRings(renderItems) {
  const seen = new Set();
  for (const item of renderItems) {
    if (item.type !== 'player' && item.type !== 'wild') continue;
    const key = item.type === 'player' ? 'player' : `wild:${item.entityKey ?? ''}`;
    if (!key || key === 'wild:') continue;
    seen.add(key);
    const serialRaw = Number(item.jumpSerial);
    const serial = Number.isFinite(serialRaw) ? Math.max(0, Math.floor(serialRaw)) : 0;
    const prevSerial = jumpSerialByEntityKey.get(key);
    if (prevSerial != null && serial > prevSerial) {
      spawnJumpRingAt((item.x ?? 0) + 0.5, (item.y ?? 0) + 0.5);
    }
    jumpSerialByEntityKey.set(key, serial);
  }
  for (const k of jumpSerialByEntityKey.keys()) {
    if (!seen.has(k)) jumpSerialByEntityKey.delete(k);
  }
}

function spawnRunDustAt(x, y, vx, vy, seed = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  activeRunDustPuffs.push({
    x,
    y,
    vx: Number.isFinite(vx) ? vx : 0,
    vy: Number.isFinite(vy) ? vy : 0,
    age: 0,
    maxAge: 0.24,
    seed
  });
  if (activeRunDustPuffs.length > 180) {
    activeRunDustPuffs.splice(0, activeRunDustPuffs.length - 180);
  }
}

function updateRunDustPuffs(timeSec) {
  const t = Number(timeSec) || 0;
  const dt =
    runDustLastTimeSec == null ? 0 : Math.max(0, Math.min(0.08, t - runDustLastTimeSec));
  runDustLastTimeSec = t;
  if (dt <= 0) return;
  for (let i = activeRunDustPuffs.length - 1; i >= 0; i--) {
    const puff = activeRunDustPuffs[i];
    puff.age += dt;
    puff.x += puff.vx * dt * 0.08;
    puff.y += puff.vy * dt * 0.08;
    puff.vx *= Math.max(0, 1 - dt * 9);
    puff.vy *= Math.max(0, 1 - dt * 9);
    if (puff.age >= puff.maxAge) activeRunDustPuffs.splice(i, 1);
  }
}

function trackRunningDust(renderItems, timeSec) {
  const t = Number(timeSec) || 0;
  const seen = new Set();
  for (const item of renderItems) {
    if (item.type !== 'player' && item.type !== 'wild') continue;
    const key = item.type === 'player' ? 'player' : `wild:${item.entityKey ?? ''}`;
    if (!key || key === 'wild:') continue;
    seen.add(key);
    if (!item.grounded || !item.animMoving) continue;
    const vx = Number(item.vx) || 0;
    const vy = Number(item.vy) || 0;
    const speed = Math.hypot(vx, vy);
    if (speed < 0.1) continue;
    const spawnInterval = item.type === 'player' ? 0.06 : 0.09;
    const last = runDustLastSpawnByEntityKey.get(key) ?? -1e9;
    if (t - last < spawnInterval) continue;
    runDustLastSpawnByEntityKey.set(key, t);
    const nx = vx / speed;
    const ny = vy / speed;
    const jitter =
      ((Math.sin((item.x ?? 0) * 11.13 + (item.y ?? 0) * 7.91 + t * 31.7) + 1) * 0.5 - 0.5) *
      0.08;
    spawnRunDustAt(
      (item.x ?? 0) + 0.5 - nx * 0.24 + jitter,
      (item.y ?? 0) + 0.62 - ny * 0.18,
      -vx * 0.22,
      -vy * 0.22,
      ((item.x ?? 0) * 17.17 + (item.y ?? 0) * 29.9 + t) % 1
    );
  }
  for (const k of runDustLastSpawnByEntityKey.keys()) {
    if (!seen.has(k)) runDustLastSpawnByEntityKey.delete(k);
  }
}

function drawRunDustPuff(ctx, puff, tileW, tileH, snapPx) {
  const t = Math.max(0, Math.min(1, puff.age / Math.max(0.001, puff.maxAge)));
  const a = 1 - t;
  const px = snapPx(puff.x * tileW);
  const py = snapPx(puff.y * tileH);
  const rx = Math.max(1.5, tileW * (0.05 + 0.085 * t));
  const ry = Math.max(1, tileH * (0.03 + 0.055 * t));
  const hue = 40 + Math.floor((puff.seed || 0) * 12);
  ctx.fillStyle = `hsla(${hue}, 30%, 74%, ${0.32 * a})`;
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawJumpRing(ctx, fx, tileW, tileH, snapPx) {
  const t = Math.max(0, Math.min(1, fx.age / Math.max(0.001, fx.maxAge)));
  const a = 1 - t;
  const px = snapPx(fx.x * tileW);
  const py = snapPx(fx.y * tileH);
  const baseR = Math.max(5, Math.min(tileW, tileH) * 0.22);
  const rx = baseR + Math.min(tileW, tileH) * 0.42 * t;
  const ry = Math.max(2, rx * 0.46);
  const hue = 188 + Math.floor((fx.seed || 0) * 20);
  ctx.strokeStyle = `hsla(${hue}, 95%, 78%, ${0.85 * a})`;
  ctx.lineWidth = Math.max(1.6, tileW * 0.05);
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export function render(canvas, data, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data) return;

  if (!didWarnTerrainSetRoles) {
    const terrainRoleProblems = TessellationEngine.validateAllTerrainSets();
    if (terrainRoleProblems.length > 0) {
      console.warn('[Tessellation] Terrain sets with missing/unknown roles:', terrainRoleProblems);
    }
    didWarnTerrainSetRoles = true;
  }

  const { width, height } = data;
  const cw = canvas.width;
  const ch = canvas.height;

  const appMode = options.settings?.appMode || 'map';
  const player = options.settings?.player || { x: 0, y: 0 };
  if (appMode !== 'play') {
    resetPlayChunkBakeAutoTuner();
    lastPlayChunkFrameStats = {
      mode: appMode,
      totalVisible: 0,
      drawnVisible: 0,
      missingVisible: 0,
      bakedThisFrame: 0,
      bakeBudget: 0,
      bakeBoost: 0,
      queueSize: 0
    };
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (ctx.webkitImageSmoothingEnabled !== undefined) ctx.webkitImageSmoothingEnabled = false;
  if (typeof ctx.imageSmoothingQuality === 'string') ctx.imageSmoothingQuality = 'low';
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cw, ch);

  const viewType = options.settings?.viewType || 'biomes';
  const overlayPaths = options.settings?.overlayPaths ?? true;
  const overlayGraph = options.settings?.overlayGraph ?? true;
  const overlayContours = options.settings?.overlayContours ?? true;

  let tileW, tileH;
  let startX = 0, startY = 0, endX = width, endY = height;

  if (appMode === 'play') {
    tileW = PLAY_BAKE_TILE_PX;
    tileH = PLAY_BAKE_TILE_PX;
  } else {
    tileW = cw / width;
    tileH = ch / height;
  }

  if (syncPlayChunkCache(data, tileW, appMode)) {
    clearGrassFireStateForNewMap();
    resetPlayChunkBakeAutoTuner();
  }

  if (appMode === 'map') {
    clearPlayCameraSnapshot();
    drawCachedMapOverview(ctx, {
      data,
      cw,
      ch,
      viewType,
      overlayPaths,
      overlayGraph,
      overlayContours,
      startX,
      startY,
      endX,
      endY
    });
  } else {
    const snapPx = (n) => Math.round(n);
    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;

    const playerDexForCam = player.dexId || 94;
    const playCam = computePlayViewState({
      cw,
      ch,
      vx,
      vy,
      playerZ: player.z ?? 0,
      flightActive: !!player.flightActive,
      framingHeightTiles: POKEMON_HEIGHTS[playerDexForCam] || 1.1
    });
    setPlayCameraSnapshot({ ...playCam, cw, ch });
    tileW = playCam.effTileW;
    tileH = playCam.effTileH;
    const lodDetail = playCam.lodDetail;
    /** LOD 0 only: deferred grass / `playerTopOverlay` strips over sprites. LOD 1+ use PASS 5a grass under entities. */
    const playLodGrassSpriteOverlay = lodDetail < 1;
    const latchGround = isGroundDigLatchEligible();
    const time = options.settings?.time || 0;
    updateJumpRings(time);
    updateRunDustPuffs(time);

    /** Match `updatePlayer`: walk/dig on ground; Mewtwo/Mew use walk slice while levitating. */
    const flightHudActive = speciesHasFlyingType(playerDexForCam) && player.flightActive;
    /** Só grama **em cima do jogador / vizinhos do tile** no voo — a grama do mundo (PASS 5a) continua em LOD 0. */
    const skipPlayerGrassOverlayDuringFlight = flightHudActive;
    const smoothLev = speciesHasSmoothLevitationFlight(playerDexForCam);
    const isPlayerWalkingAnim =
      (!!player.grounded &&
        (Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1 || !!player.digActive)) ||
      (flightHudActive &&
        smoothLev &&
        (Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1 ||
          !!playInputState.spaceHeld ||
          !!playInputState.shiftLeftHeld ||
          (player.z ?? 0) > 0.02));
    const isMovingHorizontal = isPlayerWalkingAnim && Math.abs(player.vy ?? 0) < 0.05;
    const overlayMx = Math.floor(vx);
    const overlayMy = Math.floor(vy);
    const shouldDrawPlayerOverlay = isPlayerIdleOnWaitingFrame() || isMovingHorizontal;

    startX = Math.max(0, playCam.startXTiles);
    startY = Math.max(0, playCam.startYTiles);
    endX = Math.min(width * MACRO_TILE_STRIDE, playCam.endXTiles);
    endY = Math.min(height * MACRO_TILE_STRIDE, playCam.endYTiles);

    // Identifica todos os tiles cobertos por scatter (árvores largas/altas) no viewport
    // REMOVIDO: buildScatterFootprintNoGrassSet era O(N^2) no render loop. 
    // Agora o suppressionSet é calculado uma única vez no bakeChunk.

    // Blocos 8×8: viewport + padding extra ao dar zoom (evita falhas à volta do canvas).
    const maxChunkXi = Math.floor((width * MACRO_TILE_STRIDE - 1) / PLAY_CHUNK_SIZE);
    const maxChunkYi = Math.floor((height * MACRO_TILE_STRIDE - 1) / PLAY_CHUNK_SIZE);
    const padC = playCam.chunkPad;
    let cStartX = Math.max(0, Math.floor(startX / PLAY_CHUNK_SIZE) - padC);
    let cStartY = Math.max(0, Math.floor(startY / PLAY_CHUNK_SIZE) - padC);
    let cEndX = Math.min(maxChunkXi, Math.floor((endX - 1) / PLAY_CHUNK_SIZE) + padC);
    let cEndY = Math.min(maxChunkYi, Math.floor((endY - 1) / PLAY_CHUNK_SIZE) + padC);

    const currentTransX = playCam.currentTransX;
    const currentTransY = playCam.currentTransY;
    const chunkDrawScale = playCam.viewScale;

    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = chunkDrawScale < 0.999;

    const visibleChunkCoords = [];
    let missingVisibleChunks = 0;
    let cachedVisibleChunks = 0;
    for (let cy = cStartY; cy <= cEndY; cy++) {
      for (let cx = cStartX; cx <= cEndX; cx++) {
        const key = `${cx},${cy}`;
        visibleChunkCoords.push({ cx, cy, key });
        if (playChunkMap.has(key)) {
          cachedVisibleChunks++;
        } else {
          missingVisibleChunks++;
          enqueuePlayChunkBake(cx, cy);
        }
      }
    }

    const queueBeforeBake = getPlayChunkBakeQueueSize();
    const chunkBakeBudget = getAdaptivePlayChunkBakeBudget({
      lodDetail,
      cachedVisibleChunks,
      missingVisibleChunks,
      queueSize: queueBeforeBake,
      totalVisibleChunks: visibleChunkCoords.length
    });

    const bakeRequests = dequeuePlayChunkBakes(chunkBakeBudget);
    for (const req of bakeRequests) {
      if (playChunkMap.has(req.key)) continue;
      const chunk = bakeChunk(req.cx, req.cy, data, PLAY_BAKE_TILE_PX, PLAY_BAKE_TILE_PX);
      playChunkMap.set(req.key, chunk);
    }

    let drawnVisibleChunks = 0;
    for (const { cx, cy, key } of visibleChunkCoords) {
      const chunk = playChunkMap.get(key);
      if (!chunk) continue;
      drawnVisibleChunks++;
      const destW = Math.max(1, Math.ceil(chunk.canvas.width * chunkDrawScale - 1e-6));
      const destH = Math.max(1, Math.ceil(chunk.canvas.height * chunkDrawScale - 1e-6));
      ctx.drawImage(
        chunk.canvas,
        0,
        0,
        chunk.canvas.width,
        chunk.canvas.height,
        currentTransX + cx * PLAY_CHUNK_SIZE * tileW,
        currentTransY + cy * PLAY_CHUNK_SIZE * tileH,
        destW,
        destH
      );
    }
    lastPlayChunkFrameStats = {
      mode: 'play',
      totalVisible: visibleChunkCoords.length,
      drawnVisible: drawnVisibleChunks,
      missingVisible: Math.max(0, visibleChunkCoords.length - drawnVisibleChunks),
      bakedThisFrame: bakeRequests.length,
      bakeBudget: chunkBakeBudget,
      bakeBoost: playChunkBakeBoost,
      queueSize: getPlayChunkBakeQueueSize()
    };

    ctx.imageSmoothingEnabled = prevSmoothing;

    ctx.translate(currentTransX, currentTransY);

    // Otimização de Frame: Cache de tiles para o viewport atual
    const tileCache = new Map();
    const getCached = (mx, my) => {
      const key = (mx << 16) | (my & 0xFFFF);
      if (tileCache.has(key)) return tileCache.get(key);
      const t = getMicroTile(mx, my, data);
      tileCache.set(key, t);
      return t;
    };

    // Warm viewport tile cache (LOD 2 skips: far zoom = huge rect; passes fill lazily and saves many getMicroTile calls).
    if (lodDetail < 2) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          getCached(mx, my);
        }
      }
    }

    const showPlayCollidersEarly = options.settings?.showPlayColliders || window.debugColliders;
    if (showPlayCollidersEarly) {
      const COLL_OVERLAY_RAD = 18;
      const pCol = options.settings?.player;
      const cx = pCol ? Math.floor(pCol.x) : startX + Math.floor((endX - startX) / 2);
      const cy = pCol ? Math.floor(pCol.y) : startY + Math.floor((endY - startY) / 2);
      const microWPre = width * MACRO_TILE_STRIDE;
      const microHPre = height * MACRO_TILE_STRIDE;
      const ox0p = Math.max(0, Math.max(startX, cx - COLL_OVERLAY_RAD) - 10);
      const ox1p = Math.min(microWPre, Math.min(endX, cx + COLL_OVERLAY_RAD + 1) + 10);
      const oy0p = Math.max(0, Math.max(startY, cy - COLL_OVERLAY_RAD) - 12);
      const oy1p = Math.min(microHPre, Math.min(endY, cy + COLL_OVERLAY_RAD + 1) + 12);
      for (let my = oy0p; my < oy1p; my++) {
        for (let mx = ox0p; mx < ox1p; mx++) {
          getCached(mx, my);
        }
      }
    }

    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    const TCOLS_NATURE = 57;
    const TCOLS_CAVES = 50;

    const atlasFromObjectSet = (objSet) => {
      const path = TessellationEngine.getImagePath(objSet?.file);
      const img = path ? imageCache.get(path) : null;
      const cols = path?.includes('caves') ? TCOLS_CAVES : TCOLS_NATURE;
      return { img, cols };
    };

    const twNat = Math.ceil(tileW);
    const thNat = Math.ceil(tileH);
    const drawTile16 = (tileId, px, py, rotation) => {
      if (!natureImg || tileId == null || tileId < 0) return;
      const sx = (tileId % TCOLS_NATURE) * 16;
      const sy = Math.floor(tileId / TCOLS_NATURE) * 16;
      if (rotation) {
        ctx.save();
        ctx.translate(snapPx(px + tileW / 2), snapPx(py + tileH));
        ctx.rotate(rotation);
        ctx.drawImage(natureImg, sx, sy, 16, 16, -twNat / 2, -thNat, twNat, thNat);
        ctx.restore();
      } else {
        ctx.drawImage(natureImg, sx, sy, 16, 16, snapPx(px), snapPx(py), twNat, thNat);
      }
    };

    /** Vegetation sway / grass wind only at LOD 0 (cheap LODs stay static). */
    const vegAnimTime = lodDetail === 0 ? time : 0;
    const canopyAnimTime = vegAnimTime;

    // PASS 0: Oceano — water overlay at every LOD (sea never dropped at LOD 2 / flight zoom).
    // LOD 2 = static frame 0 (cheap); LOD 1 = slower anim; LOD 0 = full anim.
    // LOD 0/1: overlay não-opaco + desenho em todo tile (incl. OUT_*), para não deixar “cantos secos”
    // do autotile lake-shore visíveis só no zoom perto; LOD 2 permanece opaco.
    const waterImg = imageCache.get('tilesets/water-tile.png');
    if (waterImg && waterImg.naturalWidth >= WATER_ANIM_SRC_W && waterImg.naturalHeight >= WATER_ANIM_SRC_H) {
      const waterFrames = Math.floor(waterImg.naturalHeight / WATER_ANIM_SRC_H);
      if (waterFrames >= 1) {
        const t = options.settings?.time ?? 0;
        const waterPhase =
          lodDetail >= 2
            ? 0
            : lodDetail >= 1
              ? Math.floor(t * 2.4) % waterFrames
              : Math.floor(t * 3.5) % waterFrames;
        const syOcean = waterPhase * WATER_ANIM_SRC_H;
        ctx.save();
        ctx.globalAlpha = lodDetail >= 2 ? 1 : PLAY_SEA_OVERLAY_ALPHA_LOD01;
        ctx.imageSmoothingEnabled = true;
        if (ctx.webkitImageSmoothingEnabled !== undefined) ctx.webkitImageSmoothingEnabled = true;
        if (typeof ctx.imageSmoothingQuality === 'string') ctx.imageSmoothingQuality = 'high';
        for (let my = startY; my < endY; my++) {
          for (let mx = startX; mx < endX; mx++) {
            const tile = getCached(mx, my);
            if (!tile || tile.biomeId !== BIOMES.OCEAN.id) continue;
            ctx.drawImage(
              waterImg,
              0,
              syOcean,
              WATER_ANIM_SRC_W,
              WATER_ANIM_SRC_H,
              mx * tileW,
              my * tileH,
              tileW,
              tileH
            );
          }
        }
        ctx.restore();
      }
    }

    /** Cliff / CENTER gate shared by PASS 5a (grass) and 5b (canopies). */
    const forEachAbovePlayerTile = (fn) => {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          if (lodDetail >= 2 && (mx + my) % 2 !== 0) continue;
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1) continue;

          const gateSet = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
          if (gateSet) {
            const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -1) >= tile.heightStep;
            if (getRoleForCell(my, mx, height * MACRO_TILE_STRIDE, width * MACRO_TILE_STRIDE, checkAtOrAbove, gateSet.type) !== 'CENTER') continue;
          }

          const tw = Math.ceil(tileW), th = Math.ceil(tileH), tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH);
          fn(mx, my, tile, tw, th, tx, ty);
        }
      }
    };

    /** E / W / S / SE / SW neighbors of the player tile: grass draws after the sprite (depth cue). */
    const isGrassDeferredAroundPlayer = (mx, my) => {
      const dx = mx - overlayMx;
      const dy = my - overlayMy;
      return (
        (dx === 1 && dy === 0) ||
        (dx === -1 && dy === 0) ||
        (dx === 0 && dy === 1) ||
        (dx === 1 && dy === 1) ||
        (dx === -1 && dy === 1)
      );
    };

    /** East or west neighbor only (E/W use waiting-frame overlay like the player tile). */
    const isGrassDeferredEwNeighbor = (mx, my) => {
      const dx = mx - overlayMx;
      const dy = my - overlayMy;
      return (dx === 1 && dy === 0) || (dx === -1 && dy === 0);
    };

    const passesAbovePlayerTileGate = (mx, my, tile) => {
      if (!tile || tile.heightStep < 1) return false;
      const gateSet = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
      if (gateSet) {
        const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -1) >= tile.heightStep;
        if (getRoleForCell(my, mx, height * MACRO_TILE_STRIDE, width * MACRO_TILE_STRIDE, checkAtOrAbove, gateSet.type) !== 'CENTER') return false;
      }
      return true;
    };

    /**
     * PASS 5a grass for one cell. `mode === 'playerTopOverlay'`: only the bottom PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC
     * of each layer (source + dest: strip near the ground), after the sprite — simple marked slice.
     */
    const drawGrass5aForCell = (mx, my, tile, tw, th, tx, ty, mode) => {
      const playerTopOverlay = mode === 'playerTopOverlay';
      if (lodDetail >= 2 && !playerTopOverlay) return;
      const barFrac = PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC;

      const blitGrassQuad = (frame, destYTop, destHFull) => {
        if (!frame) return;
        const fw = frame.width || frame.naturalWidth;
        const fh = frame.height || frame.naturalHeight;
        if (!playerTopOverlay) {
          ctx.drawImage(frame, 0, 0, fw, fh, snapPx(tx), snapPx(destYTop), tileW, destHFull);
          return;
        }
        const sh = Math.max(1, Math.round(fh * barFrac));
        const sy = fh - sh;
        const dh = destHFull * barFrac;
        const dy = destYTop + destHFull * (1 - barFrac);
        ctx.drawImage(frame, 0, sy, fw, sh, snapPx(tx), snapPx(dy), tileW, dh);
      };

      if (playerTopOverlay) {
        ctx.save();
        ctx.globalAlpha = PLAYER_TILE_GRASS_OVERLAY_ALPHA;
      }

      const layers = getPlayAnimatedGrassLayers(mx, my, data, getCached, playChunkMap);
      const firePhase = grassFireVisualPhaseAt(mx, my);
      const charredRegrowU =
        firePhase === 'charred' ? (grassFireCharredRegrowth01(mx, my) ?? 0) : 0;
      const showFireOverlay =
        firePhase && (layers.base || layers.top) && !(firePhase === 'charred' && charredRegrowU >= 1);

      if (showFireOverlay) {
        const burning = firePhase === 'burning';
        /** Mesmas sprites da grama: `ctx.filter` respeita o alpha do PNG (só folha escurece). */
        const blitGrassFramesForFire = () => {
          if (layers.base) {
            const gv = getGrassVariant(tile.biomeId);
            const gTiles = GRASS_TILES[gv];
            let baseId = gTiles.original;
            if (gv === 'lotus' && gTiles.grass2 != null) {
              const ftPick = foliageType(mx, my, data.seed);
              baseId = ftPick < 0.5 ? gTiles.original : gTiles.grass2;
            }
            if (baseId != null) {
              const fIdx = AnimationRenderer.getFrameIndex(vegAnimTime, mx, my);
              const frame = AnimationRenderer.getWindFrame(natureImg, baseId, fIdx, TCOLS_NATURE);
              blitGrassQuad(frame, ty - tileH, tileH * 2);
            }
          }
          if (lodDetail < 2 && layers.top) {
            const vt = getGrassVariant(tile.biomeId);
            const vTiles = GRASS_TILES[vt];
            const topId = vTiles.originalTop;
            if (topId) {
              const fIdx = AnimationRenderer.getFrameIndex(vegAnimTime, mx, my);
              const frame = AnimationRenderer.getWindFrame(natureImg, topId, fIdx, TCOLS_NATURE);
              blitGrassQuad(frame, ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX, tileH * 2);
            }
          }
        };
        const charredFilter = 'brightness(0.24) contrast(1.25) saturate(0.55) sepia(0.4)';
        if (burning) {
          ctx.save();
          ctx.filter =
            'brightness(0.62) saturate(1.9) sepia(1) hue-rotate(-10deg) contrast(1.1)';
          blitGrassFramesForFire();
          ctx.filter = 'none';
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = playerTopOverlay ? 0.14 * PLAYER_TILE_GRASS_OVERLAY_ALPHA : 0.16;
          ctx.filter = 'brightness(1.65) sepia(1) hue-rotate(-22deg) saturate(2.2)';
          blitGrassFramesForFire();
          ctx.filter = 'none';
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.restore();
        } else {
          const u = Math.max(0, Math.min(1, charredRegrowU));
          ctx.save();
          if (u <= 0) {
            ctx.filter = charredFilter;
            blitGrassFramesForFire();
            ctx.filter = 'none';
          } else {
            ctx.globalAlpha = 1 - u;
            ctx.filter = charredFilter;
            blitGrassFramesForFire();
            ctx.filter = 'none';
            ctx.globalAlpha = u;
            blitGrassFramesForFire();
            ctx.globalAlpha = 1;
          }
          ctx.restore();
        }
        if (playerTopOverlay) {
          ctx.restore();
        }
        return;
      }

      if (layers.base) {
        const gv = getGrassVariant(tile.biomeId);
        const gTiles = GRASS_TILES[gv];
        let baseId = gTiles.original;
        if (gv === 'lotus' && gTiles.grass2 != null) {
          const ftPick = foliageType(mx, my, data.seed);
          baseId = ftPick < 0.5 ? gTiles.original : gTiles.grass2;
        }
        if (baseId != null) {
          const fIdx = AnimationRenderer.getFrameIndex(vegAnimTime, mx, my);
          const frame = AnimationRenderer.getWindFrame(natureImg, baseId, fIdx, TCOLS_NATURE);
          blitGrassQuad(frame, ty - tileH, tileH * 2);
        }
      }

      if (lodDetail < 2 && layers.top) {
        const vt = getGrassVariant(tile.biomeId);
        const vTiles = GRASS_TILES[vt];
        const topId = vTiles.originalTop;
        if (topId) {
          const fIdx = AnimationRenderer.getFrameIndex(vegAnimTime, mx, my);
          const frame = AnimationRenderer.getWindFrame(natureImg, topId, fIdx, TCOLS_NATURE);
          blitGrassQuad(frame, ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX, tileH * 2);
        }
      }

      if (playerTopOverlay) {
        ctx.restore();
      }
    };

    const playerTileMx = Math.floor(vx);
    const playerTileMy = Math.floor(vy);

    // PASS 5a: animated grass (skipped entirely at LOD 2 — baked terrain + overlays only; big CPU win when zoomed out).
    if (lodDetail < 2) {
      forEachAbovePlayerTile((mx, my, tile, tw, th, tx, ty) => {
        if (mx === playerTileMx && my === playerTileMy) {
          drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
          return;
        }
        if (playLodGrassSpriteOverlay && isGrassDeferredAroundPlayer(mx, my)) {
          if (isGrassDeferredEwNeighbor(mx, my)) {
            drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
          } else if (skipPlayerGrassOverlayDuringFlight) {
            // S / SE / SW are normally drawn after the sprite; that pass is skipped in flight.
            // Draw them here so ground + shadow tiles still get grass (sprite is aloft).
            drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
          }
          return;
        }
        drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
      });
    }

    // PASS 3.5: Sorted Entities pass (Player + Wild Pokémon)
    const wildList = getWildPokemonEntities();
    const renderItems = [];
    
    // --- Collect Sortable Objects (Scatter, Trees, Buildings) ---
    const sortableScanPad = lodDetail >= 2 ? 2 : 4;
    /** Dedup `validScatterOriginMicro` (footprint + “em cima de outro scatter”) no mesmo frame. */
    const scatterOriginMemoRender = new Map();
    for (let myScan = startY - sortableScanPad; myScan < endY; myScan++) {
      for (let mxScan = startX - sortableScanPad; mxScan < endX; mxScan++) {
        if (mxScan < 0 || myScan < 0 || mxScan >= width * MACRO_TILE_STRIDE || myScan >= height * MACRO_TILE_STRIDE) continue;
        const t = getCached(mxScan, myScan);
        if (!tileSurfaceAllowsScatterVegetation(t)) continue;

        // 1. Formal Trees
        const treeType = getTreeType(t.biomeId, mxScan, myScan, data.seed);
        if (treeType && (mxScan + myScan) % 3 === 0 && foliageDensity(mxScan, myScan, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
          if (getCached(mxScan + 1, myScan)?.heightStep === t.heightStep) {
            renderItems.push({
              type: 'tree',
              treeType,
              originX: mxScan,
              originY: myScan,
              y: myScan + 0.9, // debug / marker; depth uses canopy pivot
              sortY: myScan + 1, // matches formal canopy translate Y: originY*tileH + tileH
              biomeId: t.biomeId
            });
          }
        }
        
        // 2. Scatter / Decoration
        if (foliageDensity(mxScan, myScan, data.seed + 111, 2.5) > 0.82 && !t.isRoad && !t.urbanBuilding) {
          const items = BIOME_VEGETATION[t.biomeId] || [];
          if (items.length > 0) {
            const itemKey = items[Math.floor(seededHash(mxScan, myScan, data.seed + 222) * items.length)];
            const isSortable = isSortableScatter(itemKey);
            // Even if not "sortable" (like grass), we check for "tops" that need sorting
            const objSet = OBJECT_SETS[itemKey];
            if (
              objSet &&
              validScatterOriginMicro(
                mxScan,
                myScan,
                data.seed,
                width * MACRO_TILE_STRIDE,
                height * MACRO_TILE_STRIDE,
                (c, r) => getCached(c, r),
                scatterOriginMemoRender
              )
            ) {
              if (isPlayDetailScatterOriginDestroyed(mxScan, myScan)) {
                continue;
              }
               const { cols, rows } = parseShape(objSet.shape);
               const hasTop = objSet.parts.some(p => p.role === 'top' || p.role === 'tops');
               if (isSortable || hasTop) {
                 renderItems.push({
                   type: 'scatter',
                   itemKey,
                   objSet,
                   originX: mxScan,
                   originY: myScan,
                   y: myScan + rows - 0.1, // debug / marker; depth uses canopy pivot
                   sortY: myScan + 1, // matches scatter tops translate: originY*tileH + tileH
                   cols,
                   rows
                 });
               }
            }
          }
        }

        // 3. Urban Buildings (Roofs / Core parts that need sorting)
        if (t.urbanBuilding && mxScan === t.urbanBuilding.ox && myScan === t.urbanBuilding.oy) {
           renderItems.push({
             type: 'building',
             bData: t.urbanBuilding,
             originX: mxScan,
             originY: myScan,
             y: myScan + (t.urbanBuilding.type === 'pokecenter' ? 5.9 : 4.9)
           });
        }
      }
    }
    
    // --- Collect Wild entities ---
    for (const we of wildList) {
      const { walk: wWalk, idle: wIdle, hurt: wHurt, sleep: wSleep, faint: wFaint } = getResolvedSheets(imageCache, we.dexId);
      if (!wWalk || !wIdle) continue;
      const wildAnimSlice = we.deadState
        ? (we.deadState === 'faint' ? 'faint' : 'sleep')
        : (we.hurtTimer > 0.001 ? 'hurt' : (we.animMoving ? 'walk' : 'idle'));
      const wSheet =
        wildAnimSlice === 'faint' ? (wFaint || wIdle)
        : wildAnimSlice === 'sleep' ? (wSleep || wIdle)
        : wildAnimSlice === 'hurt' ? (wHurt || wIdle)
        : (we.animMoving ? wWalk : wIdle);

      const { sw: pmdSw, sh: pmdSh, animCols } = resolvePmdFrameSpecForSlice(wSheet, we.dexId, wildAnimSlice);
      const canonicalH = resolveCanonicalPmdH(wIdle, wWalk, we.dexId);
      const targetHeightTiles = POKEMON_HEIGHTS[we.dexId] || 1.1;
      const targetHeightPx = targetHeightTiles * tileH;
      const finalScale = targetHeightPx / canonicalH;

      const pmdDw = pmdSw * finalScale;
      const pmdDh = pmdSh * finalScale;
      const pmdPivotX = pmdDw * 0.5;
      const pmdPivotY = pmdDh * PMD_MON_SHEET.pivotYFrac;

      const emotionPayload =
        we.emotionType !== null && typeof we.emotionType === 'number'
          ? {
              type: we.emotionType,
              age: we.emotionAge,
              portraitSlug:
                we.emotionPortraitSlug ||
                defaultPortraitSlugForBalloon(we.emotionType)
            }
          : null;

      const wy = we.y;
      const footSortY = wy + 0.5;
      /** Past same-tile scatter/tree canopy sort (`floor(tile)+1`), still near the owning sprite. */
      const emotionSortY = Math.max(footSortY + 0.018, Math.floor(wy) + 1.008);

      renderItems.push({
        type: 'wild',
        entityKey: we.key,
        y: we.y,
        x: we.x,
        /** World height (tiles) for collider / FX overlay — same as sprite lift. */
        airZ: we.z ?? 0,
        /** Depth sort: world pivot Y (tile center), not logical cell — matches sprite anchor vs props. */
        sortY: footSortY,
        dexId: we.dexId,
        animMoving: !!we.animMoving,
        cx: snapPx((we.x + 0.5) * tileW),
        cy: snapPx((we.y + 0.5) * tileH - (we.z || 0) * tileH),
        sheet: wSheet,
        sx: ((we.animFrame ?? 0) % animCols) * pmdSw,
        sy: (we.animRow ?? 0) * pmdSh,
        sw: pmdSw,
        sh: pmdSh,
        dw: pmdDw,
        dh: pmdDh,
        pivotX: pmdPivotX,
        pivotY: pmdPivotY,
        spawnPhase: we.spawnPhase ?? 1,
        spawnType: we.spawnType,
        targetHeightTiles,
        hitFlashTimer: we.hitFlashTimer,
        hp: we.hp,
        maxHp: we.maxHp,
        isBoss: !!we.isBoss,
        deadState: we.deadState,
        hurtTimer: we.hurtTimer,
        sexHud: wildSexHudLabel(we.sex),
        jumping: !!we.jumping,
        jumpSerial: we.jumpSerial || 0,
        grounded: !!we.grounded,
        vx: Number(we.vx) || 0,
        vy: Number(we.vy) || 0
      });

      if (emotionPayload && lodDetail < 2) {
        renderItems.push({
          type: 'wildEmotion',
          sortY: emotionSortY,
          x: we.x,
          y: we.y,
          cx: snapPx((we.x + 0.5) * tileW),
          cy: snapPx((we.y + 0.5) * tileH - (we.z || 0) * tileH),
          pivotY: pmdPivotY,
          spawnPhase: we.spawnPhase ?? 1,
          spawnType: we.spawnType,
          dexId: we.dexId,
          emotion: emotionPayload
        });
      }
    }

    const playerDex = player.dexId || 94;
    const playerIndicatorSortY = vy + 0.49;
    const collMx = player.x;
    const collMy = player.y;
    const microWCol = width * MACRO_TILE_STRIDE;
    const microHCol = height * MACRO_TILE_STRIDE;
    if (collMx >= 0 && collMy >= 0 && collMx < microWCol && collMy < microHCol) {
      renderItems.push({
        type: 'playerAimIndicator',
        sortY: playerIndicatorSortY,
        collMx,
        collMy
      });
    }
    const playerEmotionPayload =
      player.socialEmotionType !== null && typeof player.socialEmotionType === 'number'
        ? {
            type: player.socialEmotionType,
            age: player.socialEmotionAge || 0,
            portraitSlug:
              player.socialEmotionPortraitSlug ||
              defaultPortraitSlugForBalloon(player.socialEmotionType)
          }
        : null;

    const phDex = getBorrowDigPlaceholderDex(playerDex);
    const inDigCharge = latchGround && player.digCharge01 > 0 && !player.digBurrowMode;

    /** Full-size Diglett/Dugtrio loop beside player while charging (player species keeps mask). */
    if (inDigCharge) {
      void ensurePokemonSheetsLoaded(imageCache, phDex);
      const { idle: cIdle, walk: cWalk, dig: cDig } = getResolvedSheets(imageCache, phDex);
      const cSheet = cDig || cWalk;
      if (cSheet) {
        const slice = cDig && player.digCharge01 > 0.12 ? 'dig' : 'walk';
        const { sw: csw, sh: csh, animCols: cCols } = resolvePmdFrameSpecForSlice(cSheet, phDex, slice);
        const canonC = resolveCanonicalPmdH(cIdle, cWalk, phDex);
        const targetTilesC = POKEMON_HEIGHTS[phDex] || 1.2;
        const targetPxC = targetTilesC * tileH;
        const cScale = targetPxC / canonC;
        const cdw = csw * cScale;
        const cdh = csh * cScale;
        const cFrame = Math.floor(time * 11) % Math.max(1, cCols);
        renderItems.push({
          type: 'digCompanion',
          sortY: vy + 0.44,
          sheet: cSheet,
          sx: cFrame * csw,
          sy: (player.animRow ?? 0) * csh,
          sw: csw,
          sh: csh,
          dw: cdw,
          dh: cdh,
          cx: snapPx((vx + 0.92) * tileW),
          cy: snapPx((vy + 0.5) * tileH - (player.z || 0) * tileH)
        });
      }
    }

    // --- Collect Player ---
    const isPlayerMoving = isPlayerWalkingAnim;
    const borrowDiglettArt =
      latchGround && player.digBurrowMode && speciesUsesBorrowedDiglettDigVisual(playerDex);
    const borrowPlaceholderDex = borrowDiglettArt ? phDex : null;
    if (borrowDiglettArt && borrowPlaceholderDex != null) {
      void ensurePokemonSheetsLoaded(imageCache, borrowPlaceholderDex);
    }
    const { walk: pWalk, idle: pIdle, dig: pDigSelf, charge: pChargeSheet, shoot: pShootSheet } = getResolvedSheets(
      imageCache,
      playerDex
    );
    const diglettSheets =
      borrowDiglettArt && borrowPlaceholderDex != null
        ? getResolvedSheets(imageCache, borrowPlaceholderDex)
        : null;
    const pDig = borrowDiglettArt && diglettSheets ? diglettSheets.dig : pDigSelf;
    const wantsDigSheet =
      latchGround &&
      player.digBurrowMode &&
      !isGhostPhaseShiftBurrowEligibleDex(playerDex) &&
      (borrowDiglettArt ? !!pDig : !!pDigSelf || isUndergroundBurrowerDex(playerDex));
    const combatShoot = (player.moveShootAnimSec || 0) > 0 && !!pShootSheet;
    const combatLmbAttack = (player.lmbAttackAnimSec || 0) > 0;
    const combatCharge =
      !player.digBurrowMode &&
      (playInputState.chargeLeft01 > 0.02 || playInputState.chargeRight01 > 0.02) &&
      !playInputState.ctrlLeftHeld &&
      !!pChargeSheet;

    let pSheet;
    let pmdAnimSlice;
    if (wantsDigSheet) {
      pSheet = pDig || pWalk || pIdle;
      pmdAnimSlice = pDig ? 'dig' : 'walk';
    } else if (combatShoot) {
      pSheet = pShootSheet;
      pmdAnimSlice = 'shoot';
    } else if (combatLmbAttack) {
      void ensurePokemonSheetsLoaded(imageCache, playerDex);
      const rSheets = getResolvedSheets(imageCache, playerDex);
      const lmb = resolvePlayerLmbAttackSheetAndSlice(playerDex, imageCache, rSheets);
      if (lmb.sheet) {
        pSheet = lmb.sheet;
        pmdAnimSlice = lmb.slice;
      } else {
        pSheet = isPlayerMoving ? pWalk : pIdle;
        pmdAnimSlice = isPlayerMoving ? 'walk' : 'idle';
      }
    } else if (combatCharge) {
      pSheet = pChargeSheet;
      pmdAnimSlice = 'charge';
    } else {
      pSheet = isPlayerMoving ? pWalk : pIdle;
      pmdAnimSlice = isPlayerMoving ? 'walk' : 'idle';
    }
    const pmdSpecDex =
      wantsDigSheet && borrowDiglettArt && borrowPlaceholderDex != null ? borrowPlaceholderDex : playerDex;

    if (pSheet) {
      const { sw, sh, animCols } = resolvePmdFrameSpecForSlice(pSheet, pmdSpecDex, pmdAnimSlice);
      const idleForCanon = borrowDiglettArt && diglettSheets ? diglettSheets.idle : pIdle;
      const walkForCanon = borrowDiglettArt && diglettSheets ? diglettSheets.walk : pWalk;
      const canonicalDex =
        borrowDiglettArt && borrowPlaceholderDex != null ? borrowPlaceholderDex : playerDex;
      const canonicalH = resolveCanonicalPmdH(idleForCanon, walkForCanon, canonicalDex);
      const targetHeightTiles =
        latchGround && player.digBurrowMode
          ? POKEMON_HEIGHTS[phDex] || 1.2
          : POKEMON_HEIGHTS[playerDex] || 1.1;
      const targetHeightPx = targetHeightTiles * tileH;
      const finalScale = targetHeightPx / canonicalH;

      const dw = sw * finalScale;
      const dh = sh * finalScale;

      renderItems.push({
        type: 'player',
        y: vy,
        x: vx,
        /** World height (tiles) for collider / FX overlay — same as sprite lift. */
        airZ: player.z ?? 0,
        showAirGroundTether:
          (player.z ?? 0) <= 0.02 ? false : !flightHudActive || !!player.flightGroundTetherVisible,
        /** Depth sort: world pivot Y (tile center), not logical cell. */
        sortY: vy + 0.5,
        dexId: playerDex,
        drawAlpha: player.ghostPhaseAlpha ?? 1,
        animMoving: isPlayerMoving,
        digBuryVisual: player.digBurrowMode ? 0 : player.digCharge01,
        tackleOffPx: (player._tackleLungeDx || 0) * tileW,
        tackleOffPy: (player._tackleLungeDy || 0) * tileH,
        cx: snapPx((vx + 0.5) * tileW),
        cy: snapPx((vy + 0.5) * tileH - (player.z || 0) * tileH),
        sheet: pSheet,
        sx: ((player.animFrame ?? 0) % animCols) * sw,
        sy: (player.animRow ?? 0) * sh,
        sw: sw,
        sh: sh,
        dw: dw,
        dh: dh,
        jumping: !!player.jumping,
        jumpSerial: player.jumpSerial || 0,
        grounded: !!player.grounded,
        vx: Number(player.vx) || 0,
        vy: Number(player.vy) || 0,
        pivotX: dw * 0.5,
        pivotY: dh * PMD_MON_SHEET.pivotYFrac,
        targetHeightTiles
      });
      if (playerEmotionPayload && lodDetail < 2) {
        const playerFootSortY = vy + 0.5;
        const playerEmotionSortY = Math.max(playerFootSortY + 0.018, Math.floor(vy) + 1.008);
        renderItems.push({
          type: 'playerEmotion',
          sortY: playerEmotionSortY,
          x: vx,
          y: vy,
          cx: snapPx((vx + 0.5) * tileW),
          cy: snapPx((vy + 0.5) * tileH - (player.z || 0) * tileH),
          pivotY: dh * PMD_MON_SHEET.pivotYFrac,
          spawnPhase: 1,
          spawnType: null,
          dexId: playerDex,
          emotion: playerEmotionPayload
        });
      }
    }

    const pushPsybeamChargeOrbs = () => {
      const z0 = player.z ?? 0;
      const pushOrb = (hold) => {
        if (!hold) return;
        const { sx, sy, tx, ty } = aimAtCursor(player);
        const d = Math.hypot(tx - sx, ty - sy) || 1e-6;
        const bx = sx + ((tx - sx) / d) * 0.42;
        const by = sy + ((ty - sy) / d) * 0.42;
        renderItems.push({
          type: 'psybeamChargeBall',
          sortY: by + 0.38,
          bx,
          by,
          bz: z0 + 0.08,
          pulse: hold.pulse
        });
      };
      pushOrb(playInputState.psybeamLeftHold);
      pushOrb(playInputState.psybeamRightHold);
    };
    pushPsybeamChargeOrbs();

    for (const proj of activeProjectiles) {
      renderItems.push({
        type: 'projectile',
        proj: proj,
        sortY: proj.y + 0.5,
      });
    }

    for (const part of activeParticles) {
      renderItems.push({
        type: 'particle',
        part: part,
        sortY: part.y + 0.5,
      });
    }

    for (const shard of activeCrystalShards) {
      renderItems.push({
        type: 'crystalShard',
        shard,
        sortY: shard.y + 0.5
      });
    }
    for (const c of activeSpawnedSmallCrystals) {
      renderItems.push({
        type: 'spawnedSmallCrystal',
        crystal: c,
        sortY: c.y + 0.5
      });
    }
    for (const d of activeCrystalDrops) {
      renderItems.push({
        type: 'crystalDrop',
        drop: d,
        sortY: d.y + 0.5
      });
    }

    // --- SORT BY Y (`sortY`: pivot — Pokémon vy+0.5; formal + scatter canopy originY+1 per translate; else `y`) ---
    renderItems.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));
    trackJumpStartRings(renderItems);
    trackRunningDust(renderItems, time);

    /**
     * Wild emotion: classic RPG Maker balloon (anim → hold last frame 1.2s), then portrait panel + tail.
     * @param {CanvasRenderingContext2D} ctx
     * @param {{ cx: number, cy: number, pivotY: number, emotion: object, dexId: number }} em
     * @param {number} spawnYOffset
     */
    const drawWildEmotionOverlay = (ctx, em, spawnYOffset) => {
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
    };

    /** Projectiles + particles: single additive pass after Y-sort (see `drawBatchedProjectile`). */
    const batchedEffects = [];

    // --- DRAW PASS ---
    const drawWildHpBar = (item, spawnYOffset) => {
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
    };

    for (const item of renderItems) {
      ctx.save();
      
      if (item.type === 'wild' || item.type === 'player') {
        if (item.type === 'wild') {
          ctx.globalAlpha = item.spawnPhase;
        } else {
          ctx.globalAlpha = item.drawAlpha != null ? item.drawAlpha : 1;
        }

        let spawnYOffset = 0;
        if (item.type === 'wild' && item.spawnPhase < 1) {
          if (item.spawnType === 'sky') spawnYOffset = (1 - item.spawnPhase) * (-4 * tileH);
          else if (item.spawnType === 'water') spawnYOffset = (1 - item.spawnPhase) * (0.8 * tileH);
          else spawnYOffset = (1 - item.spawnPhase) * (0.2 * tileH);
        }

        // Shadow (ground plane — do not follow jump z; cy is lifted with z for the sprite)
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        const shadowW = tileW * 0.4 * (item.targetHeightTiles / 3.5 + 0.5);
        const shadowCy = snapPx((item.y + 0.5) * tileH) + spawnYOffset;
        ctx.ellipse(item.cx, shadowCy, shadowW, tileH * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();

        const bury = item.type === 'player' ? (item.digBuryVisual ?? 0) : 0;
        const tackleOx = item.type === 'player' ? (item.tackleOffPx || 0) : 0;
        const tackleOy = item.type === 'player' ? (item.tackleOffPy || 0) : 0;
        const pxL = snapPx(item.cx - item.pivotX + tackleOx);
        const pxT0 = snapPx(item.cy - item.pivotY + spawnYOffset + tackleOy);
        const pxW = snapPx(item.dw);
        const pxH = snapPx(item.dh);
        
        if (item.type === 'wild' && item.hitFlashTimer > 0) {
          ctx.filter = 'brightness(5) contrast(2) sepia(1) hue-rotate(-50deg)'; // Red/white flash
        }

        if (bury > 0.004) {
          const rawVis = pxH * (1 - bury * 0.39);
          const visH = Math.min(pxH - 1, Math.max(6, Math.floor(rawVis)));
          const sink = pxH - visH;
          const pxT = snapPx(pxT0 + sink);
          ctx.save();
          ctx.beginPath();
          ctx.rect(pxL, pxT, pxW, visH);
          ctx.clip();
          ctx.drawImage(item.sheet, item.sx, item.sy, item.sw, item.sh, pxL, pxT, pxW, pxH);
          ctx.restore();
        } else {
          ctx.drawImage(item.sheet, item.sx, item.sy, item.sw, item.sh, pxL, pxT0, pxW, pxH);
        }
        
        ctx.filter = 'none';

        if (item.type === 'wild') {
          drawWildHpBar(item, spawnYOffset);
        }

        // Terrain / grass depth cue (LOD 0 only) — omit for player in creative flight
        const targetMx = Math.floor(item.x);
        const targetMy = Math.floor(item.y);
        if (
          playLodGrassSpriteOverlay &&
          (item.type === 'wild' || !skipPlayerGrassOverlayDuringFlight) &&
          targetMx >= startX &&
          targetMx < endX &&
          targetMy >= startY &&
          targetMy < endY
        ) {
          const t = getCached(targetMx, targetMy);
          if (passesAbovePlayerTileGate(targetMx, targetMy, t)) {
            drawGrass5aForCell(targetMx, targetMy, t, Math.ceil(tileW), Math.ceil(tileH), Math.floor(targetMx * tileW), Math.floor(targetMy * tileH), 'playerTopOverlay');
          }
        }
      } else if (item.type === 'digCompanion') {
        ctx.drawImage(
          item.sheet,
          item.sx,
          item.sy,
          item.sw,
          item.sh,
          snapPx(item.cx - item.dw * 0.5),
          snapPx(item.cy - item.dh * PMD_MON_SHEET.pivotYFrac),
          snapPx(item.dw),
          snapPx(item.dh)
        );
      } else if (item.type === 'wildEmotion' || item.type === 'playerEmotion') {
        if (lodDetail < 2) {
          ctx.globalAlpha = item.spawnPhase;
          let spawnYOffset = 0;
          if (item.spawnPhase < 1) {
            if (item.spawnType === 'sky') spawnYOffset = (1 - item.spawnPhase) * (-4 * tileH);
            else if (item.spawnType === 'water') spawnYOffset = (1 - item.spawnPhase) * (0.8 * tileH);
            else spawnYOffset = (1 - item.spawnPhase) * (0.2 * tileH);
          }
          drawWildEmotionOverlay(ctx, item, spawnYOffset);
        }
      } else if (item.type === 'playerAimIndicator') {
        const collCx = snapPx((item.collMx + 0.5) * tileW);
        const collCyGround = snapPx((item.collMy + 0.5) * tileH);
        const pz = Math.max(0, Number(player.z) || 0);
        const collCyBody = snapPx((item.collMy + 0.5) * tileH - pz * tileH);
        const collR = Math.min(tileW, tileH) * 0.5;
        ctx.strokeStyle = 'rgba(0, 240, 200, 0.92)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(collCx, collCyGround, Math.max(1, collR - 1), 0, Math.PI * 2);
        ctx.stroke();
        {
          const { sx: aimSx, sy: aimSy, tx, ty } = aimAtCursor(player);
          let dx = (tx - aimSx) * tileW;
          let dy = (ty - aimSy) * tileH;
          if (Math.hypot(dx, dy) < 1e-4) {
            dx = tileW;
            dy = 0;
          }
          const ang = Math.atan2(dy, dx);
          ctx.save();
          ctx.setLineDash([]);
          ctx.translate(collCx, collCyGround);
          ctx.rotate(ang);
          const ring = Math.max(2, collR + 2);
          ctx.fillStyle = 'rgba(110, 185, 255, 0.92)';
          ctx.strokeStyle = 'rgba(20, 55, 120, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          const tip = ring + 11;
          const inner = ring - 2;
          ctx.moveTo(tip, 0);
          ctx.lineTo(inner, -6);
          ctx.lineTo(inner - 2.5, 0);
          ctx.lineTo(inner, 6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        const showAimAirTether =
          pz <= 0.02 ? false : !flightHudActive || !!player.flightGroundTetherVisible;
        if (showAimAirTether) {
          ctx.strokeStyle = 'rgba(160, 255, 235, 0.65)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(collCx, collCyGround);
          ctx.lineTo(collCx, collCyBody);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(0, 240, 200, 0.75)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(collCx, collCyBody, Math.max(1, collR * 0.42), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      } else if (item.type === 'psybeamChargeBall') {
        const px = snapPx(item.bx * tileW);
        const py = snapPx(item.by * tileH - item.bz * tileH);
        const pulse = item.pulse || 0;
        const scale = 1 + Math.sin(pulse) * 0.26;
        const r = Math.max(12, tileW * 0.3) * scale;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, 'rgba(255,210,245,0.95)');
        grd.addColorStop(0.18, 'rgba(255,150,215,0.98)');
        grd.addColorStop(0.45, 'rgba(255,105,190,0.92)');
        grd.addColorStop(0.75, 'rgba(255,70,170,0.72)');
        grd.addColorStop(1, 'rgba(255,40,150,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 185, 230, 0.65)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (item.type === 'scatter') {
        const { objSet, originX, originY, cols, itemKey } = item;
        const shake01 = getDetailHitShake01(`${originX},${originY}`);
        if (shake01 > 0) {
          const a = tileW * 0.07 * shake01;
          const sx = Math.sin(time * 95 + originX * 11.9 + originY * 7.3) * a;
          const sy = Math.cos(time * 120 + originX * 3.7 + originY * 9.1) * a * 0.35;
          ctx.translate(sx, sy);
        }
        const base = objSet.parts.find(p => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
        const topPart = objSet.parts.find(p => p.role === 'top' || p.role === 'tops');
        const { img, cols: atlasCols } = atlasFromObjectSet(objSet);
        
        if (img) {
          // Draw Base (if sortable)
          if (base?.ids && isSortableScatter(itemKey)) {
            base.ids.forEach((id, idx) => {
              const ox = idx % cols;
              const oy = Math.floor(idx / cols);
              const tx = originX + ox;
              const ty = originY + oy;
              const dt = getCached(tx, ty);
              if (dt && dt.heightStep === getCached(originX, originY).heightStep) {
                 ctx.drawImage(img, (id % atlasCols) * 16, Math.floor(id / atlasCols) * 16, 16, 16, snapPx(tx * tileW), snapPx(ty * tileH), Math.ceil(tileW), Math.ceil(tileH));
              }
            });
          }
          // Draw Top (Canopy) — pre-baked composite (no per-frame ctx.rotate)
          if (topPart) {
            const wind = scatterHasWindSway(itemKey);
            const { canvas: scCan, ox: scOx, oy: scOy } = getScatterTopCanopyComposite(
              canopyAnimTime,
              itemKey,
              originX,
              originY,
              topPart,
              cols,
              img,
              atlasCols,
              tileW,
              tileH,
              lodDetail === 0 && wind
            );
            const px = snapPx(originX * tileW + (cols * tileW) / 2);
            const py = snapPx(originY * tileH + tileH);
            ctx.drawImage(scCan, px - scOx, py - scOy);
          }
        }
      } else if (item.type === 'tree') {
        const { treeType, originX, originY } = item;
        const ids = TREE_TILES[treeType];
        if (ids) {
          // Draw Base (skipped in bake)
          drawTile16(ids.base[0], originX * tileW, originY * tileH);
          drawTile16(ids.base[1], (originX + 1) * tileW - VEG_MULTITILE_OVERLAP_PX, originY * tileH);
          
          // Draw Top (Canopy) — pre-baked composite (no per-frame ctx.rotate)
          if (ids.top) {
            const { canvas: ftCan, ox: ftOx, oy: ftOy } = getFormalTreeCanopyComposite(
              canopyAnimTime,
              treeType,
              originX,
              originY,
              ids.top,
              natureImg,
              TCOLS_NATURE,
              tileW,
              tileH
            );
            const px = snapPx(originX * tileW + tileW);
            const py = snapPx(originY * tileH + tileH);
            ctx.drawImage(ftCan, px - ftOx, py - ftOy);
          }
        }
      } else if (item.type === 'building') {
        const { bData, originX, originY } = item;
        const pcImg = imageCache.get('tilesets/PokemonCenter.png');
        if (pcImg) {
          const PC_COLS = 15;
          let roofIds, bodyIds, bCols, roofRows, bodyRows;
          if (bData.type === 'pokecenter') {
            bCols = 5; roofRows = 3; bodyRows = 3;
            roofIds = [[0,1,2,3,4],[15,16,17,18,19],[30,31,32,33,34]];
            bodyIds = [[45,46,47,48,49],[60,61,62,63,64],[75,76,77,78,79]];
          } else if (bData.type === 'pokemart') {
            bCols = 4; roofRows = 2; bodyRows = 3;
            roofIds = [[20,21,22,23],[35,36,37,38]];
            bodyIds = [[50,51,52,53],[65,66,67,68],[80,81,82,83]];
          } else {
            const varIdx = bData.variantIndex ?? 0;
            const RED_HOUSE_BASE_IDS = [90, 94, 98, 165, 169];
            const baseId = RED_HOUSE_BASE_IDS[varIdx % RED_HOUSE_BASE_IDS.length];
            bCols = 4; roofRows = 2; bodyRows = 3; roofIds = []; bodyIds = [];
            for(let r=0; r<roofRows; r++){ let row=[]; for(let c=0; c<bCols; c++) row.push(baseId + r*PC_COLS + c); roofIds.push(row); }
            for(let r=0; r<bodyRows; r++){ let row=[]; for(let c=0; c<bCols; c++) row.push(baseId + (roofRows+r)*PC_COLS + c); bodyIds.push(row); }
          }
          // Draw Body
          bodyIds.forEach((row, r) => {
            row.forEach((id, c) => {
              const sx = (id % PC_COLS) * 16, sy = Math.floor(id / PC_COLS) * 16;
              ctx.drawImage(pcImg, sx, sy, 16, 16, snapPx((originX+c)*tileW), snapPx((originY+roofRows+r)*tileH), Math.ceil(tileW), Math.ceil(tileH));
            });
          });
          // Draw Roof
          roofIds.forEach((row, r) => {
            row.forEach((id, c) => {
              const sx = (id % PC_COLS) * 16, sy = Math.floor(id / PC_COLS) * 16;
              ctx.drawImage(pcImg, sx, sy, 16, 16, snapPx((originX+c)*tileW), snapPx((originY+r)*tileH), Math.ceil(tileW), Math.ceil(tileH));
            });
          });
        }
      } else if (item.type === 'crystalShard') {
        const s = item.shard;
        const path = s.imgPath;
        const img = path ? imageCache.get(path) : null;
        if (img && s.tileId != null && s.tileId >= 0 && s.cols > 0) {
          const dw = Math.ceil(tileW * 0.24);
          const dh = Math.ceil(tileH * 0.24);
          const sx = (s.tileId % s.cols) * 16;
          const sy = Math.floor(s.tileId / s.cols) * 16;
          const px = snapPx(s.x * tileW);
          const py = snapPx(s.y * tileH);
          ctx.globalAlpha = Math.max(0.2, 1 - s.age / Math.max(0.001, s.maxAge));
          ctx.drawImage(img, sx, sy, 16, 16, px - dw * 0.5, py - dh * 0.5, dw, dh);
          ctx.globalAlpha = 1;
        }
      } else if (item.type === 'spawnedSmallCrystal') {
        const s = item.crystal;
        const shake01 = getDetailHitShake01(`dyn:${s.id}`);
        if (shake01 > 0) {
          const a = tileW * 0.07 * shake01;
          const sx = Math.sin(time * 95 + s.id * 0.71) * a;
          const sy = Math.cos(time * 120 + s.id * 0.53) * a * 0.35;
          ctx.translate(sx, sy);
        }
        const path = s.imgPath;
        const img = path ? imageCache.get(path) : null;
        if (img && s.tileId != null && s.tileId >= 0 && s.cols > 0) {
          const dw = Math.ceil(tileW * 0.72);
          const dh = Math.ceil(tileH * 0.72);
          const sx = (s.tileId % s.cols) * 16;
          const sy = Math.floor(s.tileId / s.cols) * 16;
          const px = snapPx(s.x * tileW);
          const py = snapPx(s.y * tileH);
          ctx.drawImage(img, sx, sy, 16, 16, px - dw * 0.5, py - dh * 0.5, dw, dh);
        }
      } else if (item.type === 'crystalDrop') {
        const d = item.drop;
        const path = d.imgPath;
        const img = path ? imageCache.get(path) : null;
        if (img && d.tileId != null && d.tileId >= 0 && d.cols > 0) {
          const pulse = 0.88 + Math.sin((d.age || 0) * 8 + (d.bobSeed || 0) * 6.28) * 0.12;
          const bob = Math.sin((d.age || 0) * 5 + (d.bobSeed || 0) * 9.7) * tileH * 0.08;
          const scale = 0.56 * pulse;
          const tileIds = Array.isArray(d.tileIds) && d.tileIds.length ? d.tileIds : [d.tileId];
          const shapeCols = Math.max(1, Number(d.shapeCols) || 1);
          const shapeRows = Math.max(1, Number(d.shapeRows) || Math.ceil(tileIds.length / shapeCols));
          const tileDw = Math.ceil(tileW * scale);
          const tileDh = Math.ceil(tileH * scale);
          const px = snapPx(d.x * tileW);
          const py = snapPx(d.y * tileH - bob);
          const footW = shapeCols * tileW * scale;
          const footH = shapeRows * tileH * scale;
          const ox0 = px - footW * 0.5;
          const oy0 = py - footH * 0.5;
          ctx.globalAlpha = 0.94;
          for (let i2 = 0; i2 < tileIds.length; i2++) {
            const tid = tileIds[i2];
            if (tid == null || tid < 0) continue;
            const sx = (tid % d.cols) * 16;
            const sy = Math.floor(tid / d.cols) * 16;
            const ox = i2 % shapeCols;
            const oy = Math.floor(i2 / shapeCols);
            const dx = snapPx(ox0 + ox * tileW * scale);
            const dy = snapPx(oy0 + oy * tileH * scale);
            ctx.drawImage(img, sx, sy, 16, 16, dx, dy, tileDw, tileDh);
          }
          ctx.globalAlpha = 1;
        }
      } else if (item.type === 'projectile') {
        batchedEffects.push({ kind: 'projectile', proj: item.proj });
      } else if (item.type === 'particle') {
        batchedEffects.push({ kind: 'particle', part: item.part });
      }
      ctx.restore();

    }

    if (batchedEffects.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const be of batchedEffects) {
        if (be.kind === 'projectile') {
          drawBatchedProjectile(ctx, be.proj, tileW, tileH, snapPx, time);
        } else {
          drawBatchedParticle(ctx, be.part, tileW, tileH, snapPx);
        }
      }
      ctx.restore();
    }

    if (activeJumpRings.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const fx of activeJumpRings) {
        drawJumpRing(ctx, fx, tileW, tileH, snapPx);
      }
      ctx.restore();
    }
    if (activeRunDustPuffs.length > 0) {
      ctx.save();
      for (const puff of activeRunDustPuffs) {
        drawRunDustPuff(ctx, puff, tileW, tileH, snapPx);
      }
      ctx.restore();
    }

    const detailHitBars = getActiveDetailHitHpBars();
    if (detailHitBars.length > 0) {
      ctx.save();
      for (const bar of detailHitBars) {
        drawDetailHitHpBar(ctx, bar, tileW, tileH, snapPx);
      }
      ctx.restore();
    }
    const detailPulses = getActiveDetailHitPulses();
    if (detailPulses.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const pulse of detailPulses) {
        drawDetailHitPulse(ctx, pulse, tileW, tileH, snapPx);
      }
      ctx.restore();
    }

    // PASS 5a-deferred: S / SE / SW full grass over sprite; E / W extra bottom strip (LOD 0 only; skipped in flight)
    const microW = width * MACRO_TILE_STRIDE;
    const microH = height * MACRO_TILE_STRIDE;
    if (playLodGrassSpriteOverlay && !skipPlayerGrassOverlayDuringFlight) {
    const playerFracY = vy - overlayMy;
    const playerTouchesSouthTile = playerFracY >= 0.68;
    const preferSouthBottomOverlay =
      shouldDrawPlayerOverlay &&
      playerTouchesSouthTile &&
      overlayMx >= 0 &&
      overlayMy + 1 >= 0 &&
      overlayMx < microW &&
      overlayMy + 1 < microH &&
      overlayMx >= startX &&
      overlayMx < endX &&
      overlayMy + 1 >= startY &&
      overlayMy + 1 < endY &&
      passesAbovePlayerTileGate(overlayMx, overlayMy, getCached(overlayMx, overlayMy)) &&
      passesAbovePlayerTileGate(overlayMx, overlayMy + 1, getCached(overlayMx, overlayMy + 1));
    for (const [dx, dy] of GRASS_DEFER_AROUND_PLAYER_DELTAS) {
      const mx = overlayMx + dx;
      const my = overlayMy + dy;
      if (mx < 0 || my < 0 || mx >= microW || my >= microH) continue;
      if (mx < startX || mx >= endX || my < startY || my >= endY) continue;

      const isEw = (dx === 1 && dy === 0) || (dx === -1 && dy === 0);
      if (isEw && !shouldDrawPlayerOverlay) continue;

      const tile = getCached(mx, my);
      if (!passesAbovePlayerTileGate(mx, my, tile)) continue;
      const tw = Math.ceil(tileW), th = Math.ceil(tileH), tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH);
      const useSouthBottomOverlay = preferSouthBottomOverlay && dx === 0 && dy === 1;
      drawGrass5aForCell(
        mx,
        my,
        tile,
        tw,
        th,
        tx,
        ty,
        isEw || useSouthBottomOverlay ? 'playerTopOverlay' : undefined
      );
    }

    // Player tile: bottom strip over sprite on waiting or horizontal-move frame
    if (
      shouldDrawPlayerOverlay &&
      !preferSouthBottomOverlay &&
      overlayMx >= 0 &&
      overlayMy >= 0 &&
      overlayMx < microW &&
      overlayMy < microH &&
      overlayMx >= startX &&
      overlayMx < endX &&
      overlayMy >= startY &&
      overlayMy < endY
    ) {
      const tPlayer = getCached(overlayMx, overlayMy);
      if (passesAbovePlayerTileGate(overlayMx, overlayMy, tPlayer)) {
        const twP = Math.ceil(tileW), thP = Math.ceil(tileH), txP = Math.floor(overlayMx * tileW), tyP = Math.floor(overlayMy * tileH);
        drawGrass5aForCell(overlayMx, overlayMy, tPlayer, twP, thP, txP, tyP, 'playerTopOverlay');
      }
    }
    } // playLodGrassSpriteOverlay && !skipPlayerGrassOverlayDuringFlight (5a-deferred)

    // --- Collider overlay (checkbox or C key): walkability tint + every nearby trunk stroke + entity radii.
    // "Inspect one tree" (context menu) only adds the yellow trunk highlight below + player feet circle here — not all trunks.
    const detailColliderDbg = options.settings?.playDetailColliderHighlight;
    const showFullColliderOverlay = options.settings?.showPlayColliders || window.debugColliders;

    if (showFullColliderOverlay) {
      ctx.save();
      const twCell = Math.ceil(tileW);
      const thCell = Math.ceil(tileH);
      const pCol = options.settings?.player;
      const colliderCache = options.settings?.playColliderOverlayCache;
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

        ctx.strokeStyle = 'rgba(120, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        for (const span of colliderCache.formalEllipses) {
          if (!circleAabbIntersectsRect(span.cx, span.cy, span.radius, startX, startY, endX, endY)) {
            continue;
          }
          const pxCx = snapPx(span.cx * tileW);
          const pxCy = snapPx(span.cy * tileH);
          const rx = Math.max(1, span.radius * tileW);
          const ry = Math.max(1, span.radius * tileH);
          ctx.beginPath();
          ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.lineWidth = 2;
        for (const p of colliderCache.scatterEllipses) {
          if (!circleAabbIntersectsRect(p.cx, p.cy, p.radius, startX, startY, endX, endY)) {
            continue;
          }
          ctx.strokeStyle = p.isTree
            ? 'rgba(200, 140, 255, 0.9)'
            : 'rgba(100, 200, 255, 0.88)';
          const pxCx = snapPx(p.cx * tileW);
          const pxCy = snapPx(p.cy * tileH);
          const rx = Math.max(1, p.radius * tileW);
          const ry = Math.max(1, p.radius * tileH);
          ctx.beginPath();
          ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        const cx = pCol ? Math.floor(pCol.x) : startX + Math.floor((endX - startX) / 2);
        const cy = pCol ? Math.floor(pCol.y) : startY + Math.floor((endY - startY) / 2);
        const COLL_OVERLAY_RAD = 18;
        const ox0 = Math.max(startX, cx - COLL_OVERLAY_RAD);
        const ox1 = Math.min(endX, cx + COLL_OVERLAY_RAD + 1);
        const oy0 = Math.max(startY, cy - COLL_OVERLAY_RAD);
        const oy1 = Math.min(endY, cy + COLL_OVERLAY_RAD + 1);
        const overlayFeetDex = player.dexId || 94;
        const overlayFeetMoving = isPlayerWalkingAnim;
        for (let my = oy0; my < oy1; my++) {
          for (let mx = ox0; mx < ox1; mx++) {
            const ftCell = worldFeetFromPivotCell(mx, my, imageCache, overlayFeetDex, overlayFeetMoving);
            const feetOk = canWalkMicroTile(ftCell.x, ftCell.y, data, ftCell.x, ftCell.y, undefined, false);
            const formalTrunk = formalTreeTrunkOverlapsMicroCell(mx, my, data);
            const scatterPhy = scatterPhysicsCircleOverlapsMicroCellAny(mx, my, data);
            if (!feetOk) {
              ctx.fillStyle = 'rgba(220, 60, 120, 0.3)';
              ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
            } else if (formalTrunk || scatterPhy) {
              ctx.fillStyle = formalTrunk
                ? 'rgba(90, 220, 255, 0.26)'
                : 'rgba(160, 170, 255, 0.24)';
              ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
            }
          }
        }

        ctx.strokeStyle = 'rgba(120, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        for (let my = oy0; my < oy1; my++) {
          for (let rootX = ox0 - 1; rootX < ox1; rootX++) {
            const span = getFormalTreeTrunkWorldXSpan(rootX, my, data);
            if (!span) continue;
            const pxCx = snapPx(span.cx * tileW);
            const pxCy = snapPx(span.cy * tileH);
            const rx = Math.max(1, span.radius * tileW);
            const ry = Math.max(1, span.radius * tileH);
            ctx.beginPath();
            ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        const microWColOv = width * MACRO_TILE_STRIDE;
        const microHColOv = height * MACRO_TILE_STRIDE;
        const scatterPhyMemo = new Map();
        ctx.lineWidth = 2;
        for (let oxS = ox0 - 8; oxS < ox1 + 2; oxS++) {
          if (oxS < 0 || oxS >= microWColOv) continue;
          const yOrigMax = Math.min(microHColOv - 1, oy1 + 3);
          for (let oyS = Math.max(0, oy0 - 10); oyS <= yOrigMax; oyS++) {
            const p = scatterPhysicsCircleAtOrigin(oxS, oyS, data, scatterPhyMemo, getCached);
            if (!p) continue;
            const cr = p.radius;
            if (p.cx + cr <= ox0 || p.cx - cr >= ox1 || p.cy + cr <= oy0 || p.cy - cr >= oy1) continue;
            ctx.strokeStyle = scatterItemKeyIsTree(p.itemKey)
              ? 'rgba(200, 140, 255, 0.9)'
              : 'rgba(100, 200, 255, 0.88)';
            const pxCx = snapPx(p.cx * tileW);
            const pxCy = snapPx(p.cy * tileH);
            const rx = Math.max(1, cr * tileW);
            const ry = Math.max(1, cr * tileH);
            ctx.beginPath();
            ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      for (const item of renderItems) {
        if (item.type === 'player' || item.type === 'wild') {
          drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache);
          drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx);
        } else if (item.type === 'crystalDrop') {
          const d = item.drop;
          const r = Math.max(0.05, Number(d.pickRadius) || 0.5);
          ctx.strokeStyle = 'rgba(140, 245, 255, 0.95)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(snapPx(d.x * tileW), snapPx(d.y * tileH), Math.max(1, r * tileW), Math.max(1, r * tileH), 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(170, 255, 255, 0.3)';
          ctx.fill();
        } else if (item.type === 'scatter' || item.type === 'tree') {
          ctx.fillStyle = 'rgba(255, 80, 255, 0.65)';
          ctx.fillRect(item.originX * tileW + tileW / 2 - 3, (item.y + 0.1) * tileH - 3, 6, 6);
        }
      }
      ctx.restore();
    } else if (detailColliderDbg) {
      ctx.save();
      for (const item of renderItems) {
        if (item.type === 'player' || item.type === 'wild') {
          drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache);
          drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx);
        }
      }
      ctx.restore();
    }

    if (detailColliderDbg?.kind === 'formal-tree') {
      const span = getFormalTreeTrunkWorldXSpan(detailColliderDbg.rootX, detailColliderDbg.my, data);
      if (span) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 210, 70, 0.98)';
        ctx.lineWidth = 3;
        const pxCx = snapPx(span.cx * tileW);
        const pxCy = snapPx(span.cy * tileH);
        const rx = Math.max(2, span.radius * tileW);
        const ry = Math.max(2, span.radius * tileH);
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (detailColliderDbg?.kind === 'scatter-tree') {
      const treeMemo = new Map();
      const p = scatterPhysicsCircleAtOrigin(detailColliderDbg.ox0, detailColliderDbg.oy0, data, treeMemo, getCached);
      if (p && scatterItemKeyIsTree(p.itemKey)) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 190, 95, 0.98)';
        ctx.lineWidth = 3;
        const pxCx = snapPx(p.cx * tileW);
        const pxCy = snapPx(p.cy * tileH);
        const rx = Math.max(2, p.radius * tileW);
        const ry = Math.max(2, p.radius * tileH);
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (detailColliderDbg?.kind === 'scatter-solid') {
      ctx.save();
      if (EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER) {
        const solidMemo = new Map();
        const p = scatterPhysicsCircleAtOrigin(
          detailColliderDbg.ox0,
          detailColliderDbg.oy0,
          data,
          solidMemo,
          getCached
        );
        if (p && !scatterItemKeyIsTree(p.itemKey)) {
          ctx.strokeStyle = 'rgba(120, 220, 255, 0.95)';
          ctx.lineWidth = 3;
          const pxCx = snapPx(p.cx * tileW);
          const pxCy = snapPx(p.cy * tileH);
          const rx = Math.max(2, p.radius * tileW);
          const ry = Math.max(2, p.radius * tileH);
          ctx.beginPath();
          ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        const twS = Math.ceil(tileW);
        const thS = Math.ceil(tileH);
        const x0 = detailColliderDbg.ox0;
        const y0 = detailColliderDbg.oy0;
        const cols = detailColliderDbg.cols ?? 1;
        const rows = detailColliderDbg.rows ?? 1;
        ctx.strokeStyle = 'rgba(120, 220, 255, 0.95)';
        ctx.lineWidth = 3;
        ctx.strokeRect(
          snapPx(x0 * tileW),
          snapPx(y0 * tileH),
          Math.max(1, cols * twS - 1),
          Math.max(1, rows * thS - 1)
        );
      }
      ctx.restore();
    } else if (detailColliderDbg?.kind === 'grass') {
      const twG = Math.ceil(tileW);
      const thG = Math.ceil(tileH);
      ctx.save();
      ctx.strokeStyle = 'rgba(140, 255, 160, 0.95)';
      ctx.lineWidth = 3;
      ctx.strokeRect(snapPx(detailColliderDbg.mx * tileW), snapPx(detailColliderDbg.my * tileH), twG, thG);
      ctx.fillStyle = 'rgba(140, 255, 160, 0.12)';
      ctx.fillRect(detailColliderDbg.mx * tileW, detailColliderDbg.my * tileH, twG, thG);
      ctx.restore();
    }

    if (
      latchGround &&
      !!player.grounded &&
      playInputState.shiftLeftHeld &&
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

    const tint = options.settings?.dayCycleTint;
    if (tint && typeof tint.r === 'number') {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    const minimapCanvas = document.getElementById('minimap');
    if (minimapCanvas) renderMinimap(minimapCanvas, data, player);
  }

  if (options.hover) {
    const { x, y } = options.hover;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
  }
  ctx.restore();
}
