import { BIOMES } from './biomes.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell, seededHash, seededHashInt, parseShape } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN, BIOME_VEGETATION,
  GRASS_TILES, TREE_TILES,
  getGrassVariant, getTreeType,
  GRASS_DENSITY_THRESHOLD, TREE_DENSITY_THRESHOLD,
  GRASS_NOISE_SCALE, TREE_NOISE_SCALE
} from './biome-tiles.js';
import { getMicroTile, CHUNK_SIZE, LAND_STEPS, WATER_STEPS, foliageDensity, foliageType, elevationToStep } from './chunking.js';

const imageCache = new Map();

export async function loadTilesetImages() {
  const sources = [
    'tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png',
    'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png'
  ];
  
  const promises = sources.map(src => {
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
    ctx.translate(Math.floor(cw/2 - (vx + 0.5) * tileW), Math.floor(ch/2 - (vy + 0.5) * tileH));
    
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
    const time = options.settings?.time || 0;
    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    const TCOLS = 57;

    const drawTile16 = (tileId, px, py, rotation) => {
      if (!natureImg || tileId == null || tileId < 0) return;
      const tx = (tileId % TCOLS) * 16, ty = Math.floor(tileId / TCOLS) * 16;
      if (rotation) {
        ctx.save(); ctx.translate(px + tileW/2, py + tileH); ctx.rotate(rotation);
        ctx.drawImage(natureImg, tx, ty, 16, 16, -tileW/2, -tileH, Math.ceil(tileW), Math.ceil(tileH));
        ctx.restore();
      } else {
        ctx.drawImage(natureImg, tx, ty, 16, 16, px, py, Math.ceil(tileW), Math.ceil(tileH));
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
              ctx.drawImage(img, (tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16, Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
            }
          }
        }
      }
    }

    // PASS 2: BASES (Veggie Trunks / Scatter Bases)
    if (natureImg) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1) continue;

          // NO VEGETATION ON CLIFFS (Borders / Roles other than CENTER)
          const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
          if (setForRole) {
            const checkAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= tile.heightStep;
            const role = getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, checkAtOrAbove, setForRole.type);
            if (role !== 'CENTER') continue;
          }

          // 1. Formal Trees Detection (BIOME AWARE)
          const treeType_check = getTreeType(tile.biomeId);
          const isFormalTree = (mx, my) => !!treeType_check && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
          const isFormalNeighbor = (mx, my) => !!treeType_check && (mx + my) % 3 === 1 && foliageDensity(mx-1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
          const isFormalOccupied = isFormalTree(mx, my) || isFormalNeighbor(mx, my);
          
          let occupiedByScatter = false;
          let drawnScatterOrigin = false;

          // 2. Scatter Base Check (Mutual Exclusion with Formal Trees AND other Scatter)
          const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
          if (scatterItems.length > 0 && !tile.isRoad && !tile.isCity) {
             // 2A. Check FIRST if tile is occupied by a scatter to the left
             for (let dox = 1; dox <= 3; dox++) {
               const nx = mx - dox;
               const nTile = getCached(nx, my);
               if (nTile && foliageDensity(nx, my, data.seed + 111, 2.5) > 0.82 && !nTile.isRoad) {
                 const nItemKey = scatterItems[Math.floor(seededHash(nx, my, data.seed + 222) * scatterItems.length)];
                 const nObjSet = OBJECT_SETS[nItemKey];
                 if (nObjSet) {
                   const { cols } = parseShape(nObjSet.shape);
                   if (dox < cols) { occupiedByScatter = true; break; }
                 }
               }
             }

             // 2B. Check if THIS tile is the origin of a NEW scatter item (ONLY if not occupied)
             if (!isFormalOccupied && !occupiedByScatter && foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82) {
                const itemKey = scatterItems[Math.floor(seededHash(mx, my, data.seed + 222) * scatterItems.length)];
                const objSet = OBJECT_SETS[itemKey];
                if (objSet) {
                  const { cols } = parseShape(objSet.shape);
                  // Ensure NO part of this scatter object overlaps a formal tree
                  let canSpawn = true;
                  for(let ox=0; ox<cols; ox++) {
                    if (isFormalTree(mx+ox, my) || isFormalNeighbor(mx+ox, my)) { canSpawn = false; break; }
                  }
                  
                  if (canSpawn) {
                    const basePart = objSet.parts.find(p => p.role === 'base' || p.role === 'CENTER');
                    if (basePart) {
                      const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.04;
                      basePart.ids.forEach((id, idx) => drawTile16(id, Math.floor(mx * tileW) + (idx % cols) * tileW, Math.floor(my * tileH), angle));
                      drawnScatterOrigin = true;
                      occupiedByScatter = true;
                    }
                  }
                }
             }
          }

          if (isFormalOccupied || occupiedByScatter) continue;

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

    // PASS 3: FORMAL TREE TOPS (Behind/Above Player Logic)
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
        drawTile16(ids.base[0], tx, ty, angle); drawTile16(ids.base[1], tx + tw, ty, angle); // Redraw base for layering
        ctx.save(); ctx.translate(tx + tw, ty + th); ctx.rotate(angle);
        ctx.drawImage(natureImg, (ids.top[0]%TCOLS)*16, Math.floor(ids.top[0]/TCOLS)*16, 16, 16, -tw, -th * 2, tw, th);
        ctx.drawImage(natureImg, (ids.top[1]%TCOLS)*16, Math.floor(ids.top[1]/TCOLS)*16, 16, 16, 0, -th * 2, tw, th);
        ctx.restore();
      }
    }

    // PASS 4: PLAYER
    const vx = player.visualX ?? player.x, vy = player.visualY ?? player.y;
    const pcx = Math.floor((vx + 0.5) * tileW), pcy = Math.floor((vy + 0.5) * tileH);
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
                const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.04;
                const topRows = Math.ceil(topPart.ids.length / cols);
                ctx.save(); ctx.translate(tx + (cols * tw)/2, ty + th); ctx.rotate(angle);
                topPart.ids.forEach((id, idx) => {
                  const ox = idx % cols, oy = Math.floor(idx / cols), drawY = -(topRows - oy + 1) * th;
                  ctx.drawImage(natureImg, (id % TCOLS) * 16, Math.floor(id / TCOLS) * 16, 16, 16, (ox * tw) - (cols * tw)/2, drawY, tw, th);
                });
                ctx.restore();
              }
            }
          }
        }

        // 2. Formal Tree Tops
        const treeType = getTreeType(tile.biomeId);
        if (treeType && (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
           const ids = TREE_TILES[treeType];
           if (ids && getCached(mx+1, my)?.heightStep === tile.heightStep) {
             const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI*2) * 0.04;
             ctx.save(); ctx.translate(tx + tw, ty + th); ctx.rotate(angle);
             ctx.drawImage(natureImg, (ids.top[2]%TCOLS)*16, Math.floor(ids.top[2]/TCOLS)*16, 16, 16, -tw, -th * 3, tw, th);
             ctx.drawImage(natureImg, (ids.top[3]%TCOLS)*16, Math.floor(ids.top[3]/TCOLS)*16, 16, 16, 0, -th * 3, tw, th);
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
             
             let occupiedByScatter = false;
             const items = BIOME_VEGETATION[tile.biomeId] || [];
             if (items.length > 0) {
               if (!(isFT || isFN) && foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82) {
                 occupiedByScatter = true;
               } else {
                 for (let dox = 1; dox <= 3; dox++) {
                   const nx = mx - dox;
                   const nTile = getCached(nx, my);
                   if (nTile && foliageDensity(nx, my, data.seed + 111, 2.5) > 0.82) {
                     const nItem = items[Math.floor(seededHash(nx, my, data.seed + 222) * items.length)];
                     const nObj = OBJECT_SETS[nItem];
                     if (nObj) {
                       const { cols: nCols } = parseShape(nObj.shape);
                       let nCanSpawn = true;
                       const nTreeType = getTreeType(nTile.biomeId);
                       for(let ox=0; ox<nCols; ox++) {
                         const tx_chk = nx+ox;
                         const isFT_chk = !!nTreeType && (tx_chk + my) % 3 === 0 && foliageDensity(tx_chk, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
                         const isFN_chk = !!nTreeType && (tx_chk + my) % 3 === 1 && foliageDensity(tx_chk - 1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
                         if (isFT_chk || isFN_chk) { nCanSpawn = false; break; }
                       }
                       if (nCanSpawn && dox < nCols) { occupiedByScatter = true; break; }
                     }
                   }
                 }
               }
             }

             if (!isFT && !isFN && !occupiedByScatter) {
               const isCactus = (variant === 'desert' && fType >= 0.5) || (variant === 'dirt' && tiles.originalTop);
               const intensity = isCactus ? 0.07 : 0.12;
               const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * intensity;
               ctx.save(); ctx.translate(tx + tw/2, ty + th); ctx.rotate(angle);
               ctx.drawImage(natureImg, (topId % TCOLS) * 16, Math.floor(topId / TCOLS) * 16, 16, 16, -tw/2, -th * 2, tw, th);
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
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
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
