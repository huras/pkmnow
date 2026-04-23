import { BIOMES } from '../biomes.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_TO_FOLIAGE,
  BIOME_VEGETATION,
  TREE_TILES,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  FOLIAGE_DENSITY_THRESHOLD,
  usesPoolAutotileMaskForFoliage,
  isSortableScatter,
  tileSurfaceAllowsScatterVegetation,
  SCATTER_NOISE_SEED_OFFSET,
  SCATTER_NOISE_SCALE,
  SCATTER_NOISE_THRESHOLD
} from '../biome-tiles.js';
import { getMicroTile, MACRO_TILE_STRIDE, LAND_STEPS, foliageDensity } from '../chunking.js';
import { imageCache } from '../image-cache.js';
import { validScatterOriginMicro } from '../scatter-pass2-debug.js';
import { getRoleForCell, seededHash, parseShape, terrainRoleAllowsScatter2CContinuation } from '../tessellation-logic.js';
import { drawTerrainCellFromSheet, getConcConvATerrainTileSpec } from './conc-conv-a-terrain-blit.js';
import { OBJECT_SETS, TERRAIN_SETS } from '../tessellation-data.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { imageForPaletteBaseTerrainDraw } from './palette-base-draw.js';
import { PLAY_CHUNK_SIZE, VEG_MULTITILE_OVERLAP_PX } from './render-constants.js';
import {
  isPlayDetailScatterOriginDestroyed,
  isPlayFormalTreeRootDestroyed,
  getFormalTreeRegrowVisualAlpha01
} from '../main/play-crystal-tackle.js';
import { hasScatterItemKeyOverride } from '../main/scatter-item-override.js';
import { resolveScatterVegetationItemKey } from '../vegetation-channels.js';

const BIOME_COLOR_BY_ID = new Map(Object.values(BIOMES).map((b) => [b.id, b.color]));

/**
 * Renderiza um bloco 8x8 de tiles estáticos (Terreno + Bases) em um canvas separado.
 */
export function bakeChunk(cx, cy, data, tileW, tileH) {
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
  const toTileKey = (mx, my) => (mx << 16) | (my & 0xffff);
  const toLocalSuppressionKey = (mx, my) => {
    const localX = ((mx % PLAY_CHUNK_SIZE) + PLAY_CHUNK_SIZE) % PLAY_CHUNK_SIZE;
    const localY = ((my % PLAY_CHUNK_SIZE) + PLAY_CHUNK_SIZE) % PLAY_CHUNK_SIZE;
    return (localY << 8) | localX;
  };
  const getCachedTile = (mx, my) => {
    const key = toTileKey(mx, my); // Chave numérica rápida
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
      const biomeColor = BIOME_COLOR_BY_ID.get(tile.biomeId);
      if (biomeColor) {
        octx.fillStyle = biomeColor;
        octx.fillRect(Math.round((mx - startX) * tileW), Math.round((my - startY) * tileH), twNat, thNat);
      }
    }
  }

  const microHBake = data.height * MACRO_TILE_STRIDE;
  const microWBake = data.width * MACRO_TILE_STRIDE;
  const roleAtOrAboveCacheBySetType = new Map();
  const getRoleAtOrAboveHeight = (mx, my, level, setType) => {
    let levelMapByType = roleAtOrAboveCacheBySetType.get(setType);
    if (!levelMapByType) {
      levelMapByType = new Map();
      roleAtOrAboveCacheBySetType.set(setType, levelMapByType);
    }
    let roleByTile = levelMapByType.get(level);
    if (!roleByTile) {
      roleByTile = new Map();
      levelMapByType.set(level, roleByTile);
    }
    const key = toTileKey(mx, my);
    if (roleByTile.has(key)) return roleByTile.get(key);
    const isAtOrAbove = (r, c) => (getCachedTile(c, r)?.heightStep ?? -99) >= level;
    const role = getRoleForCell(my, mx, microHBake, microWBake, isAtOrAbove, setType);
    roleByTile.set(key, role);
    return role;
  };
  const skipUnderCenterSprite = new Set();

  // Pré-cálculo: se a superfície deste tile é CENTER (base ou skin), o sprite logo abaixo é totalmente oculto.
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const tile = getCachedTile(mx, my);
      if (!tile || tile.heightStep < 1) continue;
      let shouldSkipUnder = false;

      const biomeSetName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
      const biomeSet = TERRAIN_SETS[biomeSetName];
      if (biomeSet) {
        const baseSurfaceRole = getRoleAtOrAboveHeight(mx, my, tile.heightStep, biomeSet.type);
        shouldSkipUnder = baseSurfaceRole === 'CENTER';
      }

      if (!shouldSkipUnder && tile.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD) {
        const foliageSetName = BIOME_TO_FOLIAGE[tile.biomeId];
        if (foliageSetName) {
          let allowFoliage = true;
          if (tile.isRoad) {
            const lowName = foliageSetName.toLowerCase();
            const isGrassFoliage = lowName.includes('grass');
            if (!isGrassFoliage) allowFoliage = false;
          }
          if (allowFoliage) {
            const foliageSet = TERRAIN_SETS[foliageSetName];
            if (foliageSet) {
              const isFoliageSafeAtSurface = (r, c) => {
                const t = getCachedTile(c, r);
                if (!t || t.heightStep !== tile.heightStep || t.biomeId !== tile.biomeId || t.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) return false;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    if (getCachedTile(c + dx, r + dy)?.heightStep !== tile.heightStep) return false;
                  }
                }
                return true;
              };
              if (isFoliageSafeAtSurface(my, mx)) {
                const isFoliagePoolTile = (r, c) => {
                  const t = getCachedTile(c, r);
                  return !!(t && t.heightStep === tile.heightStep && t.biomeId === tile.biomeId && t.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD);
                };
                const landForFoliageRole = usesPoolAutotileMaskForFoliage(foliageSetName)
                  ? isFoliagePoolTile
                  : isFoliageSafeAtSurface;
                const fRole = getRoleForCell(my, mx, microHBake, microWBake, landForFoliageRole, foliageSet.type);
                shouldSkipUnder = fRole === 'CENTER';
              }
            }
          }
        }
      }

      if (shouldSkipUnder) skipUnderCenterSprite.add(toTileKey(mx, my));
    }
  }

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
      const role = getRoleAtOrAboveHeight(mx, my, tile.heightStep, biomeSet.type);
      const centerIdW = biomeSet.roles?.CENTER ?? biomeSet.centerId;
      const specW = getConcConvATerrainTileSpec(biomeSet, role);
      const tileId = specW.tileId;
      if (tileId == null) continue;
      const px = Math.round((mx - startX) * tileW);
      const py = Math.round((my - startY) * tileH);
      const concConvAbcW =
        biomeSet.type === 'conc-conv-a' ||
        biomeSet.type === 'conc-conv-b' ||
        biomeSet.type === 'conc-conv-c';
      if (concConvAbcW && role && role !== 'CENTER' && centerIdW != null && tileId !== centerIdW) {
        octx.drawImage(
          img,
          (centerIdW % cols) * 16,
          Math.floor(centerIdW / cols) * 16,
          16,
          16,
          px,
          py,
          twNat,
          thNat
        );
      }
      drawTerrainCellFromSheet(octx, img, cols, 16, tileId, px, py, twNat, thNat, specW.flipX);
    }
  }

  for (let level = 0; level <= LAND_STEPS; level++) {
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        const tile = getCachedTile(mx, my);
        if (!tile || tile.heightStep < level) continue;
        if (tile.heightStep > level && level === tile.heightStep - 1 && skipUnderCenterSprite.has(toTileKey(mx, my))) continue;

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
            role = getRoleAtOrAboveHeight(mx, my, level, biomeSet.type);
          }
          const centerId = biomeSet.roles?.CENTER ?? biomeSet.centerId;
          const spec = role ? getConcConvATerrainTileSpec(biomeSet, role) : { tileId: null, flipX: false };
          const tileId = spec.tileId;
          if (img && tileId != null) {
            const px = Math.round((mx - startX) * tileW);
            const py = Math.round((my - startY) * tileH);
            // Cantos/bordas conc-conv costumam ter alpha; sem isto vê-se só a cor plana do PASS 1.
            const concConvAbc =
              biomeSet.type === 'conc-conv-a' ||
              biomeSet.type === 'conc-conv-b' ||
              biomeSet.type === 'conc-conv-c';
            if (concConvAbc && role && role !== 'CENTER' && centerId != null && tileId !== centerId) {
              octx.drawImage(
                img,
                (centerId % cols) * 16,
                Math.floor(centerId / cols) * 16,
                16,
                16,
                px,
                py,
                twNat,
                thNat
              );
            }
            drawTerrainCellFromSheet(octx, img, cols, 16, tileId, px, py, twNat, thNat, spec.flipX);
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
                  const fRole = getRoleForCell(my, mx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, landForFoliageRole, foliageSet.type);
                  const fSpec = getConcConvATerrainTileSpec(foliageSet, fRole);
                  const fTileId = fSpec.tileId;
                  if (img && fTileId != null) {
                    drawTerrainCellFromSheet(
                      octx,
                      img,
                      fCols,
                      16,
                      fTileId,
                      Math.round((mx - startX) * tileW),
                      Math.round((my - startY) * tileH),
                      twNat,
                      thNat,
                      fSpec.flipX
                    );
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
            const role = getRoleForCell(my, mx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, isAtOrAboveRoad, roadSet.type);
            const rSpec = role ? getConcConvATerrainTileSpec(roadSet, role) : { tileId: null, flipX: false };
            const tileId = rSpec.tileId;
            if (img && tileId != null) {
              drawTerrainCellFromSheet(
                octx,
                img,
                cols,
                16,
                tileId,
                Math.round((mx - startX) * tileW),
                Math.round((my - startY) * tileH),
                twNat,
                thNat,
                rSpec.flipX
              );
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
              const role = getRoleForCell(my, mx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, isAtOrAboveStair, stairSet.type);
              const sSpec = role ? getConcConvATerrainTileSpec(stairSet, role) : { tileId: null, flipX: false };
              const tileId = sSpec.tileId;
              if (tileId != null) {
                drawTerrainCellFromSheet(
                  octx,
                  img,
                  cols,
                  16,
                  tileId,
                  Math.round((mx - startX) * tileW),
                  Math.round((my - startY) * tileH),
                  twNat,
                  thNat,
                  sSpec.flipX
                );
              }
            }
          }
        }
      }
    }
  }

  // PASS 2: BASES (Halogened scan for multi-tile objects)
  const validOriginMemo = new Map();
  // Scan original position up to 4 tiles West and 4 tiles North (for 3x3 or larger spillover)
  for (let myScan = startY - 4; myScan < endY; myScan++) {
    for (let mxScan = startX - 4; mxScan < endX; mxScan++) {
      if (mxScan < 0 || myScan < 0 || mxScan >= data.width * MACRO_TILE_STRIDE || myScan >= data.height * MACRO_TILE_STRIDE) continue;

      const tile = getCachedTile(mxScan, myScan);
      if (!tileSurfaceAllowsScatterVegetation(tile)) continue;

      const treeType = getTreeType(tile.biomeId, mxScan, myScan, data.seed);
      const isFormalRoot = (tx, ty) =>
        !!treeType && (tx + ty) % 3 === 0 && foliageDensity(tx, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

      // 1. Formal Trees (2x1)
      if (isFormalRoot(mxScan, myScan)) {
        if (isPlayFormalTreeRootDestroyed(mxScan, myScan)) continue;
        if (getFormalTreeRegrowVisualAlpha01(mxScan, myScan) < 0.999) continue;
        // STRICT HEIGHT CHECK: Formal trees only start on flat ground
        const setRoot = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
        const roleOrig = setRoot ? getRoleAtOrAboveHeight(mxScan, myScan, tile.heightStep, setRoot.type) : 'CENTER';

        if (roleOrig === 'CENTER') {
          const rx = mxScan + 1;
          const hRight = getCachedTile(rx, myScan)?.heightStep;

          if (hRight === tile.heightStep) {
            const roleRight = setRoot ? getRoleAtOrAboveHeight(rx, myScan, tile.heightStep, setRoot.type) : 'CENTER';
            if (!terrainRoleAllowsScatter2CContinuation(roleRight)) continue;
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
      if (
        foliageDensity(mxScan, myScan, data.seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE) > SCATTER_NOISE_THRESHOLD &&
        !tile.isRoad &&
        !tile.urbanBuilding
      ) {
        const isFormalNeighbor = (tx, ty) =>
          !!treeType && (tx + ty) % 3 === 1 && foliageDensity(tx - 1, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

        if (!isFormalRoot(mxScan, myScan) && !isFormalNeighbor(mxScan, myScan)) {
          if (
            hasScatterItemKeyOverride(mxScan, myScan) ||
            validScatterOriginMicro(
              mxScan,
              myScan,
              data.seed,
              data.width * MACRO_TILE_STRIDE,
              data.height * MACRO_TILE_STRIDE,
              (c, r) => getCachedTile(c, r),
              validOriginMemo
            )
          ) {
            const itemKey = resolveScatterVegetationItemKey(mxScan, myScan, tile, data.seed);
            if (isPlayDetailScatterOriginDestroyed(mxScan, myScan)) continue;
            const objSet = OBJECT_SETS[itemKey];
            if (objSet) {
              const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
              const { cols, rows } = parseShape(objSet.shape);

              // Suppression rule: No grass under this scatter footprint
              for (let dy = 0; dy < rows; dy++) {
                for (let dx = 0; dx < cols; dx++) {
                  const fx = mxScan + dx;
                  const fy = myScan + dy;
                  if (fx >= startX && fx < endX && fy >= startY && fy < endY) {
                    suppressedSet.add(toLocalSuppressionKey(fx, fy));
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
                          const roleDest = getRoleAtOrAboveHeight(tx, ty, tile.heightStep, setForRole.type);
                          allowDest = terrainRoleAllowsScatter2CContinuation(roleDest);
                        }
                      } else {
                        const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
                        if (setForRole) {
                          if (getRoleAtOrAboveHeight(mxScan, myScan, tile.heightStep, setForRole.type) !== 'CENTER')
                            allowDest = false;
                        }
                      }

                      if (allowDest) {
                        const isSortable = isSortableScatter(itemKey);
                        if (!isSortable) {
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
      }
    }
  }

  // PASS 3: CLUMP SUPPRESSION (Suppress grass clumps where noise is high, avoiding dense overlap)
  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const t = getCachedTile(mx, my);
      if (!t || t.isRoad || t.isCity) continue;
      if ((BIOME_VEGETATION[t.biomeId] || []).length === 0) continue;
      if (foliageDensity(mx, my, data.seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE) > SCATTER_NOISE_THRESHOLD) {
        suppressedSet.add(toLocalSuppressionKey(mx, my));
      }
    }
  }

  return { canvas, suppressedSet };
}
