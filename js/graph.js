/**
 * Grafo de mundo: cidades (nós) e rotas (arestas).
 * Garante conectividade via MST + validação BFS e reparo defensivo.
 */

/**
 * @typedef {{ id: number, x: number, y: number }} GraphNode
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

/**
 * Coloca cidades em células inteiras do grid, sem sobreposição.
 * @param {{ next: () => number }} rng
 * @param {number} gridW
 * @param {number} gridH
 * @param {number} count
 * @param {number} margin
 * @returns {GraphNode[]}
 */
export function placeCityNodes(rng, gridW, gridH, count, margin) {
  const used = new Set();
  const nodes = [];
  const spanW = Math.max(1, gridW - 2 * margin);
  const spanH = Math.max(1, gridH - 2 * margin);

  for (let id = 0; id < count; id++) {
    let x = margin;
    let y = margin;
    let placed = false;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      x = margin + Math.floor(rng.next() * spanW);
      y = margin + Math.floor(rng.next() * spanH);
      const key = y * gridW + x;
      if (!used.has(key)) {
        used.add(key);
        placed = true;
      }
    }
    if (!placed) {
      for (let yy = margin; yy < gridH - margin && !placed; yy++) {
        for (let xx = margin; xx < gridW - margin && !placed; xx++) {
          const key = yy * gridW + xx;
          if (!used.has(key)) {
            used.add(key);
            x = xx;
            y = yy;
            placed = true;
          }
        }
      }
    }
    nodes.push({ id, x, y });
  }
  return nodes;
}

/**
 * Quadrado da distância euclidiana (inteira).
 */
function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * MST (Kruskal): prioriza arestas curtas com jitter do RNG (rotas mais “locais”).
 * @param {GraphNode[]} nodes
 * @param {{ next: () => number }} rng
 * @returns {GraphEdge[]}
 */
export function minimumSpanningTree(nodes, rng) {
  const n = nodes.length;
  if (n <= 1) return [];

  const cand = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distSq(nodes[i], nodes[j]);
      const w = d + rng.next();
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
 * Adiciona arestas extras aleatórias (ciclos), sem duplicata.
 * @param {GraphEdge[]} base
 * @param {number} nodeCount
 * @param {{ next: () => number }} rng
 * @param {number} extraCount
 * @returns {GraphEdge[]}
 */
export function addRandomChordEdges(base, nodeCount, rng, extraCount) {
  const set = new Set(base.map((e) => edgeKey(e.u, e.v)));
  const out = base.slice();
  let guard = 0;
  const maxGuard = extraCount * 200;
  while (out.length - base.length < extraCount && guard < maxGuard) {
    guard++;
    const u = Math.floor(rng.next() * nodeCount);
    let v = Math.floor(rng.next() * nodeCount);
    if (v === u) continue;
    const k = edgeKey(u, v);
    if (set.has(k)) continue;
    set.add(k);
    out.push({ u, v });
  }
  return out;
}

/**
 * Se o grafo estiver desconexo, liga componentes com arestas baratas entre pares de nós.
 * @param {GraphNode[]} nodes
 * @param {GraphEdge[]} edges
 * @returns {GraphEdge[]}
 */
export function repairConnectivity(nodes, edges) {
  const n = nodes.length;
  if (n <= 1) return edges.slice();

  let current = edges.slice();
  let guard = 0;
  while (!isConnected(n, current) && guard < n * n) {
    guard++;
    const adj = buildAdjacency(n, current);
    const comp = new Int32Array(n);
    comp.fill(-1);
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
 * @param {{ cityCount?: number, margin?: number, extraEdges?: number }} [opts]
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[], connected: boolean }}
 */
export function generateWorldGraph(rng, gridW, gridH, opts = {}) {
  const margin = opts.margin ?? 2;
  const cityCount = Math.min(
    opts.cityCount ?? 7,
    Math.max(2, (gridW - 2 * margin) * (gridH - 2 * margin)),
  );
  const extraEdges = opts.extraEdges ?? 2;

  const nodes = placeCityNodes(rng, gridW, gridH, cityCount, margin);
  let edges = minimumSpanningTree(nodes, rng);
  edges = addRandomChordEdges(edges, nodes.length, rng, extraEdges);
  edges = repairConnectivity(nodes, edges);

  return {
    nodes,
    edges,
    connected: isConnected(nodes.length, edges),
  };
}
