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
 */
export function render(canvas, data) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data) return;

  const { width, height, cells, paths } = data;
  const cw = canvas.width;
  const ch = canvas.height;
  const tileW = cw / width;
  const tileH = ch / height;
  const graph = data.graph;
  const hasGraph = !!(graph && graph.nodes?.length);

  // Fundo limpo
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cw, ch);

  // 1. Desenha Terreno
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = cells[y * width + x];
      
      // Cores simples: [0, 0.3) água, [0.3, 0.7) grama, [0.7, 1.0] montanha
      let r, g, b;
      if (v < 0.3) {
        // Águia (tons de azul)
        r = 30 + v * 50;
        g = 100 + v * 100;
        b = 200 + v * 55;
      } else if (v < 0.7) {
        // Grama (tons de verde)
        r = 60 + v * 40;
        g = 140 + v * 60;
        b = 40 + v * 40;
      } else {
        // Montanha (tons de marrom/cinza)
        r = 100 + v * 80;
        g = 90 + v * 70;
        b = 70 + v * 60;
      }

      ctx.fillStyle = `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
      ctx.fillRect(
        Math.floor(x * tileW),
        Math.floor(y * tileH),
        Math.ceil(tileW),
        Math.ceil(tileH),
      );
    }
  }

  // 2. Desenha Caminhos (Corredores de Rota)
  if (paths && paths.length > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'; // Cor da "estrada"
    for (const p of paths) {
      for (const cell of p) {
        ctx.fillRect(
          Math.floor(cell.x * tileW),
          Math.floor(cell.y * tileH),
          Math.ceil(tileW),
          Math.ceil(tileH),
        );
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
    
    ctx.fillStyle = '#ff5b5b'; // Cidades em vermelho (tipo Centro Pokémon)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, nodeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.shadowBlur = 0;
  }
}
