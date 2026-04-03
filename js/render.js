import { BIOMES } from './biomes.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell, seededHash, seededHashInt, parseShape, terrainRoleAllowsScatter2CContinuation } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN, BIOME_VEGETATION,
  GRASS_TILES, TREE_TILES,
  getGrassVariant, getTreeType,
  GRASS_DENSITY_THRESHOLD, TREE_DENSITY_THRESHOLD,
  GRASS_NOISE_SCALE, TREE_NOISE_SCALE,
  scatterHasWindSway
} from './biome-tiles.js';
import { getMicroTile, CHUNK_SIZE, LAND_STEPS, WATER_STEPS, foliageDensity, foliageType, elevationToStep } from './chunking.js';
import { validScatterOriginMicro, buildScatterFootprintNoGrassSet } from './scatter-pass2-debug.js';

/** 1px de sobreposição tipo telhado entre células de vegetação >1×1 (empilhamento em Y; vizinhas em X onde há 2+ colunas) */
const VEG_MULTITILE_OVERLAP_PX = 1;

/** Máx. linhas (altura) de um objecto scatter em células micro — 2C/2A varrem origens (ox, oy) acima do tile. */
const MAX_SCATTER_ROWS_PASS2 = 8;

/** Faixa vertical 16×(16×N) em tilesets/water-tile.png — animação de ondas no oceano (modo play). */
const WATER_ANIM_SRC_W = 16;
const WATER_ANIM_SRC_H = 16;

const imageCache = new Map();

export async function loadTilesetImages() {
  const sources = [
    'tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png',
    'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png'
  ];

  const promises = sources.map((src) => {
    if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = reject;
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

  return Promise.all(promises);
}

export function render(canvas, data, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data) return;

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
    tileW = 40; tileH = 40;
    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;
    ctx.translate(
      Math.round(cw / 2 - (vx + 0.5) * tileW),
      Math.round(ch / 2 - (vy + 0.5) * tileH)
    );
    
    const txRadius = Math.ceil((cw / tileW) / 2) + 2;
    const tyRadius = Math.ceil((ch / tileH) / 2) + 2;
    startX = Math.max(0, Math.floor(vx) - txRadius);
    startY = Math.max(0, Math.floor(vy) - tyRadius);
    endX = Math.min(width * CHUNK_SIZE, Math.floor(vx) + txRadius);
    endY = Math.min(height * CHUNK_SIZE, Math.floor(vy) + tyRadius);
  } else {
    tileW = cw / width; tileH = ch / height;
  }

  if (appMode === 'map') {
     const isLandAt = (r, c) => (r >= 0 && r < height && c >= 0 && c < width) && biomes[r * width + c] !== BIOMES.OCEAN.id;
     for (let y = startY; y < endY; y++) {
       for (let x = startX; x < endX; x++) {
         const idx = y * width + x;
         const bId = biomes[idx];
         if (viewType === 'elevation') {
           const val = cells[idx], colorVal = Math.floor(Math.max(0, Math.min(1, val)) * 255);
           ctx.fillStyle = val < 0.3 ? `rgb(0,0,${colorVal})` : `rgb(${colorVal},${colorVal},${colorVal})`;
           ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
         } else {
           const setName = BIOME_TO_TERRAIN[bId], set = TERRAIN_SETS[setName];
           if (set && imageCache.size > 0) {
             const imgPath = TessellationEngine.getImagePath(set.file), img = imageCache.get(imgPath);
             if (img) {
               const role = getRoleForCell(y, x, height, width, isLandAt, set.type);
               const tileId = set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
               const cols = imgPath.includes('caves') ? 50 : 57;
               ctx.drawImage(img, (tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16, Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
             }
           } else {
             ctx.fillStyle = Object.values(BIOMES).find(b => b.id === bId)?.color || '#f0f';
             ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
           }
         }
       }
     }

     // PASS 2: OVERLAYS (Restaurando Rotas e Cidades)
     if (overlayPaths && paths) {
       ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)'; // Dourado para rotas
       ctx.lineWidth = Math.max(1.5, tileW * 0.45);
       ctx.lineJoin = 'round';
       ctx.lineCap = 'round';
       for (const path of paths) {
         ctx.beginPath();
         path.forEach((p, i) => {
           const px = (p.x + 0.5) * tileW;
           const py = (p.y + 0.5) * tileH;
           if (i === 0) ctx.moveTo(px, py);
           else ctx.lineTo(px, py);
         });
         ctx.stroke();
       }
     }

     if (overlayGraph && graph) {
       for (const node of graph.nodes) {
         const px = (node.x + 0.5) * tileW;
         const py = (node.y + 0.5) * tileH;
         const r = Math.max(4, tileW * 0.75);
         
         // Marcador
         ctx.shadowBlur = 6;
         ctx.shadowColor = 'rgba(0,0,0,0.8)';
         ctx.fillStyle = node.isGym ? '#ff2222' : '#ffffff';
         ctx.strokeStyle = '#000';
         ctx.lineWidth = 2;
         ctx.beginPath();
         if (node.isGym) {
           ctx.moveTo(px, py - r*1.3); ctx.lineTo(px + r*1.3, py); ctx.lineTo(px, py + r*1.3); ctx.lineTo(px - r*1.3, py); ctx.closePath();
         } else {
           ctx.arc(px, py, r, 0, Math.PI * 2);
         }
         ctx.fill();
         ctx.stroke();
         ctx.shadowBlur = 0;

         // Rótulo
         ctx.fillStyle = '#fff';
         ctx. font = `bold ${Math.max(10, tileW * 1.0)}px Outfit, Inter, sans-serif`;
         ctx.textAlign = 'center';
         ctx.lineWidth = 3;
         ctx.strokeStyle = '#000';
         ctx.strokeText(node.name, px, py - r - 6);
         ctx.fillText(node.name, px, py - r - 6);
       }
     }

     // PASS 3: CURVAS DE NÍVEL (Bordas de elevação)
     if (overlayContours) {
       ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'; // Branco translúcido para as curvas
       ctx.lineWidth = 1;
       for (let y = startY; y < endY; y++) {
         for (let x = startX; x < endX; x++) {
           const h = elevationToStep(cells[y * width + x]);
           
           // Borda Direita
           if (x < width - 1) {
             const hr = elevationToStep(cells[y * width + (x + 1)]);
             if (h !== hr) {
               ctx.beginPath();
               ctx.moveTo((x + 1) * tileW, y * tileH);
               ctx.lineTo((x + 1) * tileW, (y + 1) * tileH);
               ctx.stroke();
             }
           }
           
           // Borda Inferior
           if (y < height - 1) {
             const hd = elevationToStep(cells[(y + 1) * width + x]);
             if (h !== hd) {
               ctx.beginPath();
               ctx.moveTo(x * tileW, (y + 1) * tileH);
               ctx.lineTo((x + 1) * tileW, (y + 1) * tileH);
               ctx.stroke();
             }
           }
         }
       }
     }
  } else {
    // ==== PLAY MODE RENDERER ====
    const snapPx = (n) => Math.round(n);
    const time = options.settings?.time || 0;
    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    const cavesImg = imageCache.get('tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png');
    const TCOLS_NATURE = 57;
    const TCOLS_CAVES = 50;

    const atlasFromObjectSet = (objSet) => {
      const path = TessellationEngine.getImagePath(objSet?.file);
      const img = path ? imageCache.get(path) : null;
      const cols = path.includes('caves') ? TCOLS_CAVES : TCOLS_NATURE;
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
    const drawScatterTile16 = (objSet, tileId, px, py, rotation) => {
      const { img, cols } = atlasFromObjectSet(objSet);
      if (!img || tileId == null || tileId < 0) return;
      const sx = (tileId % cols) * 16;
      const sy = Math.floor(tileId / cols) * 16;
      if (rotation) {
        ctx.save();
        ctx.translate(snapPx(px + tileW / 2), snapPx(py + tileH));
        ctx.rotate(rotation);
        ctx.drawImage(img, sx, sy, 16, 16, -twNat / 2, -thNat, twNat, thNat);
        ctx.restore();
      } else {
        ctx.drawImage(img, sx, sy, 16, 16, snapPx(px), snapPx(py), twNat, thNat);
      }
    };

    const padding = 2;
    const cStartX = Math.max(0, startX - padding), cStartY = Math.max(0, startY - padding);
    const cEndX = Math.min(width * CHUNK_SIZE, endX + padding), cEndY = Math.min(height * CHUNK_SIZE, endY + padding);
    const vw = cEndX - cStartX, vh = cEndY - cStartY;
    const tileCache = new Array(vw * vh);
    for (let my = cStartY; my < cEndY; my++) {
      for (let mx = cStartX; mx < cEndX; mx++) {
        tileCache[(my - cStartY) * vw + (mx - cStartX)] = getMicroTile(mx, my, data);
      }
    }
    const getCached = (mx, my) => (mx < cStartX || mx >= cEndX || my < cStartY || my >= cEndY) ? null : tileCache[(my - cStartY) * vw + (mx - cStartX)];
    const getStep = (mx, my) => getCached(mx, my)?.heightStep ?? -WATER_STEPS - 1;

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
        for (let my = startY; my < endY; my++) {
          for (let mx = startX; mx < endX; mx++) {
            const tile = getCached(mx, my);
            if (!tile || tile.biomeId !== BIOMES.OCEAN.id) continue;
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

    // PASS 1: TERRAIN
    for (let level = 0; level <= LAND_STEPS; level++) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < level) continue;

          let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
          if (tile.isRoad && TERRAIN_SETS['terrain folliage']) setName = 'terrain folliage';
          const set = TERRAIN_SETS[setName];

          if (set) {
            const imgPath = TessellationEngine.getImagePath(set.file), img = imageCache.get(imgPath);
            const cols = imgPath.includes('caves') ? 50 : 57;

            // NEW LOGIC: A tile only draws a border (Cliff/Edge/Corner) at its OWN height.
            // For levels below its height, it acts as a solid ground (CENTER) foundation.
            let role;
            if (tile.heightStep > level) {
              // Foundation: Skip drawing unless it's the layer immediately below (to fill the cliff base gap)
              if (level !== tile.heightStep - 1) continue;
              role = 'CENTER';
            } else {
              // Final Height: Calculate the correct role (Edge, NW, CENTER, etc.)
              const isAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= level;
              role = getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, isAtOrAbove, set.type);
            }

            const tileId = set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
            if (img && tileId != null) {
              ctx.drawImage(
                img,
                (tileId % cols) * 16,
                Math.floor(tileId / cols) * 16,
                16,
                16,
                snapPx(mx * tileW),
                snapPx(my * tileH),
                twNat,
                thNat
              );
            }
          }
        }
      }
    }

    // PASS 2: BASES (Veggie Trunks / Scatter Bases)
    let scatterFootprintNoGrassSet = new Set();
    if (natureImg || cavesImg) {
      const microWPass2 = width * CHUNK_SIZE;
      const microHPass2 = height * CHUNK_SIZE;
      const getWorldTilePass2 = (tx, ty) => getMicroTile(tx, ty, data);
      const validOriginMemo = new Map();
      scatterFootprintNoGrassSet = buildScatterFootprintNoGrassSet(startX, endX, startY, endY, data, validOriginMemo);
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1) continue;

          const treeType_check = getTreeType(tile.biomeId);
          const isFormalTree = (tx, ty) =>
            !!treeType_check &&
            (tx + ty) % 3 === 0 &&
            foliageDensity(tx, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
          const isFormalNeighbor = (tx, ty) =>
            !!treeType_check &&
            (tx + ty) % 3 === 1 &&
            foliageDensity(tx - 1, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

          const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];

          // 2C antes do gate CENTER: objectos largos (ex.: savannah-tree 3×3) em tiles IN_* no mesmo degrau
          {
            let allow2cDest = true;
            if (setForRole) {
              const chk2c = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= tile.heightStep;
              const roleDest = getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, chk2c, setForRole.type);
              allow2cDest = terrainRoleAllowsScatter2CContinuation(roleDest);
            }
            if (allow2cDest) {
            // Continuação 2C usa lista do bioma da origem (itemsO), não exige scatter no bioma destino
            if (!tile.isRoad && !tile.isCity) {
              let drew2cHere = false;
              for (let dox = 1; dox <= 4 && !drew2cHere; dox++) {
                const ox0 = mx - dox;
                if (ox0 < 0 || ox0 >= width * CHUNK_SIZE) continue;

                for (let oyDelta = 0; oyDelta < MAX_SCATTER_ROWS_PASS2; oyDelta++) {
                  const oy0 = my - oyDelta;
                  if (oy0 < 0 || oy0 >= height * CHUNK_SIZE) break;

                  const nTile = getMicroTile(ox0, oy0, data);
                  if (!nTile || nTile.heightStep < 1 || nTile.isRoad || nTile.isCity) continue;
                  if (tile.heightStep !== nTile.heightStep) continue;

                  const treeFormalOrigin = getTreeType(nTile.biomeId);
                  const isFormalTreeOrig = (tx, ty) =>
                    !!treeFormalOrigin &&
                    (tx + ty) % 3 === 0 &&
                    foliageDensity(tx, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
                  const isFormalNeighborOrig = (tx, ty) =>
                    !!treeFormalOrigin &&
                    (tx + ty) % 3 === 1 &&
                    foliageDensity(tx - 1, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
                  if (isFormalTreeOrig(ox0, oy0) || isFormalNeighborOrig(ox0, oy0)) continue;

                  if (!validScatterOriginMicro(ox0, oy0, data.seed, microWPass2, microHPass2, getWorldTilePass2, validOriginMemo)) continue;

                  const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
                  const itemKeyO = itemsO[Math.floor(seededHash(ox0, oy0, data.seed + 222) * itemsO.length)];
                  const objSetO = OBJECT_SETS[itemKeyO];
                  if (!objSetO) continue;
                  const { rows: rowsO, cols: colsO } = parseShape(objSetO.shape);
                  const doy = my - oy0;
                  if (dox >= colsO || doy < 0 || doy >= rowsO) continue;

                  const basePartO = objSetO.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
                  if (!basePartO?.ids?.length) continue;
                  const idxO = doy * colsO + dox;
                  if (idxO < 0 || idxO >= basePartO.ids.length) continue;

                  if (isFormalTree(mx, my) || isFormalNeighbor(mx, my)) continue;

                  const angleO = scatterHasWindSway(itemKeyO)
                    ? Math.sin(time * 2.5 + ox0 * 0.3 + oy0 * 0.7) * 0.04
                    : 0;
                  const pxO = Math.floor(mx * tileW);
                  const pyO = Math.floor(my * tileH);
                  drawScatterTile16(objSetO, basePartO.ids[idxO], pxO, pyO, angleO);
                  drew2cHere = true;
                  break;
                }
              }
            }
            }
          }

          // NO VEGETATION ON CLIFFS (2B / grama): só CENTER; 2C já corre acima
          if (setForRole) {
            const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= tile.heightStep;
            const role = getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, checkAtOrAbove, setForRole.type);
            if (role !== 'CENTER') continue;
          }

          // 1. Formal Trees (BIOME AWARE) — helpers já definidos no início do tile
          const isFormalOccupied = isFormalTree(mx, my) || isFormalNeighbor(mx, my);
          
          let occupiedByScatter = false;
          let drawnScatterOrigin = false;

          // 2. Scatter Base Check (Mutual Exclusion with Formal Trees AND other Scatter)
          const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
          if (!tile.isRoad && !tile.isCity) {
             // 2A: ocupação por scatter a Oeste (origem pode ser outro bioma com lista scatter)
             for (let dox = 1; dox <= 3 && !occupiedByScatter; dox++) {
               const ox = mx - dox;
               for (let oyDelta = 0; oyDelta < MAX_SCATTER_ROWS_PASS2; oyDelta++) {
                 const oy = my - oyDelta;
                 if (oy < 0 || oy >= height * CHUNK_SIZE) break;
                 const nTile = getMicroTile(ox, oy, data);
                 if (
                   nTile &&
                   foliageDensity(ox, oy, data.seed + 111, 2.5) > 0.82 &&
                   !nTile.isRoad &&
                   validScatterOriginMicro(ox, oy, data.seed, microWPass2, microHPass2, getWorldTilePass2, validOriginMemo)
                 ) {
                   const itemsAtO = BIOME_VEGETATION[nTile.biomeId] || [];
                   if (itemsAtO.length === 0) continue;
                   const nItemKey = itemsAtO[Math.floor(seededHash(ox, oy, data.seed + 222) * itemsAtO.length)];
                   const nObjSet = OBJECT_SETS[nItemKey];
                   if (nObjSet) {
                     const { rows, cols } = parseShape(nObjSet.shape);
                     const doy = my - oy;
                     if (dox < cols && doy >= 0 && doy < rows) {
                       occupiedByScatter = true;
                       break;
                     }
                   }
                 }
               }
             }

             // 2B: só se este bioma tem itens scatter
             if (
               scatterItems.length > 0 &&
               !isFormalOccupied &&
               !occupiedByScatter &&
               foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82 &&
               validScatterOriginMicro(mx, my, data.seed, microWPass2, microHPass2, getWorldTilePass2, validOriginMemo)
             ) {
                const itemKey = scatterItems[Math.floor(seededHash(mx, my, data.seed + 222) * scatterItems.length)];
                const objSet = OBJECT_SETS[itemKey];
                if (objSet) {
                  const { cols } = parseShape(objSet.shape);
                  const basePart = objSet.parts.find(p => p.role === 'base' || p.role === 'CENTER');
                  if (basePart) {
                    const angle = scatterHasWindSway(itemKey)
                      ? Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.04
                      : 0;
                    const thB = Math.ceil(tileH);
                    let drewAnyOriginFrag = false;
                    basePart.ids.forEach((id, idx) => {
                      const ox = idx % cols;
                      if (ox !== 0) return;
                      const oy = Math.floor(idx / cols);
                      const tx = mx + ox;
                      const ty = my + oy;
                      if (isFormalTree(tx, ty) || isFormalNeighbor(tx, ty)) return;
                      const px = Math.floor(mx * tileW) + ox * tileW;
                      const py = Math.floor(my * tileH) + oy * (thB - VEG_MULTITILE_OVERLAP_PX);
                      drawScatterTile16(objSet, id, px, py, angle);
                      drewAnyOriginFrag = true;
                    });
                    if (drewAnyOriginFrag) {
                      drawnScatterOrigin = true;
                      occupiedByScatter = true;
                    }
                  }
                }
             }
          }

          if (isFormalOccupied || occupiedByScatter) continue;
          if (scatterFootprintNoGrassSet.has(`${mx},${my}`)) continue;
          if (
            !tile.isRoad &&
            !tile.isCity &&
            scatterItems.length > 0 &&
            !isFormalOccupied &&
            foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82
          ) {
            continue;
          }

          // 3. Grass/Small Cacti
          if (foliageDensity(mx, my, data.seed, GRASS_NOISE_SCALE) >= GRASS_DENSITY_THRESHOLD && !tile.isRoad && !tile.isCity) {
            const variant = getGrassVariant(tile.biomeId);
            if (!variant) continue;
            
            const tiles = GRASS_TILES[variant];
            const fType = foliageType(mx, my, data.seed);
            const isCactus = (variant === 'desert' && fType >= 0.5) || (variant === 'dirt' && tiles.originalTop);
            const intensity = isCactus ? 0.07 : 0.12;
            const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * intensity;
            drawTile16(fType < 0.5 ? tiles.original : (tiles.cactusBase || tiles.grass2 || tiles.original), Math.floor(mx * tileW), Math.floor(my * tileH), angle);
          }
        }
      }
    }

    // PASS 3: FORMAL TREE BASES ONLY (copas desenhadas no Pass 5, à frente do jogador)
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        if ((mx + my) % 3 !== 0) continue;
        const tile = getCached(mx, my);
        if (!tile || tile.heightStep < 1 || tile.isRoad || tile.isCity) continue;

        const treeType = getTreeType(tile.biomeId);
        if (!treeType) continue;

        // NO TREES ON CLIFFS
        const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
        if (setForRole) {
          const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -1) >= tile.heightStep;
          if (getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, checkAtOrAbove, setForRole.type) !== 'CENTER') continue;
        }
        if (foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) < TREE_DENSITY_THRESHOLD) continue;
        const right = getCached(mx+1, my);
        if (!right || right.heightStep !== tile.heightStep) continue;
        const ids = TREE_TILES[treeType];
        if (!ids) continue;
        const tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH), tw = Math.ceil(tileW), th = Math.ceil(tileH);
        const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI*2) * 0.04;
        drawTile16(ids.base[0], tx, ty, angle);
        drawTile16(ids.base[1], tx + tw - VEG_MULTITILE_OVERLAP_PX, ty, angle);
      }
    }

    // PASS 4: PLAYER
    const vx = player.visualX ?? player.x, vy = player.visualY ?? player.y;
    const pcx = snapPx((vx + 0.5) * tileW);
    const pcy = snapPx((vy + 0.5) * tileH);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(pcx, pcy + tileH*0.3, tileW*0.3, tileH*0.15, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ff2222'; ctx.fillRect(pcx - tileW*0.2, pcy - tileH*0.1, tileW*0.4, tileH*0.3);
    ctx.fillStyle = '#3355ee'; ctx.fillRect(pcx - tileW*0.2, pcy + tileH*0.2, tileW*0.15, tileH*0.2); ctx.fillRect(pcx + tileW*0.05, pcy + tileH*0.2, tileW*0.15, tileH*0.2);
    ctx.fillStyle = '#ffccaa'; ctx.fillRect(pcx - tileW*0.2, pcy - tileH*0.4, tileW*0.4, tileH*0.3);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(pcx - tileW*0.25, pcy - tileH*0.4, tileW*0.5, tileH*0.1);
    ctx.fillStyle = '#ff2222'; ctx.fillRect(pcx - tileW * 0.2, pcy - tileH * 0.5, tileW * 0.4, tileH * 0.15);

    // PASS 5: TOPS (Above Player)
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        const tile = getCached(mx, my);
        if (!tile || tile.heightStep < 1) continue;

        // NO VEGETATION ON CLIFFS (Tops redraw)
        const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
        if (setForRole) {
          const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -1) >= tile.heightStep;
          if (getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, checkAtOrAbove, setForRole.type) !== 'CENTER') continue;
        }

        const tw = Math.ceil(tileW), th = Math.ceil(tileH), tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH);

        // 1. Scatter Tops (Palms/Mangroves correct columns)
        const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
        if (scatterItems.length > 0 && foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82 && !tile.isRoad) {
          const itemKey = scatterItems[Math.floor(seededHash(mx, my, data.seed + 222) * scatterItems.length)];
          const objSet = OBJECT_SETS[itemKey];
          if (objSet) {
            const { cols } = parseShape(objSet.shape);
            
            // Lógica canSpawn IDENTICA ao Pass 2 para garantir exclusão mútua total (BIOME AWARE)
            let canSpawn = true;
            const treeType_chk = getTreeType(tile.biomeId);
            for(let ox=0; ox<cols; ox++) {
              const tx_ch = mx + ox;
              const isFT = !!treeType_chk && (tx_ch + my) % 3 === 0 && foliageDensity(tx_ch, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
              const isFN = !!treeType_chk && (tx_ch + my) % 3 === 1 && foliageDensity(tx_ch - 1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
              if (isFT || isFN) { canSpawn = false; break; }
            }

            if (canSpawn) {
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

        // 2. Formal tree canopy: todas as fileiras de "top" (meio + ápice) à frente do jogador
        const treeType = getTreeType(tile.biomeId);
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
        // 3. Foliage Tops (Cacti/Dry Grass)
        const variant = getGrassVariant(tile.biomeId);
        const tiles = GRASS_TILES[variant];
        if (tiles && foliageDensity(mx, my, data.seed, GRASS_NOISE_SCALE) >= GRASS_DENSITY_THRESHOLD && !tile.isRoad && !tile.isCity) {
           const fType = foliageType(mx, my, data.seed);
           let topId = null;
           if (variant === 'desert' && fType >= 0.5) topId = tiles.cactusTop;
           else if (tiles.originalTop && fType < 0.5) topId = tiles.originalTop;

           if (topId) {
             // Exclusion check IDENTICA ao Pass 2 para evitar "meia planta" (BIOME AWARE)
             const treeT_chk = getTreeType(tile.biomeId);
             const isFT = !!treeT_chk && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
             const isFN = !!treeT_chk && (mx + my) % 3 === 1 && foliageDensity(mx-1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
             
             const items = BIOME_VEGETATION[tile.biomeId] || [];
             const noGrassTopUnderScatter =
               scatterFootprintNoGrassSet.has(`${mx},${my}`) ||
               (items.length > 0 &&
                 !(isFT || isFN) &&
                 foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82);

             if (!isFT && !isFN && !noGrassTopUnderScatter) {
               const isCactus = (variant === 'desert' && fType >= 0.5) || (variant === 'dirt' && tiles.originalTop);
               const intensity = isCactus ? 0.07 : 0.12;
               const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * intensity;
               ctx.save();
               ctx.translate(snapPx(tx + tw / 2), snapPx(ty + th));
               ctx.rotate(angle);
               ctx.drawImage(
                 natureImg,
                 (topId % TCOLS_NATURE) * 16,
                 Math.floor(topId / TCOLS_NATURE) * 16,
                 16,
                 16,
                 snapPx(-tw / 2),
                 snapPx(-th * 2 + VEG_MULTITILE_OVERLAP_PX),
                 tw,
                 th
               );
               ctx.restore();
             }
           }
        }
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
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
  const tileW = w / data.width, tileH = h / data.height;
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const idx = y * data.width + x, bId = data.biomes[idx];
      ctx.fillStyle = Object.values(BIOMES).find(b => b.id === bId)?.color || '#000';
      ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
    }
  }
  const macroPx = player.x / CHUNK_SIZE, macroPy = player.y / CHUNK_SIZE;
  ctx.fillStyle = '#ff0000'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc((macroPx + 0.5) * tileW, (macroPy + 0.5) * tileH, Math.max(3, tileW*2), 0, Math.PI*2); ctx.fill(); ctx.stroke();
}
