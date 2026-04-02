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

/**
 * Desenha dados já gerados — não conhece RNG nem algoritmos de mundo.
 */
export function render(canvas, data, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data) return;

  const { width, height, cells, biomes, paths } = data;
  const cw = canvas.width;
  const ch = canvas.height;
  const graph = data.graph;
  const hasGraph = !!(graph && graph.nodes?.length);

  const appMode = options.settings?.appMode || 'map';
  const player = options.settings?.player || {x:0, y:0};

  // Fundo limpo
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cw, ch);

  const viewType = options.settings?.viewType || 'biomes';
  const overlayPaths = options.settings?.overlayPaths ?? true;
  const overlayGraph = options.settings?.overlayGraph ?? true;

  let tileW, tileH;
  let startX = 0, startY = 0, endX = width, endY = height;

  if (appMode === 'play') {
    tileW = 40; 
    tileH = 40;
    const cx = cw / 2;
    const cy = ch / 2;
    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;
    const px = (vx + 0.5) * tileW;
    const py = (vy + 0.5) * tileH;
    ctx.translate(Math.floor(cx - px), Math.floor(cy - py));
    
    const txRadius = Math.ceil((cw / tileW) / 2) + 2;
    const tyRadius = Math.ceil((ch / tileH) / 2) + 2;
    startX = Math.max(0, Math.floor(vx) - txRadius);
    startY = Math.max(0, Math.floor(vy) - tyRadius);
    endX = Math.min(width * CHUNK_SIZE, Math.floor(vx) + txRadius);
    endY = Math.min(height * CHUNK_SIZE, Math.floor(vy) + tyRadius);
  } else {
    tileW = cw / width;
    tileH = ch / height;
  }

  const biomeColors = Object.values(BIOMES).reduce((acc, b) => {
    acc[b.id] = b.color;
    return acc;
  }, {});

  if (appMode === 'map') {
    const isLandAt = (r, c) => {
      if (r < 0 || r >= height || c < 0 || c >= width) return false;
      return biomes[r * width + c] !== BIOMES.OCEAN.id;
    };
    
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = y * width + x;
        const bId = biomes[idx];
        
        if (viewType === 'elevation') {
          const val = cells[idx];
          const colorVal = Math.floor(Math.max(0, Math.min(1, val)) * 255);
          ctx.fillStyle = val < 0.3 ? `rgb(0, 0, ${colorVal})` : `rgb(${colorVal}, ${colorVal}, ${colorVal})`;
          ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
        } else if (viewType === 'moisture') {
          const moist = data.moisture ? data.moisture[idx] : 0;
          const colorVal = Math.floor(Math.max(0, Math.min(1, moist)) * 255);
          ctx.fillStyle = `rgb(${255 - colorVal}, ${255 - colorVal}, 255)`;
          ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
        } else {
          const setName = BIOME_TO_TERRAIN[bId];
          const set = TERRAIN_SETS[setName];
          if (set && imageCache.size > 0) {
            const imgPath = TessellationEngine.getImagePath(set.file);
            const img = imageCache.get(imgPath);
            if (img) {
              const role = getRoleForCell(y, x, height, width, isLandAt, set.type);
              const tileId = set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
              const cols = imgPath.includes('caves') ? 50 : 57;
              const tx = tileId % cols;
              const ty = Math.floor(tileId / cols);
              ctx.drawImage(img, tx * 16, ty * 16, 16, 16, Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
            }
          } else {
            ctx.fillStyle = biomeColors[bId] || '#f0f';
            ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
          }
        }
      }
    }

    if (overlayPaths && paths && paths.length > 0) {
      const traffic = data.roadTraffic;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const p of paths) {
        const imp = p.importance || 1;
        for (let i = 0; i < p.length - 1; i++) {
          const p1 = p[i], p2 = p[i+1];
          if ((p1.x < startX && p2.x < startX) || (p1.x > endX && p2.x > endX) ||
              (p1.y < startY && p2.y < startY) || (p1.y > endY && p2.y > endY)) continue;
          const idx = p1.y * width + p1.x;
          const isHighway = imp > 5 || (traffic && traffic[idx] >= 2);
          ctx.beginPath();
          ctx.moveTo((p1.x + 0.5) * tileW, (p1.y + 0.5) * tileH);
          ctx.lineTo((p2.x + 0.5) * tileW, (p2.y + 0.5) * tileH);
          if (cells[idx] < 0.3) {
            ctx.strokeStyle = isHighway ? 'rgba(80, 50, 40, 1)' : 'rgba(121, 85, 72, 0.7)'; ctx.lineWidth = isHighway ? 7 : 4;
          } else {
            ctx.strokeStyle = isHighway ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.4)'; ctx.lineWidth = isHighway ? 6 : 3;
          }
          ctx.stroke();
        }
      }
    }

    if (hasGraph && overlayGraph) {
      const { nodes, edges } = graph;
      ctx.strokeStyle = 'rgba(255, 214, 120, 0.25)'; ctx.lineWidth = 1;
      for (const e of edges) {
        const a = nodes[e.u], b = nodes[e.v];
        if ((a.x < startX && b.x < startX) || (a.x > endX && b.x > endX) ||
            (a.y < startY && b.y < startY) || (a.y > endY && b.y > endY)) continue;
        ctx.beginPath(); ctx.moveTo((a.x + 0.5) * tileW, (a.y + 0.5) * tileH);
        ctx.lineTo((b.x + 0.5) * tileW, (b.y + 0.5) * tileH); ctx.stroke();
      }
    }

    if (hasGraph) {
      const nodeR = Math.max(4, Math.min(tileW, tileH) * 0.42);
      for (const n of graph.nodes) {
        if (n.x < startX || n.x >= endX || n.y < startY || n.y >= endY) continue;
        const cx = (n.x + 0.5) * tileW, cy = (n.y + 0.5) * tileH;
        const isGym = !!n.isGym;
        const r = isGym ? nodeR * 1.2 : nodeR;
        ctx.fillStyle = isGym ? '#ffd700' : '#ff5b5b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = isGym ? 3 : 2;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    if (data.landmarks) {
      for (const lm of data.landmarks) {
        if (lm.x < startX || lm.x >= endX || lm.y < startY || lm.y >= endY) continue;
        const cx = (lm.x + 0.5) * tileW, cy = (lm.y + 0.5) * tileH, r = Math.max(3, Math.min(tileW, tileH) * 0.35);
        ctx.fillStyle = `hsl(${lm.type.length * 15 % 360}, 80%, 60%)`; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  } else {
    // ==== PLAY MODE: MULTI-PASS LAYERED RENDERER ====
    const time = options.settings?.time || 0;
    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    const TCOLS = 57;

    const drawTile16 = (tileId, px, py, rotation) => {
      if (!natureImg || tileId < 0) return;
      const tx = tileId % TCOLS, ty = Math.floor(tileId / TCOLS);
      if (rotation) {
        ctx.save(); ctx.translate(px + tileW / 2, py + tileH + 1); ctx.rotate(rotation);
        ctx.drawImage(natureImg, tx * 16, ty * 16, 16, 16, -tileW / 2, -tileH, Math.ceil(tileW), Math.ceil(tileH));
        ctx.restore();
      } else {
        ctx.drawImage(natureImg, tx * 16, ty * 16, 16, 16, px, py, Math.ceil(tileW), Math.ceil(tileH));
      }
    };

    const vw = endX - startX, vh = endY - startY;
    const tileCache = new Array(vw * vh);
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        tileCache[(my - startY) * vw + (mx - startX)] = getMicroTile(mx, my, data);
      }
    }
    const getCached = (mx, my) => (mx < startX || mx >= endX || my < startY || my >= endY) ? null : tileCache[(my - startY) * vw + (mx - startX)];
    const getStep = (mx, my) => getCached(mx, my)?.heightStep ?? -WATER_STEPS - 1;

    // PASS 0: WATER
    const waterDepthTints = ['#bbddff', '#88aaff', '#5588cc', '#4477bb', '#3366aa'];
    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        const tile = getCached(mx, my);
        if (tile && tile.heightStep < 0) {
          ctx.fillStyle = waterDepthTints[Math.min(WATER_STEPS - 1, Math.abs(tile.heightStep) - 1)] || '#3366aa';
          ctx.fillRect(Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
        }
      }
    }

    // PASS 1-N: TERRAIN
    for (let level = 0; level <= LAND_STEPS; level++) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < level) continue;
          const setName = BIOME_TO_TERRAIN[tile.biomeId];
          const set = TERRAIN_SETS[setName];
          if (set && natureImg) {
            const isAtLevel = (r, c) => getCached(c, r)?.heightStep >= level;
            const role = getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, isAtLevel, set.type);
            if (tile.heightStep > level && role === 'CENTER') continue;
            const tileId = set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
            if (tileId != null) {
              const imgPath = TessellationEngine.getImagePath(set.file);
              const img = imageCache.get(imgPath);
              if (img) ctx.drawImage(img, (tileId % (imgPath.includes('caves') ? 50 : TCOLS)) * 16, Math.floor(tileId / (imgPath.includes('caves') ? 50 : TCOLS)) * 16, 16, 16, Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
            }
          }
        }
      }
    }

    // PASS GRASS
    if (natureImg) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1 || tile.isCity || tile.isRoad) continue;
          
          // Evitar grama onde tem pé de árvore (2x1 base)
          const isTreeHere = (mx, my) => {
            if ((mx + my) % 3 !== 0) return false;
            if (foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) < TREE_DENSITY_THRESHOLD) return false;
            const t = getCached(mx, my), r = getCached(mx + 1, my);
            return (t && r && t.heightStep >= 1 && r.heightStep === t.heightStep && !t.isRoad && !t.isCity && !r.isRoad && !r.isCity);
          };
          if (isTreeHere(mx, my) || isTreeHere(mx - 1, my)) continue;

          const h = tile.heightStep;
          if ([[-1,0],[1,0],[0,-1],[0,1]].some(([dx, dy]) => getStep(mx+dx, my+dy) !== h)) continue;
          const variant = getGrassVariant(tile.biomeId);
          if (!variant) continue;
          const tiles = GRASS_TILES[variant];
          if (!tiles || foliageDensity(mx, my, data.seed, GRASS_NOISE_SCALE) < GRASS_DENSITY_THRESHOLD) continue;
          const fType = foliageType(mx, my, data.seed);
          const grassId = variant === 'desert' ? (fType < 0.5 ? tiles.original : tiles.cactusBase) : (variant === 'dirt' ? (fType < 0.33 ? tiles.small : (fType < 0.66 ? tiles.mushroom : tiles.dryGrass)) : (fType < 0.33 ? tiles.small : (fType < 0.66 ? tiles.grass2 : tiles.original)));
          drawTile16(grassId, Math.floor(mx * tileW), Math.floor(my * tileH), Math.sin(time * 2.5 + mx * 0.3 + my * 0.7) * 0.12);
        }
      }
    }

    // PASS 4.5: TREES BEHIND PLAYER
    const pRow = Math.floor(player.visualY ?? player.y);
    if (natureImg) {
      for (let my = startY; my < endY; my++) {
        if (my >= pRow) continue;
        for (let mx = startX; mx < endX; mx++) {
          if ((mx + my) % 3 !== 0) continue;
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1 || tile.isCity || tile.isRoad) continue;
          const h = tile.heightStep;
          if ([[-1,0],[1,0],[0,-1],[0,1]].some(([dx, dy]) => getStep(mx+dx, my+dy) !== h)) continue;
          const treeType = getTreeType(tile.biomeId);
          const ids = treeType ? TREE_TILES[treeType] : null;
          if (ids && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
            const right = getCached(mx + 1, my);
            if (right && right.heightStep === h && !right.isRoad && !right.isCity) {
              const tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH), tw = Math.ceil(tileW), th = Math.ceil(tileH);
              drawTile16(ids.base[0], tx, ty, 0); drawTile16(ids.base[1], tx + tw, ty, 0);
              const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI*2) * 0.08;
              ctx.save(); ctx.translate(tx + tw, ty + 1); ctx.rotate(angle);
              ctx.drawImage(natureImg, (ids.top[0]%TCOLS)*16, Math.floor(ids.top[0]/TCOLS)*16, 16, 16, -tw, -th, tw, th);
              ctx.drawImage(natureImg, (ids.top[1]%TCOLS)*16, Math.floor(ids.top[1]/TCOLS)*16, 16, 16, 0, -th, tw, th);
              ctx.restore();
            }
          }
        }
      }
    }

    // PASS 5: PLAYER
    const vx = player.visualX ?? player.x, vy = player.visualY ?? player.y;
    const pcx = Math.floor((vx + 0.5) * tileW), pcy = Math.floor((vy + 0.5) * tileH);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(pcx, pcy + tileH*0.3, tileW*0.3, tileH*0.15, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ff2222'; ctx.fillRect(pcx - tileW*0.2, pcy - tileH*0.1, tileW*0.4, tileH*0.3);
    ctx.fillStyle = '#3355ee'; ctx.fillRect(pcx - tileW*0.2, pcy + tileH*0.2, tileW*0.15, tileH*0.2); ctx.fillRect(pcx + tileW*0.05, pcy + tileH*0.2, tileW*0.15, tileH*0.2);
    ctx.fillStyle = '#ffccaa'; ctx.fillRect(pcx - tileW*0.2, pcy - tileH*0.4, tileW*0.4, tileH*0.3); ctx.fillRect(pcx - tileW*0.3, pcy - tileH*0.1, tileW*0.1, tileH*0.2); ctx.fillRect(pcx + tileW*0.2, pcy - tileH*0.1, tileW*0.1, tileH*0.2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(pcx - tileW*0.25, pcy - tileH*0.4, tileW*0.5, tileH*0.1);
    ctx.fillStyle = '#ff2222'; ctx.fillRect(pcx - tileW*0.2, pcy - tileH*0.5, tileW*0.4, tileH*0.15);

    // PASS 5.5: TREES IN FRONT OF PLAYER
    if (natureImg) {
      for (let my = startY; my < endY; my++) {
        if (my < pRow) continue;
        for (let mx = startX; mx < endX; mx++) {
          if ((mx + my) % 3 !== 0) continue;
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1 || tile.isCity || tile.isRoad) continue;
          const h = tile.heightStep;
          if ([[-1,0],[1,0],[0,-1],[0,1]].some(([dx, dy]) => getStep(mx+dx, my+dy) !== h)) continue;
          const treeType = getTreeType(tile.biomeId);
          const ids = treeType ? TREE_TILES[treeType] : null;
          if (ids && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
            const right = getCached(mx + 1, my);
            if (right && right.heightStep === h && !right.isRoad && !right.isCity) {
              const tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH), tw = Math.ceil(tileW), th = Math.ceil(tileH);
              drawTile16(ids.base[0], tx, ty, 0); drawTile16(ids.base[1], tx + tw, ty, 0);
              const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI*2) * 0.08;
              ctx.save(); ctx.translate(tx + tw, ty + 1); ctx.rotate(angle);
              ctx.drawImage(natureImg, (ids.top[0]%TCOLS)*16, Math.floor(ids.top[0]/TCOLS)*16, 16, 16, -tw, -th, tw, th);
              ctx.drawImage(natureImg, (ids.top[1]%TCOLS)*16, Math.floor(ids.top[1]/TCOLS)*16, 16, 16, 0, -th, tw, th);
              ctx.restore();
            }
          }
        }
      }
    }

    // PASS 6.5: TREE TOPS (Always Above)
    if (natureImg) {
      for (let my = startY; my < endY; my++) {
        for (let mx = startX; mx < endX; mx++) {
          if ((mx + my) % 3 !== 0) continue;
          const tile = getCached(mx, my);
          if (!tile || tile.heightStep < 1 || tile.isCity || tile.isRoad) continue;
          const h = tile.heightStep;
          if ([[-1,0],[1,0],[0,-1],[0,1]].some(([dx, dy]) => getStep(mx+dx, my+dy) !== h)) continue;
          const treeType = getTreeType(tile.biomeId);
          const ids = treeType ? TREE_TILES[treeType] : null;
          if (ids && foliageDensity(mx, my, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
            const right = getCached(mx + 1, my);
            if (right && right.heightStep === h && !right.isRoad && !right.isCity) {
              const tx = Math.floor(mx * tileW), ty = Math.floor(my * tileH), tw = Math.ceil(tileW), th = Math.ceil(tileH);
              const angle = Math.sin(time * 1.5 + seededHash(mx, my, data.seed + 9999) * Math.PI*2) * 0.08;
              ctx.save(); ctx.translate(tx + tw, ty + 1); ctx.rotate(angle);
              ctx.drawImage(natureImg, (ids.top[2]%TCOLS)*16, Math.floor(ids.top[2]/TCOLS)*16, 16, 16, -tw, -th*2, tw, th);
              ctx.drawImage(natureImg, (ids.top[3]%TCOLS)*16, Math.floor(ids.top[3]/TCOLS)*16, 16, 16, 0, -th*2, tw, th);
              ctx.restore();
            }
          }
        }
      }
    }

    const minimapCanvas = document.getElementById('minimap');
    if (minimapCanvas) renderMinimap(minimapCanvas, data, player);
  }

  if (options.hover && appMode === 'map') {
    const { x, y } = options.hover;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
  }

  ctx.restore();
}

/**
 * Renderiza uma versão do minimapa no modo Play
 */
function renderMinimap(canvas, data, player) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
  
  const tileW = w / data.width;
  const tileH = h / data.height;
  
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const idx = y * data.width + x;
      const bId = data.biomes[idx];
      const bColor = [...Object.values(BIOMES)].find(b => b.id === bId)?.color || '#000';
      ctx.fillStyle = bColor;
      ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
    }
  }
  
  const macroPx = player.x / CHUNK_SIZE;
  const macroPy = player.y / CHUNK_SIZE;
  
  ctx.fillStyle = '#ff0000';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc((macroPx + 0.5) * tileW, (macroPy + 0.5) * tileH, Math.max(3, tileW*2), 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
}
