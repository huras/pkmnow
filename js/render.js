import { BIOMES } from './biomes.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell, seededHash, seededHashInt, parseShape } from './tessellation-logic.js';
import { BIOME_TO_TERRAIN, BIOME_VEGETATION } from './biome-tiles.js';
import { getMicroTile, CHUNK_SIZE } from './chunking.js';

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
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   width: number,
 *   height: number,
 *   cells: Float32Array,
 *   graph?: { nodes: Array<{ id: number, x: number, y: number }>, edges: Array<{ u: number, v: number }> },
 *   paths?: Array<Array<{x: number, y: number}>>
 * } | null} data
 * @param {{ hover?: {x: number, y: number}, settings?: { viewType: string, overlayPaths: boolean, overlayGraph: boolean } }} [options]
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
    tileW = 40; // Zoom
    tileH = 40;
    const cx = cw / 2;
    const cy = ch / 2;
    const px = (player.x + 0.5) * tileW;
    const py = (player.y + 0.5) * tileH;
    ctx.translate(Math.floor(cx - px), Math.floor(cy - py));
    
    // Frustum Culling em espaço MICRO
    const txRadius = Math.ceil((cw / tileW) / 2) + 1;
    const tyRadius = Math.ceil((ch / tileH) / 2) + 1;
    startX = Math.max(0, player.x - txRadius);
    startY = Math.max(0, player.y - tyRadius);
    endX = Math.min(width * CHUNK_SIZE, player.x + txRadius);
    endY = Math.min(height * CHUNK_SIZE, player.y + tyRadius);
  } else {
    tileW = cw / width;
    tileH = ch / height;
  }

  // Cache de cores de bioma
  const biomeColors = Object.values(BIOMES).reduce((acc, b) => {
    acc[b.id] = b.color;
    return acc;
  }, {});

  // 1. Desenha Terreno
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
  } else {
    // ==== PLAY MODE: MICRO GRID OTIMIZADO ====
    const isLandAtMicro = (r, c) => {
      // Evitar saídas do mapa
      if (r < 0 || r >= height * CHUNK_SIZE || c < 0 || c >= width * CHUNK_SIZE) return false;
      return getMicroTile(c, r, data).biomeId !== BIOMES.OCEAN.id;
    };

    for (let my = startY; my < endY; my++) {
      for (let mx = startX; mx < endX; mx++) {
        const tile = getMicroTile(mx, my, data);
        const bId = tile.biomeId;
        
        if (viewType === 'elevation') {
          const val = tile.elevation;
          const colorVal = Math.floor(Math.max(0, Math.min(1, val)) * 255);
          ctx.fillStyle = val < 0.3 ? `rgb(0, 0, ${colorVal})` : `rgb(${colorVal}, ${colorVal}, ${colorVal})`;
          ctx.fillRect(Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
        } else {
          const setName = BIOME_TO_TERRAIN[bId];
          const set = TERRAIN_SETS[setName];
          
          if (set && imageCache.size > 0) {
            const imgPath = TessellationEngine.getImagePath(set.file);
            const img = imageCache.get(imgPath);
            if (img) {
              const role = getRoleForCell(my, mx, height * CHUNK_SIZE, width * CHUNK_SIZE, isLandAtMicro, set.type);
              const tileId = set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
              const cols = imgPath.includes('caves') ? 50 : 57;
              const tx = tileId % cols;
              const ty = Math.floor(tileId / cols);
              ctx.drawImage(img, tx * 16, ty * 16, 16, 16, Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
            }
          } else {
            ctx.fillStyle = biomeColors[bId] || '#f0f';
            ctx.fillRect(Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
          }

          // Scatter Dinâmico da Vegetação (Densidade menor no Micro-Grid)
          if (imageCache.size > 0) {
            const vegList = BIOME_VEGETATION[bId];
            if (vegList && seededHash(mx, my, data.seed + 123) < 0.05) {
               const vegName = vegList[seededHashInt(mx, my, data.seed + 456) % vegList.length];
               const obj = OBJECT_SETS[vegName];
               if (obj) {
                  const imgPath = TessellationEngine.getImagePath(obj.file);
                  const img = imageCache.get(imgPath);
                  const { rows: objH, cols: objW } = parseShape(obj.shape);
                  const cols = imgPath.includes('caves') ? 50 : 57;
                  
                  if (objH === 1 && objW === 1 && img) {
                     const tId = obj.parts[0].ids[0];
                     const tx = tId % cols;
                     const ty = Math.floor(tId / cols);
                     ctx.drawImage(img, tx * 16, ty * 16, 16, 16, Math.floor(mx * tileW), Math.floor(my * tileH), Math.ceil(tileW), Math.ceil(tileH));
                  }
               }
            }
          }
        }
      }
    }
  }

  // Apenas renderizar caminhos/grafos no modo Mapa para evitar bagunça no Zoom
  if (appMode === 'map') {
    // 2. Desenha Caminhos (Fase 2.3 Refinamento: Linhas Contínuas e Importance-aware)
  if (overlayPaths && paths && paths.length > 0) {
    const traffic = data.roadTraffic;
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const p of paths) {
      // Importância da rota (de 1 a ~20+)
      const imp = p.importance || 1;
      
      for (let i = 0; i < p.length - 1; i++) {
        const p1 = p[i];
        const p2 = p[i+1];
        // Culling simples de linha
        if ((p1.x < startX && p2.x < startX) || (p1.x > endX && p2.x > endX) ||
            (p1.y < startY && p2.y < startY) || (p1.y > endY && p2.y > endY)) {
            continue;
        }
        const idx = p1.y * width + p1.x;
        const count = traffic ? traffic[idx] : 1;
        const v = cells[idx];
        const isWater = v < 0.3;

        ctx.beginPath();
        ctx.moveTo((p1.x + 0.5) * tileW, (p1.y + 0.5) * tileH);
        ctx.lineTo((p2.x + 0.5) * tileW, (p2.y + 0.5) * tileH);

        // Lógica Visual baseada em importância e tráfego
        // imp: importância teórica da rota
        // count: quantas rotas reais passam por esta célula
        const isHighway = imp > 5 || count >= 2;

        if (isWater) {
          // Visual de PONTE
          ctx.strokeStyle = isHighway ? 'rgba(80, 50, 40, 1)' : 'rgba(121, 85, 72, 0.7)';
          ctx.lineWidth = isHighway ? 7 : 4;
        } else {
          // Visual de ESTRADA
          ctx.strokeStyle = isHighway ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = isHighway ? 6 : 3;
        }
        
        ctx.stroke();

        // Camada interna para detalhe
        if (!isWater) {
          ctx.beginPath();
          ctx.moveTo((p1.x + 0.5) * tileW, (p1.y + 0.5) * tileH);
          ctx.lineTo((p2.x + 0.5) * tileW, (p2.y + 0.5) * tileH);
          ctx.strokeStyle = isHighway ? 'rgba(180, 180, 180, 0.8)' : 'rgba(200, 200, 200, 0.2)';
          ctx.lineWidth = isHighway ? 2 : 1;
          ctx.stroke();
        }
      }
    }
  }

  if (!hasGraph || !overlayGraph) return;

  // 3. Desenha Arestas do Grafo (Overlay Abstrato)
  const { nodes, edges } = graph;
  ctx.strokeStyle = 'rgba(255, 214, 120, 0.25)'; // Mais sutil agora que temos caminhos reais
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const e of edges) {
    const a = nodes[e.u];
    const b = nodes[e.v];
    if ((a.x < startX && b.x < startX) || (a.x > endX && b.x > endX) ||
        (a.y < startY && b.y < startY) || (a.y > endY && b.y > endY)) continue;
    ctx.beginPath();
    ctx.moveTo((a.x + 0.5) * tileW, (a.y + 0.5) * tileH);
    ctx.lineTo((b.x + 0.5) * tileW, (b.y + 0.5) * tileH);
    ctx.stroke();
  }

  // 4. Desenha Cidades (Nós)
  const nodeR = Math.max(4, Math.min(tileW, tileH) * 0.42);
  for (const n of nodes) {
    if (n.x < startX || n.x >= endX || n.y < startY || n.y >= endY) continue;
    const cx = (n.x + 0.5) * tileW;
    const cy = (n.y + 0.5) * tileH;
    
    // Sombra do nó
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    
    // Estilo baseado no tipo (Fase 2 Refinamento)
    const isGym = !!n.isGym;
    const r = isGym ? nodeR * 1.2 : nodeR;
    
    ctx.fillStyle = isGym ? '#ffd700' : '#ff5b5b'; // Dourado (Gym) vs Vermelho (Town)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = isGym ? 3 : 2;
    
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Pequeno detalhe no centro para o Ginásio
    if (isGym) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowBlur = 0;
  }

  // 4.5 Desenha Landmarks (POIs)
  if (data.landmarks) {
    for (const lm of data.landmarks) {
      if (lm.x < startX || lm.x >= endX || lm.y < startY || lm.y >= endY) continue;
      const cx = (lm.x + 0.5) * tileW;
      const cy = (lm.y + 0.5) * tileH;
      const r = Math.max(3, Math.min(tileW, tileH) * 0.35);

      ctx.shadowBlur = 4;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      
      // Cor baseada no tipo para diversificar (usando hash mod)
      const colorHash = lm.type.length * 15 % 360;
      ctx.fillStyle = `hsl(${colorHash}, 80%, 60%)`;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      // Forma de diamante
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
    }
  }
} // Fim de if (appMode === 'map')

  // 5. Highlight de Hover (apenas Modo Mapa)
  if (options.hover && appMode === 'map') {
    const { x, y } = options.hover;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.floor(x * tileW),
      Math.floor(y * tileH),
      Math.ceil(tileW),
      Math.ceil(tileH)
    );
  }

  // 6. Desenha Jogador (se no modo play)
  if (appMode === 'play') {
    const cx = Math.floor((player.x + 0.5) * tileW);
    const cy = Math.floor((player.y + 0.5) * tileH);

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + tileH*0.3, tileW*0.3, tileH*0.15, 0, 0, Math.PI*2);
    ctx.fill();

    // Sprite Simplificado (Boneco Estilo Red)
    ctx.fillStyle = '#ff2222'; // Camisa vermelha
    ctx.fillRect(cx - tileW*0.2, cy - tileH*0.1, tileW*0.4, tileH*0.3);
    
    ctx.fillStyle = '#3355ee'; // Calça azul
    ctx.fillRect(cx - tileW*0.2, cy + tileH*0.2, tileW*0.15, tileH*0.2); // Perna E
    ctx.fillRect(cx + tileW*0.05, cy + tileH*0.2, tileW*0.15, tileH*0.2); // Perna D
    
    ctx.fillStyle = '#ffccaa'; // Pele (rosto e braços)
    ctx.fillRect(cx - tileW*0.2, cy - tileH*0.4, tileW*0.4, tileH*0.3); // Rosto
    ctx.fillRect(cx - tileW*0.3, cy - tileH*0.1, tileW*0.1, tileH*0.2); // Braço E
    ctx.fillRect(cx + tileW*0.2, cy - tileH*0.1, tileW*0.1, tileH*0.2); // Braço D
    
    ctx.fillStyle = '#ffffff'; // Boné aba branca
    ctx.fillRect(cx - tileW*0.25, cy - tileH*0.4, tileW*0.5, tileH*0.1);
    ctx.fillStyle = '#ff2222'; // Boné topo
    ctx.fillRect(cx - tileW*0.2, cy - tileH*0.5, tileW*0.4, tileH*0.15);
  }

  // 7. Atualiza Minimapa se aplicável
  if (appMode === 'play') {
     const minimapCanvas = document.getElementById('minimap');
     if (minimapCanvas) {
         renderMinimap(minimapCanvas, data, player);
     }
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
  
  // Desenha biomas básicos no minimapa
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const idx = y * data.width + x;
      const bId = data.biomes[idx];
      const bColor = [...Object.values(BIOMES)].find(b => b.id === bId)?.color || '#000';
      ctx.fillStyle = bColor;
      ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
    }
  }
  
  // Como o player agora está em micro-space (2048x2048), ajustamos pro macro-space do mapa original (128)
  const macroPx = player.x / CHUNK_SIZE;
  const macroPy = player.y / CHUNK_SIZE;
  
  // Desenha ponto do jogador no minimapa
  ctx.fillStyle = '#ff0000';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc((macroPx + 0.5) * tileW, (macroPy + 0.5) * tileH, Math.max(3, tileW*2), 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
}
