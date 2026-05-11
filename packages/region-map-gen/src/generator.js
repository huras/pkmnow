import { createRng, stringToSeed } from './rng.js';
import { generateWorldGraph, calculateImportance } from './graph.js';
import { findPath } from './pathfind.js';
import { getBiome, getBiomeWithAnomalies, BIOMES, resolveWaterLevel, DEFAULT_WATER_LEVEL } from './biomes.js';
import { applyMorphologicalCleanup } from './tessellation-logic.js';
import { generateCityName, generateRouteName } from './names.js';
import { placeLandmarks } from './landmarks.js';
import { buildCityLayouts } from './city-layout.js';

export const DEFAULT_CONFIG = {
  waterLevel: DEFAULT_WATER_LEVEL,
  elevationScale: 24,
  /** Oitavas de ruído fractal para mapas macro (Elevation, Temp, Moisture). */
  fbmOctaves: 3,
  fbmPersistence: 0.5,
  /** Oitavas FBM extra só na elevação (sliders “detalhe” no modal). 0 = desliga camada extra. */
  elevationDetailOctaves: 2,
  elevationDetailPersistence: 0.5,
  /** Força do detalhe (valor/1000 no UI; somado à elevação base antes dos biomas). */
  elevationDetailStrength: 0.034,
  temperatureScale: 60,
  moistureScale: 28,
  desertMoisture: 0.38,
  forestMoisture: 0.58,
  anomalyScale: 32,
  cityCount: 22,
  gymCount: 10,
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
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;

      const sx = smooth(fx);
      const sy = smooth(fy);

      const v00 = controls[iy * controlW + ix];
      const v10 = controls[iy * controlW + (ix + 1)];
      const v01 = controls[(iy + 1) * controlW + ix];
      const v11 = controls[(iy + 1) * controlW + (ix + 1)];

      const top = lerp(v00, v10, sx);
      const bottom = lerp(v01, v11, sx);
      cells[y * w + x] = lerp(top, bottom, sy);
    }
  }
  return cells;
}

/**
 * Gera um mapa FBM (Fractal Brownian Motion).
 */
function generateFBMMap(rng, w, h, baseScale, octaves, persistence) {
  const base = generateNoiseMap(rng, w, h, baseScale);
  if (octaves <= 1) return base;

  const out = new Float32Array(w * h);
  out.set(base);

  let amp = persistence;
  for (let o = 1; o < octaves; o++) {
    const div = 2 ** o;
    const scale = Math.max(2, Math.round(baseScale / div));
    const layer = generateNoiseMap(rng, w, h, scale);
    for (let i = 0; i < w * h; i++) {
       // Somar detalhe centralizado em 0
      out[i] += amp * ((layer[i] - 0.5) * 2);
    }
    amp *= persistence;
  }

  // Clamp 0..1
  for (let i = 0; i < w * h; i++) {
    const v = out[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
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
  const width = 256;
  const height = 256;
  
  // Mapas de Ruído Fractal (FBM)
  const elevation = generateFBMMap(rng, width, height, config.elevationScale, config.fbmOctaves, config.fbmPersistence);

  const detOct = Math.max(0, Math.min(5, config.elevationDetailOctaves ?? 0));
  const detStr = config.elevationDetailStrength ?? 0;
  if (detOct > 0 && detStr > 0) {
    const detScale = Math.max(2, Math.round(config.elevationScale / 2));
    const detPers = config.elevationDetailPersistence ?? 0.5;
    const detail = generateFBMMap(rng, width, height, detScale, detOct + 1, detPers);
    for (let i = 0; i < width * height; i++) {
      let v = elevation[i] + detStr * ((detail[i] - 0.5) * 2);
      elevation[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  const temperature = generateFBMMap(rng, width, height, config.temperatureScale, config.fbmOctaves, config.fbmPersistence);
  const moisture = generateFBMMap(rng, width, height, config.moistureScale, config.fbmOctaves, config.fbmPersistence);
  const anomaly = generateFBMMap(rng, width, height, config.anomalyScale, 4, 0.5); // Mais oitavas para bordas orgânicas

  // Mapeamento de Biomas com Pós-processamento de Anomalias
  const biomes = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const e = elevation[i];
    const t = temperature[i];
    const m = moisture[i];
    const a = anomaly[i];
    
    biomes[i] = getBiomeWithAnomalies(e, t, m, a, config).id;
  }

  // Pós-processamento de Morfologia: Evitar tiles isolados que quebram o autotiler
  // de 13 papéis. Rodamos um cleanup básico na terra.
  const wlLand = resolveWaterLevel(config);
  const isLandAt = (r, c) => {
    if (r < 0 || r >= height || c < 0 || c >= width) return false;
    return elevation[r * width + c] >= wlLand;
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
    waterLevel: config.waterLevel,
  });

  // Centralidade + ordem de rotas: conexões mais curtas primeiro (tie-break: mais importantes)
  const importanceMap = calculateImportance(graph.nodes, graph.edges);
  const getEdgeKey = (u, v) => [u, v].sort((a, b) => a - b).join(',');
  const edgeLenSq = (e) => {
    const a = graph.nodes[e.u];
    const b = graph.nodes[e.v];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };
  const sortedEdges = [...graph.edges]
    .map((e) => ({
      ...e,
      importance: importanceMap.get(getEdgeKey(e.u, e.v)) || 1,
    }))
    .sort((a, b) => {
      const da = edgeLenSq(a);
      const db = edgeLenSq(b);
      if (da !== db) return da - db;
      return b.importance - a.importance;
    });

  // Nomes de Cidades
  const nextRng = () => rng.next();
  for (const node of graph.nodes) {
    const idx = node.y * width + node.x;
    node.name = generateCityName(biomes[idx], nextRng);
  }

  // Caminhos: grelha espelha elevação até marcar estradas; A* reutiliza estradas (custo 0) e prefere cortar por cidades
  const workingCosts = new Float32Array(width * height);
  workingCosts.set(elevation);
  const roadTraffic = new Uint8Array(width * height);
  const roadMasks = new Uint32Array(width * height);
  const cellImportance = new Uint16Array(width * height);
  const paths = [];

  const cityKeys = new Set(graph.nodes.map((n) => n.y * width + n.x));
  const roadKeys = new Set();

  let routeCount = 1;

  for (let i = 0; i < sortedEdges.length; i++) {
    const edge = sortedEdges[i];
    const startNode = graph.nodes[edge.u];
    const endNode = graph.nodes[edge.v];
    const waterCostBase = Math.max(5, 40 / (1 + (edge.importance - 1) * 0.15));

    const p = findPath(
      startNode.x,
      startNode.y,
      endNode.x,
      endNode.y,
      width,
      height,
      workingCosts,
      waterCostBase,
      elevation,
      {
        waterLevel: config.waterLevel,
        roadKeys,
        cityKeys,
        cityThroughMultiplier: 0.35,
      },
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
        roadKeys.add(idx);
      }
    }
  }

  // City layouts (pre-computed building positions, inner-city paths, terracing)
  const cityData = buildCityLayouts(graph, { width, height, cells: elevation, seed: seedSnapshot, config }, seedSnapshot);

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
    cityData,
    config
  };
}

