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
  hasPlayChunk,
  getPlayChunk,
  setPlayChunk,
  enqueuePlayChunkBake,
  dequeuePlayChunkBakes,
  getPlayChunkBakeQueueSize,
  prunePlayChunkCache
} from './render/play-chunk-cache.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import {
  clearGrassFireStateForNewMap,
  grassFireVisualPhaseAt,
  grassFireCharredRegrowth01
} from './play-grass-fire.js';
import { clearGrassCutStateForNewMap, grassCutSuppressesAnimatedGrassAt } from './play-grass-cut.js';
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

import { drawBatchedProjectile } from './render/render-projectiles.js';
import { drawBatchedParticle } from './render/render-particles.js';
import {
  drawPlayEntityFootAndAirCollider,
  drawPlayEntityCombatHurtbox
} from './render/render-debug-overlays.js';
import {
  drawDetailHitHpBar,
  drawDetailHitPulse,
  drawStrengthGrabProgressBar,
  drawWildEmotionOverlay,
  drawWildHpBar
} from './render/render-ui-world.js';
import { drawWildSpeechBubbleOverlay } from './render/render-speech-bubble.js';
import {
  updateJumpRings,
  updateRunDustPuffs,
  trackJumpStartRings,
  trackRunningDust,
  drawRunDustPuff,
  drawJumpRing,
  getActiveJumpRings,
  getActiveRunDustPuffs
} from './render/render-effects-state.js';
import {
  resetPlayChunkBakeAutoTuner,
  getAdaptivePlayChunkBakeBudget,
  getPlayChunkFrameStats,
  setLastPlayChunkFrameStats,
  getPlayChunkBakeBoost
} from './render/render-chunk-stats.js';

import {
  snapPx,
  drawTile16,
  atlasFromObjectSet,
  TCOLS_NATURE
} from './render/render-utils-internal.js';
import {
  drawOceanPass,
  drawAnimatedGrassPass,
  drawGrass5aForCell
} from './render/render-map-layers.js';
import { collectRenderItems } from './render/render-item-collector.js';
import {
  drawScatter,
  drawTree,
  drawBuilding,
  drawCrystalDrop,
  drawDigCompanion,
  drawPlayerAimIndicator,
  drawStrengthThrowAimPreview,
  drawTreeTopFall,
  drawPsybeamChargeBall,
  drawCrystalShard,
  drawSpawnedSmallCrystal,
  drawStrengthThrowRock,
  drawStrengthThrowFaintedWild
} from './render/render-world-entities.js';
import {
  drawWorldColliderOverlay,
  drawWorldReactionsOverlay,
  drawEnvironmentalEffects,
  drawDigChargeBar
} from './render/render-debug-world.js';

import './render/render-debug-hotkeys.js';

import { TessellationEngine } from './tessellation-engine.js';
import { POKEMON_HEIGHTS } from './pokemon/pokemon-config.js';
import { MACRO_TILE_STRIDE, getMicroTile } from './chunking.js';
import { BIOME_TO_TERRAIN } from './biome-tiles.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { getRoleForCell } from './tessellation-logic.js';
import {
  speciesHasFlyingType,
  speciesHasSmoothLevitationFlight
} from './pokemon/pokemon-type-helpers.js';
import { activeProjectiles, activeParticles } from './moves/moves-manager.js';
import {
  activeCrystalShards,
  activeSpawnedSmallCrystals,
  activeCrystalDrops,
  getActiveDetailHitHpBars,
  getActiveDetailHitPulses
} from './main/play-crystal-tackle.js';
import { playInputState } from './main/play-input-state.js';
import { isPlayerIdleOnWaitingFrame, PLAYER_FLIGHT_MAX_Z_TILES } from './player.js';
import { aimAtCursor } from './main/play-mouse-combat.js';
import { PMD_MON_SHEET } from './pokemon/pmd-default-timing.js';
import { imageCache } from './image-cache.js';
import {
  resolvePmdFrameSpecForSlice,
  resolveCanonicalPmdH
} from './pokemon/pmd-layout-metrics.js';
import { getResolvedSheets } from './pokemon/pokemon-asset-loader.js';


export {
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_TOP_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render/render-constants.js';

export { loadTilesetImages } from './render/load-tileset-images.js';
export { getPlayChunkFrameStats };

let didWarnTerrainSetRoles = false;

export function spawnJumpRingAt(x, y) {
  // logic handled in render/render-effects-state.js
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
    setLastPlayChunkFrameStats({
      mode: appMode,
      totalVisible: 0,
      drawnVisible: 0,
      missingVisible: 0,
      bakedThisFrame: 0,
      bakeBudget: 0,
      bakeBoost: 0,
      queueSize: 0
    });
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
    clearGrassCutStateForNewMap();
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
    const latchGround = !!player.grounded;

    const playerDexForCam = player.dexId || 94;
    const playCam = computePlayViewState({
      cw, ch, vx, vy,
      playerZ: player.z ?? 0,
      flightActive: !!player.flightActive,
      framingHeightTiles: POKEMON_HEIGHTS[playerDexForCam] || 1.1
    });
    setPlayCameraSnapshot({ ...playCam, cw, ch });
    tileW = playCam.effTileW;
    tileH = playCam.effTileH;
    const lodDetail = playCam.lodDetail;
    const time = options.settings?.time || 0;
    const smoothLev = player.flightLevelVisual ?? (player.z || 0);
    const flightHudActive = speciesHasFlyingType(playerDexForCam) && player.flightActive;
    const isPlayerWalkingAnim =
      (!!player.grounded &&
        (Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1 || !!player.digActive)) ||
      (flightHudActive &&
        smoothLev &&
        (Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1 ||
          !!playInputState.spaceHeld ||
          !!playInputState.shiftLeftHeld ||
          (player.z ?? 0) > 0.02));
    
    updateJumpRings(time);
    updateRunDustPuffs(time);

    startX = Math.max(0, playCam.startXTiles);
    startY = Math.max(0, playCam.startYTiles);
    endX = Math.min(width * MACRO_TILE_STRIDE, playCam.endXTiles);
    endY = Math.min(height * MACRO_TILE_STRIDE, playCam.endYTiles);

    // --- CHUNK BAKING & RENDERING ---
    const maxChunkXi = Math.floor((width * MACRO_TILE_STRIDE - 1) / PLAY_CHUNK_SIZE);
    const maxChunkYi = Math.floor((height * MACRO_TILE_STRIDE - 1) / PLAY_CHUNK_SIZE);
    const padC = playCam.chunkPad;
    let cStartX = Math.max(0, Math.floor(startX / PLAY_CHUNK_SIZE) - padC);
    let cStartY = Math.max(0, Math.floor(startY / PLAY_CHUNK_SIZE) - padC);
    let cEndX = Math.min(maxChunkXi, Math.floor((endX - 1) / PLAY_CHUNK_SIZE) + padC);
    let cEndY = Math.min(maxChunkYi, Math.floor((endY - 1) / PLAY_CHUNK_SIZE) + padC);

    const visibleChunkCoords = [];
    const visibleChunkKeys = new Set();
    let missingVisibleChunks = 0;
    let cachedVisibleChunks = 0;
    for (let cy = cStartY; cy <= cEndY; cy++) {
      for (let cx = cStartX; cx <= cEndX; cx++) {
        const key = `${cx},${cy}`;
        visibleChunkCoords.push({ cx, cy, key });
        visibleChunkKeys.add(key);
        if (hasPlayChunk(key)) cachedVisibleChunks++;
        else {
          missingVisibleChunks++;
          enqueuePlayChunkBake(cx, cy);
        }
      }
    }

    const chunkBakeBudget = getAdaptivePlayChunkBakeBudget({
      lodDetail, cachedVisibleChunks, missingVisibleChunks,
      queueSize: getPlayChunkBakeQueueSize(),
      totalVisibleChunks: visibleChunkCoords.length
    });

    const bakeRequests = dequeuePlayChunkBakes(chunkBakeBudget);
    for (const req of bakeRequests) {
      if (hasPlayChunk(req.key) && !req.forceRebake) continue;
      setPlayChunk(req.key, bakeChunk(req.cx, req.cy, data, PLAY_BAKE_TILE_PX, PLAY_BAKE_TILE_PX));
    }

    const currentTransX = playCam.currentTransX;
    const currentTransY = playCam.currentTransY;
    const chunkDrawScale = playCam.viewScale;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = chunkDrawScale < 0.999;

    let drawnVisibleChunks = 0;
    for (const { cx, cy, key } of visibleChunkCoords) {
      const chunk = getPlayChunk(key);
      if (!chunk) continue;
      drawnVisibleChunks++;
      ctx.drawImage(
        chunk.canvas, 0, 0, chunk.canvas.width, chunk.canvas.height,
        currentTransX + cx * PLAY_CHUNK_SIZE * tileW,
        currentTransY + cy * PLAY_CHUNK_SIZE * tileH,
        Math.max(1, Math.ceil(chunk.canvas.width * chunkDrawScale - 1e-6)),
        Math.max(1, Math.ceil(chunk.canvas.height * chunkDrawScale - 1e-6))
      );
    }
    setLastPlayChunkFrameStats({
      mode: 'play',
      totalVisible: visibleChunkCoords.length,
      drawnVisible: drawnVisibleChunks,
      missingVisible: Math.max(0, visibleChunkCoords.length - drawnVisibleChunks),
      bakedThisFrame: bakeRequests.length,
      bakeBudget: chunkBakeBudget,
      bakeBoost: getPlayChunkBakeBoost(),
      queueSize: getPlayChunkBakeQueueSize()
    });
    prunePlayChunkCache({
      keepKeys: visibleChunkKeys,
      centerCx: Math.floor(player.x / PLAY_CHUNK_SIZE),
      centerCy: Math.floor(player.y / PLAY_CHUNK_SIZE)
    });
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.translate(currentTransX, currentTransY);

    // --- TILE CACHE & WARMING ---
    const tileCache = new Map();
    const getCached = (mx, my) => {
      const key = (mx << 16) | (my & 0xFFFF);
      let t = tileCache.get(key);
      if (!t) {
        t = getMicroTile(mx, my, data);
        tileCache.set(key, t);
      }
      return t;
    };
    if (lodDetail < 2) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) getCached(mx, my);
      }
    }

    // --- MODULAR RENDERING ---
    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    const vegAnimTime = lodDetail === 0 ? time : 0;
    const canopyAnimTime = vegAnimTime;

    // PASS 0: Ocean
    drawOceanPass(ctx, { 
      waterImg: imageCache.get('tilesets/water-tile.png'), 
      lodDetail, time, startX, startY, endX, endY, getCached, tileW, tileH 
    });

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
          fn(mx, my, tile, Math.ceil(tileW), Math.ceil(tileH), Math.floor(mx * tileW), Math.floor(my * tileH));
        }
      }
    };

    const overlayMx = Math.floor(vx);
    const overlayMy = Math.floor(vy);
    const skipPlayerGrassOverlayDuringFlight = flightHudActive;
    const playLodGrassSpriteOverlay = lodDetail < 1;
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

    // PASS 5a: Animated Grass
    drawAnimatedGrassPass(ctx, { 
      lodDetail, forEachAbovePlayerTile, playerTileMx: overlayMx, playerTileMy: overlayMy, 
      playLodGrassSpriteOverlay, isGrassDeferredAroundPlayer, isGrassDeferredEwNeighbor, skipPlayerGrassOverlayDuringFlight,
      drawGrass5aForCell: (mx, my, tile, tw, th, tx, ty, mode) => {
        drawGrass5aForCell(ctx, mx, my, tile, tw, th, tx, ty, { mode, lodDetail, tileW, tileH, vegAnimTime, natureImg, data, getCached, playChunkMap, snapPx });
      }
    });

    // PASS 3.5: Entity Collection & Drawing
    const renderItems = collectRenderItems({ 
      data, player, startX, startY, endX, endY, lodDetail, width, height, getCached, time, 
      activeProjectiles, activeParticles, activeCrystalShards, activeSpawnedSmallCrystals, activeCrystalDrops, playInputState,
      imageCache, tileW, tileH, isPlayerWalkingAnim, latchGround, snapPx
    });
    
    // Sort and track effects
    renderItems.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));
    trackJumpStartRings(renderItems);
    trackRunningDust(renderItems, time);

    const blockedGrassOverlayTiles = new Set();
    const tileKey = (mx, my) => `${mx},${my}`;
    const markBlockedTile = (mx, my) => {
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
      blockedGrassOverlayTiles.add(tileKey(Math.floor(mx), Math.floor(my)));
    };
    const markBlockedRect = (ox, oy, cols, rows) => {
      const bx = Math.floor(ox);
      const by = Math.floor(oy);
      const w = Math.max(1, Math.floor(cols || 1));
      const h = Math.max(1, Math.floor(rows || 1));
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) markBlockedTile(bx + dx, by + dy);
      }
    };
    for (const it of renderItems) {
      if (it.type === 'tree') {
        // Formal tree trunk/base spans two ground tiles.
        markBlockedRect(it.originX, it.originY, 2, 1);
      } else if (it.type === 'scatter') {
        markBlockedRect(it.originX, it.originY, it.cols || 1, it.rows || 1);
      } else if (it.type === 'building') {
        const bCols = it.bData?.cols ?? (it.bData?.type === 'pokecenter' ? 5 : 4);
        const bRows = it.bData?.rows ?? (it.bData?.type === 'pokecenter' ? 6 : 5);
        markBlockedRect(it.originX, it.originY, bCols, bRows);
      }
    }
    const isGrassOverlayBlocked = (mx, my) => blockedGrassOverlayTiles.has(tileKey(Math.floor(mx), Math.floor(my)));

    const batchedEffects = [];
    for (const item of renderItems) {
      if (item.type === 'wild' || item.type === 'player') {
        ctx.save();
        const alpha = item.type === 'wild' ? item.spawnPhase : (item.drawAlpha ?? 1);
        ctx.globalAlpha = alpha;
        let spawnYOffset = 0;
        if (item.type === 'wild' && item.spawnPhase < 1) {
          if (item.spawnType === 'sky') spawnYOffset = (1 - item.spawnPhase) * (-4 * tileH);
          else if (item.spawnType === 'water') spawnYOffset = (1 - item.spawnPhase) * (0.8 * tileH);
          else spawnYOffset = (1 - item.spawnPhase) * (0.2 * tileH);
        }

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        const shadowW = tileW * 0.4 * (item.targetHeightTiles / 3.5 + 0.5);
        ctx.ellipse(item.cx, snapPx((item.y + 0.5) * tileH) + spawnYOffset, shadowW, tileH * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();

        const bury = item.type === 'player' ? (item.digBuryVisual ?? 0) : 0;
        const tackleOx = item.type === 'player' ? (item.tackleOffPx || 0) : 0;
        const tackleOy = item.type === 'player' ? (item.tackleOffPy || 0) : 0;
        const pxL = snapPx(item.cx - item.pivotX + tackleOx);
        const pxT0 = snapPx(item.cy - item.pivotY + spawnYOffset + tackleOy);
        const pxW = snapPx(item.dw);
        const pxH = snapPx(item.dh);
        
        if (item.type === 'wild' && item.hitFlashTimer > 0) ctx.filter = 'brightness(5) contrast(2) sepia(1) hue-rotate(-50deg)';
        if (bury > 0.004) {
          const visH = Math.min(pxH - 1, Math.max(6, Math.floor(pxH * (1 - bury * 0.39))));
          const pxT = snapPx(pxT0 + (pxH - visH));
          ctx.save();
          ctx.beginPath(); ctx.rect(pxL, pxT, pxW, visH); ctx.clip();
          ctx.drawImage(item.sheet, item.sx, item.sy, item.sw, item.sh, pxL, pxT0, pxW, pxH);
          ctx.restore();
        } else {
          ctx.drawImage(item.sheet, item.sx, item.sy, item.sw, item.sh, pxL, pxT0, pxW, pxH);
        }

        ctx.filter = 'none';
        if (item.type === 'wild' && item.hitFlashTimer > 0) {
          const spark01 = Math.max(0, Math.min(1, (item.hitFlashTimer || 0) / 0.2));
          const pulse = 0.65 + 0.35 * Math.sin((time || 0) * 90 + item.x * 2.3 + item.y * 1.9);
          const sr = Math.max(4, tileW * (0.16 + 0.12 * spark01) * pulse);
          ctx.save();
          ctx.globalAlpha = alpha * spark01 * 0.78;
          ctx.strokeStyle = 'rgba(255, 242, 182, 0.95)';
          ctx.lineWidth = Math.max(1, tileW * 0.03);
          ctx.beginPath();
          ctx.moveTo(item.cx - sr, item.cy);
          ctx.lineTo(item.cx + sr, item.cy);
          ctx.moveTo(item.cx, item.cy - sr);
          ctx.lineTo(item.cx, item.cy + sr);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255, 145, 98, 0.75)';
          ctx.beginPath();
          ctx.arc(item.cx, item.cy, sr * 0.52, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        if (item.type === 'wild') drawWildHpBar(ctx, item, spawnYOffset, tileW, tileH);

        // Terrain / grass depth cue (LOD 0)
        if (playLodGrassSpriteOverlay && (item.type === 'wild' || !skipPlayerGrassOverlayDuringFlight)) {
          const tx = Math.floor(item.x); const ty = Math.floor(item.y);
          if (tx >= startX && tx < endX && ty >= startY && ty < endY) {
            if (!isGrassOverlayBlocked(tx, ty)) {
              const t = getCached(tx, ty);
              const gateSet = TERRAIN_SETS[BIOME_TO_TERRAIN[t?.biomeId] || 'grass'];
              const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -1) >= (t?.heightStep ?? 0);
              if (t?.heightStep > 0 && (!gateSet || getRoleForCell(ty, tx, height * MACRO_TILE_STRIDE, width * MACRO_TILE_STRIDE, checkAtOrAbove, gateSet.type) === 'CENTER')) {
                drawGrass5aForCell(ctx, tx, ty, t, Math.ceil(tileW), Math.ceil(tileH), tx * tileW, ty * tileH, { mode: 'playerTopOverlay', lodDetail, tileW, tileH, vegAnimTime, natureImg, data, getCached, playChunkMap, snapPx });
              }
            }
          }
        }

        // Strength carry visual (and lift-in-progress travel from origin -> above carrier).
        if (item.type === 'player' && (item.strengthCarry || item._strengthGrabAction)) {
          const sc = item.strengthCarry || item._strengthGrabAction;
          const objSet = OBJECT_SETS[sc.itemKey];
          if (objSet) {
            const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
            const tid = base?.ids?.[0];
            const { img, cols: atlasCols } = atlasFromObjectSet(objSet, imageCache);
            if (img && tid != null) {
              const cols = Math.max(1, Number(sc.cols) || 1);
              const rows = Math.max(1, Number(sc.rows) || 1);
              const srcW = 16 * cols;
              const srcH = 16 * rows;
              const dw = Math.ceil(tileW * cols);
              const dh = Math.ceil(tileH * rows);
              const sx0 = (tid % atlasCols) * 16;
              const sy0 = Math.floor(tid / atlasCols) * 16;
              const tackX = tackleOx * 0.12;
              const tackY = tackleOy * 0.12;
              const carryCx = item.cx + tackX;
              const carryCy = pxT0 - tackY - Math.max(dw, dh) * 0.48;
              let drawCx = carryCx;
              let drawCy = carryCy;
              let rot = Math.PI / 2;
              if (!item.strengthCarry && item._strengthGrabAction) {
                const g = item._strengthGrabAction;
                const dur = Math.max(0.001, Number(g.durationSec) || 0.001);
                const pRaw = Math.max(0, Math.min(1, (Number(g.elapsedSec) || 0) / dur));
                const p = 1 - Math.pow(1 - pRaw, 2.35);
                const fromX = (Number(g.originCx) || 0) * tileW;
                const fromY = (Number(g.originCy) || 0) * tileH;
                const arcLift = Math.sin(Math.PI * p) * tileH * 0.55;
                drawCx = fromX + (carryCx - fromX) * p;
                drawCy = fromY + (carryCy - fromY) * p - arcLift;
                rot = (Math.PI / 2) * p;
              }
              ctx.save();
              ctx.translate(snapPx(drawCx), snapPx(drawCy));
              ctx.rotate(rot);
              ctx.drawImage(img, sx0, sy0, srcW, srcH, -dw * 0.5, -dh * 0.5, dw, dh);
              ctx.restore();
            }
          }
          if (!objSet && sc.kind === 'faintedWild') {
            const dex = Math.max(1, Math.floor(Number(sc.wildDexId) || Number(sc?.wildEntity?.dexId) || 1));
            const { idle: wIdle, walk: wWalk, faint: wFaint } = getResolvedSheets(imageCache, dex);
            const sheet = wFaint || wIdle || wWalk;
            if (sheet) {
              const { sw, sh } = resolvePmdFrameSpecForSlice(sheet, dex, 'faint');
              const canonicalH = resolveCanonicalPmdH(wIdle || wWalk, wWalk || wIdle, dex);
              const targetHeightTiles = POKEMON_HEIGHTS[dex] || 1.1;
              const finalScale = (targetHeightTiles * tileH) / Math.max(1, canonicalH);
              const dw = sw * finalScale;
              const dh = sh * finalScale;
              const tackX = tackleOx * 0.12;
              const tackY = tackleOy * 0.12;
              const carryCx = item.cx + tackX;
              const carryCy = pxT0 - tackY - Math.max(dw, dh) * 0.52;
              let drawCx = carryCx;
              let drawCy = carryCy;
              let rot = Math.PI / 2;
              if (!item.strengthCarry && item._strengthGrabAction) {
                const g = item._strengthGrabAction;
                const dur = Math.max(0.001, Number(g.durationSec) || 0.001);
                const pRaw = Math.max(0, Math.min(1, (Number(g.elapsedSec) || 0) / dur));
                const p = 1 - Math.pow(1 - pRaw, 2.35);
                const fromX = (Number(g.originCx) || 0) * tileW;
                const fromY = (Number(g.originCy) || 0) * tileH;
                const arcLift = Math.sin(Math.PI * p) * tileH * 0.55;
                drawCx = fromX + (carryCx - fromX) * p;
                drawCy = fromY + (carryCy - fromY) * p - arcLift;
                rot = (Math.PI / 2) * p;
              }
              ctx.save();
              ctx.translate(snapPx(drawCx), snapPx(drawCy));
              ctx.rotate(rot);
              ctx.drawImage(sheet, 0, 0, sw, sh, -dw * 0.5, -dh * PMD_MON_SHEET.pivotYFrac, dw, dh);
              ctx.restore();
            }
          }
        }
        if (item.type === 'player' && item._strengthGrabAction) {
          drawStrengthGrabProgressBar(ctx, item, tileW, tileH, snapPx);
        }

        ctx.restore();
      } else if (item.type === 'wildSpeechBubble' || item.type === 'playerSpeechBubble') {
        ctx.save();
        const spawnYOffset =
          item.spawnType === 'sky' && item.spawnPhase < 1 ? (1 - item.spawnPhase) * (-4 * tileH) : 0;
        drawWildSpeechBubbleOverlay(ctx, item, spawnYOffset, imageCache, tileW, tileH, snapPx);
        ctx.restore();
      } else if (item.type === 'wildEmotion' || item.type === 'playerEmotion') {
        ctx.save();
        const spawnYOffset = (item.spawnType === 'sky' && item.spawnPhase < 1) ? (1 - item.spawnPhase) * (-4 * tileH) : 0;
        drawWildEmotionOverlay(ctx, item, spawnYOffset, imageCache, tileW, tileH, snapPx);
        ctx.restore();
      } else if (item.type === 'scatter') {
        ctx.save();
        ctx.globalAlpha *= item.regrowFade01 != null ? item.regrowFade01 : 1;
        drawScatter(ctx, item, { tileW, tileH, snapPx, time, lodDetail, canopyAnimTime, imageCache, getCached });
        ctx.restore();
      } else if (item.type === 'tree') {
        ctx.save();
        ctx.globalAlpha *= item.regrowFade01 != null ? item.regrowFade01 : 1;
        drawTree(ctx, item, { tileW, tileH, snapPx, time, canopyAnimTime, natureImg, imageCache });
        ctx.restore();
      } else if (item.type === 'building') {
        ctx.save(); drawBuilding(ctx, item, { tileW, tileH, snapPx, imageCache }); ctx.restore();
      } else if (item.type === 'crystalDrop') {
        ctx.save(); drawCrystalDrop(ctx, item, { tileW, tileH, snapPx, imageCache }); ctx.restore();
      } else if (item.type === 'crystalShard') {
        ctx.save(); drawCrystalShard(ctx, item, { tileW, tileH, snapPx, imageCache }); ctx.restore();
      } else if (item.type === 'spawnedSmallCrystal') {
        ctx.save(); drawSpawnedSmallCrystal(ctx, item, { tileW, tileH, snapPx, imageCache, time }); ctx.restore();
      } else if (item.type === 'strengthThrowRock') {
        ctx.save(); drawStrengthThrowRock(ctx, item, { tileW, tileH, snapPx, imageCache }); ctx.restore();
      } else if (item.type === 'strengthThrowFaintedWild') {
        ctx.save(); drawStrengthThrowFaintedWild(ctx, item, { tileW, tileH, snapPx, imageCache }); ctx.restore();
      } else if (item.type === 'projectile') batchedEffects.push({ kind: 'projectile', proj: item.proj });
      else if (item.type === 'particle') batchedEffects.push({ kind: 'particle', part: item.part });
      else if (item.type === 'digCompanion') { ctx.save(); drawDigCompanion(ctx, item, { snapPx, PMD_MON_SHEET }); ctx.restore(); }
      else if (item.type === 'playerAimIndicator') { ctx.save(); drawPlayerAimIndicator(ctx, item, { snapPx, player, flightHudActive, tileW, tileH, aimAtCursor }); ctx.restore(); }
      else if (item.type === 'strengthThrowAimPreview') { ctx.save(); drawStrengthThrowAimPreview(ctx, item, { snapPx, tileW, tileH }); ctx.restore(); }
      else if (item.type === 'psybeamChargeBall') { ctx.save(); drawPsybeamChargeBall(ctx, item, { snapPx, tileW }); ctx.restore(); }
      else if (
        item.type === 'formalTreeCanopyFall' ||
        item.type === 'scatterTreeCanopyFall' ||
        item.type === 'scatterVegetationFadeOut'
      ) {
        ctx.save();
        drawTreeTopFall(ctx, item, {
          snapPx,
          natureImg,
          TCOLS_NATURE,
          tileW,
          tileH,
          imageCache,
          getCached,
          lodDetail,
          canopyAnimTime
        });
        ctx.restore();
      }
    }

    if (batchedEffects.length > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const be of batchedEffects) {
        if (be.kind === 'projectile') drawBatchedProjectile(ctx, be.proj, tileW, tileH, snapPx, time);
        else drawBatchedParticle(ctx, be.part, tileW, tileH, snapPx);
      }
      ctx.restore();
    }

    // Secondary FX passes
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const fx of getActiveJumpRings()) drawJumpRing(ctx, fx, tileW, tileH, snapPx);
    ctx.restore();

    for (const puff of getActiveRunDustPuffs()) drawRunDustPuff(ctx, puff, tileW, tileH, snapPx);
    for (const bar of getActiveDetailHitHpBars()) drawDetailHitHpBar(ctx, bar, tileW, tileH, snapPx);
    
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const pulse of getActiveDetailHitPulses()) drawDetailHitPulse(ctx, pulse, tileW, tileH, snapPx);
    ctx.restore();

    // PASS 5a-deferred (grass over spirits)
    if (playLodGrassSpriteOverlay && !skipPlayerGrassOverlayDuringFlight) {
        const passesPlayerGate = (mx, my, t) => {
            if (!t || t.heightStep < 1) return false;
            const gateSet = TERRAIN_SETS[BIOME_TO_TERRAIN[t.biomeId] || 'grass'];
            const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -1) >= t.heightStep;
            return !gateSet || getRoleForCell(my, mx, height * MACRO_TILE_STRIDE, width * MACRO_TILE_STRIDE, checkAtOrAbove, gateSet.type) === 'CENTER';
        };
        const playerFracY = vy - Math.floor(vy);
        const shouldDrawPlayerOverlay = isPlayerIdleOnWaitingFrame() || (Math.abs(player.vy ?? 0) < 0.05 && !!player.grounded);
        const preferSouthBottomOverlay = shouldDrawPlayerOverlay && playerFracY >= 0.68 && passesPlayerGate(overlayMx, overlayMy, getCached(overlayMx, overlayMy)) && passesPlayerGate(overlayMx, overlayMy + 1, getCached(overlayMx, overlayMy + 1));
        
        for (const [dx, dy] of GRASS_DEFER_AROUND_PLAYER_DELTAS) {
            const mx = overlayMx + dx; const my = overlayMy + dy;
            if (mx < startX || mx >= endX || my < startY || my >= endY) continue;
            if (isGrassOverlayBlocked(mx, my)) continue;
            const tile = getCached(mx, my);
            if (!passesPlayerGate(mx, my, tile)) continue;
            drawGrass5aForCell(ctx, mx, my, tile, Math.ceil(tileW), Math.ceil(tileH), mx * tileW, my * tileH, { mode: (dx === 0 && dy === 1 && preferSouthBottomOverlay) || ((dx === 1 || dx === -1) && dy === 0) ? 'playerTopOverlay' : undefined, lodDetail, tileW, tileH, vegAnimTime, natureImg, data, getCached, playChunkMap, snapPx });
        }
        if (
          shouldDrawPlayerOverlay &&
          !preferSouthBottomOverlay &&
          !isGrassOverlayBlocked(overlayMx, overlayMy) &&
          passesPlayerGate(overlayMx, overlayMy, getCached(overlayMx, overlayMy))
        ) {
          drawGrass5aForCell(ctx, overlayMx, overlayMy, getCached(overlayMx, overlayMy), Math.ceil(tileW), Math.ceil(tileH), overlayMx * tileW, overlayMy * tileH, { mode: 'playerTopOverlay', lodDetail, tileW, tileH, vegAnimTime, natureImg, data, getCached, playChunkMap, snapPx });
        }
    }

    drawWorldColliderOverlay(ctx, { 
      showFullColliderOverlay: options.settings?.showPlayColliders || window.debugColliders, 
      detailColliderDbg: options.settings?.detailColliderDbg, 
      data, startX, startY, endX, endY, tileW, tileH, snapPx, imageCache, renderItems, player, isPlayerWalkingAnim, getCached, settings: options.settings 
    });
    drawWorldReactionsOverlay(ctx, {
      showWorldReactionsOverlay:
        !!options.settings?.showWorldReactionsOverlay || !!window.debugWorldReactionsOverlay,
      startX,
      startY,
      endX,
      endY,
      tileW,
      tileH,
      cw,
      ch
    });
    
    drawDigChargeBar(ctx, { latchGround, player, playInputState, cw, ch });
    drawEnvironmentalEffects(ctx, {
      cw,
      ch,
      tint: options.settings?.dayCycleTint,
      mistTile: getCached(overlayMx, overlayMy),
      lodDetail,
      time,
      playerZ: smoothLev,
      playerFlightMaxZ: PLAYER_FLIGHT_MAX_Z_TILES,
      startX,
      startY,
      endX,
      endY,
      tileW,
      tileH,
      worldCols: width * MACRO_TILE_STRIDE,
      worldRows: height * MACRO_TILE_STRIDE,
      cloudPresence: options.settings?.weatherCloudPresence,
      cloudNoiseSeed: options.settings?.weatherCloudNoiseSeed
    });

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
