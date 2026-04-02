import { createRng, stringToSeed } from './rng.js';
import { generateWorldGraph, calculateImportance } from './graph.js';
import { findPath } from './pathfind.js';
import { getBiome, BIOMES } from './biomes.js';
import { applyMorphologicalCleanup } from './tessellation-logic.js';
import { generateCityName, generateRouteName } from './names.js';
import { placeLandmarks } from './landmarks.js';

/**
 * Aceita número finito (unsigned) ou string (hash FNV).
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
 * Gera um grid de "ruído" simples (Value Noise 2D).
 */
function generateNoiseMap(rng, w, h, scale) {
  const cells = new Float32Array(w * h);
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
 * Fase 4.0: Identidade e Landmarks.
 */
export function generate(seedInput) {
  const seedSnapshot = normalizeSeed(seedInput);
  const rng = createRng(seedSnapshot);
  const width = 128;
  const height = 128;
  
  // Mapas de Ruído (Escalas subindo junto com a resolução)
  const elevation = generateNoiseMap(rng, width, height, 24);
  const temperature = generateNoiseMap(rng, width, height, 32);
  const moisture = generateNoiseMap(rng, width, height, 28);
  const anomaly = generateNoiseMap(rng, width, height, 20); // Ruído de Misticismo

  // Mapeamento de Biomas com Pós-processamento de Anomalias
  const biomes = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const e = elevation[i];
    const t = temperature[i];
    const m = moisture[i];
    const a = anomaly[i];
    
    let biomeObj = getBiome(e, t, m);

    // Regras de Anomalia (Ideia 1 + 2)
    if (a > 0.7) {
      if (e > 0.8 && t > 0.6) {
        biomeObj = BIOMES.VOLCANO;
      } else if (m > 0.7 && t < 0.4) {
        biomeObj = BIOMES.GHOST_WOODS;
      } else if (a > 0.9 && e < 0.5) {
        biomeObj = BIOMES.ARCANE;
      }
    }

    biomes[i] = biomeObj.id;
  }

  // Pós-processamento de Morfologia: Evitar tiles isolados que quebram o autotiler
  // de 13 papéis. Rodamos um cleanup básico na terra.
  const isLandAt = (r, c) => {
    if (r < 0 || r >= height || c < 0 || c >= width) return false;
    return elevation[r * width + c] >= 0.3; // Nosso threshold clássico
  };
  const setLandAt = (r, c, isLand) => {
    if (!isLand) elevation[r * width + c] = 0.25; // Garante que vira água
  };
  applyMorphologicalCleanup(width, height, isLandAt, setLandAt);

  const graph = generateWorldGraph(rng, width, height, elevation, {
    cityCount: 14,
    gymCount: 8,
    margin: 2,
    extraEdges: 3,
  });

  // Centralidade
  const importanceMap = calculateImportance(graph.nodes, graph.edges);
  const getEdgeKey = (u, v) => [u, v].sort((a,b) => a-b).join(',');
  const sortedEdges = [...graph.edges].map(e => ({
    ...e,
    importance: importanceMap.get(getEdgeKey(e.u, e.v)) || 1
  })).sort((a, b) => b.importance - a.importance);

  // Nomes de Cidades
  const nextRng = () => rng.next();
  for (const node of graph.nodes) {
    const idx = node.y * width + node.x;
    node.name = generateCityName(biomes[idx], nextRng);
  }

  // Caminhos
  const workingCosts = new Float32Array(width * height);
  const roadTraffic = new Uint8Array(width * height);
  const cellImportance = new Uint16Array(width * height);
  const paths = [];

  let routeCount = 1;

  for (const edge of sortedEdges) {
    const startNode = graph.nodes[edge.u];
    const endNode = graph.nodes[edge.v];
    const waterCostBase = Math.max(5, 40 / (1 + (edge.importance - 1) * 0.15));

    const p = findPath(
      startNode.x, startNode.y, 
      endNode.x, endNode.y, 
      width, height, 
      workingCosts, 
      waterCostBase,
      elevation
    );
    
    if (p) {
      p.importance = edge.importance;
      p.name = generateRouteName(routeCount++);
      paths.push(p);
      for (const cell of p) {
        const idx = cell.y * width + cell.x;
        roadTraffic[idx]++;
        cellImportance[idx] = Math.max(cellImportance[idx], edge.importance);
        workingCosts[idx] = 0.05; 
      }
    }
  }

  // Landmarks
  const landmarks = placeLandmarks(nextRng, width, height, biomes, anomaly, graph);

  return {
    version: 1,
    phase: 4.0,
    seed: seedSnapshot,
    width,
    height,
    cells: elevation,
    temperature,
    moisture,
    anomaly,
    biomes,
    graph,
    paths,
    roadTraffic,
    cellImportance,
    landmarks,
  };
}

