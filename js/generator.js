import { createRng, stringToSeed } from './rng.js';
import { generateWorldGraph } from './graph.js';
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
 * Fase 2: grid macro (Value Noise) + pathfinding A* entre cidades.
 *
 * @param {string|number} seedInput
 * @returns {{ version: number, phase: number, seed: number, width: number, height: number, cells: Float32Array, graph: Object, paths: Array<Array<{x: number, y: number}>> }}
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

  // 3. Pathfinding Dinâmico (Fase 2.2: Highway Splicing)
  // Criamos um mapa de custos de trabalho que será alterado conforme as estradas são "pavimentadas"
  const workingCosts = new Float32Array(cells);
  const roadTraffic = new Uint8Array(width * height);
  const paths = [];

  for (const edge of graph.edges) {
    const startNode = graph.nodes[edge.u];
    const endNode = graph.nodes[edge.v];
    const p = findPath(startNode.x, startNode.y, endNode.x, endNode.y, width, height, workingCosts);
    
    if (p) {
      paths.push(p);
      // Cada célula usada por este caminho agora fica "barata" para os próximos
      for (const cell of p) {
        const idx = cell.y * width + cell.x;
        roadTraffic[idx]++;
        workingCosts[idx] = 0.05; // Custo de "estrada pronta" (baixíssimo)
      }
    }
  }

  return {
    version: 1,
    phase: 2.2,
    seed,
    width,
    height,
    cells,
    graph,
    paths,
    roadTraffic,
  };
}
