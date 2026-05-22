import { buildCityLayouts } from 'region-map-gen/city-layout.js';
import { isConnected } from 'region-map-gen/graph.js';

/**
 * Builds a 1×1 macro-cell world from a full region so play mode covers exactly one stride (41×41 micro tiles).
 *
 * @param {object} data — output of {@link import('region-map-gen').generate}
 * @param {number} gx — macro X in the source world
 * @param {number} gy — macro Y in the source world
 * @returns {object | null}
 */
export function sliceWorldDataToSingleMacroTile(data, gx, gy) {
  if (!data) return null;
  const ow = data.width | 0;
  const oh = data.height | 0;
  if (ow <= 0 || oh <= 0) return null;
  if (gx < 0 || gy < 0 || gx >= ow || gy >= oh) return null;

  const idx = gy * ow + gx;

  const pickScalar = (arr) => {
    if (!arr || typeof arr.length !== 'number') return arr;
    const Ctor = arr.constructor;
    const out = new Ctor(1);
    out[0] = arr[idx];
    return out;
  };

  const oldNodes = data.graph?.nodes || [];
  /** @type {Map<number, number>} old graph node index → new index */
  const oldIdxToNew = new Map();
  for (let i = 0; i < oldNodes.length; i++) {
    const n = oldNodes[i];
    if (n && n.x === gx && n.y === gy) {
      oldIdxToNew.set(i, oldIdxToNew.size);
    }
  }

  const newNodes = [];
  for (let i = 0; i < oldNodes.length; i++) {
    const n = oldNodes[i];
    if (!n || n.x !== gx || n.y !== gy) continue;
    newNodes.push({
      ...n,
      id: newNodes.length,
      x: 0,
      y: 0
    });
  }

  const newEdges = [];
  for (const e of data.graph?.edges || []) {
    const nu = oldIdxToNew.get(e.u);
    const nv = oldIdxToNew.get(e.v);
    if (nu === undefined || nv === undefined) continue;
    newEdges.push({ u: nu, v: nv });
  }

  const graph = {
    nodes: newNodes,
    edges: newEdges,
    connected: newNodes.length <= 1 ? true : isConnected(newNodes.length, newEdges)
  };

  const pathsFixed = [];
  for (const p of data.paths || []) {
    if (!Array.isArray(p)) continue;
    const has = p.some((c) => c && c.x === gx && c.y === gy);
    if (!has) continue;
    const row = [{ x: 0, y: 0 }];
    if (p.importance != null) row.importance = p.importance;
    if (p.name != null) row.name = p.name;
    pathsFixed.push(row);
  }

  const landmarks = (data.landmarks || [])
    .filter((lm) => lm && lm.x === gx && lm.y === gy)
    .map((lm) => ({ ...lm, x: 0, y: 0 }));

  const slicedBase = {
    version: data.version,
    phase: data.phase,
    seed: data.seed,
    width: 1,
    height: 1,
    cells: pickScalar(data.cells),
    temperature: pickScalar(data.temperature),
    moisture: pickScalar(data.moisture),
    anomaly: pickScalar(data.anomaly),
    biomes: pickScalar(data.biomes),
    graph,
    paths: pathsFixed,
    roadTraffic: pickScalar(data.roadTraffic),
    roadMasks: pickScalar(data.roadMasks),
    cellImportance: pickScalar(data.cellImportance),
    landmarks,
    config: data.config ? { ...data.config } : data.config
  };

  const cityData = buildCityLayouts(graph, slicedBase, data.seed);

  return {
    ...slicedBase,
    cityData
  };
}
