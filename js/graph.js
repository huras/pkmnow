/**
 * Grafo de mundo: cidades (nós) e rotas (arestas).
 * Garante conectividade via MST + validação BFS e reparo defensivo.
 */

import { DEFAULT_WATER_LEVEL } from './biomes.js';

/**
 * @typedef {{ id: number, x: number, y: number, isGym: boolean }} GraphNode
 * @typedef {{ u: number, v: number }} GraphEdge
 */

/**
 * @param {number} n
 * @param {GraphEdge[]} edges
 * @returns {number[][]} lista de adjacência
 */
function buildAdjacency(n, edges) {
  const adj = Array.from({ length: n }, () => []);
  for (const { u, v } of edges) {
    adj[u].push(v);
    adj[v].push(u);
  }
  return adj;
}

/**
 * BFS a partir do nó 0.
 * @param {number} nodeCount
 * @param {GraphEdge[]} edges
 * @returns {boolean}
 */
export function isConnected(nodeCount, edges) {
  if (nodeCount <= 1) return true;
  const adj = buildAdjacency(nodeCount, edges);
  const seen = new Uint8Array(nodeCount);
  const q = [0];
  seen[0] = 1;
  let visited = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = 1;
        visited++;
        q.push(v);
      }
    }
  }
  return visited === nodeCount;
}

function edgeKey(u, v) {
  return u < v ? `${u},${v}` : `${v},${u}`;
}

/** Distância Manhattan mínima entre duas cidades (regra “≥ 5 tiles”). */
const MIN_MANHATTAN_BETWEEN_CITIES = 5;

function manhattanOkFromAll(x, y, existing) {
  for (const n of existing) {
    if (Math.abs(n.x - x) + Math.abs(n.y - y) < MIN_MANHATTAN_BETWEEN_CITIES) {
      return false;
    }
  }
  return true;
}

/**
 * Coloca cidades em células de terra, com Manhattan ≥ 5 entre pares (com fallbacks).
 * @param {{ next: () => number }} rng
 * @param {number} gridW
 * @param {number} gridH
 * @param {number} count
 * @param {number} margin
 * @param {Float32Array} terrainCells - elevação; terra se ≥ waterLevel
 * @param {number} [waterLevel] - alinhado ao gerador (água abaixo disto); default = `DEFAULT_WATER_LEVEL`
 * @returns {GraphNode[]}
 */
export function placeCityNodes(rng, gridW, gridH, count, margin, terrainCells, waterLevel = DEFAULT_WATER_LEVEL) {
  const nodes = [];
  const spanW = Math.max(1, gridW - 2 * margin);
  const spanH = Math.max(1, gridH - 2 * margin);

  const isLandAt = (x, y) => {
    const idx = y * gridW + x;
    return terrainCells[idx] >= waterLevel;
  };

  for (let id = 0; id < count; id++) {
    let bestX = -1;
    let bestY = -1;
    let placed = false;

    for (let attempt = 0; attempt < 500 && !placed; attempt++) {
      const x = margin + Math.floor(rng.next() * spanW);
      const y = margin + Math.floor(rng.next() * spanH);
      if (!isLandAt(x, y)) continue;
      if (!manhattanOkFromAll(x, y, nodes)) continue;
      bestX = x;
      bestY = y;
      placed = true;
    }

    if (!placed) {
      for (let yy = margin; yy < gridH - margin && !placed; yy++) {
        for (let xx = margin; xx < gridW - margin && !placed; xx++) {
          if (!isLandAt(xx, yy)) continue;
          if (!manhattanOkFromAll(xx, yy, nodes)) continue;
          bestX = xx;
          bestY = yy;
          placed = true;
        }
      }
    }

    if (!placed) {
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const x = margin + Math.floor(rng.next() * spanW);
        const y = margin + Math.floor(rng.next() * spanH);
        if (!isLandAt(x, y)) continue;
        if (!nodes.some((n) => n.x === x && n.y === y)) {
          bestX = x;
          bestY = y;
          placed = true;
        }
      }
    }

    if (!placed) {
      for (let yy = margin; yy < gridH - margin && !placed; yy++) {
        for (let xx = margin; xx < gridW - margin && !placed; xx++) {
          if (!isLandAt(xx, yy)) continue;
          if (!nodes.some((n) => n.x === xx && n.y === yy)) {
            bestX = xx;
            bestY = yy;
            placed = true;
          }
        }
      }
    }

    if (placed) {
      nodes.push({ id, x: bestX, y: bestY, isGym: false });
    }
  }
  return nodes;
}

/**
 * Quadrado da distância euclidiana.
 */
function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * MST (Kruskal): prioriza arestas curtas com jitter do PRNG.
 */
export function minimumSpanningTree(nodes, rng) {
  const n = nodes.length;
  if (n <= 1) return [];

  const cand = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distSq(nodes[i], nodes[j]);
      const w = d + rng.next() * 2; // Pequeno jitter
      cand.push({ u: i, v: j, w });
    }
  }
  cand.sort((a, b) => a.w - b.w);

  const parent = nodes.map((_, i) => i);
  function find(i) {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) return false;
    parent[ri] = rj;
    return true;
  }

  const mst = [];
  for (const e of cand) {
    if (union(e.u, e.v)) {
      mst.push({ u: e.u, v: e.v });
      if (mst.length === n - 1) break;
    }
  }
  return mst;
}

/**
 * Adiciona arestas extras aleatórias (ciclos).
 */
export function addRandomChordEdges(base, nodeCount, rng, extraCount) {
  if (nodeCount < 3) return base.slice();
  const set = new Set(base.map((e) => edgeKey(e.u, e.v)));
  const out = base.slice();
  let guard = 0;
  const maxGuard = extraCount * 100;
  while (out.length - base.length < extraCount && guard < maxGuard) {
    guard++;
    const u = Math.floor(rng.next() * nodeCount);
    const v = Math.floor(rng.next() * nodeCount);
    if (v === u) continue;
    const k = edgeKey(u, v);
    if (set.has(k)) continue;
    
    // Opcional: só adiciona se não for muito longe (ex: dist < 12)
    set.add(k);
    out.push({ u, v });
  }
  return out;
}

/**
 * Reparo de conectividade.
 */
export function repairConnectivity(nodes, edges) {
  const n = nodes.length;
  if (n <= 1) return edges.slice();

  let current = edges.slice();
  let guard = 0;
  while (!isConnected(n, current) && guard < n * n) {
    guard++;
    const adj = buildAdjacency(n, current);
    const comp = new Int32Array(n).fill(-1);
    let c = 0;
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1) continue;
      const q = [s];
      comp[s] = c;
      for (let qi = 0; qi < q.length; qi++) {
        const u = q[qi];
        for (const v of adj[u]) {
          if (comp[v] === -1) {
            comp[v] = c;
            q.push(v);
          }
        }
      }
      c++;
    }
    if (c <= 1) break;

    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (comp[i] === comp[j]) continue;
        const d = distSq(nodes[i], nodes[j]);
        if (d < bestD) {
          bestD = d;
          best = { u: i, v: j };
        }
      }
    }
    if (best) current.push(best);
  }
  return current;
}

/**
 * @param {{ next: () => number }} rng
 * @param {number} gridW
 * @param {number} gridH
 * @param {Float32Array} terrainCells
 * @param {{ cityCount?: number, gymCount?: number, margin?: number, extraEdges?: number, waterLevel?: number }} [opts]
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[], connected: boolean }}
 */
export function generateWorldGraph(rng, gridW, gridH, terrainCells, opts = {}) {
  const margin = opts.margin ?? 2;
  const cityCount = opts.cityCount ?? 14;
  const gymCount = opts.gymCount ?? 8;
  const extraEdges = opts.extraEdges ?? 3;
  const waterLevel = opts.waterLevel ?? DEFAULT_WATER_LEVEL;

  // 1. Posicionamento: terra (elevação) + Manhattan ≥ 5 entre cidades
  const nodes = placeCityNodes(rng, gridW, gridH, cityCount, margin, terrainCells, waterLevel);
  
  // 2. Atribuição de Ginásios (8 Gyms, o resto Towns)
  // Sorteia índices únicos para serem ginásios
  const indices = nodes.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  for (let i = 0; i < Math.min(gymCount, nodes.length); i++) {
    nodes[indices[i]].isGym = true;
  }

  // 3. Conectividade
  let edges = minimumSpanningTree(nodes, rng);
  edges = addRandomChordEdges(edges, nodes.length, rng, extraEdges);
  edges = repairConnectivity(nodes, edges);

  return {
    nodes,
    edges,
    connected: isConnected(nodes.length, edges),
  };
}

/**
 * Calcula a centralidade de intermediação das arestas (Edge Betweenness Centrality) no grafo.
 * Identifica quais arestas são mais importantes para a conectividade regional.
 */
export function calculateImportance(nodes, edges) {
  const importance = new Map();
  
  // Inicializa o mapa de importância para cada aresta
  const getEdgeKey = (u, v) => [u, v].sort((a,b) => a-b).join(',');
  edges.forEach(e => importance.set(getEdgeKey(e.u, e.v), 1)); // Base de 1 para evitar divisão por zero

  // Para cada par de nós, encontramos o caminho mais curto topológico
  for (let s = 0; s < nodes.length; s++) {
    const distances = new Array(nodes.length).fill(Infinity);
    const predecessors = new Array(nodes.length).fill(null).map(() => []);
    const queue = [s];
    distances[s] = 0;

    let head = 0;
    while(head < queue.length) {
      const u = queue[head++];
      const neighbors = edges
        .filter(e => e.u === u || e.v === u)
        .map(e => e.u === u ? e.v : e.u);

      for (const v of neighbors) {
        if (distances[v] === Infinity) {
          distances[v] = distances[u] + 1;
          predecessors[v].push(u);
          queue.push(v);
        } else if (distances[v] === distances[u] + 1) {
          predecessors[v].push(u);
        }
      }
    }

    for (let t = 0; t < nodes.length; t++) {
      if (s === t) continue;
      const stack = [t];
      const visited = new Set();
      while(stack.length > 0) {
        const curr = stack.pop();
        for (const pred of predecessors[curr]) {
          const key = getEdgeKey(curr, pred);
          importance.set(key, importance.get(key) + 1);
          if (!visited.has(pred)) {
            stack.push(pred);
            visited.add(pred);
          }
        }
      }
    }
  }

  return importance;
}
