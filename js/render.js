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
  isSortableScatter
} from './biome-tiles.js';
import { getMicroTile, CHUNK_SIZE, foliageDensity, foliageType } from './chunking.js';
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
import { getWildPokemonEntities } from './wild-pokemon/wild-pokemon-manager.js';
import { activeProjectiles, activeParticles } from './moves/moves-manager.js';
import { ensurePokemonSheetsLoaded, getResolvedSheets } from './pokemon/pokemon-asset-loader.js';
import { PMD_MON_SHEET } from './pokemon/pmd-default-timing.js';
import {
  resolvePmdFrameSpecForSlice,
  resolveCanonicalPmdH,
  worldFeetFromPivotCell
} from './pokemon/pmd-layout-metrics.js';
import {
  speciesHasFlyingType,
  speciesHasGroundType,
  speciesHasSmoothLevitationFlight
} from './pokemon/pokemon-type-helpers.js';
import { isGhostPhaseShiftBurrowEligibleDex } from './wild-pokemon/ghost-phase-shift.js';
import { playInputState } from './main/play-input-state.js';
import { aimAtCursor } from './main/play-mouse-combat.js';
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
import { syncPlayChunkCache, playChunkMap } from './render/play-chunk-cache.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import { clearGrassFireStateForNewMap, grassFireVisualPhaseAt } from './play-grass-fire.js';
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
  } else if (p.type === 'psybeamShot') {
    const ang = Math.atan2(p.vy || 0, p.vx || 1);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,112,198,0.9)';
    ctx.fillRect(-Math.max(3, tileW * 0.16), -Math.max(2, tileH * 0.07), Math.max(7, tileW * 0.32), Math.max(4, tileH * 0.14));
    ctx.restore();
  } else if (p.type === 'prismaticShot') {
    const colors = ['#ff1744', '#ff9100', '#ffee58', '#40c4ff', '#7c4dff'];
    const idx = Math.floor(((time * 25) % colors.length + colors.length) % colors.length);
    ctx.fillStyle = colors[idx];
    ctx.beginPath();
    ctx.arc(px, py, Math.max(3, tileW * 0.12), 0, Math.PI * 2);
    ctx.fill();
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
    ctx.fillStyle = '#ffd6ff';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, tileW * 0.09) * a, 0, Math.PI * 2);
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
 * @param {{ type: string, x: number, y: number, dexId?: number, animMoving?: boolean, airZ?: number }} item
 */
function drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache) {
  const zLift = Math.max(0, Number(item.airZ) || 0);
  const r = 0.32 * Math.min(tileW, tileH);
  const dex = item.dexId ?? 94;
  const ft = worldFeetFromPivotCell(item.x, item.y, imageCache, dex, !!item.animMoving);
  const fcx = snapPx(ft.x * tileW);
  const fcyGround = snapPx(ft.y * tileH);
  const fcyBody = snapPx(ft.y * tileH - zLift * tileH);

  if (zLift > 0.02) {
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

export {
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_TOP_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render/render-constants.js';

export { loadTilesetImages } from './render/load-tileset-images.js';

let didWarnTerrainSetRoles = false;

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
    const latchGround = isGroundDigLatchEligible();
    const time = options.settings?.time || 0;

    /** Match `updatePlayer`: walk/dig on ground; Mewtwo/Mew use walk slice while levitating. */
    const flightHudActive = speciesHasFlyingType(playerDexForCam) && player.flightActive;
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
    endX = Math.min(width * CHUNK_SIZE, playCam.endXTiles);
    endY = Math.min(height * CHUNK_SIZE, playCam.endYTiles);

    // Identifica todos os tiles cobertos por scatter (árvores largas/altas) no viewport
    // REMOVIDO: buildScatterFootprintNoGrassSet era O(N^2) no render loop. 
    // Agora o suppressionSet é calculado uma única vez no bakeChunk.

    // Blocos 8×8: viewport + padding extra ao dar zoom (evita falhas à volta do canvas).
    const maxChunkXi = Math.floor((width * CHUNK_SIZE - 1) / PLAY_CHUNK_SIZE);
    const maxChunkYi = Math.floor((height * CHUNK_SIZE - 1) / PLAY_CHUNK_SIZE);
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

    for (let cy = cStartY; cy <= cEndY; cy++) {
      for (let cx = cStartX; cx <= cEndX; cx++) {
        const key = `${cx},${cy}`;
        let chunk = playChunkMap.get(key);
        if (!chunk) {
          chunk = bakeChunk(cx, cy, data, PLAY_BAKE_TILE_PX, PLAY_BAKE_TILE_PX);
          playChunkMap.set(key, chunk);
        }
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
    }

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
      const microWPre = width * CHUNK_SIZE;
      const microHPre = height * CHUNK_SIZE;
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
            if (getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, checkAtOrAbove, gateSet.type) !== 'CENTER') continue;
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
        if (getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, checkAtOrAbove, gateSet.type) !== 'CENTER') return false;
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

      if (firePhase && (layers.base || layers.top)) {
        const burning = firePhase === 'burning';
        const fillBase = burning ? 'rgba(58,26,10,0.82)' : 'rgba(7,5,4,0.92)';
        const fillTop = burning ? 'rgba(44,18,7,0.86)' : 'rgba(4,3,2,0.94)';
        const drawScorchedFull = (fill, y0, hFull) => {
          ctx.fillStyle = fill;
          ctx.fillRect(snapPx(tx), snapPx(y0), tileW, hFull);
        };
        const drawScorchedOverlayStrip = (fill, y0, hFull) => {
          const sh = hFull * barFrac;
          const sy = y0 + hFull * (1 - barFrac);
          ctx.fillStyle = fill;
          ctx.fillRect(snapPx(tx), snapPx(sy), tileW, sh);
        };
        const drawScorchedLayer = (fill, y0, hFull) => {
          if (playerTopOverlay) drawScorchedOverlayStrip(fill, y0, hFull);
          else drawScorchedFull(fill, y0, hFull);
        };
        /** Base grass is blitted in a 2×tileH quad; lower half sits over baked terrain — scorch only upper half so chão stays unchanged. */
        const baseGrassY0 = ty - tileH;
        const baseBurnScorchH = tileH;
        if (layers.base && !playerTopOverlay) {
          drawScorchedLayer(fillBase, baseGrassY0, baseBurnScorchH);
        }
        if (lodDetail < 2 && layers.top) {
          drawScorchedLayer(fillTop, ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX, tileH * 2);
        }
        if (burning) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,130,40,0.14)';
          if (layers.base && !playerTopOverlay) {
            drawScorchedLayer('rgba(255,130,40,0.14)', baseGrassY0, baseBurnScorchH);
          }
          if (lodDetail < 2 && layers.top) {
            drawScorchedLayer('rgba(255,110,30,0.12)', ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX, tileH * 2);
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
        if (isGrassDeferredAroundPlayer(mx, my)) {
          if (isGrassDeferredEwNeighbor(mx, my)) {
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
    for (let myScan = startY - sortableScanPad; myScan < endY; myScan++) {
      for (let mxScan = startX - sortableScanPad; mxScan < endX; mxScan++) {
        if (mxScan < 0 || myScan < 0 || mxScan >= width * CHUNK_SIZE || myScan >= height * CHUNK_SIZE) continue;
        const t = getCached(mxScan, myScan);
        if (!t || t.heightStep < 1) continue;

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
            if (objSet && validScatterOriginMicro(mxScan, myScan, data.seed, width * CHUNK_SIZE, height * CHUNK_SIZE, (c, r) => getCached(c, r))) {
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
        deadState: we.deadState,
        hurtTimer: we.hurtTimer
      });

      if (emotionPayload) {
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
        /** Depth sort: world pivot Y (tile center), not logical cell. */
        sortY: vy + 0.5,
        dexId: playerDex,
        drawAlpha: player.ghostPhaseAlpha ?? 1,
        animMoving: isPlayerMoving,
        digBuryVisual: player.digBurrowMode ? 0 : player.digCharge01,
        cx: snapPx((vx + 0.5) * tileW),
        cy: snapPx((vy + 0.5) * tileH - (player.z || 0) * tileH),
        sheet: pSheet,
        sx: ((player.animFrame ?? 0) % animCols) * sw,
        sy: (player.animRow ?? 0) * sh,
        sw: sw,
        sh: sh,
        dw: dw,
        dh: dh,
        pivotX: dw * 0.5,
        pivotY: dh * PMD_MON_SHEET.pivotYFrac,
        targetHeightTiles
      });
    }

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

    // --- SORT BY Y (`sortY`: pivot — Pokémon vy+0.5; formal + scatter canopy originY+1 per translate; else `y`) ---
    renderItems.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));

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
        const side = tileW * 1.14;
        const gap = tileH * 0.07;
        const bx = snapPx(em.cx - side * 0.5);
        const by = snapPx(spriteTopY - side - gap);
        const cr = Math.max(8, side * 0.09);
        const midX = bx + side * 0.5;
        const boxBottom = by + side;
        const tipY = snapPx(spriteTopY - tileH * 0.035);
        const tailHalfW = side * 0.13;

        ctx.save();
        ctx.translate(0, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        roundRectPath(bx, by, side, side, cr);
        ctx.fill();
        ctx.restore();

        ctx.save();
        roundRectPath(bx, by, side, side, cr);
        ctx.fillStyle = 'rgba(252,250,255,0.98)';
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
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(midX - tailHalfW, boxBottom);
        ctx.lineTo(em.cx, tipY);
        ctx.lineTo(midX + tailHalfW, boxBottom);
        ctx.closePath();
        ctx.fillStyle = 'rgba(252,250,255,0.98)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.stroke();
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
      const barW = Math.max(16, Math.floor(tileW * 0.82));
      const barH = Math.max(3, Math.floor(tileH * 0.08));
      const x = Math.floor(item.cx - barW * 0.5);
      const y = Math.floor(item.cy - item.pivotY + spawnYOffset - barH - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
      ctx.fillStyle = hp01 > 0.5 ? '#63e86f' : hp01 > 0.22 ? '#ffd54a' : '#ff6363';
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
        const pxL = snapPx(item.cx - item.pivotX);
        const pxT0 = snapPx(item.cy - item.pivotY + spawnYOffset);
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

        // Terrain / Grass Depth Cue (Deferred Overlay)
        const targetMx = Math.floor(item.x);
        const targetMy = Math.floor(item.y);
        if (targetMx >= startX && targetMx < endX && targetMy >= startY && targetMy < endY) {
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
      } else if (item.type === 'wildEmotion') {
        ctx.globalAlpha = item.spawnPhase;
        let spawnYOffset = 0;
        if (item.spawnPhase < 1) {
          if (item.spawnType === 'sky') spawnYOffset = (1 - item.spawnPhase) * (-4 * tileH);
          else if (item.spawnType === 'water') spawnYOffset = (1 - item.spawnPhase) * (0.8 * tileH);
          else spawnYOffset = (1 - item.spawnPhase) * (0.2 * tileH);
        }
        drawWildEmotionOverlay(ctx, item, spawnYOffset);
      } else if (item.type === 'scatter') {
        const { objSet, originX, originY, cols, itemKey } = item;
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

    // PASS 5a-deferred: S / SE / SW full grass over sprite; E / W extra bottom strip on active/waiting tile
    const microW = width * CHUNK_SIZE;
    const microH = height * CHUNK_SIZE;
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
      drawGrass5aForCell(mx, my, tile, tw, th, tx, ty, isEw ? 'playerTopOverlay' : undefined);
    }

    // Player tile: bottom strip over sprite on waiting or horizontal-move frame
    if (
      shouldDrawPlayerOverlay &&
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

        const microWColOv = width * CHUNK_SIZE;
        const microHColOv = height * CHUNK_SIZE;
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

    // Indicador de colisão: círculo = 1 tile no centro da célula lógica (player.x, player.y) = chão;
    // com `player.z` > 0, eixo tracejado até o corpo no ar (mesma convenção que sprite / projéteis).
    {
      const collMx = player.x;
      const collMy = player.y;
      const microWCol = width * CHUNK_SIZE;
      const microHCol = height * CHUNK_SIZE;
      if (collMx >= 0 && collMy >= 0 && collMx < microWCol && collMy < microHCol) {
        const collCx = snapPx((collMx + 0.5) * tileW);
        const collCyGround = snapPx((collMy + 0.5) * tileH);
        const pz = Math.max(0, Number(player.z) || 0);
        const collCyBody = snapPx((collMy + 0.5) * tileH - pz * tileH);
        const collR = Math.min(tileW, tileH) * 0.5;
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 200, 0.92)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(collCx, collCyGround, Math.max(1, collR - 1), 0, Math.PI * 2);
        ctx.stroke();
        {
          const { tx, ty } = aimAtCursor(player);
          const pcx = player.x + 0.5;
          const pcy = player.y + 0.5;
          let dx = (tx - pcx) * tileW;
          let dy = (ty - pcy) * tileH;
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
        if (pz > 0.02) {
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
        ctx.restore();
      }
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
