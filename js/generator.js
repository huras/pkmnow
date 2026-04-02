import { createRng, stringToSeed } from './rng.js';
import { generateWorldGraph, calculateImportance } from './graph.js';
import { findPath } from './pathfind.js';

/**
 * Aceita número finito (unsigned) ou string (hash FNV).
 * @param {string|number} input
 * @returns {number} seed efetiva 32-bit
 */
export function normalizeSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input >>> 0;
  }
  const s = String(input).trim();
  if (s === '') return stringToSeed('default');
  if (/^\d+$/.test(s)) {
    return Number(s) >>> 0;
  }
  return stringToSeed(s);
}

/**
 * Gera um grid de "ruído" simples (Value Noise 2D) para terreno.
 */
function generateTerrain(rng, w, h) {
  const cells = new Float32Array(w * h);
  const scale = 8;
  const controlW = Math.ceil(w / scale) + 1;
  const controlH = Math.ceil(h / scale) + 1;
  const controls = new Float32Array(controlW * controlH);
  for (let i = 0; i < controls.length; i++) controls[i] = rng.next();

  function lerp(a, b, t) {
    const ft = t * Math.PI;
    const f = (1 - Math.cos(ft)) * 0.5;
    return a * (1 - f) + b * f;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;

      const v00 = controls[iy * controlW + ix];
      const v10 = controls[iy * controlW + (ix + 1)];
      const v01 = controls[(iy + 1) * controlW + ix];
      const v11 = controls[(iy + 1) * controlW + (ix + 1)];

      const top = lerp(v00, v10, fx);
      const bottom = lerp(v01, v11, fx);
      cells[y * w + x] = lerp(top, bottom, fy);
    }
  }
  return cells;
}

/**
 * Fase 2.3: Centralidade de Grafo + Orçamento de Infraestutura.
 */
export function generate(seedInput) {
  const seed = normalizeSeed(seedInput);
  const rng = createRng(seed);
  const width = 32;
  const height = 32;
  
  const cells = generateTerrain(rng, width, height);
  const graph = generateWorldGraph(rng, width, height, cells, {
    cityCount: 14,
    gymCount: 8,
    margin: 2,
    extraEdges: 3,
  });

  // 1. Calcula importância das arestas (Centralidade)
  const importanceMap = calculateImportance(graph.nodes, graph.edges);
  
  // 2. Anexa importância ao objeto de aresta e ordena
  const getEdgeKey = (u, v) => [u, v].sort((a,b) => a-b).join(',');
  const sortedEdges = [...graph.edges].map(e => ({
    ...e,
    importance: importanceMap.get(getEdgeKey(e.u, e.v)) || 1
  })).sort((a, b) => b.importance - a.importance);

  // 3. Pathfinding Dinâmico com Orçamento
  const workingCosts = new Float32Array(cells);
  const roadTraffic = new Uint8Array(width * height);
  const paths = [];

  for (const edge of sortedEdges) {
    const startNode = graph.nodes[edge.u];
    const endNode = graph.nodes[edge.v];
    
    // Orçamentando: rotas importantes têm mais verba para pontes (menor waterCostBase)
    // Se importância for 20 (máxima aprox), custo cai para ~3.6. Se for 1, fica em ~26.
    // Vamos usar uma curva que garanta que rotas secundárias ainda custem caro.
    const waterCostBase = Math.max(5, 40 / (1 + (edge.importance - 1) * 0.15));

    const p = findPath(
      startNode.x, startNode.y, 
      endNode.x, endNode.y, 
      width, height, 
      workingCosts, 
      waterCostBase
    );
    
    if (p) {
      // Guardamos a importância no próprio path para o renderizador usar
      p.importance = edge.importance;
      paths.push(p);

      // Pavimenta o caminho
      for (const cell of p) {
        const idx = cell.y * width + cell.x;
        roadTraffic[idx]++;
        workingCosts[idx] = 0.05; 
      }
    }
  }

  return {
    version: 1,
    phase: 2.3,
    seed,
    width,
    height,
    cells,
    graph,
    paths,
    roadTraffic,
  };
}
