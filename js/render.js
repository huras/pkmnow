import { BIOMES } from './biomes.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell, seededHash, seededHashInt, parseShape, terrainRoleAllowsScatter2CContinuation } from './tessellation-logic.js';
import { AnimationRenderer } from './animation-renderer.js';
import {
  BIOME_TO_TERRAIN, BIOME_VEGETATION,
  BIOME_TO_FOLIAGE,
  GRASS_TILES, TREE_TILES,
  getGrassVariant, getTreeType, getGrassParams,
  TREE_DENSITY_THRESHOLD,
  FOLIAGE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  FOLIAGE_NOISE_SCALE,
  scatterHasWindSway,
  lakeLotusGrassInteriorAllowed,
  usesPoolAutotileMaskForFoliage
} from './biome-tiles.js';
import { getMicroTile, CHUNK_SIZE, LAND_STEPS, WATER_STEPS, foliageDensity, foliageType, elevationToStep } from './chunking.js';
import { validScatterOriginMicro, buildScatterFootprintNoGrassSet } from './scatter-pass2-debug.js';
import { isPlayerIdleOnWaitingFrame } from './player.js';
import { imageCache } from './image-cache.js';
import {
  PALETTE_BASE_IMAGE_PATHS,
  paletteBaseSlugFromTerrainSetName,
  paletteBaseTransitionImageRelPath,
  allPaletteBaseTransitionImagePaths
} from './terrain-palette-base.js';
import { PALETTE_GRASSY_IMAGE_PATHS } from './terrain-palette-grassy.js';
import { getWildPokemonEntities } from './wild-pokemon/wild-pokemon-manager.js';
import { getResolvedSheets } from './pokemon/pokemon-asset-loader.js';
import { PMD_MON_SHEET } from './pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from './pokemon/pmd-anim-metadata.js';

/** 1px de sobreposição tipo telhado entre células de vegetação >1×1 (empilhamento em Y; vizinhas em X onde há 2+ colunas) */
const VEG_MULTITILE_OVERLAP_PX = 1;

/** Máx. linhas (altura) de um objecto scatter em células micro — 2C/2A varrem origens (ox, oy) acima do tile. */
const MAX_SCATTER_ROWS_PASS2 = 8;

/** Faixa vertical 16×(16×N) em tilesets/water-tile.png — animação de ondas no oceano (modo play). */
const WATER_ANIM_SRC_W = 16;
const WATER_ANIM_SRC_H = 16;

/** Camada estática no modo play organizada em blocos (chunks) de 8×8 tiles.
 * Cada bloco é um canvas renderizado uma única vez e mantido em cache.
 * Isso elimina os picos de lag ao caminhar, pois apenas novos blocos pequenos são assados. */
const PLAY_CHUNK_SIZE = 8;

/**
 * E / W / S / SE / SW from player tile (+y = south). S / SE / SW: full grass only after the sprite.
 * E / W: full grass in PASS 5a (under sprite) always; bottom-strip overlay after sprite on idle waiting frame only (player tile same).
 */
const GRASS_DEFER_AROUND_PLAYER_DELTAS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

/**
 * Player cell: fraction of each PASS 5a grass quad taken from the **bottom** of the sprite (ground-adjacent bar)
 * and the **bottom** of the on-screen quad — drawn after the sprite so it sits in front of the character.
 */
export const PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC = 0.25;

/** @deprecated Use PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC (same value). */
export const PLAYER_TILE_GRASS_OVERLAY_TOP_FRAC = PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC;

/** Simple “marked” look for that slice (1 = same opacity as normal PASS 5a grass). */
export const PLAYER_TILE_GRASS_OVERLAY_ALPHA = 0.92;

const playChunkMap = new Map();
let lastDataForCache = null;
let lastTileWForCache = 0;
let minimapBaseCacheCanvas = null;
let minimapBaseCacheData = null;
let minimapBaseCacheW = 0;
let minimapBaseCacheH = 0;
let mapOverviewCacheCanvas = null;
let mapOverviewCacheKey = '';
let didWarnTerrainSetRoles = false;

export async function loadTilesetImages() {
  const sources = [
    'tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png',
    'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png',
    ...PALETTE_BASE_IMAGE_PATHS,
    ...PALETTE_GRASSY_IMAGE_PATHS,
    ...allPaletteBaseTransitionImagePaths(),
    'tilesets/PokemonCenter.png',
    'tilesets/gengar_walk.png',
    'tilesets/gengar_idle.png'
  ];

  const promises = sources.map((src) => {
    if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = () => {
        if (src.startsWith('tilesets/palettes/') || src === 'tilesets/rocky-terrain.png') {
          resolve(null);
        } else {
          reject(new Error(`Failed to load ${src}`));
        }
      };
      img.src = src;
    });
  });

  promises.push(
    new Promise((resolve) => {
      const src = 'tilesets/water-tile.png';
      if (imageCache.has(src)) {
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src;
    })
  );

  await Promise.all(promises);
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

  const { width, height, cells, biomes, paths } = data;
  const cw = canvas.width;
  const ch = canvas.height;
  const graph = data.graph;

  const appMode = options.settings?.appMode || 'map';
  const player = options.settings?.player || {x:0, y:0};

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

  // Invalida o cache global de blocos se os dados básicos (mapa ou escala) mudarem (agora com tileW definido)
  if (appMode !== 'play' || data !== lastDataForCache || tileW !== lastTileWForCache) {
    playChunkMap.clear();
    lastDataForCache = data;
    lastTileWForCache = tileW;
  }

  if (appMode === 'map') {
    // Incluir config na chave: mesma seed + parâmetros diferentes deve invalidar o cache (antes só seed+view).
    const configSig = data.config != null ? JSON.stringify(data.config) : '';
    const mapCacheKey = [
      data.seed,
      configSig,
      width,
      height,
      cw,
      ch,
      viewType,
      overlayPaths ? 1 : 0,
      overlayGraph ? 1 : 0,
      overlayContours ? 1 : 0
    ].join('|');

    if (!mapOverviewCacheCanvas || mapOverviewCacheKey !== mapCacheKey) {
      mapOverviewCacheCanvas = document.createElement('canvas');
      mapOverviewCacheCanvas.width = cw;
      mapOverviewCacheCanvas.height = ch;
      mapOverviewCacheKey = mapCacheKey;
      const mctx = mapOverviewCacheCanvas.getContext('2d');
      if (mctx) {
        mctx.imageSmoothingEnabled = false;
        if (mctx.webkitImageSmoothingEnabled !== undefined) mctx.webkitImageSmoothingEnabled = false;
        mctx.fillStyle = '#111';
        mctx.fillRect(0, 0, cw, ch);

        const biomeColorById = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * width + x;
            const bId = biomes[idx];
            if (viewType === 'elevation') {
              const val = cells[idx];
              const colorVal = Math.floor(Math.max(0, Math.min(1, val)) * 255);
              mctx.fillStyle = val < 0.3 ? `rgb(0,0,${colorVal})` : `rgb(${colorVal},${colorVal},${colorVal})`;
            } else {
              mctx.fillStyle = biomeColorById.get(bId) || '#000';
            }
            mctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
          }
        }

        if (overlayPaths && paths) {
          mctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
          mctx.lineWidth = Math.max(1.5, tileW * 0.45);
          mctx.lineJoin = 'round';
          mctx.lineCap = 'round';
          for (const path of paths) {
            mctx.beginPath();
            path.forEach((p, i) => {
              const px = (p.x + 0.5) * tileW;
              const py = (p.y + 0.5) * tileH;
              if (i === 0) mctx.moveTo(px, py);
              else mctx.lineTo(px, py);
            });
            mctx.stroke();
          }
        }

        if (overlayGraph && graph) {
          for (const node of graph.nodes) {
            const px = (node.x + 0.5) * tileW;
            const py = (node.y + 0.5) * tileH;
            const r = Math.max(4, tileW * 0.75);
            mctx.shadowBlur = 6;
            mctx.shadowColor = 'rgba(0,0,0,0.8)';
            mctx.fillStyle = node.isGym ? '#ff2222' : '#ffffff';
            mctx.strokeStyle = '#000';
            mctx.lineWidth = 2;
            mctx.beginPath();
            if (node.isGym) {
              mctx.moveTo(px, py - r * 1.3);
              mctx.lineTo(px + r * 1.3, py);
              mctx.lineTo(px, py + r * 1.3);
              mctx.lineTo(px - r * 1.3, py);
              mctx.closePath();
            } else {
              mctx.arc(px, py, r, 0, Math.PI * 2);
            }
            mctx.fill();
            mctx.stroke();
            mctx.shadowBlur = 0;
            mctx.fillStyle = '#fff';
            mctx.font = `bold ${Math.max(10, tileW * 1.0)}px Outfit, Inter, sans-serif`;
            mctx.textAlign = 'center';
            mctx.lineWidth = 3;
            mctx.strokeStyle = '#000';
            mctx.strokeText(node.name, px, py - r - 6);
            mctx.fillText(node.name, px, py - r - 6);
          }
        }

        if (overlayContours) {
          mctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          mctx.lineWidth = 1;
          for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
              const hStep = elevationToStep(cells[y * width + x]);
              if (x < width - 1) {
                const hr = elevationToStep(cells[y * width + (x + 1)]);
                if (hStep !== hr) {
                  mctx.beginPath();
                  mctx.moveTo((x + 1) * tileW, y * tileH);
                  mctx.lineTo((x + 1) * tileW, (y + 1) * tileH);
                  mctx.stroke();
                }
              }
              if (y < height - 1) {
                const hd = elevationToStep(cells[(y + 1) * width + x]);
                if (hStep !== hd) {
                  mctx.beginPath();
                  mctx.moveTo(x * tileW, (y + 1) * tileH);
                  mctx.lineTo((x + 1) * tileW, (y + 1) * tileH);
                  mctx.stroke();
                }
              }
            }
          }
        }
      }
    }

    if (mapOverviewCacheCanvas) {
      ctx.drawImage(mapOverviewCacheCanvas, 0, 0);
    }
  } else {
    const snapPx = (n) => Math.round(n);
    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;

    const isMovingHorizontal = player.moving && (player.y === player.fromY);
    const overlayMx = isMovingHorizontal ? player.fromX : Math.floor(vx);
    const overlayMy = isMovingHorizontal ? player.fromY : Math.floor(vy);
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
    const cavesImg = imageCache.get('tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png');
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

    // PASS 3.5: wild Pokémon (3×3 overview window; mesma folha PMD que o player)
    const wildList = getWildPokemonEntities();
    wildList.sort((a, b) => a.y - b.y);
    const pmdScale = PMD_MON_SHEET.scale;

    /** Resolve frame size/cols using AnimData.xml metadata first, then image fallback. */
    const resolvePmdFrameSpec = (sheet, isMoving, dexId) => {
      const meta = getDexAnimMeta(dexId);
      const modeMeta = isMoving ? meta?.walk : meta?.idle;
      const fallbackCols = isMoving ? 4 : 8;
      const animCols = modeMeta?.durations?.length || fallbackCols;
      const sw = Math.max(
        1,
        Number(modeMeta?.frameWidth) ||
          Math.floor((sheet.naturalWidth || PMD_MON_SHEET.frameW * animCols) / animCols)
      );
      const sh = Math.max(
        1,
        Number(modeMeta?.frameHeight) ||
          Math.floor((sheet.naturalHeight || PMD_MON_SHEET.frameH * 8) / 8)
      );
      return { sw, sh, animCols };
    };

    /** Canonical PMD frame box per species (prefer idle), used to keep visual scale stable across idle/walk. */
    const resolveCanonicalPmdBox = (wIdle, wWalk, dexId) => {
      const meta = getDexAnimMeta(dexId);
      const idleCols = meta?.idle?.durations?.length || 8;
      const walkCols = meta?.walk?.durations?.length || 4;
      const idleW = Number(meta?.idle?.frameWidth) ||
        Math.floor(((wIdle?.naturalWidth || PMD_MON_SHEET.frameW * idleCols) / idleCols));
      const idleH = Number(meta?.idle?.frameHeight) ||
        Math.floor(((wIdle?.naturalHeight || PMD_MON_SHEET.frameH * 8) / 8));
      const walkW = Number(meta?.walk?.frameWidth) ||
        Math.floor(((wWalk?.naturalWidth || PMD_MON_SHEET.frameW * walkCols) / walkCols));
      const walkH = Number(meta?.walk?.frameHeight) ||
        Math.floor(((wWalk?.naturalHeight || PMD_MON_SHEET.frameH * 8) / 8));

      const canonicalW = Math.max(1, idleW || walkW || PMD_MON_SHEET.frameW);
      const canonicalH = Math.max(1, idleH || walkH || PMD_MON_SHEET.frameH);
      return { canonicalW, canonicalH };
    };

    const gengarMeta = getDexAnimMeta(94);
    const gengarRefH = Number(gengarMeta?.idle?.frameHeight) || PMD_MON_SHEET.frameH;

    const getSpeciesScaleFactor = (dexId) => {
      const meta = getDexAnimMeta(dexId);
      const refH = Number(meta?.idle?.frameHeight) || Number(meta?.walk?.frameHeight) || PMD_MON_SHEET.frameH;
      return Math.max(0.35, refH / gengarRefH);
    };

    for (const we of wildList) {
      const { walk: wWalk, idle: wIdle } = getResolvedSheets(imageCache, we.dexId);
      if (!wWalk || !wIdle) continue;
      const wSheet = we.animMoving ? wWalk : wIdle;
      const { sw: pmdSw, sh: pmdSh, animCols } = resolvePmdFrameSpec(wSheet, !!we.animMoving, we.dexId);
      const { canonicalW, canonicalH } = resolveCanonicalPmdBox(wIdle, wWalk, we.dexId);
      // Rule-of-three scaling with Gengar as reference = 1.0.
      // Example: Onix (104h) vs Gengar (40h) => factor 2.6.
      const speciesFactor = getSpeciesScaleFactor(we.dexId);
      const normalizedScale = pmdScale * (PMD_MON_SHEET.frameH / canonicalH);
      const finalScale = normalizedScale * speciesFactor;
      const pmdDw = canonicalW * finalScale;
      const pmdDh = canonicalH * finalScale;
      const pmdPivotX = pmdDw * 0.5;
      const pmdPivotY = pmdDh * PMD_MON_SHEET.pivotYFrac;
      const wCol = (we.animFrame ?? 0) % animCols;
      const wRow = we.animRow ?? 0;
      const wsx = wCol * pmdSw;
      const wsy = wRow * pmdSh;
      const wcx = snapPx((we.x + 0.5) * tileW);
      const wcy = snapPx((we.y + 0.5) * tileH);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(wcx, wcy, tileW * 0.38, tileH * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(
        wSheet,
        wsx, wsy, pmdSw, pmdSh,
        snapPx(wcx - pmdPivotX), snapPx(wcy - pmdPivotY),
        snapPx(pmdDw), snapPx(pmdDh)
      );

      // Wild grass overlay strip (same depth cue idea used for player).
      const wmx = Math.floor(we.x);
      const wmy = Math.floor(we.y);
      if (wmx >= startX && wmx < endX && wmy >= startY && wmy < endY) {
        const wTile = getCached(wmx, wmy);
        if (passesAbovePlayerTileGate(wmx, wmy, wTile)) {
          const wtw = Math.ceil(tileW);
          const wth = Math.ceil(tileH);
          const wtx = Math.floor(wmx * tileW);
          const wty = Math.floor(wmy * tileH);
          drawGrass5aForCell(wmx, wmy, wTile, wtw, wth, wtx, wty, 'playerTopOverlay');
        }
      }
    }

    // PASS 4: PLAYER (after grass, before canopies)
    const pcx = snapPx((vx + 0.5) * tileW);
    const pcy = snapPx((vy + 0.5) * tileH);

    const gengarWalk = imageCache.get('tilesets/gengar_walk.png');
    const gengarIdle = imageCache.get('tilesets/gengar_idle.png');

    if (gengarWalk && gengarIdle) {
      const isMoving = player.moving;
      const sheet = isMoving ? gengarWalk : gengarIdle;

      const sw = PMD_MON_SHEET.frameW; // Gengar PMD: 32x40
      const sh = PMD_MON_SHEET.frameH;

      const frameCol = player.animFrame ?? 0;
      const frameRow = player.animRow ?? 0;

      const sx = frameCol * sw;
      const sy = frameRow * sh;

      // Global PMD scale (shared with wild baseline)
      const gengarScale = PMD_MON_SHEET.scale;
      const dw = sw * gengarScale;
      const dh = sh * gengarScale;

      // Pivot Científico: Gengar #094 é "baixo" no sprite de 40px.
      // Ajustado para 0.48 para trazer o corpo 1 tile (40px) para baixo.
      const pivotX = dw * 0.5;
      const pivotY = dh * PMD_MON_SHEET.pivotYFrac; // Grounding recalibrado (Original: 0.84)

      // Sombra Científica: ShadowSize 2 (aproximadamente 28px no motor original)
      // Escalado: 1.4 * 2.5 = 3.5. Ajustado visualmente para 0.5 do tile.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(pcx, pcy, tileW * 0.45, tileH * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      // Draw Sprite
      ctx.drawImage(
        sheet,
        sx, sy, sw, sh,
        snapPx(pcx - pivotX), snapPx(pcy - pivotY),
        snapPx(dw), snapPx(dh)
      );
    } else {
      const protImg = imageCache.get('tilesets/protagonist.png');
      if (protImg) {
        const sw = 16, sh = 32;
        const frame = player.animFrame ?? 1;
        const sx = (frame % 3) * sw;
        const sy = Math.floor(frame / 3) * sh;
        const scale = tileW / sw;
        const dw = sw * scale;
        const dh = sh * scale;
        const pivotX = dw * 0.5;
        const pivotY = dh * 0.9;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(pcx, pcy, tileW * 0.25, tileH * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(
          protImg,
          sx, sy, sw, sh,
          snapPx(pcx - pivotX), snapPx(pcy - pivotY),
          snapPx(dw), snapPx(dh)
        );
      } else {
        // Fallback
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(pcx, pcy + tileH*0.3, tileW*0.3, tileH*0.15, 0, 0, Math.PI*2); ctx.fill();
      }
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

    // PASS 5b: CANOPIES & roofs (scatter tops, formal tree tops, urban roofs) — over player
    forEachAbovePlayerTile((mx, my, tile, tw, th, tx, ty) => {
      const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
      if (
        scatterItems.length > 0 &&
        foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82 &&
        !tile.isRoad &&
        !tile.isCity
      ) {
        const itemKey = scatterItems[Math.floor(seededHash(mx, my, data.seed + 222) * scatterItems.length)];
        const objSet = OBJECT_SETS[itemKey];
        if (objSet) {
          const { cols } = parseShape(objSet.shape);
          const getT = (tx, ty) => getMicroTile(tx, ty, data);

          if (
            validScatterOriginMicro(
              mx,
              my,
              data.seed,
              width * CHUNK_SIZE,
              height * CHUNK_SIZE,
              getT
            )
          ) {
            const topPart = objSet.parts.find(p => p.role === 'top' || p.role === 'tops');

            if (topPart) {
              const { img: scatterAtlasImg, cols: atlasCols } = atlasFromObjectSet(objSet);
              if (scatterAtlasImg) {
                const angle = scatterHasWindSway(itemKey)
                  ? Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.04
                  : 0;
                const topRows = Math.ceil(topPart.ids.length / cols);
                ctx.save();
                ctx.translate(snapPx(tx + (cols * tw) / 2), snapPx(ty + th));
                ctx.rotate(angle);
                topPart.ids.forEach((id, idx) => {
                  const ox = idx % cols;
                  const oy = Math.floor(idx / cols);
                  const drawY = -(topRows - oy + 1) * th + (topRows - oy) * VEG_MULTITILE_OVERLAP_PX;
                  const lx = (ox * tw) - (cols * tw) / 2 - ox * VEG_MULTITILE_OVERLAP_PX;
                  ctx.drawImage(
                    scatterAtlasImg,
                    (id % atlasCols) * 16,
                    Math.floor(id / atlasCols) * 16,
                    16,
                    16,
                    snapPx(lx),
                    snapPx(drawY),
                    tw,
                    th
                  );
                });
                ctx.restore();
              }
            }
          }
        }
      }

      const treeType = getTreeType(tile.biomeId, mx, my, data.seed);
      if (treeType && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
        const ids = TREE_TILES[treeType];
        if (ids?.top?.length && getCached(mx + 1, my)?.heightStep === tile.heightStep) {
          const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI * 2) * 0.04;
          const tops = ids.top;
          const n = tops.length;
          const canopyCols = 2;
          const canopyRows = Math.ceil(n / canopyCols);
          ctx.save();
          ctx.translate(snapPx(tx + tw), snapPx(ty + th));
          ctx.rotate(angle);
          for (let i = 0; i < n; i++) {
            const id = tops[i];
            const ox = i % canopyCols;
            const row = Math.floor(i / canopyCols);
            const drawY = -(row + canopyRows) * th + (row + 1) * VEG_MULTITILE_OVERLAP_PX;
            const lx = ox === 0 ? -tw : -VEG_MULTITILE_OVERLAP_PX;
            ctx.drawImage(
              natureImg,
              (id % TCOLS_NATURE) * 16,
              Math.floor(id / TCOLS_NATURE) * 16,
              16,
              16,
              snapPx(lx),
              snapPx(drawY),
              tw,
              th
            );
          }
          ctx.restore();
        }
      }

      if (tile.urbanBuilding && mx === tile.urbanBuilding.ox && my === tile.urbanBuilding.oy) {
        const objSet = OBJECT_SETS[tile.urbanBuilding.type];
        if (objSet) {
          const img = imageCache.get(objSet.file);
          if (img) {
            const [colsObj, rowsObj] = objSet.shape.split('x').map(Number);
            const pcCols = 15, natureCols = 57;
            const useCols = objSet.file.includes('PokemonCenter') ? pcCols : natureCols;

            for (let r = 0; r < rowsObj; r++) {
              for (let c = 0; c < colsObj; c++) {
                const isRoof = tile.urbanBuilding.type.includes('pokecenter') ? (r < 3) : (r < 2);
                if (isRoof) {
                  let drawId = null;
                  if (tile.urbanBuilding.type.includes('pokecenter')) {
                    if (r === 0) drawId = 0 + c;
                    else if (r === 1) drawId = 15 + c;
                    else if (r === 2) drawId = 30 + c;
                  } else if (tile.urbanBuilding.type.includes('mart')) {
                    if (r === 0) drawId = 20 + c;
                    else if (r === 1) drawId = 35 + c;
                  } else {
                    if (r === 0) drawId = 90 + c;
                    else if (r === 1) drawId = 105 + c;
                  }
                  if (drawId != null) {
                    const sx = (drawId % useCols) * 16, sy = Math.floor(drawId / useCols) * 16;
                    ctx.drawImage(img, sx, sy, 16, 16, snapPx((mx + c) * tileW), snapPx((my + r) * tileH), tw, th);
                  }
                }
              }
            }
          }
        }
      }
    });

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
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
  }
  ctx.restore();
}

function renderMinimap(canvas, data, player) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.imageSmoothingEnabled = false;
  if (ctx.webkitImageSmoothingEnabled !== undefined) ctx.webkitImageSmoothingEnabled = false;

  const needsRebuild =
    !minimapBaseCacheCanvas ||
    minimapBaseCacheData !== data ||
    minimapBaseCacheW !== w ||
    minimapBaseCacheH !== h;

  if (needsRebuild) {
    minimapBaseCacheCanvas = document.createElement('canvas');
    minimapBaseCacheCanvas.width = w;
    minimapBaseCacheCanvas.height = h;
    minimapBaseCacheData = data;
    minimapBaseCacheW = w;
    minimapBaseCacheH = h;

    const bctx = minimapBaseCacheCanvas.getContext('2d');
    if (!bctx) return;
    bctx.imageSmoothingEnabled = false;
    if (bctx.webkitImageSmoothingEnabled !== undefined) bctx.webkitImageSmoothingEnabled = false;
    bctx.fillStyle = '#111';
    bctx.fillRect(0, 0, w, h);

    const tileWb = w / data.width;
    const tileHb = h / data.height;
    const colorByBiomeId = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));
    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) {
        const idx = y * data.width + x;
        const bId = data.biomes[idx];
        bctx.fillStyle = colorByBiomeId.get(bId) || '#000';
        bctx.fillRect(Math.floor(x * tileWb), Math.floor(y * tileHb), Math.ceil(tileWb), Math.ceil(tileHb));
      }
    }
  }

  ctx.drawImage(minimapBaseCacheCanvas, 0, 0);

  const tileW = w / data.width, tileH = h / data.height;
  const macroPx = player.x / CHUNK_SIZE, macroPy = player.y / CHUNK_SIZE;
  ctx.fillStyle = '#ff0000'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc((macroPx + 0.5) * tileW, (macroPy + 0.5) * tileH, Math.max(3, tileW*2), 0, Math.PI*2); ctx.fill(); ctx.stroke();
}

/** Vizinho cardinal à mesma altura com outra paleta rocky-style (não grama / Dirty / cidade). */
function firstDifferingPaletteBaseNeighborSlug(mx, my, surfaceLevel, getCachedTile, selfSlug) {
  const offsets = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0]
  ];
  for (const [dx, dy] of offsets) {
    const t = getCachedTile(mx + dx, my + dy);
    if (!t || t.heightStep !== surfaceLevel) continue;
    const nSet = BIOME_TO_TERRAIN[t.biomeId] || 'grass';
    const nSlug = paletteBaseSlugFromTerrainSetName(nSet);
    if (nSlug && nSlug !== selfSlug) return nSlug;
  }
  return null;
}

/** Mesmo role/tileId; troca só a folha se existir PNG trans/ para o par de paletas. */
function imageForPaletteBaseTerrainDraw(biomeSetName, biomeSet, mx, my, surfaceLevel, getCachedTile) {
  const defaultPath = TessellationEngine.getImagePath(biomeSet.file);
  let img = imageCache.get(defaultPath);
  const selfSlug = paletteBaseSlugFromTerrainSetName(biomeSetName);
  if (selfSlug == null) return img;
  const otherSlug = firstDifferingPaletteBaseNeighborSlug(mx, my, surfaceLevel, getCachedTile, selfSlug);
  if (!otherSlug) return img;
  const tRel = paletteBaseTransitionImageRelPath(selfSlug, otherSlug);
  const tPath = TessellationEngine.getImagePath(tRel);
  const tImg = imageCache.get(tPath);
  if (tImg?.complete && (tImg.naturalWidth || tImg.width)) return tImg;
  return img;
}

/**
 * Renderiza um bloco 8x8 de tiles estáticos (Terreno + Bases) em um canvas separado.
 */
function bakeChunk(cx, cy, data, tileW, tileH) {
  const canvas = document.createElement('canvas');
  const size = PLAY_CHUNK_SIZE * tileW;
  canvas.width = Math.ceil(size);
  canvas.height = Math.ceil(size);
  const octx = canvas.getContext('2d');
  octx.imageSmoothingEnabled = false;

  const suppressedSet = new Set(); // Metadata for Pass 5a (Animated Grass) suppression

  const startX = cx * PLAY_CHUNK_SIZE;
  const startY = cy * PLAY_CHUNK_SIZE;
  const endX = startX + PLAY_CHUNK_SIZE;
  const endY = startY + PLAY_CHUNK_SIZE;

  const twNat = Math.ceil(tileW);
  const thNat = Math.ceil(tileH);
  const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
  const TCOLS_NATURE_BAKE = 57;
  const TCOLS_CAVES_BAKE = 50;

  const drawTile16 = (tileId, px, py) => {
    if (!natureImg || tileId == null || tileId < 0) return;
    const sx = (tileId % TCOLS_NATURE_BAKE) * 16;
    const sy = Math.floor(tileId / TCOLS_NATURE_BAKE) * 16;
    octx.drawImage(natureImg, sx, sy, 16, 16, Math.round(px), Math.round(py), twNat, thNat);
  };

  /** Bases scatter: OBJECT_SETS podem vir de nature ou caves — não usar sempre nature. */
  const drawScatterBaseFromObjectSet = (objSet, tileId, px, py) => {
    if (tileId == null || tileId < 0) return;
    const path = TessellationEngine.getImagePath(objSet?.file);
    const img = path ? imageCache.get(path) : null;
    if (!img) return;
    const cols = path.includes('caves') ? TCOLS_CAVES_BAKE : TCOLS_NATURE_BAKE;
    const sx = (tileId % cols) * 16;
    const sy = Math.floor(tileId / cols) * 16;
    octx.drawImage(img, sx, sy, 16, 16, Math.round(px), Math.round(py), twNat, thNat);
  };

  octx.fillStyle = '#111';
  octx.fillRect(0, 0, size, size);

  // NOVO: Cache de metadados para evitar recálculos matemáticos (Otimização GIGANTE de FPS)
  const tileCache = new Map();
  const getCachedTile = (mx, my) => {
    const key = (mx << 16) | (my & 0xFFFF); // Chave numérica rápida
    if (tileCache.has(key)) return tileCache.get(key);
    const t = getMicroTile(mx, my, data);
    tileCache.set(key, t);
    return t;
  };

  // Pré-aquecer o cache para a área do chunk + margem de segurança para vizinhos
  for (let my = startY - 2; my < endY + 2; my++) {
    for (let mx = startX - 2; mx < endX + 2; mx++) {
      getCachedTile(mx, my);
    }
  }

  // PASS 1: TERRAIN (Base + Height Layers)
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const tile = getCachedTile(mx, my);
      if (!tile) continue;
      
      // FALLBACK: Draw biome background color first
      const biome = Object.values(BIOMES).find(b => b.id === tile.biomeId);
      if (biome) {
        octx.fillStyle = biome.color;
        octx.fillRect(Math.round((mx - startX) * tileW), Math.round((my - startY) * tileH), twNat, thNat);
      }
    }
  }

  const microHBake = data.height * CHUNK_SIZE;
  const microWBake = data.width * CHUNK_SIZE;
  // Água (heightStep < 1): o loop seguinte usa level ≥ 0 e `tile.heightStep < level` → estes tiles
  // nunca eram desenhados, só a cor do PASS 1 (oceano sólido sem autotile).
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const tile = getCachedTile(mx, my);
      if (!tile || tile.heightStep >= 1) continue;
      const biomeSetName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
      const biomeSet = TERRAIN_SETS[biomeSetName];
      if (!biomeSet) continue;
      const img = imageForPaletteBaseTerrainDraw(biomeSetName, biomeSet, mx, my, tile.heightStep, getCachedTile);
      if (!img) continue;
      const cols = TessellationEngine.getTerrainSheetCols(biomeSet);
      const isAtOrAbove = (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= tile.heightStep;
      const role = getRoleForCell(my, mx, microHBake, microWBake, isAtOrAbove, biomeSet.type);
      const tileId = biomeSet.roles[role] ?? biomeSet.roles['CENTER'] ?? biomeSet.centerId;
      if (tileId == null) continue;
      const sx = (tileId % cols) * 16;
      const sy = Math.floor(tileId / cols) * 16;
      octx.drawImage(
        img,
        sx,
        sy,
        16,
        16,
        Math.round((mx - startX) * tileW),
        Math.round((my - startY) * tileH),
        twNat,
        thNat
      );
    }
  }

  for (let level = 0; level <= LAND_STEPS; level++) {
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        const tile = getCachedTile(mx, my);
        if (!tile || tile.heightStep < level) continue;

        // 1.1 Render Base Layer (BIOME)
        const biomeSetName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
        const biomeSet = TERRAIN_SETS[biomeSetName];
        if (biomeSet) {
          const defaultPath = TessellationEngine.getImagePath(biomeSet.file);
          let img = imageCache.get(defaultPath);
          if (tile.heightStep === level) {
            img = imageForPaletteBaseTerrainDraw(biomeSetName, biomeSet, mx, my, level, getCachedTile);
          }
          const cols = TessellationEngine.getTerrainSheetCols(biomeSet);
          let role;
          if (tile.heightStep > level) {
            if (level !== tile.heightStep - 1) role = null;
            else role = 'CENTER';
          } else {
            const isAtOrAbove = (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= level;
            role = getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, isAtOrAbove, biomeSet.type);
          }
          const tileId = role ? (biomeSet.roles[role] ?? biomeSet.roles['CENTER'] ?? biomeSet.centerId) : null;
          if (img && tileId != null) {
            octx.drawImage(img,(tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16, Math.round((mx - startX) * tileW), Math.round((my - startY) * tileH), twNat, thNat);
          }
        }

        const isStair = tile.roadFeature?.startsWith('stair');

        // 1.2 Render Terrain Foliage (Detail Skin) - MOVED BEFORE ROAD
        if (tile.heightStep === level && tile.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD) {
          const foliageSetName = BIOME_TO_FOLIAGE[tile.biomeId];
          if (foliageSetName) {
            // "CLEAN ROADS" logic: Only allow grass-based foliage under road/stairs (block sand/rocky/orange/volcano)
            let allowFoliage = true;
            if (tile.isRoad) {
                const lowName = foliageSetName.toLowerCase();
                const isGrassFoliage = lowName.includes('grass'); 
                if (!isGrassFoliage) allowFoliage = false;
            }

            if (allowFoliage) {
              const foliageSet = TERRAIN_SETS[foliageSetName];
              if (foliageSet) {
                const isFoliageSafeAt = (r, c) => {
                  const t = getCachedTile(c, r);
                  if (!t || t.heightStep !== level || t.biomeId !== tile.biomeId || t.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) return false;
                  // If we are drawing under a road, neighbors must be at same height regardless of being road
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                      if (getCachedTile(c + dx, r + dy)?.heightStep !== level) return false;
                    }
                  }
                  return true;
                };

                if (isFoliageSafeAt(my, mx)) {
                  const imgPath = TessellationEngine.getImagePath(foliageSet.file);
                  const img = imageCache.get(imgPath);
                  const fCols = TessellationEngine.getTerrainSheetCols(foliageSet);
                  const isFoliagePoolTile = (r, c) => {
                    const t = getCachedTile(c, r);
                    return !!(t && t.heightStep === level && t.biomeId === tile.biomeId && t.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD);
                  };
                  const landForFoliageRole = usesPoolAutotileMaskForFoliage(foliageSetName)
                    ? isFoliagePoolTile
                    : isFoliageSafeAt;
                  const fRole = getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, landForFoliageRole, foliageSet.type);
                  const fTileId = (foliageSet.roles[fRole] ?? foliageSet.roles['CENTER'] ?? foliageSet.centerId);
                  if (img && fTileId != null) {
                    octx.drawImage(img, (fTileId % fCols) * 16, Math.floor(fTileId / fCols) * 16, 16, 16, Math.round((mx - startX) * tileW), Math.round((my - startY) * tileH), twNat, thNat);
                  }
                }
              }
            }
          }
        }

        // 1.3 Render Road Layer (Overlay only for NON-STAIRS)
        if (tile.isRoad && !isStair) {
          const roadSetName = tile.roadFeature || 'road';
          const roadSet = TERRAIN_SETS[roadSetName];
          if (roadSet) {
            const imgPath = TessellationEngine.getImagePath(roadSet.file);
            const img = imageCache.get(imgPath);
            const cols = TessellationEngine.getTerrainSheetCols(roadSet);
            const isAtOrAboveRoad = (r, c) => {
              const t = getCachedTile(c, r);
              return (t?.heightStep ?? -99) >= level && t?.isRoad && !t?.roadFeature?.startsWith('stair');
            };
            const role = getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, isAtOrAboveRoad, roadSet.type);
            const tileId = role ? (roadSet.roles[role] ?? roadSet.roles['CENTER'] ?? roadSet.centerId) : null;
            if (img && tileId != null) {
              octx.drawImage(img,(tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16, Math.round((mx - startX) * tileW), Math.round((my - startY) * tileH), twNat, thNat);
            }
          }
        }

        // 1.4 Render STAIRS (Top Overlay)
        if (tile.isRoad && isStair) {
          const stairSet = TERRAIN_SETS[tile.roadFeature];
          if (stairSet) {
            const imgPath = TessellationEngine.getImagePath(stairSet.file);
            const img = imageCache.get(imgPath);
            if (img) {
              const cols = TessellationEngine.getTerrainSheetCols(stairSet);
              const isAtOrAboveStair = (r, c) => {
                const t = getCachedTile(c, r);
                return (t?.heightStep ?? -99) >= tile.heightStep && t?.isRoad && t?.roadFeature === tile.roadFeature;
              };
              const role = getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, isAtOrAboveStair, stairSet.type);
              const tileId = role ? (stairSet.roles[role] ?? stairSet.roles['CENTER'] ?? stairSet.centerId) : null;
              if (tileId != null) {
                octx.drawImage(img,(tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16, Math.round((mx - startX) * tileW), Math.round((my - startY) * tileH), twNat, thNat);
              }
            }
          }
        }
      }
    }
  }




  /* 
  // PASS 1.5: GRASS OVERLAY (Bases)
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const tile = getCachedTile(mx, my);
      if (!tile || tile.heightStep < 1 || tile.isRoad || tile.isCity) continue;

      const variant = getGrassVariant(tile.biomeId);
      const tiles = GRASS_TILES[variant];
      const { scale: gScale, threshold: gThreshold } = getGrassParams(tile.biomeId);
      if (tiles && foliageDensity(mx, my, data.seed, gScale) >= gThreshold) {
        // ENFORCE FLAT GROUND FOR GRASS (No grass on cliffs/edges)
        const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
        if (setForRole) {
           const checkAtOrAbove = (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= tile.heightStep;
           const microW = data.width * CHUNK_SIZE;
           const microH = data.height * CHUNK_SIZE;
           if (getRoleForCell(my, mx, microH, microW, checkAtOrAbove, setForRole.type) !== 'CENTER') continue;
        }

        // Exclusion check: don't draw grass if it's a formal tree root
        const treeType = getTreeType(tile.biomeId, mx, my, data.seed);
        const isFT = !!treeType && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        const isFN = !!treeType && (mx + my) % 3 === 1 && foliageDensity(mx-1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        
        if (!isFT && !isFN) {
           let baseId = tiles.original;
           if (baseId != null) drawTile16(baseId, (mx - startX) * tileW, (my - startY) * tileH);
        }
      }
    }
  }
  */

  // PASS 2: BASES (Halogened scan for multi-tile objects)
  const validOriginMemo = new Map();
  // Scan original position up to 4 tiles West and 4 tiles North (for 3x3 or larger spillover)
  for (let myScan = startY - 4; myScan < endY; myScan++) {
    for (let mxScan = startX - 4; mxScan < endX; mxScan++) {
      if (mxScan < 0 || myScan < 0 || mxScan >= data.width * CHUNK_SIZE || myScan >= data.height * CHUNK_SIZE) continue;
      
      const tile = getCachedTile(mxScan, myScan);
      if (!tile || tile.heightStep < 1) continue;

      const treeType = getTreeType(tile.biomeId, mxScan, myScan, data.seed);
      const isFormalRoot = (tx, ty) =>
        !!treeType && (tx + ty) % 3 === 0 && foliageDensity(tx, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

      // 1. Formal Trees (2x1)
      if (isFormalRoot(mxScan, myScan)) {
        // STRICT HEIGHT CHECK: Formal trees only start on flat ground
        const setRoot = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
        const roleOrig = setRoot ? getRoleForCell(myScan, mxScan, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= tile.heightStep, setRoot.type) : 'CENTER';

        if (roleOrig === 'CENTER') {
          const rx = mxScan + 1;
          const hRight = getCachedTile(rx, myScan)?.heightStep;
          
          if (hRight === tile.heightStep) {
            const ids = TREE_TILES[treeType];
            if (ids) {
              // Part 0 (Left half)
              if (mxScan >= startX && mxScan < endX && myScan >= startY && myScan < endY) {
                drawTile16(ids.base[0], (mxScan - startX) * tileW, (myScan - startY) * tileH);
              }
              // Part 1 (Right half)
              if (rx >= startX && rx < endX && myScan >= startY && myScan < endY) {
                drawTile16(ids.base[1], (rx - startX) * tileW - VEG_MULTITILE_OVERLAP_PX, (myScan - startY) * tileH);
              }
            }
          }
        }
      }

      // 2. Scatter Objects
      if (foliageDensity(mxScan, myScan, data.seed + 111, 2.5) > 0.82 && !tile.isRoad && !tile.urbanBuilding) {
        const isFormalNeighbor = (tx, ty) =>
           !!treeType && (tx + ty) % 3 === 1 && foliageDensity(tx - 1, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        
        if (!isFormalRoot(mxScan, myScan) && !isFormalNeighbor(mxScan, myScan)) {
           if (validScatterOriginMicro(mxScan, myScan, data.seed, data.width * CHUNK_SIZE, data.height * CHUNK_SIZE, (c, r) => getCachedTile(c, r), validOriginMemo)) {
              const items = BIOME_VEGETATION[tile.biomeId] || [];
              const itemKey = items[Math.floor(seededHash(mxScan, myScan, data.seed + 222) * items.length)];
              const objSet = OBJECT_SETS[itemKey];
              if (objSet) {
                const base = objSet.parts.find(p => p.role === 'base' || p.role === 'CENTER');
                const { cols, rows } = parseShape(objSet.shape);

                // Suppression rule: No grass under this scatter footprint
                for (let dy = 0; dy < rows; dy++) {
                   for (let dx = 0; dx < cols; dx++) {
                      const fx = mxScan + dx;
                      const fy = myScan + dy;
                      if (fx >= startX && fx < endX && fy >= startY && fy < endY) {
                         suppressedSet.add(`${fx % PLAY_CHUNK_SIZE},${fy % PLAY_CHUNK_SIZE}`);
                      }
                   }
                }

                if (base?.ids?.length) {
                  for (let idx = 0; idx < base.ids.length; idx++) {
                    const ox = idx % cols;
                    const oy = Math.floor(idx / cols);
                    const tx = mxScan + ox;
                    const ty = myScan + oy;
                    
                    // Fragment within current chunk bounds?
                    if (tx >= startX && tx < endX && ty >= startY && ty < endY) {
                       const destTile = getCachedTile(tx, ty);
                       if (destTile?.heightStep === tile.heightStep) {
                          let allowDest = true;
                          if (ox > 0) {
                             const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[destTile.biomeId] || 'grass'];
                             if (setForRole) {
                                const checkAtOrAbove = (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= tile.heightStep;
                                const roleDest = getRoleForCell(ty, tx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, checkAtOrAbove, setForRole.type);
                                allowDest = terrainRoleAllowsScatter2CContinuation(roleDest);
                             }
                          } else {
                             const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
                             if (setForRole) {
                                const checkAtOrAbove = (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= tile.heightStep;
                                if (getRoleForCell(myScan, mxScan, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, checkAtOrAbove, setForRole.type) !== 'CENTER') allowDest = false;
                             }
                          }

                          if (allowDest) {
                             drawScatterBaseFromObjectSet(
                               objSet,
                               base.ids[idx],
                               (tx - startX) * tileW - (ox > 0 ? VEG_MULTITILE_OVERLAP_PX : 0),
                               (ty - startY) * tileH
                             );
                          }
                       }
                    }
                  }
                }
              }
           }
        }
      }
       // 3. Urban Buildings (Deterministic CORE)
       if (tile.urbanBuilding && mxScan === tile.urbanBuilding.ox && myScan === tile.urbanBuilding.oy) {
          const objSet = OBJECT_SETS[tile.urbanBuilding.type];
          if (objSet) {
             const img = imageCache.get(objSet.file);
             if (img) {
                const [colsObj, rowsObj] = objSet.shape.split('x').map(Number);
                const pcCols = 15, natureCols = 57;
                const useCols = objSet.file.includes('PokemonCenter') ? pcCols : natureCols;

                for (let r = 0; r < rowsObj; r++) {
                   for (let c = 0; c < colsObj; c++) {
                      const rx = mxScan + c, ry = myScan + r;
                      if (rx < startX || rx >= endX || ry < startY || ry >= endY) continue;

                      let isCore = tile.urbanBuilding.type.includes('pokecenter') ? (r >= 3) : (r >= 2);
                      if (isCore) {
                         let drawId = null;
                         if (tile.urbanBuilding.type.includes('pokecenter')) {
                            if (r === 3) drawId = 45 + c;
                            else if (r === 4) drawId = 60 + c;
                            else if (r === 5) drawId = (c === 2) ? 77 : 75 + c;
                         } else if (tile.urbanBuilding.type.includes('mart')) {
                            if (r === 2) drawId = 50 + c;
                            else if (r === 3) drawId = 65 + c;
                            else if (r === 4) drawId = (c === 1) ? 81 : 80 + c;
                         } else { // House
                            if (r === 2) drawId = 120 + c;
                            else if (r === 3) drawId = 135 + c;
                            else if (r === 4) drawId = (c === 1) ? 151 : 150 + c;
                         }

                         if (drawId != null) {
                            const sx = (drawId % useCols) * 16, sy = Math.floor(drawId / useCols) * 16;
                            octx.drawImage(img, sx, sy, 16, 16, Math.round((rx - startX) * tileW), Math.round((ry - startY) * tileH), twNat, thNat);
                         }
                      }
                   }
                }
             }
          }
       }
    }
  }

  // PASS 3: CLUMP SUPPRESSION (Suppress grass clumps where noise is high, avoiding dense overlap)
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
       const t = getCachedTile(mx, my);
       if (!t || t.isRoad || t.isCity) continue;
       if ((BIOME_VEGETATION[t.biomeId] || []).length === 0) continue;
       if (foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82) {
          suppressedSet.add(`${mx % PLAY_CHUNK_SIZE},${my % PLAY_CHUNK_SIZE}`);
       }
    }
  }

  return { canvas, suppressedSet };
}
