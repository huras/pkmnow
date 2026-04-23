import {
  PLAY_CHUNK_SIZE,
  PLAY_BAKE_TILE_PX,
  WATER_ANIM_SRC_W,
  WATER_ANIM_SRC_H,
  PLAY_SEA_OVERLAY_ALPHA_LOD01,
  VEG_MULTITILE_OVERLAP_PX
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
import { invalidateStaticEntityCache } from './render/static-entity-cache.js';
import { drawCachedMapOverview } from './render/map-overview-cache.js';
import { resolveMapGlobalPlayerMicroForMarker } from './main/play-session-persist.js';
import { renderMinimap } from './render/render-minimap.js';
import {
  FIRE_FRAME_W,
  FIRE_FRAME_H,
  BURN_START_FRAME,
  BURN_START_FRAMES
} from './moves/move-constants.js';
import { getGroundWetness01 } from './main/weather-state.js';

import { drawEncounterCinematicOverlay } from './encounter/encounter-cinematic.js';

import {
  drawBatchedProjectile,
  drawPrismaticStreamGradientBeam,
  drawSteelStreamGradientBeam,
  drawWaterCannonStreamBeam
} from './render/render-projectiles.js';
import { drawBatchedParticle } from './render/render-particles.js';
import {
  drawPlayEntityFootAndAirCollider,
  drawPlayEntityCombatHurtbox
} from './render/render-debug-overlays.js';
import {
  drawDetailHitHpBar,
  drawDetailHitPulse,
  drawStrengthGrabTargetOutline,
  drawStrengthGrabTargetOutlineHalf,
  drawStrengthGrabProgressBar,
  drawWildEmotionOverlay,
  drawWildHpBar,
  drawPlayerHpBar,
  drawPlayerExpBar,
  drawEntityStaminaBar,
  drawInventoryGroundDropPreview,
  drawPlayerLevelUpTerrainGlow,
  drawPlayerLevelUpSpriteGlow
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
  drawStrengthThrowIdleTarget,
  drawTreeTopFall,
  drawPsybeamChargeBall,
  drawCrystalShard,
  drawSpawnedSmallCrystal,
  drawStrengthThrowRock,
  drawStrengthThrowFaintedWild,
  drawWildLeaderRoamTarget
} from './render/render-world-entities.js';
import { isWildLeaderRoamTargetVisible } from './main/wild-groups-visual-toggle-state.js';
import {
  drawWorldColliderOverlay,
  drawWorldReactionsOverlay,
  drawEnvironmentalEffects,
  drawVolumetricEnvironmentalLayer,
  drawDigChargeBar,
  drawFieldCombatChargeBar,
  drawPlayerFieldChargeShineOverlay,
  CLOUD_WHITE_LAYER_FULL_ALTITUDE_TILES
} from './render/render-debug-world.js';
import { drawFarCryScreenWaves } from './render/render-far-cry.js';
import { PluginRegistry } from './core/plugin-registry.js';
import { getPlayVisionFogState, drawPlayVisionFogOverlay } from './main/play-vision-fog.js';

import './render/render-debug-hotkeys.js';

import { TessellationEngine } from './tessellation-engine.js';
import { POKEMON_HEIGHTS } from './pokemon/pokemon-config.js';
import { MACRO_TILE_STRIDE, getMicroTile } from './chunking.js';
import { BIOME_TO_TERRAIN, TREE_TILES } from './biome-tiles.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { scatterItemKeyIsTree } from './scatter-pass2-debug.js';
import { getRoleForCell } from './tessellation-logic.js';
import { drawTerrainCellFromSheet, getConcConvATerrainTileSpec } from './render/conc-conv-a-terrain-blit.js';
import { NORTH_CLIFF_EDGE_ROLES } from './walkability.js';
import {
  speciesHasFlyingType,
  speciesHasSmoothLevitationFlight
} from './pokemon/pokemon-type-helpers.js';
import {
  activeProjectiles,
  activeParticles,
  getPlayerPrismaticMergedBeamVisual,
  getPlayerSteelBeamMergedBeamVisual,
  getPlayerWaterCannonMergedBeamVisual
} from './moves/moves-manager.js';
import {
  activeCrystalShards,
  activeSpawnedSmallCrystals,
  activeCrystalDrops,
  getActiveDetailHitHpBars,
  getActiveDetailHitPulses
} from './main/play-crystal-tackle.js';
import { playInputState, isPlayGroundDigShiftHeld, isPlaySpaceAscendHeld } from './main/play-input-state.js';
import { applyPlayPointerWithPlayCam } from './main/play-pointer-world.js';
import { getEarthquakeShakePx, getEarthquakeActiveIntensity01 } from './main/earthquake-layer.js';
import { PLAYER_FLIGHT_MAX_Z_TILES, PLAYER_LEVEL_UP_GLOW_SEC } from './player.js';
import { aimAtCursor, getPlayerFlashHoldVisual } from './main/play-mouse-combat.js';
import { getStrengthGrabPromptInfo } from './main/play-strength-carry.js';
import { getHoveredWildGroupEntityKey } from './main/wild-groups-hover-state.js';
import { PMD_MON_SHEET } from './pokemon/pmd-default-timing.js';
import { imageCache } from './image-cache.js';
import {
  resolvePmdFrameSpecForSlice,
  resolveCanonicalPmdH
} from './pokemon/pmd-layout-metrics.js';
import { getResolvedSheets } from './pokemon/pokemon-asset-loader.js';
import {
  beginRenderFrameProfile,
  addRenderFramePhaseMs,
  finalizeRenderFrameProfile,
  clearRenderFrameBreakdown
} from './render/render-frame-phases.js';
import {
  mapFingerprintForTrail,
  resetWorldMapPlayerWaveTick,
  resetWorldMapPlayerWavesIfMapChanged,
  tickWorldMapPlayerWaves,
  drawWorldMapPlayerWaves,
  loadPersistedGlobalMapTrail,
  persistGlobalMapTrailIfNeeded,
  recordGlobalMapTrailPoint,
  drawGlobalMapPlayerTrail,
  pruneRecentGlobalMapTrail,
  getGlobalMapTrailFingerprint,
  getGlobalMapPlayerTrailMicro,
  getGlobalMapPlayerTrailRecentMicro
} from './render/render-global-map-trail.js';
import { renderItemVisibleInPlayerVision, renderItemSortX } from './render/render-item-visibility.js';
import {
  BUILDING_GROUND_SHADOW_TUNING,
  POKEMON_ELLIPSE_SHADOW_TUNING,
  ensurePlayerCanopySilScratch,
  resetMotionStutterHistory,
  applyMotionStutterMask,
  ensurePlayerCanopyMaskScratch,
  appendFormalTreeCanopyToPlayerMask,
  appendScatterTreeCanopyToPlayerMask,
  drawGroundSilhouetteShadow,
  resolveDynamicShadowDynamics,
  shadowPolicyByType,
  getBuildingGroundShadowMeta,
  drawPlayerFlashHoldAura,
  drawVegetationHybridShadow,
  drawScatterGroundDetailSilhouetteShadow
} from './render/render-play-shadow-canopy.js';
import { getActiveFarCryScreenWaves } from './main/far-cry-system.js';

export {
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_TOP_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render/render-constants.js';

export { loadTilesetImages } from './render/load-tileset-images.js';
export { getPlayChunkFrameStats };


let didWarnTerrainSetRoles = false;

// ---------------------------------------------------------------------------
// Performance: module-level pools — allocated once, cleared per frame.
// Avoids GC pressure from `new Map()` / string key allocation in the hot path.
// ---------------------------------------------------------------------------
/** Reused per-frame tile metadata Map (cleared at start of each render, never GC'd). */
const _tileCachePool = new Map();
/**
 * Fast integer tile key identical to the one used inside bakeChunk.
 * Safe for map sizes up to 32767×32767 micro-tiles.
 * @param {number} mx @param {number} my @returns {number}
 */
const _tileKeyInt = (mx, my) => (mx << 16) | (my & 0xffff);
const ENTITY_COLLECTION_SHADOW_PAD_TILES = 5;

/**
 * `getStrengthGrabPromptInfo` runs a 7×7 micro-tile Strength scan — too heavy to repeat every frame
 * when the player is standing still. Invalidate when tile / facing / carry state changes.
 */
let _strengthGrabPromptCache = { key: '', prompt: /** @type {any} */ (null) };

export function spawnJumpRingAt(x, y) {
  // logic handled in render/render-effects-state.js
}

export function render(canvas, data, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data) {
    clearRenderFrameBreakdown();
    return;
  }

  // --- Plugin Hooks: preRender ---
  PluginRegistry.executeHooks('preRender', ctx, data, options);

  let tFrame0 = 0;
  try {
    tFrame0 = performance.now();
    beginRenderFrameProfile(options.settings?.appMode || 'map');
    const tPrep0 = performance.now();

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
  const frameNowMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  pruneRecentGlobalMapTrail(frameNowMs);
  const mapFp = mapFingerprintForTrail(data);
  if (mapFp && getGlobalMapTrailFingerprint() !== mapFp) {
    loadPersistedGlobalMapTrail(mapFp);
  }
  resetWorldMapPlayerWavesIfMapChanged(frameNowMs, mapFp);
  recordGlobalMapTrailPoint(data, player, appMode);
  persistGlobalMapTrailIfNeeded(false);
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
  let camNoShakePx = null;

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
    // Clear static entity descriptors so the new map is scanned fresh.
    invalidateStaticEntityCache();
  }

  addRenderFramePhaseMs('rndPrepMs', performance.now() - tPrep0);

  if (appMode === 'map') {
    clearPlayCameraSnapshot();
    const tMap0 = performance.now();
    const worldMapCamera = options.settings?.worldMapCamera || null;
    const useSvgOverlay = !!options.settings?.worldMapUseSvgOverlay;
    drawCachedMapOverview(ctx, {
      data,
      cw,
      ch,
      viewType,
      overlayPaths: useSvgOverlay ? false : overlayPaths,
      overlayGraph: useSvgOverlay ? false : overlayGraph,
      overlayContours,
      camera: worldMapCamera,
      startX,
      startY,
      endX,
      endY
    });
    const mapPlayerMicro = resolveMapGlobalPlayerMicroForMarker(
      data,
      options.settings?.player,
      options.settings?.appMode ?? 'map',
      { sessionEnteredPlayOnCurrentMap: !!options.settings?.sessionEnteredPlayOnCurrentMap }
    );
    if (mapPlayerMicro && data.width > 0 && data.height > 0) {
      tickWorldMapPlayerWaves(frameNowMs, mapPlayerMicro, mapFp);
      const globalTrailMicro = getGlobalMapPlayerTrailMicro();
      if (getGlobalMapTrailFingerprint() === mapFp && globalTrailMicro.length > 1) {
        drawGlobalMapPlayerTrail(ctx, globalTrailMicro, data, cw, ch, worldMapCamera);
      }
      drawWorldMapPlayerWaves(ctx, cw, ch, data, worldMapCamera);
      const gx = mapPlayerMicro.x / MACRO_TILE_STRIDE;
      const gy = mapPlayerMicro.y / MACRO_TILE_STRIDE;
      const tileW = worldMapCamera?.scale ? worldMapCamera.scale : cw / data.width;
      const tileH = worldMapCamera?.scale ? worldMapCamera.scale : ch / data.height;
      const ox = worldMapCamera?.ox || 0;
      const oy = worldMapCamera?.oy || 0;
      const px = (gx - ox + 0.5) * tileW;
      const py = (gy - oy + 0.5) * tileH;
      const r = Math.max(4, Math.min(8, Math.min(tileW, tileH) * 0.42));
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = 'rgba(120, 220, 255, 0.95)';
      ctx.lineWidth = Math.max(1.5, r * 0.22);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    persistGlobalMapTrailIfNeeded(false);
    addRenderFramePhaseMs('rndMapMs', performance.now() - tMap0);
  } else {
    resetWorldMapPlayerWaveTick();
    const tCam0 = performance.now();
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
    tileW = playCam.effTileW;
    tileH = playCam.effTileH;
    const lodDetail = playCam.lodDetail;
    const time = options.settings?.time || 0;
    const earthquakeShakePx = getEarthquakeShakePx(
      time,
      getEarthquakeActiveIntensity01(),
      playCam.effTileW
    );
    setPlayCameraSnapshot({
      ...playCam,
      cw,
      ch,
      earthquakeOffXPx: earthquakeShakePx.x,
      earthquakeOffYPx: earthquakeShakePx.y
    });
    applyPlayPointerWithPlayCam(canvas, playCam, earthquakeShakePx);
    const smoothLev = player.flightLevelVisual ?? (player.z || 0);
    const flightHudActive = speciesHasFlyingType(playerDexForCam) && player.flightActive;
    const zCloudTiles = Math.max(0, Number(smoothLev) || 0);
    const cloudWhiteSkyContext =
      speciesHasFlyingType(playerDexForCam) &&
      (flightHudActive || (!player.jumping && zCloudTiles > 0.02));
    const cloudWhiteRampT = Math.min(1, zCloudTiles / CLOUD_WHITE_LAYER_FULL_ALTITUDE_TILES);
    const cloudWhiteRampU = Math.max(0, Math.min(1, cloudWhiteRampT));
    const cloudWhiteLayerAlphaMul = cloudWhiteSkyContext
      ? cloudWhiteRampU * cloudWhiteRampU * (3 - 2 * cloudWhiteRampU)
      : 0;
    const isPlayerWalkingAnim =
      (!!player.grounded &&
        (Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1 || !!player.digActive)) ||
      (flightHudActive &&
        smoothLev &&
        (Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1 ||
          isPlaySpaceAscendHeld() ||
          isPlayGroundDigShiftHeld() ||
          (player.z ?? 0) > 0.02));
    
    updateJumpRings(time);
    updateRunDustPuffs(time);

    startX = Math.max(0, playCam.startXTiles);
    startY = Math.max(0, playCam.startYTiles);
    endX = Math.min(width * MACRO_TILE_STRIDE, playCam.endXTiles);
    endY = Math.min(height * MACRO_TILE_STRIDE, playCam.endYTiles);
    addRenderFramePhaseMs('rndCamMs', performance.now() - tCam0);

    const tVision0 = performance.now();
    const visionFogEnabled = options.settings?.visionFogEnabled ?? false;
    var playVision = getPlayVisionFogState(data, player, { enabled: visionFogEnabled });
    addRenderFramePhaseMs('rndVisionMs', performance.now() - tVision0);

    // --- CHUNK BAKING & RENDERING ---
    const tChunkQ0 = performance.now();
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
          enqueuePlayChunkBake(cx, cy, false, true);
        }
      }
    }

    // --- PRE-BAKE NEARBY CHUNKS (PREDICTIVE CACHING) ---
    // If the visible area is mostly baked, use some of the budget to bake nearby chunks
    // that the player might move into soon. This reduces FPS drops during discovery.
    const prebakeRadius = 1; 
    for (let cy = cStartY - prebakeRadius; cy <= cEndY + prebakeRadius; cy++) {
      for (let cx = cStartX - prebakeRadius; cx <= cEndX + prebakeRadius; cx++) {
        if (cx < 0 || cy < 0 || cx > maxChunkXi || cy > maxChunkYi) continue;
        const key = `${cx},${cy}`;
        if (!visibleChunkKeys.has(key) && !hasPlayChunk(key)) {
          enqueuePlayChunkBake(cx, cy);
        }
      }
    }
    addRenderFramePhaseMs('rndChunkQMs', performance.now() - tChunkQ0);

    const chunkBakeBudget = getAdaptivePlayChunkBakeBudget({
      lodDetail, cachedVisibleChunks, missingVisibleChunks,
      queueSize: getPlayChunkBakeQueueSize(),
      totalVisibleChunks: visibleChunkCoords.length
    });

    const tChunkBake0 = performance.now();
    const bakeRequests = dequeuePlayChunkBakes(chunkBakeBudget);
    for (const req of bakeRequests) {
      if (hasPlayChunk(req.key) && !req.forceRebake) continue;
      setPlayChunk(req.key, bakeChunk(req.cx, req.cy, data, PLAY_BAKE_TILE_PX, PLAY_BAKE_TILE_PX));
    }
    addRenderFramePhaseMs('rndChunkBakeMs', performance.now() - tChunkBake0);

    const tChunkDraw0 = performance.now();
    const currentTransX = playCam.currentTransX + earthquakeShakePx.x;
    const currentTransY = playCam.currentTransY + earthquakeShakePx.y;
    camNoShakePx = { x: playCam.currentTransX, y: playCam.currentTransY };
    const chunkDrawScale = playCam.viewScale;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = chunkDrawScale < 0.999;

    let drawnVisibleChunks = 0;
    for (const { cx, cy, key } of visibleChunkCoords) {
      const chunk = getPlayChunk(key);
      if (!chunk) continue;
      drawnVisibleChunks++;
      // Use GPU-resident ImageBitmap when available (zero-copy); fall back to canvas.
      const src = chunk.bitmap || chunk.canvas;
      ctx.drawImage(
        src, 0, 0, chunk.w, chunk.h,
        currentTransX + cx * PLAY_CHUNK_SIZE * tileW,
        currentTransY + cy * PLAY_CHUNK_SIZE * tileH,
        Math.max(1, PLAY_CHUNK_SIZE * tileW),
        Math.max(1, PLAY_CHUNK_SIZE * tileH)
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
    addRenderFramePhaseMs('rndChunkDrawMs', performance.now() - tChunkDraw0);

    // --- TILE CACHE & WARMING ---
    const tTileWarm0 = performance.now();
    // Reuse the module-level Map to avoid per-frame GC pressure.
    _tileCachePool.clear();
    const tileCache = _tileCachePool;
    const getCached = (mx, my) => {
      const key = _tileKeyInt(mx, my);
      let t = tileCache.get(key);
      if (!t) {
        t = getMicroTile(mx, my, data);
        tileCache.set(key, t);
      }
      return t;
    };
    {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) getCached(mx, my);
      }
    }
    addRenderFramePhaseMs('rndTileWarmMs', performance.now() - tTileWarm0);

    // --- MODULAR RENDERING ---
    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    const vegAnimTime = time;
    const canopyAnimTime = vegAnimTime;

    // Pre-compute the set of grass-eligible tiles ONCE per frame.
    // Eliminates per-tile getRoleForCell calls inside forEachAbovePlayerTile
    // and in the playerTopOverlay path (O(viewport) → O(1) lookup).
    // Only needed at LOD 0/1 — at LOD 2 animated grass is fully skipped.
    const grassEligibleSet = new Set();
    /** Pre-computed grass layers keyed by _tileKeyInt, avoids redundant getRoleForCell in drawGrass5aForCell. */
    const grassLayersMap = new Map();
    if (lodDetail < 2) {
      const _mH = height * MACRO_TILE_STRIDE;
      const _mW = width * MACRO_TILE_STRIDE;
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1) continue;
          const gateSet = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
          if (gateSet) {
            const _h = tile.heightStep;
            const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -1) >= _h;
            if (getRoleForCell(my, mx, _mH, _mW, checkAtOrAbove, gateSet.type) !== 'CENTER') continue;
          }
          const key = _tileKeyInt(mx, my);
          grassEligibleSet.add(key);
          const layers = getPlayAnimatedGrassLayers(mx, my, data, getCached, playChunkMap, { gateVerified: true });
          if (layers.base || layers.top) grassLayersMap.set(key, layers);
        }
      }
    }

    // PASS 0: Ocean
    const tOcean0 = performance.now();
    drawOceanPass(ctx, { 
      waterImg: imageCache.get('tilesets/water-tile.png'), 
      lodDetail, time, startX, startY, endX, endY, getCached, tileW, tileH 
    });
    addRenderFramePhaseMs('rndOceanMs', performance.now() - tOcean0);

    // forEachAbovePlayerTile iterates the pre-computed grassEligibleSet instead of
    // calling getRoleForCell per tile per frame. At LOD >= 2, the animated-grass
    // pass returns immediately anyway, so skip building the closure entirely.
    const forEachAbovePlayerTile = (fn) => {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          if (lodDetail < 2) {
            if (!grassEligibleSet.has(_tileKeyInt(mx, my))) continue;
          }
          const tile = getCached(mx, my);
          if (lodDetail >= 2) {
            if (!tile || tile.heightStep < 1) continue;
          }
          fn(mx, my, tile, Math.ceil(tileW), Math.ceil(tileH), Math.floor(mx * tileW), Math.floor(my * tileH));
        }
      }
    };

    const overlayMx = Math.floor(vx);
    const overlayMy = Math.floor(vy);
    const skipPlayerGrassOverlayDuringFlight = flightHudActive;

    // PASS 5a: Animated Grass — simple uniform pass, no deferred overlays.
    const tGrass0 = performance.now();
    forEachAbovePlayerTile((mx, my, tile, tw, th, tx, ty) => {
      if (playVision?.enabled && !playVision.isVisible(mx, my)) return;
      drawGrass5aForCell(ctx, mx, my, tile, tw, th, tx, ty, { lodDetail, tileW, tileH, vegAnimTime, natureImg, data, getCached, playChunkMap, snapPx, precomputedLayers: grassLayersMap.get(_tileKeyInt(mx, my)) });
    });
    addRenderFramePhaseMs('rndGrassMs', performance.now() - tGrass0);

    // PASS 3.5: Entity Collection & Drawing
    const tCollect0 = performance.now();
    const worldMicroW = width * MACRO_TILE_STRIDE;
    const worldMicroH = height * MACRO_TILE_STRIDE;
    const collectStartX = Math.max(0, Math.floor(startX - ENTITY_COLLECTION_SHADOW_PAD_TILES));
    const collectStartY = Math.max(0, Math.floor(startY - ENTITY_COLLECTION_SHADOW_PAD_TILES));
    const collectEndX = Math.min(worldMicroW, Math.ceil(endX + ENTITY_COLLECTION_SHADOW_PAD_TILES));
    const collectEndY = Math.min(worldMicroH, Math.ceil(endY + ENTITY_COLLECTION_SHADOW_PAD_TILES));
    const renderItems = collectRenderItems({ 
      data, player, startX: collectStartX, startY: collectStartY, endX: collectEndX, endY: collectEndY, lodDetail, width, height, getCached, time, 
      activeProjectiles, activeParticles, activeCrystalShards, activeSpawnedSmallCrystals, activeCrystalDrops, playInputState,
      imageCache, tileW, tileH, isPlayerWalkingAnim, latchGround, snapPx, playVision
    });
    const visibleRenderItems =
      playVision?.enabled
        ? renderItems.filter((it) => renderItemVisibleInPlayerVision(it, playVision))
        : renderItems;
    
    // Sort and track effects
    visibleRenderItems.sort((a, b) => {
      const ay = Number(a.sortY ?? a.y ?? 0);
      const by = Number(b.sortY ?? b.y ?? 0);
      const dy = ay - by;
      if (Math.abs(dy) > 1e-6) return dy;
      // Stable diagonal ordering for same-row entities (notably formal trees).
      const ax = renderItemSortX(a);
      const bx = renderItemSortX(b);
      return ax - bx;
    });
    trackJumpStartRings(visibleRenderItems);
    trackRunningDust(visibleRenderItems, time);
    addRenderFramePhaseMs('rndCollectMs', performance.now() - tCollect0);

    const tEnt0 = performance.now();
    /** Footprint ∪ tree/scatter canopy — used by canopy shadow detection. */
    const blockedGrassStripOverlayTiles = new Set();
    const markCanopyTile = (mx, my) => {
      if (Number.isFinite(mx) && Number.isFinite(my)) blockedGrassStripOverlayTiles.add(_tileKeyInt(Math.floor(mx), Math.floor(my)));
    };
    for (const it of visibleRenderItems) {
      if (it.type === 'tree') {
        markCanopyTile(it.originX, it.originY);
        markCanopyTile(it.originX + 1, it.originY);
        if (!it.isDestroyed) {
          const tops = TREE_TILES[it.treeType]?.top;
          const canopyRows = tops?.length ? Math.ceil(tops.length / 2) : 2;
          for (let dy = 0; dy < canopyRows; dy++)
            for (let dx = -1; dx <= 2; dx++) markCanopyTile(it.originX + dx, it.originY - canopyRows + dy);
        }
      } else if (it.type === 'scatter') {
        const cols = Math.max(1, it.cols || 1);
        const rows = Math.max(1, it.rows || 1);
        for (let dy = 0; dy < rows; dy++)
          for (let dx = 0; dx < cols; dx++) markCanopyTile(it.originX + dx, it.originY + dy);
        if (scatterItemKeyIsTree(it.itemKey) && !it.isCharred) {
          const objSet = OBJECT_SETS[it.itemKey];
          const topPart = objSet?.parts?.find((p) => p.role === 'top' || p.role === 'tops');
          if (topPart?.ids?.length) {
            const topRows = Math.max(1, Math.ceil(topPart.ids.length / cols));
            for (let dy = 0; dy < topRows; dy++)
              for (let dx = -1; dx < cols + 1; dx++) markCanopyTile(it.originX + dx, it.originY - topRows + dy);
          }
        }
      } else if (it.type === 'building') {
        const bCols = it.bData?.cols ?? (it.bData?.type === 'pokecenter' ? 5 : 4);
        const bRows = it.bData?.rows ?? (it.bData?.type === 'pokecenter' ? 6 : 5);
        for (let dy = 0; dy < bRows; dy++)
          for (let dx = 0; dx < bCols; dx++) markCanopyTile(it.originX + dx, it.originY + dy);
      }
    }
    const isGrassStripOverlayBlocked = (mx, my) => blockedGrassStripOverlayTiles.has(_tileKeyInt(Math.floor(mx), Math.floor(my)));

    let strengthGrabPrompt = null;
    if (player._strengthCarry || player._strengthGrabAction) {
      _strengthGrabPromptCache.key = '';
      _strengthGrabPromptCache.prompt = null;
    } else {
      const vx = player.visualX ?? player.x;
      const vy = player.visualY ?? player.y;
      const grabK = `${String(data?.seed ?? '')}_${Math.floor(Number(vx) || 0)}_${Math.floor(Number(vy) || 0)}_${Number(player.tackleDirNx) || 0}_${Number(player.tackleDirNy) || 0}`;
      if (grabK === _strengthGrabPromptCache.key) {
        strengthGrabPrompt = _strengthGrabPromptCache.prompt;
      } else {
        strengthGrabPrompt = getStrengthGrabPromptInfo(player, data);
        _strengthGrabPromptCache.key = grabK;
        _strengthGrabPromptCache.prompt = strengthGrabPrompt;
      }
    }
    let drewSplitStrengthGrabOutline = false;
    const isStrengthGrabTargetItem = (item) => {
      const p = strengthGrabPrompt;
      if (!p) return false;
      if (p.kind === 'rock' && item.type === 'scatter') {
        return Math.floor(Number(item.originX) || 0) === Math.floor(Number(p.ox) || 0) &&
          Math.floor(Number(item.originY) || 0) === Math.floor(Number(p.oy) || 0);
      }
      if (p.kind === 'faintedWild' && item.type === 'wild') {
        if (item.deadState !== 'faint') return false;
        const ix = Math.floor(Number(item.x) || 0);
        const iy = Math.floor(Number(item.y) || 0);
        const dex = Math.max(1, Math.floor(Number(item.dexId) || 1));
        const pDex = Math.max(1, Math.floor(Number(p.wildDexId) || 1));
        return ix === Math.floor(Number(p.ox) || 0) && iy === Math.floor(Number(p.oy) || 0) && dex === pDex;
      }
      return false;
    };

    const batchedEffects = [];
    let vegScatterMsAcc = 0;
    let vegTreeMsAcc = 0;

    // Pre-compute canopy shadow for the player (dark silhouette where player ∩ canopy).
    // Stored here so we can draw it BEFORE the player sprite in the entity loop,
    // giving a two-layer result: shadow behind, pokemon on top.
    let _playerCanopyShadow = null;
    if (lodDetail < 2 && !skipPlayerGrassOverlayDuringFlight) {
      const pItem = visibleRenderItems.find((it) => it.type === 'player');
      // Skip the under-canopy shadow silhouette when player is standing ON TOP of trees.
      const pItemOnCanopy = pItem && (pItem.groundZ || 0) > 0.1;
      if (pItem?.sheet && !pItem.strengthCarry && !pItem._strengthGrabAction && !pItemOnCanopy) {
        let underCanopy = false;
        const probes = [[0, 0], [0, -1], [0, -2], [-1, -1], [1, -1], [-1, 0], [1, 0]];
        for (const [dx, dy] of probes) {
          if (isGrassStripOverlayBlocked(overlayMx + dx, overlayMy + dy)) { underCanopy = true; break; }
        }
        if (underCanopy) {
          const alpha = Math.max(0, Math.min(1, pItem.drawAlpha ?? 1));
          const bury = pItem.digBuryVisual ?? 0;
          const tackleOx = pItem.tackleOffPx || 0;
          const tackleOy = pItem.tackleOffPy || 0;
          const pxL = snapPx(pItem.cx - pItem.pivotX + tackleOx);
          const pxT0 = snapPx(pItem.cy - pItem.pivotY + tackleOy);
          const pxW = snapPx(pItem.dw);
          const pxH = snapPx(pItem.dh);
          const bufW = Math.max(1, Math.ceil(pxW));
          const bufH = Math.max(1, Math.ceil(pxH));
          const mask = ensurePlayerCanopyMaskScratch(bufW, bufH);
          const comp = ensurePlayerCanopySilScratch(bufW, bufH);
          const mctx = mask.getContext('2d');
          const cctx = comp.getContext('2d');
          if (mctx && cctx) {
            mctx.setTransform(1, 0, 0, 1, 0, 0);
            mctx.clearRect(0, 0, bufW, bufH);
            mctx.imageSmoothingEnabled = false;
            let drewMask = false;
            for (const it of visibleRenderItems) {
              if (it.type === 'tree') {
                if (appendFormalTreeCanopyToPlayerMask(mctx, it, pxL, pxT0, pxW, pxH, tileW, tileH, snapPx, natureImg, canopyAnimTime, time)) drewMask = true;
              } else if (it.type === 'scatter') {
                if (appendScatterTreeCanopyToPlayerMask(mctx, it, pxL, pxT0, pxW, pxH, tileW, tileH, snapPx, imageCache, canopyAnimTime, time, data)) drewMask = true;
              }
            }
            if (drewMask) {
              cctx.setTransform(1, 0, 0, 1, 0, 0);
              cctx.clearRect(0, 0, bufW, bufH);
              cctx.imageSmoothingEnabled = false;
              cctx.globalAlpha = 1;
              cctx.globalCompositeOperation = 'source-over';
              cctx.save();
              if (bury > 0.004) {
                const visH = Math.min(pxH - 1, Math.max(6, Math.floor(pxH * (1 - bury * 0.39))));
                const bandTop = Math.max(0, pxH - visH);
                cctx.beginPath(); cctx.rect(0, bandTop, bufW, visH); cctx.clip();
              }
              cctx.drawImage(pItem.sheet, pItem.sx, pItem.sy, pItem.sw, pItem.sh, 0, 0, pxW, pxH);
              cctx.restore();
              cctx.globalCompositeOperation = 'destination-in';
              cctx.drawImage(mask, 0, 0);
              cctx.globalCompositeOperation = 'source-in';
              cctx.fillStyle = 'rgb(26, 28, 36)';
              cctx.fillRect(-2, -2, bufW + 4, bufH + 4);
              cctx.globalCompositeOperation = 'source-over';
              _playerCanopyShadow = { canvas: comp, bufW, bufH, pxL, pxT0, pxW, pxH, alpha };
            }
          }
        }
      }
    }

    const showLeaderRoamTargetOverlay = isWildLeaderRoamTargetVisible();
    const hoveredWildGroupEntityKey = getHoveredWildGroupEntityKey();
    const getHoveredWildGroupPrompt = (item) => {
      if (!hoveredWildGroupEntityKey || item.type !== 'wild') return null;
      if (String(item.key || '') !== hoveredWildGroupEntityKey) return null;
      return {
        kind: 'faintedWild',
        cx: Number(item.x) + 0.5,
        cy: Number(item.y) + 0.5,
        cols: 1,
        rows: 1
      };
    };

    // Precompute NORTH-facing cliff edge tiles for per-entity depth overlay.
    // These tiles (EDGE_N, OUT_NW, OUT_NE) must appear IN FRONT of entities at a lower heightStep
    // but BEHIND entities at the same/higher heightStep.
    const _cliffEdgeMap = new Map();
    {
      const _microW = data.width * MACRO_TILE_STRIDE;
      const _microH = data.height * MACRO_TILE_STRIDE;
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1) continue;
          const biomeSetName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
          const biomeSet = TERRAIN_SETS[biomeSetName];
          if (!biomeSet) continue;
          const isAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= tile.heightStep;
          const role = getRoleForCell(my, mx, _microH, _microW, isAtOrAbove, biomeSet.type);
          if (!NORTH_CLIFF_EDGE_ROLES.has(role)) continue;
          const cols = TessellationEngine.getTerrainSheetCols(biomeSet);
          const imgPath = TessellationEngine.getImagePath(biomeSet.file);
          const img = imageCache.get(imgPath);
          if (!img) continue;
          const spec = getConcConvATerrainTileSpec(biomeSet, role);
          if (spec.tileId == null) continue;
          _cliffEdgeMap.set(_tileKeyInt(mx, my), { mx, my, heightStep: tile.heightStep, img, cols, spec });
        }
      }
    }

    // When the player stands on a tree canopy, split tree/scatter drawing:
    // trunks are drawn in sorted order, canopies of trees BEHIND the player are deferred
    // and flushed right before the player draws, so the player renders on top of them.
    const _pItemForCanopy = visibleRenderItems.find((it) => it.type === 'player');
    const _playerOnCanopy = _pItemForCanopy && (_pItemForCanopy.groundZ || 0) > 0.1;
    const _playerSortY = _playerOnCanopy ? Number(_pItemForCanopy.sortY ?? _pItemForCanopy.y ?? 0) : 0;
    const _deferredCanopies = _playerOnCanopy ? [] : null;
    let _deferredCanopiesFlushed = false;
    const frameShadowBudget = {
      buildingSilhouetteBuilds: 0,
      vegetationSilhouetteDraws: 0
    };
    const shadowDynamics = resolveDynamicShadowDynamics(options.settings);
    const playerFlashHoldVisual = getPlayerFlashHoldVisual();

    for (const item of visibleRenderItems) {
      // Flush deferred canopies right before the player is drawn.
      if (_deferredCanopies && !_deferredCanopiesFlushed && item.type === 'player') {
        _deferredCanopiesFlushed = true;
        for (const dc of _deferredCanopies) {
          ctx.save();
          ctx.globalAlpha = dc.alpha;
          if (dc.type === 'tree') {
            drawTree(ctx, dc.item, { tileW, tileH, snapPx, time, lodDetail, canopyAnimTime, natureImg, imageCache, data, phase: 'canopy' });
          } else if (dc.type === 'scatter') {
            drawScatter(ctx, dc.item, { tileW, tileH, snapPx, time, lodDetail, canopyAnimTime, imageCache, getCached, data, phase: 'canopy' });
          }
          ctx.restore();
        }
        _deferredCanopies.length = 0;
      }

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

        if (item.type === 'wild' && isStrengthGrabTargetItem(item)) {
          drewSplitStrengthGrabOutline = true;
          drawStrengthGrabTargetOutlineHalf(ctx, strengthGrabPrompt, 'north', tileW, tileH, snapPx, time);
        }
        const hoveredWildGroupPrompt = getHoveredWildGroupPrompt(item);
        if (hoveredWildGroupPrompt) {
          drawStrengthGrabTargetOutlineHalf(ctx, hoveredWildGroupPrompt, 'north', tileW, tileH, snapPx, time);
        }

        const bury = item.type === 'player' ? (item.digBuryVisual ?? 0) : 0;
        const tackleOx = item.type === 'player' ? (item.tackleOffPx || 0) : 0;
        const tackleOy = item.type === 'player' ? (item.tackleOffPy || 0) : 0;
        const pxL = snapPx(item.cx - item.pivotX + tackleOx);
        const pxT0 = snapPx(item.cy - item.pivotY + spawnYOffset + tackleOy);
        const pxW = snapPx(item.dw);
        const pxH = snapPx(item.dh);

        // Shadow — normal circular blob for pokemon.
        const _shadowGroundZ = (item.type === 'player' ? (item.groundZ || 0) : 0);
        const _shadowBaseY = snapPx((item.y + 0.5) * tileH - _shadowGroundZ * tileH) + spawnYOffset;
        const blobAlpha = Math.max(
          POKEMON_ELLIPSE_SHADOW_TUNING.alphaMin,
          Math.min(
            POKEMON_ELLIPSE_SHADOW_TUNING.alphaMax,
            POKEMON_ELLIPSE_SHADOW_TUNING.alphaBase * (shadowDynamics?.alphaMul ?? 1)
          )
        );
        ctx.fillStyle = `rgba(0,0,0,${blobAlpha})`;
        ctx.beginPath();
        const shadowW =
          tileW *
          POKEMON_ELLIPSE_SHADOW_TUNING.widthMul *
          (item.targetHeightTiles / POKEMON_ELLIPSE_SHADOW_TUNING.widthHeightDiv + POKEMON_ELLIPSE_SHADOW_TUNING.widthHeightBias);
        ctx.ellipse(item.cx, _shadowBaseY, shadowW, tileH * POKEMON_ELLIPSE_SHADOW_TUNING.radiusYTiles, 0, 0, Math.PI * 2);
        ctx.fill();

        if (item.type === 'player' && (item.levelUpGlowSec ?? 0) > 0.001) {
          drawPlayerLevelUpTerrainGlow(ctx, {
            cx: item.cx,
            feetYPx: _shadowBaseY,
            levelUpGlowSec: item.levelUpGlowSec,
            glowDurationSec: PLAYER_LEVEL_UP_GLOW_SEC,
            tileW,
            alphaMul: alpha
          });
        }

        // Draw canopy shadow BEFORE the player sprite so it sits behind.
        // Two images: (1) the shadow, (2) the pokemon — shadow is behind.
        if (item.type === 'player' && _playerCanopyShadow) {
          const s = _playerCanopyShadow;
          ctx.save();
          ctx.globalAlpha = s.alpha * 0.56;
          ctx.drawImage(s.canvas, 0, 0, s.bufW, s.bufH, s.pxL, s.pxT0, s.pxW, s.pxH);
          ctx.restore();
        }
        
        if (item.type === 'wild' && item.hitFlashTimer > 0) ctx.filter = 'brightness(5) contrast(2) sepia(1) hue-rotate(-50deg)';
        let shineClipTop = pxT0;
        let shineClipH = pxH;
        /** @type {{ x: number, y: number, w: number, h: number } | null} */
        let levelUpSpriteClip = null;
        if (bury > 0.004) {
          const visH = Math.min(pxH - 1, Math.max(6, Math.floor(pxH * (1 - bury * 0.39))));
          const pxT = snapPx(pxT0 + (pxH - visH));
          shineClipTop = pxT;
          shineClipH = visH;
          levelUpSpriteClip = { x: pxL, y: pxT, w: pxW, h: visH };
          ctx.save();
          ctx.beginPath(); ctx.rect(pxL, pxT, pxW, visH); ctx.clip();
          ctx.drawImage(item.sheet, item.sx, item.sy, item.sw, item.sh, pxL, pxT0, pxW, pxH);
          ctx.restore();
        } else {
          ctx.drawImage(item.sheet, item.sx, item.sy, item.sw, item.sh, pxL, pxT0, pxW, pxH);
        }

        if (item.type === 'player' && (item.levelUpGlowSec ?? 0) > 0.001) {
          drawPlayerLevelUpSpriteGlow(ctx, item.sheet, {
            sx: item.sx,
            sy: item.sy,
            sw: item.sw,
            sh: item.sh,
            dx: pxL,
            dy: pxT0,
            dw: pxW,
            dh: pxH,
            levelUpGlowSec: item.levelUpGlowSec,
            glowDurationSec: PLAYER_LEVEL_UP_GLOW_SEC,
            alphaMul: alpha,
            clip: levelUpSpriteClip
          });
        }
        if (item.type === 'player' && playerFlashHoldVisual) {
          drawPlayerFlashHoldAura(ctx, item, playerFlashHoldVisual, tileW, pxT0, pxH);
        }

        if (item.type === 'player') {
          drawPlayerFieldChargeShineOverlay(ctx, {
            pxL,
            pxT: shineClipTop,
            pxW,
            pxH: shineClipH,
            shineStartMs: item._fieldChargeShineStartMs,
            shineDurMs: item._fieldChargeShineDurMs,
            alphaMul: alpha
          });
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
        if (
          showLeaderRoamTargetOverlay &&
          item.type === 'wild' &&
          item.groupId &&
          String(item.groupLeaderKey || '') === String(item.key || '') &&
          String(item.groupPhase || '') === 'ROAM'
        ) {
          drawWildLeaderRoamTarget(ctx, item, { snapPx, tileW, tileH, time });
        }
        if (item.type === 'wild') drawWildHpBar(ctx, item, spawnYOffset, tileW, tileH);
        if (item.type === 'player') drawPlayerHpBar(ctx, item, spawnYOffset, tileW, tileH);
        if (item.type === 'player') drawPlayerExpBar(ctx, item, spawnYOffset, tileW, tileH);
        drawEntityStaminaBar(ctx, item, spawnYOffset, tileW, tileH);



        if (item.type === 'wild' && isStrengthGrabTargetItem(item)) {
          drawStrengthGrabTargetOutlineHalf(ctx, strengthGrabPrompt, 'south', tileW, tileH, snapPx, time);
        }
        if (hoveredWildGroupPrompt) {
          drawStrengthGrabTargetOutlineHalf(ctx, hoveredWildGroupPrompt, 'south', tileW, tileH, snapPx, time);
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

        // Per-entity cliff edge overlay: redraw north-facing cliff tiles that are at a
        // HIGHER heightStep on top of this entity so it appears behind the cliff face.
        if (_cliffEdgeMap.size > 0) {
          const _entMx = Math.floor(item.x ?? 0);
          const _entMy = Math.floor(item.y ?? 0);
          const _entTile = getCached(_entMx, _entMy);
          const _entH = _entTile?.heightStep ?? 0;
          const _eLeft = item.cx - item.pivotX;
          const _eTop = item.cy - item.pivotY;
          const _tmxS = Math.max(startX, Math.floor(_eLeft / tileW));
          const _tmyS = Math.max(startY, Math.floor(_eTop / tileH));
          const _tmxE = Math.min(endX - 1, Math.floor((_eLeft + item.dw) / tileW));
          const _tmyE = Math.min(endY - 1, Math.floor((_eTop + item.dh) / tileH));
          for (let _ty = _tmyS; _ty <= _tmyE; _ty++) {
            for (let _tx = _tmxS; _tx <= _tmxE; _tx++) {
              const _ce = _cliffEdgeMap.get(_tileKeyInt(_tx, _ty));
              if (!_ce || _ce.heightStep <= _entH) continue;
              // Only overlay if entity is at or north of the cliff tile's south edge.
              if ((item.y ?? 0) >= _ty + 1) continue;
              const _cpx = snapPx(_tx * tileW);
              const _cpy = snapPx(_ty * tileH);
              drawTerrainCellFromSheet(ctx, _ce.img, _ce.cols, 16, _ce.spec.tileId, _cpx, _cpy, tileW, tileH, _ce.spec.flipX);
            }
          }
        }
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
        drawScatterGroundDetailSilhouetteShadow(ctx, item, tileW, tileH, snapPx, imageCache, shadowDynamics, time);
        drawVegetationHybridShadow(ctx, item, { tileW, tileH, snapPx, lodDetail, canopyAnimTime, imageCache, natureImg, data, time, frameShadowBudget, shadowDynamics });
        if (isStrengthGrabTargetItem(item)) {
          drewSplitStrengthGrabOutline = true;
          drawStrengthGrabTargetOutlineHalf(ctx, strengthGrabPrompt, 'north', tileW, tileH, snapPx, time);
        }
        const tVegScatter0 = performance.now();
        const _scatterItemSortY = Number(item.sortY ?? item.y ?? 0);
        if (_deferredCanopies && _scatterItemSortY <= _playerSortY && scatterItemKeyIsTree(item.itemKey)) {
          // Player on canopy: draw trunk only now, defer canopy for later.
          drawScatter(ctx, item, { tileW, tileH, snapPx, time, lodDetail, canopyAnimTime, imageCache, getCached, data, phase: 'trunk' });
          _deferredCanopies.push({ type: 'scatter', item, alpha: ctx.globalAlpha });
        } else {
          drawScatter(ctx, item, { tileW, tileH, snapPx, time, lodDetail, canopyAnimTime, imageCache, getCached, data });
        }
        vegScatterMsAcc += performance.now() - tVegScatter0;
        if (isStrengthGrabTargetItem(item)) {
          drawStrengthGrabTargetOutlineHalf(ctx, strengthGrabPrompt, 'south', tileW, tileH, snapPx, time);
        }
        ctx.restore();
      } else if (item.type === 'tree') {
        ctx.save();
        ctx.globalAlpha *= item.regrowFade01 != null ? item.regrowFade01 : 1;
        drawVegetationHybridShadow(ctx, item, { tileW, tileH, snapPx, lodDetail, canopyAnimTime, imageCache, natureImg, data, time, frameShadowBudget, shadowDynamics });
        const tVegTree0 = performance.now();
        const _treeItemSortY = Number(item.sortY ?? item.y ?? 0);
        if (_deferredCanopies && _treeItemSortY <= _playerSortY) {
          // Player on canopy: draw trunk only now, defer canopy for later.
          drawTree(ctx, item, { tileW, tileH, snapPx, time, lodDetail, canopyAnimTime, natureImg, imageCache, data, phase: 'trunk' });
          _deferredCanopies.push({ type: 'tree', item, alpha: ctx.globalAlpha });
        } else {
          drawTree(ctx, item, { tileW, tileH, snapPx, time, lodDetail, canopyAnimTime, natureImg, imageCache, data });
        }
        vegTreeMsAcc += performance.now() - tVegTree0;
        ctx.restore();
      } else if (item.type === 'building') {
        ctx.save();
        if (shadowPolicyByType(item) === 'buildingSilhouette') {
          const bMeta = getBuildingGroundShadowMeta(item, imageCache, tileW, tileH, snapPx, frameShadowBudget);
          if (bMeta) {
            drawGroundSilhouetteShadow(ctx, bMeta, snapPx, tileW, tileH, BUILDING_GROUND_SHADOW_TUNING, shadowDynamics);
          }
        }
        drawBuilding(ctx, item, { tileW, tileH, snapPx, imageCache });
        ctx.restore();
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
      else if (item.type === 'strengthThrowIdleTarget') { ctx.save(); drawStrengthThrowIdleTarget(ctx, item, { snapPx, tileW, tileH }); ctx.restore(); }
      else if (item.type === 'psybeamChargeBall') { ctx.save(); drawPsybeamChargeBall(ctx, item, { snapPx, tileW, tileH }); ctx.restore(); }
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
          canopyAnimTime,
          data
        });
        ctx.restore();
      }
    }


    addRenderFramePhaseMs('rndVegScatterMs', vegScatterMsAcc);
    addRenderFramePhaseMs('rndVegTreeMs', vegTreeMsAcc);

    const mergedPrismaticBeam = getPlayerPrismaticMergedBeamVisual();
    const mergedSteelBeam = getPlayerSteelBeamMergedBeamVisual();
    const mergedWaterCannonBeam = getPlayerWaterCannonMergedBeamVisual();
    if (batchedEffects.length > 0 || mergedPrismaticBeam || mergedSteelBeam) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (mergedPrismaticBeam) {
        drawPrismaticStreamGradientBeam(ctx, mergedPrismaticBeam, tileW, tileH, snapPx, time);
      }
      if (mergedSteelBeam) {
        drawSteelStreamGradientBeam(ctx, mergedSteelBeam, tileW, tileH, snapPx, time);
      }
      for (const be of batchedEffects) {
        if (be.kind === 'projectile') drawBatchedProjectile(ctx, be.proj, tileW, tileH, snapPx, time);
        else drawBatchedParticle(ctx, be.part, tileW, tileH, snapPx);
      }
      ctx.restore();
    }
    if (mergedWaterCannonBeam) {
      ctx.save();
      drawWaterCannonStreamBeam(ctx, mergedWaterCannonBeam, tileW, tileH, snapPx, time);
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
    if (strengthGrabPrompt && !drewSplitStrengthGrabOutline) {
      drawStrengthGrabTargetOutline(ctx, strengthGrabPrompt, tileW, tileH, snapPx, time);
    }
    if (options.inventoryDropPreview) {
      drawInventoryGroundDropPreview(ctx, options.inventoryDropPreview, tileW, tileH, snapPx, time);
      const previewItemKey = String(options.inventoryDropPreview.itemKey || '');
      const previewObjSet = previewItemKey ? OBJECT_SETS[previewItemKey] : null;
      if (previewObjSet) {
        const cols = Math.max(1, Math.floor(Number(options.inventoryDropPreview.cols) || 1));
        const rows = Math.max(1, Math.floor(Number(options.inventoryDropPreview.rows) || 1));
        const ox = Math.floor(Number(options.inventoryDropPreview.ox) || 0);
        const oy = Math.floor(Number(options.inventoryDropPreview.oy) || 0);
        const originTile = getCached(ox, oy);
        const baseHeight = Number(originTile?.heightStep);
        const previewGetCached =
          Number.isFinite(baseHeight)
            ? (tx, ty) => {
                const t = getCached(tx, ty);
                if (!t) return t;
                if (tx >= ox && tx < ox + cols && ty >= oy && ty < oy + rows) {
                  return { ...t, heightStep: baseHeight };
                }
                return t;
              }
            : getCached;
        ctx.save();
        if (!options.inventoryDropPreview.canDrop) ctx.filter = 'grayscale(0.85) saturate(0.4)';
        ctx.globalAlpha *= options.inventoryDropPreview.canDrop ? 0.8 : 0.46;
        drawScatter(
          ctx,
          {
            type: 'scatter',
            objSet: previewObjSet,
            originX: ox,
            originY: oy,
            cols,
            rows,
            itemKey: previewItemKey,
            isSortable: true,
            isBurning: false,
            isCharred: false,
            windSway: false
          },
          {
            tileW,
            tileH,
            snapPx,
            time,
            lodDetail,
            canopyAnimTime,
            imageCache,
            getCached: previewGetCached
          }
        );
        ctx.restore();
      }
    }

    addRenderFramePhaseMs('rndEntitiesMs', performance.now() - tEnt0);

    // PASS 5a-deferred: removed (no grass overlays on entities).
    addRenderFramePhaseMs('rndGrassDeferMs', 0);

    const tDebug0 = performance.now();
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
    
    drawDigChargeBar(ctx, { latchGround, player, cw, ch });
    drawFieldCombatChargeBar(ctx, { appMode, playInputState, cw, ch, timeSec: time });
    addRenderFramePhaseMs('rndDebugMs', performance.now() - tDebug0);

    const tWeather0 = performance.now();
    const rainI = Number(options.settings?.weatherRainIntensity) || 0;
    const cloudPresenceForShadowShift = Number(options.settings?.weatherCloudPresence) || 0;
    const splashTargets = [];
    // Simple sprite rects for the "cloud-shadow-on-entity" billboard shift pass.
    // We only feed tall vertical billboards (player/wild) — trees/scatter are tied to ground and
    // already read fine with the flat shadow, and reconstructing their sprites here would be noisy.
    const entityShadowSprites = [];
    const collectEntitySprites = cloudPresenceForShadowShift > 0.001;
    if (rainI > 0.02 || collectEntitySprites) {
      for (const it of visibleRenderItems) {
        if (it.type !== 'player' && it.type !== 'wild') continue;
        const cx = it.cx;
        const cy = it.cy;
        const dh = it.dh;
        const dw = it.dw;
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(dh) || !Number.isFinite(dw)) continue;
        if (rainI > 0.02) splashTargets.push({ x: cx, yTop: cy - dh * 0.88, w: dw, h: dh });
        if (!collectEntitySprites) continue;
        if (!it.sheet) continue;
        let spawnYOffset = 0;
        if (it.type === 'wild' && it.spawnPhase < 1) {
          if (it.spawnType === 'sky') spawnYOffset = (1 - it.spawnPhase) * (-4 * tileH);
          else if (it.spawnType === 'water') spawnYOffset = (1 - it.spawnPhase) * (0.8 * tileH);
          else spawnYOffset = (1 - it.spawnPhase) * (0.2 * tileH);
        }
        const tackleOx = it.type === 'player' ? (it.tackleOffPx || 0) : 0;
        const tackleOy = it.type === 'player' ? (it.tackleOffPy || 0) : 0;
        const pxL = snapPx(cx - it.pivotX + tackleOx);
        const pxT = snapPx(cy - it.pivotY + spawnYOffset + tackleOy);
        const pxW = snapPx(dw);
        const pxH = snapPx(dh);
        const alphaIt = it.type === 'wild' ? it.spawnPhase : (it.drawAlpha ?? 1);
        entityShadowSprites.push({
          sheet: it.sheet,
          sx: it.sx,
          sy: it.sy,
          sw: it.sw,
          sh: it.sh,
          pxL,
          pxT,
          pxW,
          pxH,
          alpha: Math.max(0, Math.min(1, alphaIt))
        });
      }
    }
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
      cloudNoiseSeed: options.settings?.weatherCloudNoiseSeed,
      cloudThreshold: options.settings?.weatherCloudThreshold,
      cloudMinMul: options.settings?.weatherCloudMinMul,
      cloudMaxMul: options.settings?.weatherCloudMaxMul,
      cloudAlphaMul: options.settings?.weatherCloudAlphaMul,
      weatherPreset: options.settings?.weatherPreset,
      weatherBlizzardBlend01: options.settings?.weatherBlizzardBlend01 ?? 0,
      rainIntensity: rainI,
      windIntensity: options.settings?.weatherWindIntensity ?? 0,
      windDirRad: options.settings?.weatherWindDirRad ?? 0,
      screenTint: options.settings?.weatherScreenTint,
      splashTargets,
      entityShadowSprites,
      earthquakeVisual01: options.settings?.weatherEarthquakeIntensity ?? 0,
      sunLightRaysIntensity01: options.settings?.weatherSunLightRaysIntensity ?? 0,
      moonLightRaysIntensity01: options.settings?.weatherMoonLightRaysIntensity ?? 0,
      cloudWhiteLayerAlphaMul,
      worldHours: options.settings?.worldHours
    });
    addRenderFramePhaseMs('rndWeatherMs', performance.now() - tWeather0);

    drawVolumetricEnvironmentalLayer(ctx, {
      cw,
      ch,
      time,
      startX,
      startY,
      endX,
      endY,
      tileW,
      tileH,
      lodDetail,
      macroData: data,
      weatherPreset: options.settings?.weatherPreset,
      weatherBlizzardBlend01: options.settings?.weatherBlizzardBlend01 ?? 0,
      weatherSandstormBlend01: options.settings?.weatherSandstormBlend01 ?? 0,
      rainIntensity: rainI,
      windIntensity: options.settings?.weatherWindIntensity ?? 0,
      windDirRad: options.settings?.weatherWindDirRad ?? 0,
      volumetricParticleDensity: options.settings?.weatherVolumetricParticleDensity ?? 0,
      volumetricVolumeDepth: options.settings?.weatherVolumetricVolumeDepth ?? 0.5,
      volumetricFallSpeed: options.settings?.weatherVolumetricFallSpeed ?? 0.5,
      volumetricWindCarry: options.settings?.weatherVolumetricWindCarry ?? 0.5,
      volumetricTurbulence: options.settings?.weatherVolumetricTurbulence ?? 0.2,
      volumetricAbsorptionBias: options.settings?.weatherVolumetricAbsorptionBias ?? 0.5,
      volumetricSplashBias: options.settings?.weatherVolumetricSplashBias ?? 0.5,
      weatherVolumetricMode: options.settings?.weatherVolumetricMode ?? 'clear'
    });

    drawPlayVisionFogOverlay(ctx, playVision, startX, startY, endX, endY, tileW, tileH);

    // --- Wet Ground Sheen Pass ---
    const wetness = getGroundWetness01();
    if (wetness > 0.01) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // 1. Darken the ground
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(200, 210, 230, ${0.1 * wetness})`;
      ctx.fillRect(0, 0, cw, ch);
      // 2. Subtle specular sheen
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.05 * wetness;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    if (options.settings?.appMode === 'play') {
      drawFarCryScreenWaves(ctx, getActiveFarCryScreenWaves(), { w: cw, h: ch });
      applyMotionStutterMask(ctx, cw, ch, player, camNoShakePx);
      drawEncounterCinematicOverlay(ctx, cw, ch);
    }

    const tMm0 = performance.now();
    const minimapCanvas = document.getElementById('minimap');
    if (minimapCanvas) {
      renderMinimap(minimapCanvas, data, player, {
        recentTrailMicro: getGlobalMapPlayerTrailRecentMicro(),
        playVision,
        debugShowAllSpawned: !!options.settings?.minimapShowAllSpawnedDebug,
        showMacroTileGrid: !!options.settings?.minimapMacroGridOverlay
      });
    }
    addRenderFramePhaseMs('rndMinimapMs', performance.now() - tMm0);
  }
  if (appMode !== 'play') {
    resetMotionStutterHistory();
  }

  if (options.hover) {
    const th0 = performance.now();
    const { x, y } = options.hover;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    const mapCam = options.settings?.appMode === 'map' ? options.settings?.worldMapCamera : null;
    if (mapCam?.scale) {
      const sx = Math.floor((x - mapCam.ox) * mapCam.scale);
      const sy = Math.floor((y - mapCam.oy) * mapCam.scale);
      const sW = Math.max(1, Math.ceil(mapCam.scale));
      const sH = Math.max(1, Math.ceil(mapCam.scale));
      ctx.strokeRect(sx, sy, sW, sH);
    } else {
      ctx.strokeRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
    }
    addRenderFramePhaseMs('rndHoverMs', performance.now() - th0);
  }

  // --- Plugin Hooks: postRender ---
  PluginRegistry.executeHooks('postRender', ctx, data, options);

  ctx.restore();
} finally {
    finalizeRenderFrameProfile(performance.now() - tFrame0);
  }
}
