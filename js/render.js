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
  lakeLotusGrassInteriorAllowed,
  isSortableScatter
} from './biome-tiles.js';
import { getMicroTile, CHUNK_SIZE, foliageDensity, foliageType } from './chunking.js';
import {
  canWalkMicroTile,
  formalTreeTrunkOverlapsMicroCell,
  getFormalTreeTrunkWorldXSpan,
  scatterTreeTrunkOverlapsMicroCell,
  getScatterTreeTrunkWorldSpanIfOrigin
} from './walkability.js';
import { validScatterOriginMicro } from './scatter-pass2-debug.js';
import { isPlayerIdleOnWaitingFrame } from './player.js';
import { imageCache } from './image-cache.js';
import { POKEMON_HEIGHTS } from './pokemon/pokemon-heights.js';
import { getWildPokemonEntities } from './wild-pokemon/wild-pokemon-manager.js';
import { getResolvedSheets } from './pokemon/pokemon-asset-loader.js';
import { PMD_MON_SHEET } from './pokemon/pmd-default-timing.js';
import { resolvePmdFrameSpec, resolveCanonicalPmdH, worldFeetFromPivotCell } from './pokemon/pmd-layout-metrics.js';

import {
  PLAY_CHUNK_SIZE,
  WATER_ANIM_SRC_W,
  WATER_ANIM_SRC_H,
  VEG_MULTITILE_OVERLAP_PX,
  GRASS_DEFER_AROUND_PLAYER_DELTAS,
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render/render-constants.js';
import { syncPlayChunkCache, playChunkMap } from './render/play-chunk-cache.js';
import { bakeChunk } from './render/play-chunk-bake.js';
import { drawCachedMapOverview } from './render/map-overview-cache.js';
import { renderMinimap } from './render/render-minimap.js';

import './render/render-debug-hotkeys.js';

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
    tileW = 40;
    tileH = 40;
  } else {
    tileW = cw / width;
    tileH = ch / height;
  }

  syncPlayChunkCache(data, tileW, appMode);

  if (appMode === 'map') {
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

    /** Must match `updatePlayer`: walk sheet + walk frames only while grounded and moving. */
    const isPlayerWalkingAnim =
      !!player.grounded && Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1;
    const isMovingHorizontal = isPlayerWalkingAnim && Math.abs(player.vy ?? 0) < 0.05;
    const overlayMx = Math.floor(vx);
    const overlayMy = Math.floor(vy);
    const shouldDrawPlayerOverlay = isPlayerIdleOnWaitingFrame() || isMovingHorizontal;

    // Área visível em tiles (com pequena margem para tops de árvores)
    const viewW = cw / tileW;
    const viewH = ch / tileH;
    const startXTiles = Math.floor(vx - viewW / 2) - 2;
    const startYTiles = Math.floor(vy - viewH / 2) - 2;
    const endXTiles = Math.ceil(vx + viewW / 2) + 2;
    const endYTiles = Math.ceil(vy + viewH / 2) + 2;

    startX = Math.max(0, startXTiles);
    startY = Math.max(0, startYTiles);
    endX = Math.min(width * CHUNK_SIZE, endXTiles);
    endY = Math.min(height * CHUNK_SIZE, endYTiles);

    // Identifica todos os tiles cobertos por scatter (árvores largas/altas) no viewport
    // REMOVIDO: buildScatterFootprintNoGrassSet era O(N^2) no render loop. 
    // Agora o suppressionSet é calculado uma única vez no bakeChunk.

    // Identifica quais blocos 8x8 intersectam o viewport
    const cStartX = Math.floor(startX / PLAY_CHUNK_SIZE);
    const cStartY = Math.floor(startY / PLAY_CHUNK_SIZE);
    const cEndX = Math.floor((endX - 1) / PLAY_CHUNK_SIZE);
    const cEndY = Math.floor((endY - 1) / PLAY_CHUNK_SIZE);

    // Sincroniza o deslocamento da camada estática com a translação global arredondada
    const currentTransX = Math.round(cw / 2 - (vx + 0.5) * tileW);
    const currentTransY = Math.round(ch / 2 - (vy + 0.5) * tileH);

    for (let cy = cStartY; cy <= cEndY; cy++) {
      for (let cx = cStartX; cx <= cEndX; cx++) {
        const key = `${cx},${cy}`;
        let chunk = playChunkMap.get(key);
        if (!chunk) {
          chunk = bakeChunk(cx, cy, data, tileW, tileH);
          playChunkMap.set(key, chunk);
        }
        ctx.drawImage(
          chunk.canvas,
          currentTransX + cx * PLAY_CHUNK_SIZE * tileW,
          currentTransY + cy * PLAY_CHUNK_SIZE * tileH
        );
      }
    }

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

    // Pré-carregar os tiles visíveis no cache
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        getCached(mx, my);
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

    const time = options.settings?.time || 0;


    // PASS 0: Oceano — animação water-tile.png (faixa 16×16 por frame, empilhados em Y)
    const waterImg = imageCache.get('tilesets/water-tile.png');
    if (waterImg && waterImg.naturalWidth >= WATER_ANIM_SRC_W && waterImg.naturalHeight >= WATER_ANIM_SRC_H) {
      const waterFrames = Math.floor(waterImg.naturalHeight / WATER_ANIM_SRC_H);
      if (waterFrames >= 1) {
        const t = options.settings?.time ?? 0;
        const tick = Math.floor(t * 3.5);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if (ctx.webkitImageSmoothingEnabled !== undefined) ctx.webkitImageSmoothingEnabled = true;
        if (typeof ctx.imageSmoothingQuality === 'string') ctx.imageSmoothingQuality = 'high';
        const oceanSet = TERRAIN_SETS[BIOME_TO_TERRAIN[BIOMES.OCEAN.id]];
        const microRows = height * CHUNK_SIZE;
        const microCols = width * CHUNK_SIZE;
        for (let my = startY; my < endY; my++) {
          for (let mx = startX; mx < endX; mx++) {
            const tile = getCached(mx, my);
            if (!tile || tile.biomeId !== BIOMES.OCEAN.id) continue;
            // Quinas OUT_* do autotile são “terra” na lógica de caminhada; não cobrir com água animada
            // (senão parece oceano profundo mas `baseTerrainSpriteWalkable` continua true).
            if (oceanSet) {
              const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= tile.heightStep;
              const oRole = getRoleForCell(my, mx, microRows, microCols, checkAtOrAbove, oceanSet.type);
              if (oRole && String(oRole).startsWith('OUT_')) continue;
            }
            const phase = (tick + mx * 2 + my * 5) % waterFrames;
            const sy = phase * WATER_ANIM_SRC_H;
            ctx.drawImage(
              waterImg,
              0,
              sy,
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

      const gv = getGrassVariant(tile.biomeId);
      const gTiles = GRASS_TILES[gv];
      const { scale: gs, threshold: gt } = getGrassParams(tile.biomeId);

      if (gTiles && foliageDensity(mx, my, data.seed, gs) >= gt && !tile.isRoad && !tile.isCity) {
        let isFlat = true;
        const lakeInterior = lakeLotusGrassInteriorAllowed(
          mx,
          my,
          tile,
          data.height * CHUNK_SIZE,
          data.width * CHUNK_SIZE,
          (c, r) => getCached(c, r)
        );
        if (lakeInterior === null) {
          const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
          if (setForRole) {
            const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= tile.heightStep;
            if (getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, checkAtOrAbove, setForRole.type) !== 'CENTER') isFlat = false;
          }
        } else {
          isFlat = lakeInterior;
        }

        if (isFlat) {
          const items = BIOME_VEGETATION[tile.biomeId] || [];
          const trType = getTreeType(tile.biomeId, mx, my, data.seed);
          const isFT = !!trType && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
          const isFN = !!trType && (mx + my) % 3 === 1 && foliageDensity(mx - 1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

          const cx = Math.floor(mx / PLAY_CHUNK_SIZE);
          const cy = Math.floor(my / PLAY_CHUNK_SIZE);
          const chunk = playChunkMap.get(`${cx},${cy}`);
          const isOccupiedByObject = chunk ? chunk.suppressedSet.has(`${mx % PLAY_CHUNK_SIZE},${my % PLAY_CHUNK_SIZE}`) : false;

          if (!isFT && !isFN && !isOccupiedByObject) {
            let baseId = gTiles.original;
            if (gv === 'lotus' && gTiles.grass2 != null) {
              const ftPick = foliageType(mx, my, data.seed);
              baseId = ftPick < 0.5 ? gTiles.original : gTiles.grass2;
            }
            if (baseId != null) {
              const fIdx = AnimationRenderer.getFrameIndex(time, mx, my);
              const frame = AnimationRenderer.getWindFrame(natureImg, baseId, fIdx, TCOLS_NATURE);
              blitGrassQuad(frame, ty - tileH, tileH * 2);
            }
          }
        }
      }

      const vt = getGrassVariant(tile.biomeId);
      const vTiles = GRASS_TILES[vt];
      const { scale: vs, threshold: vt_th } = getGrassParams(tile.biomeId);
      if (vTiles && foliageDensity(mx, my, data.seed, vs) >= vt_th && !tile.isRoad && !tile.isCity) {
        const topId = vTiles.originalTop;
        if (topId) {
          const items = BIOME_VEGETATION[tile.biomeId] || [];
          const treeT_chk = getTreeType(tile.biomeId, mx - 1, my, data.seed);
          const isFT = !!treeT_chk && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
          const isFN = !!treeT_chk && (mx + my) % 3 === 1 && foliageDensity(mx - 1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

          const cx = Math.floor(mx / PLAY_CHUNK_SIZE);
          const cy = Math.floor(my / PLAY_CHUNK_SIZE);
          const chunk = playChunkMap.get(`${cx},${cy}`);
          const isOccupiedByObject = chunk ? chunk.suppressedSet.has(`${mx % PLAY_CHUNK_SIZE},${my % PLAY_CHUNK_SIZE}`) : false;

          if (!isFT && !isFN && !isOccupiedByObject) {
            const fIdx = AnimationRenderer.getFrameIndex(time, mx, my);
            const frame = AnimationRenderer.getWindFrame(natureImg, topId, fIdx, TCOLS_NATURE);
            blitGrassQuad(frame, ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX, tileH * 2);
          }
        }
      }

      if (playerTopOverlay) {
        ctx.restore();
      }
    };

    const playerTileMx = Math.floor(vx);
    const playerTileMy = Math.floor(vy);

    // PASS 5a: full grass under sprite for player + E/W always; idle waiting frame adds bottom strip after PASS 4 (no skip here). S/SE/SW deferred only.
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

    // PASS 3.5: Sorted Entities pass (Player + Wild Pokémon)
    const wildList = getWildPokemonEntities();
    const renderItems = [];
    
    // --- Collect Sortable Objects (Scatter, Trees, Buildings) ---
    for (let myScan = startY - 4; myScan < endY; myScan++) {
      for (let mxScan = startX - 4; mxScan < endX; mxScan++) {
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
      const { walk: wWalk, idle: wIdle } = getResolvedSheets(imageCache, we.dexId);
      if (!wWalk || !wIdle) continue;
      const wSheet = we.animMoving ? wWalk : wIdle;

      const { sw: pmdSw, sh: pmdSh, animCols } = resolvePmdFrameSpec(wSheet, !!we.animMoving, we.dexId);
      const canonicalH = resolveCanonicalPmdH(wIdle, wWalk, we.dexId);
      const targetHeightTiles = POKEMON_HEIGHTS[we.dexId] || 1.1;
      const targetHeightPx = targetHeightTiles * tileH;
      const finalScale = targetHeightPx / canonicalH;

      const pmdDw = pmdSw * finalScale;
      const pmdDh = pmdSh * finalScale;
      const pmdPivotX = pmdDw * 0.5;
      const pmdPivotY = pmdDh * PMD_MON_SHEET.pivotYFrac;

      renderItems.push({
        type: 'wild',
        y: we.y,
        x: we.x,
        /** Depth sort: world pivot Y (tile center), not logical cell — matches sprite anchor vs props. */
        sortY: we.y + 0.5,
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
        emotion: (we.emotionType !== null && typeof we.emotionType === 'number') ? {
          type: we.emotionType,
          age: we.emotionAge
        } : null,
        targetHeightTiles
      });
    }

    // --- Collect Player ---
    const isPlayerMoving = isPlayerWalkingAnim;
    const playerDex = player.dexId || 94;
    const { walk: pWalk, idle: pIdle } = getResolvedSheets(imageCache, playerDex);
    const pSheet = isPlayerMoving ? pWalk : pIdle;

    if (pSheet) {
      const { sw, sh, animCols } = resolvePmdFrameSpec(pSheet, isPlayerMoving, playerDex);
      const canonicalH = resolveCanonicalPmdH(pIdle, pWalk, playerDex);
      const targetHeightTiles = POKEMON_HEIGHTS[playerDex] || 1.1;
      const targetHeightPx = targetHeightTiles * tileH;
      const finalScale = targetHeightPx / canonicalH;

      const dw = sw * finalScale;
      const dh = sh * finalScale;

      renderItems.push({
        type: 'player',
        y: vy,
        x: vx,
        /** Depth sort: world pivot Y (tile center), not logical cell. */
        sortY: vy + 0.5,
        dexId: playerDex,
        animMoving: isPlayerMoving,
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

    // --- SORT BY Y (`sortY`: pivot — Pokémon vy+0.5; formal + scatter canopy originY+1 per translate; else `y`) ---
    renderItems.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));

      // --- DRAW PASS ---
    for (const item of renderItems) {
      ctx.save();
      
      if (item.type === 'wild' || item.type === 'player') {
        if (item.type === 'wild') {
          ctx.globalAlpha = item.spawnPhase;
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

        // Sprite
        ctx.drawImage(
          item.sheet,
          item.sx, item.sy, item.sw, item.sh,
          snapPx(item.cx - item.pivotX), snapPx(item.cy - item.pivotY + spawnYOffset),
          snapPx(item.dw), snapPx(item.dh)
        );
        // 🎈 Emotion Balloon
        if (item.emotion) {
          const emoImg = imageCache.get('tilesets/PC _ Computer - RPG Maker VX Ace - Miscellaneous - Emotions.png');
          if (emoImg && emoImg.naturalWidth) {
            const eCols = 8, eRows = 10;
            const eSw = Math.floor(emoImg.naturalWidth / eCols);
            const eSh = Math.floor(emoImg.naturalHeight / eRows);
            const progress = Math.min(1.0, item.emotion.age / 0.8);
            const fIdx = Math.min(eCols - 1, Math.floor(progress * eCols));
            const dW = eSw * 1.25 * (tileW / 32);
            const dH = eSh * 1.25 * (tileW / 32);
            const px = snapPx(item.cx - dW * 0.5);
            const py = snapPx(item.cy + spawnYOffset - item.pivotY - dH * 0.8);
            ctx.drawImage(emoImg, fIdx * eSw, item.emotion.type * eSh, eSw, eSh, px, py, Math.ceil(dW), Math.ceil(dH));
          }
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
          // Draw Top (Canopy)
          if (topPart) {
            const angle = scatterHasWindSway(itemKey) ? Math.sin(time * 2.5 + originX * 0.3 + originY * 0.7) * 0.04 : 0;
            const topRows = Math.ceil(topPart.ids.length / cols);
            ctx.save();
            ctx.translate(snapPx(originX * tileW + (cols * tileW) / 2), snapPx(originY * tileH + tileH));
            ctx.rotate(angle);
            topPart.ids.forEach((id, idx) => {
              const ox = idx % cols, oy = Math.floor(idx / cols);
              const drawY = -(topRows - oy + 1) * tileH + (topRows - oy) * VEG_MULTITILE_OVERLAP_PX;
              const lx = (ox * tileW) - (cols * tileW) / 2 - ox * VEG_MULTITILE_OVERLAP_PX;
              ctx.drawImage(img, (id % atlasCols) * 16, Math.floor(id / atlasCols) * 16, 16, 16, snapPx(lx), snapPx(drawY), Math.ceil(tileW), Math.ceil(tileH));
            });
            ctx.restore();
          }
        }
      } else if (item.type === 'tree') {
        const { treeType, originX, originY } = item;
        const ids = TREE_TILES[treeType];
        if (ids) {
          // Draw Base (skipped in bake)
          drawTile16(ids.base[0], originX * tileW, originY * tileH);
          drawTile16(ids.base[1], (originX + 1) * tileW - VEG_MULTITILE_OVERLAP_PX, originY * tileH);
          
          // Draw Top (Canopy)
          if (ids.top) {
            const angle = Math.sin(time * 1.5 + seededHash(originX, originY, data.seed + 9999) * Math.PI * 2) * 0.04;
            const tops = ids.top, canopyCols = 2, canopyRows = Math.ceil(tops.length / canopyCols);
            ctx.save();
            ctx.translate(snapPx(originX * tileW + tileW), snapPx(originY * tileH + tileH));
            ctx.rotate(angle);
            tops.forEach((id, i) => {
              const ox = i % canopyCols, row = Math.floor(i / canopyCols);
              const drawY = -(row + canopyRows) * tileH + (row + 1) * VEG_MULTITILE_OVERLAP_PX;
              const lx = ox === 0 ? -tileW : -VEG_MULTITILE_OVERLAP_PX;
              ctx.drawImage(natureImg, (id % TCOLS_NATURE) * 16, Math.floor(id / TCOLS_NATURE) * 16, 16, 16, snapPx(lx), snapPx(drawY), Math.ceil(tileW), Math.ceil(tileH));
            });
            ctx.restore();
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
          const scatterTrunk = scatterTreeTrunkOverlapsMicroCell(mx, my, data);
          if (!feetOk) {
            ctx.fillStyle = 'rgba(220, 60, 120, 0.3)';
            ctx.fillRect(mx * tileW, my * tileH, twCell, thCell);
          } else if (formalTrunk || scatterTrunk) {
            ctx.fillStyle = formalTrunk
              ? 'rgba(90, 220, 255, 0.26)'
              : 'rgba(180, 120, 255, 0.24)';
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
      const scatterTrunkMemo = new Map();
      ctx.strokeStyle = 'rgba(200, 140, 255, 0.9)';
      ctx.lineWidth = 2;
      for (let oxS = ox0 - 8; oxS < ox1 + 2; oxS++) {
        if (oxS < 0 || oxS >= microWColOv) continue;
        const yOrigMax = Math.min(microHColOv - 1, oy1 + 3);
        for (let oyS = Math.max(0, oy0 - 10); oyS <= yOrigMax; oyS++) {
          const sspan = getScatterTreeTrunkWorldSpanIfOrigin(oxS, oyS, data, scatterTrunkMemo);
          if (!sspan) continue;
          const cr = sspan.radius;
          if (sspan.cx + cr <= ox0 || sspan.cx - cr >= ox1 || sspan.cy + cr <= oy0 || sspan.cy - cr >= oy1) continue;
          const pxCx = snapPx(sspan.cx * tileW);
          const pxCy = snapPx(sspan.cy * tileH);
          const rx = Math.max(1, cr * tileW);
          const ry = Math.max(1, cr * tileH);
          ctx.beginPath();
          ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      for (const item of renderItems) {
        if (item.type === 'player' || item.type === 'wild') {
          ctx.strokeStyle = 'rgba(0, 255, 140, 0.55)';
          ctx.fillStyle = 'rgba(0, 255, 140, 0.12)';
          ctx.lineWidth = 2;
          const r = 0.32 * Math.min(tileW, tileH);
          const dex = item.dexId ?? 94;
          const ft = worldFeetFromPivotCell(item.x, item.y, imageCache, dex, !!item.animMoving);
          const fcx = snapPx(ft.x * tileW);
          const fcy = snapPx(ft.y * tileH);
          ctx.beginPath();
          ctx.arc(fcx, fcy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(fcx - 2, fcy - 2, 4, 4);
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
          ctx.strokeStyle = 'rgba(0, 255, 140, 0.55)';
          ctx.fillStyle = 'rgba(0, 255, 140, 0.12)';
          ctx.lineWidth = 2;
          const r = 0.32 * Math.min(tileW, tileH);
          const dex = item.dexId ?? 94;
          const ft = worldFeetFromPivotCell(item.x, item.y, imageCache, dex, !!item.animMoving);
          const fcx = snapPx(ft.x * tileW);
          const fcy = snapPx(ft.y * tileH);
          ctx.beginPath();
          ctx.arc(fcx, fcy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(fcx - 2, fcy - 2, 4, 4);
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
      const sspan = getScatterTreeTrunkWorldSpanIfOrigin(detailColliderDbg.ox0, detailColliderDbg.oy0, data, treeMemo);
      if (sspan) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 190, 95, 0.98)';
        ctx.lineWidth = 3;
        const pxCx = snapPx(sspan.cx * tileW);
        const pxCy = snapPx(sspan.cy * tileH);
        const rx = Math.max(2, sspan.radius * tileW);
        const ry = Math.max(2, sspan.radius * tileH);
        ctx.beginPath();
        ctx.ellipse(pxCx, pxCy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (detailColliderDbg?.kind === 'scatter-solid') {
      const twS = Math.ceil(tileW);
      const thS = Math.ceil(tileH);
      const x0 = detailColliderDbg.ox0;
      const y0 = detailColliderDbg.oy0;
      const cols = detailColliderDbg.cols ?? 1;
      const rows = detailColliderDbg.rows ?? 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.95)';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        snapPx(x0 * tileW),
        snapPx(y0 * tileH),
        Math.max(1, cols * twS - 1),
        Math.max(1, rows * thS - 1)
      );
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

    // Indicador de colisão: círculo com diâmetro = 1 tile no centro da célula lógica (player.x, player.y).
    // É essa célula que o jogo trata como "onde estás" após um passo; canWalk(nx,ny) avalia o tile de destino da mesma forma (grelha, sem elipse contínua).
    {
      const collMx = player.x;
      const collMy = player.y;
      const microWCol = width * CHUNK_SIZE;
      const microHCol = height * CHUNK_SIZE;
      if (collMx >= 0 && collMy >= 0 && collMx < microWCol && collMy < microHCol) {
        const collCx = snapPx((collMx + 0.5) * tileW);
        const collCy = snapPx((collMy + 0.5) * tileH);
        const collR = Math.min(tileW, tileH) * 0.5;
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 200, 0.92)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(collCx, collCy, Math.max(1, collR - 1), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
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
