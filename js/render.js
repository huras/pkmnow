import { BIOMES } from './biomes.js';

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
 * @param {{ hover?: {x: number, y: number} }} [options]
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

  // Cache de cores de bioma
  const biomeColors = Object.values(BIOMES).reduce((acc, b) => {
    acc[b.id] = b.color;
    return acc;
  }, {});

  // 1. Desenha Terreno
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const bId = biomes[idx];
      
      // Cor do Bioma
      ctx.fillStyle = biomeColors[bId] || '#f0f';
      ctx.fillRect(
        Math.floor(x * tileW),
        Math.floor(y * tileH),
        Math.ceil(tileW),
        Math.ceil(tileH),
      );

      // Decoração procedural simples
      if (bId === BIOMES.FOREST.id || bId === BIOMES.JUNGLE.id || bId === BIOMES.TAIGA.id) {
          // Pequenos triângulos (árvores)
          ctx.fillStyle = 'rgba(0,0,0,0.1)';
          ctx.beginPath();
          ctx.moveTo(x * tileW + tileW*0.5, y * tileH + tileH*0.2);
          ctx.lineTo(x * tileW + tileW*0.2, y * tileH + tileH*0.8);
          ctx.lineTo(x * tileW + tileW*0.8, y * tileH + tileH*0.8);
          ctx.fill();
      } else if (bId === BIOMES.DESERT.id) {
          // Pontinhos (areia)
          ctx.fillStyle = 'rgba(0,0,0,0.1)';
          ctx.fillRect(x * tileW + tileW*0.3, y * tileH + tileH*0.4, 2, 2);
          ctx.fillRect(x * tileW + tileW*0.6, y * tileH + tileH*0.7, 2, 2);
      }
    }
  }

  // 2. Desenha Caminhos (Fase 2.3 Refinamento: Linhas Contínuas e Importance-aware)
  if (paths && paths.length > 0) {
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

  if (!hasGraph) return;

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
