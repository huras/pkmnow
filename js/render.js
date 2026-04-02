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
import { getMicroTile, CHUNK_SIZE, LAND_STEPS, WATER_STEPS, foliageDensity, foliageType } from './chunking.js';

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
          const setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
          const set = TERRAIN_SETS[setName];
          if (set) {
            const imgPath = TessellationEngine.getImagePath(set.file), img = imageCache.get(imgPath);
            const isAtOrAbove = (r, c) => (getCached(c, r)?.heightStep ?? -99) >= level;
            const role = getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, isAtOrAbove, set.type);
            if (tile.heightStep > level && role === 'CENTER') continue;
            const tileId = set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
            const cols = imgPath.includes('caves') ? 50 : 57;
            if (img && tileId != null) ctx.drawImage(img, (tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16, Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
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

          // 1. Formal Trees Detection
          const isFormalTree = (mx, my) => (mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
          const isFormalNeighbor = (mx, my) => (mx + my) % 3 === 1 && foliageDensity(mx-1, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
          const isFormalOccupied = isFormalTree(mx, my) || isFormalNeighbor(mx, my);
          
          let occupiedByScatter = false;
          let drawnScatterOrigin = false;

          // 2. Scatter Base Check (Mutual Exclusion with Formal Trees)
          const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
          if (scatterItems.length > 0 && !tile.isRoad && !tile.isCity) {
             // Check if THIS tile is the origin of a scatter item
             if (!isFormalOccupied && foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82) {
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
                      basePart.ids.forEach((id, idx) => drawTile16(id, Math.floor(mx * tileW) + (idx % cols) * tileW, Math.floor(my * tileH), 0));
                      drawnScatterOrigin = true;
                      occupiedByScatter = true;
                    }
                  }
                }
             }
             // Check if tile is occupied by a scatter to the left
             if (!drawnScatterOrigin) {
               for (let dox = 1; dox <= 3; dox++) {
                 const nx = mx - dox;
                 const nTile = getCached(nx, my);
                 if (nTile && foliageDensity(nx, my, data.seed + 111, 2.5) > 0.82 && !nTile.isRoad) {
                   const nItemKey = scatterItems[Math.floor(seededHash(nx, my, data.seed + 222) * scatterItems.length)];
                   const nObjSet = OBJECT_SETS[nItemKey];
                   if (nObjSet) {
                     const { cols } = parseShape(nObjSet.shape);
                     // If scatter from left covers this tile, and didn't collide with formal there
                     let nCanSpawn = true; 
                     for(let ox=0; ox<cols; ox++) { if (isFormalTree(nx+ox, my) || isFormalNeighbor(nx+ox, my)) { nCanSpawn = false; break; } }
                     if (nCanSpawn && dox < cols) { occupiedByScatter = true; break; }
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
            if (variant === 'desert') {
              drawTile16(fType >= 0.5 ? tiles.cactusBase : tiles.original, Math.floor(mx * tileW), Math.floor(my * tileH), 0);
            } else {
              const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.12;
              drawTile16(fType < 0.5 ? tiles.original : (tiles.grass2 || tiles.original), Math.floor(mx * tileW), Math.floor(my * tileH), angle);
            }
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
        if (foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) < TREE_DENSITY_THRESHOLD) continue;
        const right = getCached(mx+1, my);
        if (!right || right.heightStep !== tile.heightStep) continue;
        const treeType = getTreeType(tile.biomeId), ids = TREE_TILES[treeType];
        if (!ids) continue;
        const tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH), tw = Math.ceil(tileW), th = Math.ceil(tileH);
        const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI*2) * 0.08;
        drawTile16(ids.base[0], tx, ty); drawTile16(ids.base[1], tx + tw, ty); // Redraw base for layering
        ctx.save(); ctx.translate(tx + tw, ty + 1); ctx.rotate(angle);
        ctx.drawImage(natureImg, (ids.top[0]%TCOLS)*16, Math.floor(ids.top[0]/TCOLS)*16, 16, 16, -tw, -th, tw, th);
        ctx.drawImage(natureImg, (ids.top[1]%TCOLS)*16, Math.floor(ids.top[1]/TCOLS)*16, 16, 16, 0, -th, tw, th);
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
        const tw = Math.ceil(tileW), th = Math.ceil(tileH), tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH);

        // 1. Scatter Tops (Palms/Mangroves correct columns)
        const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
        if (scatterItems.length > 0 && foliageDensity(mx, my, data.seed + 111, 2.5) > 0.82 && !tile.isRoad) {
          const itemKey = scatterItems[Math.floor(seededHash(mx, my, data.seed + 222) * scatterItems.length)];
          const objSet = OBJECT_SETS[itemKey];
          if (objSet) {
            const topPart = objSet.parts.find(p => p.role === 'top' || p.role === 'tops');
            if (topPart) {
              const { rows, cols } = parseShape(objSet.shape);
              const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.12;
              const topRows = Math.ceil(topPart.ids.length / cols);
              ctx.save(); ctx.translate(tx + (cols * tw)/2, ty + 1); ctx.rotate(angle);
              topPart.ids.forEach((id, idx) => {
                const ox = idx % cols, oy = Math.floor(idx / cols), drawY = -(topRows - oy) * th;
                ctx.drawImage(natureImg, (id % TCOLS) * 16, Math.floor(id / TCOLS) * 16, 16, 16, (ox * tw) - (cols * tw)/2, drawY, tw, th);
              });
              ctx.restore();
            }
          }
        }

        // 2. Formal Tree Tops
        if ((mx + my) % 3 === 0 && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
           const treeType = getTreeType(tile.biomeId), ids = TREE_TILES[treeType];
           if (ids && getCached(mx+1, my)?.heightStep === tile.heightStep) {
             const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI*2) * 0.08;
             ctx.save(); ctx.translate(tx + tw, ty + 1); ctx.rotate(angle);
             ctx.drawImage(natureImg, (ids.top[2]%TCOLS)*16, Math.floor(ids.top[2]/TCOLS)*16, 16, 16, -tw, -th*2, tw, th);
             ctx.drawImage(natureImg, (ids.top[3]%TCOLS)*16, Math.floor(ids.top[3]/TCOLS)*16, 16, 16, 0, -th*2, tw, th);
             ctx.restore();
           }
        }

        // 3. Cactus Top
        if (tile.biomeId === BIOMES.DESERT.id && foliageDensity(mx, my, data.seed, GRASS_NOISE_SCALE) >= GRASS_DENSITY_THRESHOLD) {
          const angle = Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.12;
          const fType = foliageType(mx, my, data.seed);
          const topId = (fType >= 0.5) ? GRASS_TILES.desert.cactusTop : (GRASS_TILES.desert.original - 57);
          ctx.save(); ctx.translate(tx + tw/2, ty + 1); ctx.rotate(angle);
          ctx.drawImage(natureImg, (topId % TCOLS) * 16, Math.floor(topId / TCOLS) * 16, 16, 16, -tw/2, -th, tw, th);
          ctx.restore();
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
