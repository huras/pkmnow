import { createRng, stringToSeed } from './rng.js';
import { generateWorldGraph, calculateImportance } from './graph.js';
import { findPath } from './pathfind.js';
import { getBiome, BIOMES } from './biomes.js';
import { applyMorphologicalCleanup } from './tessellation-logic.js';
import { generateCityName, generateRouteName } from './names.js';
import { placeLandmarks } from './landmarks.js';

export const DEFAULT_CONFIG = {
  waterLevel: 0.38,
  elevationScale: 24,
  /** Oitavas extra de value noise suave (maior frequência, baixa amplitude). Não altera a escala macro dos montes. */
  elevationDetailOctaves: 2,
  /** Amplitude da 1ª oitava de detalhe no intervalo 0..1 (ex.: 0.034 ≈ ±3.4%). As seguintes × elevationDetailPersistence. */
  elevationDetailStrength: 0.034,
  elevationDetailPersistence: 0.5,
  temperatureScale: 32,
  moistureScale: 28,
  desertMoisture: 0.38,
  forestMoisture: 0.58,
  anomalyScale: 20,
  cityCount: 14,
  gymCount: 8,
  extraEdges: 3
};

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
    return a * (1 - t) + b * t;
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
 * Elevação macro (elevationScale) + oitavas de detalhe mais finas e suaves.
 * Cada oitava usa metade do período da anterior (scale/2, /4, …) e amplitude decrescente,
 * para variar degraus sem mudar o tamanho dos maciços.
 */
function generateFractalElevationMap(rng, w, h, config) {
  const baseScale = config.elevationScale;
  const base = generateNoiseMap(rng, w, h, baseScale);
  const octaves = Math.max(0, Math.min(6, config.elevationDetailOctaves | 0));
  if (octaves === 0) return base;

  let strength = Number(config.elevationDetailStrength);
  if (!Number.isFinite(strength) || strength < 0) strength = 0.034;
  strength = Math.min(strength, 0.12);

  let persistence = Number(config.elevationDetailPersistence);
  if (!Number.isFinite(persistence) || persistence < 0) persistence = 0.5;
  persistence = Math.min(persistence, 1);

  const out = new Float32Array(w * h);
  out.set(base);
  let amp = strength;
  for (let o = 0; o < octaves; o++) {
    const div = 2 ** (o + 1);
    const scale = Math.max(2, Math.round(baseScale / div));
    const layer = generateNoiseMap(rng, w, h, scale);
    for (let i = 0; i < w * h; i++) {
      out[i] += amp * ((layer[i] - 0.5) * 2);
    }
    amp *= persistence;
  }
  for (let i = 0; i < w * h; i++) {
    const v = out[i];
    out[i] = v <= 0 ? 0 : v >= 1 ? 1 : v;
  }
  return out;
}

/**
 * Fase 4.0: Identidade e Landmarks.
 */
export function generate(seedInput, customConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...customConfig };
  const seedSnapshot = normalizeSeed(seedInput);
  const rng = createRng(seedSnapshot);
  const width = 128;
  const height = 128;
  
  // Mapas de Ruído Simples (Single Octave - No FBM)
  const elevation = generateNoiseMap(rng, width, height, config.elevationScale);
  const temperature = generateNoiseMap(rng, width, height, config.temperatureScale);
  const moisture = generateNoiseMap(rng, width, height, config.moistureScale);
  const anomaly = generateNoiseMap(rng, width, height, config.anomalyScale); // Ruído de Misticismo

  // Mapeamento de Biomas com Pós-processamento de Anomalias
  const biomes = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const e = elevation[i];
    const t = temperature[i];
    const m = moisture[i];
    const a = anomaly[i];
    
    let biomeObj = getBiome(e, t, m, config);

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
    return elevation[r * width + c] >= (config.waterLevel || 0.38); 
  };
  const setLandAt = (r, c, isLand) => {
    if (!isLand) elevation[r * width + c] = 0.25; // Garante que vira água
  };
  applyMorphologicalCleanup(width, height, isLandAt, setLandAt);

  const graph = generateWorldGraph(rng, width, height, elevation, {
    cityCount: config.cityCount,
    gymCount: config.gymCount,
    margin: 2,
    extraEdges: config.extraEdges,
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
  const roadMasks = new Uint32Array(width * height);
  const cellImportance = new Uint16Array(width * height);
  const paths = [];

  let routeCount = 1;

  for (let i = 0; i < sortedEdges.length; i++) {
    const edge = sortedEdges[i];
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
      const pathBit = 1 << (i % 32);
      for (const cell of p) {
        const idx = cell.y * width + cell.x;
        roadTraffic[idx]++;
        roadMasks[idx] |= pathBit;
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
    roadMasks,
    cellImportance,
    landmarks,
    config
  };
}

