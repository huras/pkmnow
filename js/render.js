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

/** Camada estática no modo play organizada em blocos (chunks) de 8×8 tiles.
 * Cada bloco é um canvas renderizado uma única vez e mantido em cache.
 * Isso elimina os picos de lag ao caminhar, pois apenas novos blocos pequenos são assados. */
const PLAY_CHUNK_SIZE = 8;
const playChunkMap = new Map();
let lastDataForCache = null;
let lastTileWForCache = 0;

const imageCache = new Map();

export async function loadTilesetImages() {
  const sources = [
    'tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png',
    'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png',
    'tilesets/PokemonCenter.png'
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
    const snapPx = (n) => Math.round(n);
    const scatterFootprintNoGrassSet = new Set(); // Prevent crash in Pass 5
    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;

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
        let chunkCanvas = playChunkMap.get(key);
        if (!chunkCanvas) {
          chunkCanvas = bakeChunk(cx, cy, data, tileW, tileH);
          playChunkMap.set(key, chunkCanvas);
        }
        ctx.drawImage(
          chunkCanvas,
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

    // PASS 4: PLAYER
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

            const microW = width * CHUNK_SIZE;
            const microH = height * CHUNK_SIZE;
            const getT = (tx, ty) => getMicroTile(tx, ty, data);

            // Usa validScatterOriginMicro (que já checa formal trees e overlaps a Oeste)
            // para garantir que se o Base não desenha, o Top também não desenha.
            if (validScatterOriginMicro(mx, my, data.seed, microW, microH, getT)) {
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

        // 3. (Dynamic Pass) Grass and Cactus Bases
        const gv = getGrassVariant(tile.biomeId);
        const gTiles = GRASS_TILES[gv];
        const { scale: gs, threshold: gt } = getGrassParams(tile.biomeId);
        
        if (gTiles && foliageDensity(mx, my, data.seed, gs) >= gt && !tile.isRoad && !tile.isCity) {
           // ENFORCE FLAT GROUND (same as bakeChunk)
           let isFlat = true;
           const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
           if (setForRole) {
              const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= tile.heightStep;
              if (getRoleForCell(my, mx, data.height*CHUNK_SIZE, data.width*CHUNK_SIZE, checkAtOrAbove, setForRole.type) !== 'CENTER') isFlat = false;
           }

           if (isFlat) {
              // Exclusion check (no grass under formal trees)
              const trType = getTreeType(tile.biomeId);
              const isFT = !!trType && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
              const isFN = !!trType && (mx + my) % 3 === 1 && foliageDensity(mx-1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
              
              if (!isFT && !isFN) {
                 const fType = seededHash(mx, my, data.seed + 9993);
                 let baseId = (gv === 'desert' && fType < 0.5) ? gTiles.cactusBase : gTiles.original;
                 
                 if (baseId != null) {
                    const fIdx = AnimationRenderer.getFrameIndex(time, mx, my);
                    const frame = AnimationRenderer.getWindFrame(natureImg, baseId, fIdx, TCOLS_NATURE);
                    if (frame) {
                       ctx.drawImage(frame, snapPx(tx), snapPx(ty - tileH), tileW, tileH * 2); 
                    }
                 }
              }
           }
        }
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
        const vt = getGrassVariant(tile.biomeId);
        const vTiles = GRASS_TILES[vt];
        const { scale: vs, threshold: vt_th } = getGrassParams(tile.biomeId);
        if (vTiles && foliageDensity(mx, my, data.seed, vs) >= vt_th && !tile.isRoad && !tile.isCity) {
           const fType = foliageType(mx, my, data.seed);
           let topId = (vt === 'desert' && fType < 0.5) ? vTiles.cactusTop : vTiles.originalTop;
           
           if (topId) {
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
               const fIdx = AnimationRenderer.getFrameIndex(time, mx, my);
               const frame = AnimationRenderer.getWindFrame(natureImg, topId, fIdx, TCOLS_NATURE);
               if (frame) {
                   ctx.drawImage(frame, snapPx(tx), snapPx(ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX), tileW, tileH * 2); 
               }
             }
           }
        }

        // 4. Urban Roofs (Deterministic)
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
                            let isRoof = tile.urbanBuilding.type.includes('pokecenter') ? (r < 3) : (r < 2);
                            if (isRoof) {
                                let drawId = null;
                                if (tile.urbanBuilding.type.includes('pokecenter')) {
                                    if (r === 0) drawId = 0 + c;
                                    else if (r === 1) drawId = 15 + c;
                                    else if (r === 2) drawId = 30 + c;
                                } else if (tile.urbanBuilding.type.includes('mart')) {
                                    if (r === 0) drawId = 20 + c;
                                    else if (r === 1) drawId = 35 + c;
                                } else { // House
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

  for (let level = 0; level <= LAND_STEPS; level++) {
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        const tile = getCachedTile(mx, my);
        if (!tile || tile.heightStep < level) continue;

        // 1.1 Render Base Layer (BIOME)
        const biomeSetName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
        const biomeSet = TERRAIN_SETS[biomeSetName];
        if (biomeSet) {
          const imgPath = TessellationEngine.getImagePath(biomeSet.file);
          const img = imageCache.get(imgPath);
          const cols = imgPath.includes('caves') ? 50 : 57;
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
                  const fCols = imgPath.includes('caves') ? 50 : 57;
                  const fRole = getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, isFoliageSafeAt, foliageSet.type);
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
            const cols = imgPath.includes('caves') ? 50 : 57;
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
              const cols = imgPath.includes('caves') ? 50 : 57;
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
        const treeType = getTreeType(tile.biomeId);
        const isFT = !!treeType && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        const isFN = !!treeType && (mx + my) % 3 === 1 && foliageDensity(mx-1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        
        if (!isFT && !isFN) {
           const fType = foliageType(mx, my, data.seed);
           let baseId = (variant === 'desert' && fType < 0.5) ? tiles.cactusBase : tiles.original;
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

      const treeType = getTreeType(tile.biomeId);
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

  return canvas;
}
