import { BIOMES } from './biomes.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell, seededHash, seededHashInt, parseShape } from './tessellation-logic.js';
import { BIOME_TO_TERRAIN, BIOME_VEGETATION } from './biome-tiles.js';

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
  const tileW = cw / width;
  const tileH = ch / height;
  const graph = data.graph;
  const hasGraph = !!(graph && graph.nodes?.length);

  // Fundo limpo
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cw, ch);

  const viewType = options.settings?.viewType || 'biomes';
  const overlayPaths = options.settings?.overlayPaths ?? true;
  const overlayGraph = options.settings?.overlayGraph ?? true;

  // Cache de cores de bioma
  const biomeColors = Object.values(BIOMES).reduce((acc, b) => {
    acc[b.id] = b.color;
    return acc;
  }, {});

  // 1. Desenha Terreno
  const isLandAt = (r, c) => {
    if (r < 0 || r >= height || c < 0 || c >= width) return false;
    // Simplificado: terra é qualquer coisa que não seja oceano para fins de borda
    return biomes[r * width + c] !== BIOMES.OCEAN.id;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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
        // VIEW: BIOMES (Usando Tilesets se disponíveis)
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
            const sSize = 16; // Supondo 16px base, pode variar no tileset
            
            ctx.drawImage(
              img,
              tx * sSize, ty * sSize, sSize, sSize,
              Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH)
            );
          }
        } else {
          // Fallback cores solidas
          ctx.fillStyle = biomeColors[bId] || '#f0f';
          ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
        }

        // Camada de Vegetação (Scatter)
        if (viewType === 'biomes' && imageCache.size > 0) {
          const vegList = BIOME_VEGETATION[bId];
          if (vegList && seededHash(x, y, data.seed + 123) < 0.15) {
             const vegName = vegList[seededHashInt(x, y, data.seed + 456) % vegList.length];
             const obj = OBJECT_SETS[vegName];
             if (obj) {
                const imgPath = TessellationEngine.getImagePath(obj.file);
                const img = imageCache.get(imgPath);
                const { rows: objH, cols: objW } = parseShape(obj.shape);
                const cols = imgPath.includes('caves') ? 50 : 57;
                
                // Desenha apenas se for 1x1 por enquanto para simplificar o render loop
                if (objH === 1 && objW === 1 && img) {
                   const tId = obj.parts[0].ids[0];
                   const tx = tId % cols;
                   const ty = Math.floor(tId / cols);
                   ctx.drawImage(
                     img,
                     tx * 16, ty * 16, 16, 16,
                     Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH)
                   );
                }
             }
          }
        }
      }
    }
  }

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
    ctx.beginPath();
    ctx.moveTo((a.x + 0.5) * tileW, (a.y + 0.5) * tileH);
    ctx.lineTo((b.x + 0.5) * tileW, (b.y + 0.5) * tileH);
    ctx.stroke();
  }

  // 4. Desenha Cidades (Nós)
  const nodeR = Math.max(4, Math.min(tileW, tileH) * 0.42);
  for (const n of nodes) {
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

  // 5. Highlight de Hover
  if (options.hover) {
    const { x, y } = options.hover;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.floor(x * tileW),
      Math.floor(y * tileH),
      Math.ceil(tileW),
      Math.ceil(tileH),
    );
  }
}
