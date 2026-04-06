/**
 * A* em grid 4-vizinhos: elevação para água/grama/montanha, estradas existentes com custo 0,
 * desconto ao passar por outras cidades (exceto origem/destino da rota atual).
 */

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function heuristic(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * @typedef {{
 *   waterLevel?: number,
 *   roadKeys?: Set<number>,
 *   cityKeys?: Set<number>,
 *   cityThroughMultiplier?: number
 * }} PathfindOptions
 */

/**
 * @param {number} nbKey
 * @param {number} startKey
 * @param {number} endKey
 * @param {Float32Array} elevation
 * @param {number} waterLevel
 * @param {number} waterCostBase
 * @param {Float32Array} workingCosts
 * @param {Set<number>} roadKeys
 * @param {Set<number>} cityKeys
 * @param {number} cityMult
 */
function neighborMoveCost(
  nbKey,
  startKey,
  endKey,
  elevation,
  waterLevel,
  waterCostBase,
  workingCosts,
  roadKeys,
  cityKeys,
  cityMult,
) {
  if (roadKeys.has(nbKey) || workingCosts[nbKey] < 0.051) {
    return 0;
  }

  const v = elevation[nbKey];
  let d;
  if (v < waterLevel) {
    d = waterCostBase;
  } else if (v > 0.7) {
    d = 1 + Math.pow(v, 2) * 15;
  } else {
    d = 1 + Math.pow(v, 2) * 3;
  }

  if (cityKeys.has(nbKey) && nbKey !== startKey && nbKey !== endKey) {
    d *= cityMult;
  }
  return d;
}

function normalizeOpts(pathOpts) {
  const o = pathOpts ?? {};
  return {
    waterLevel: typeof o.waterLevel === 'number' ? o.waterLevel : 0.38,
    roadKeys: o.roadKeys ?? new Set(),
    cityKeys: o.cityKeys ?? new Set(),
    cityThroughMultiplier:
      typeof o.cityThroughMultiplier === 'number' ? o.cityThroughMultiplier : 0.35,
  };
}

/**
 * A* Search.
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @param {number} width
 * @param {number} height
 * @param {Float32Array} workingCosts - grelha de trabalho (estradas já traçadas ≈ 0.05)
 * @param {number} [waterCostBase=40]
 * @param {Float32Array} elevation - elevação bruta (água / terra / montanha)
 * @param {PathfindOptions} [pathOpts]
 * @returns {Array<{x: number, y: number}> | null}
 */
export function findPath(
  startX,
  startY,
  endX,
  endY,
  width,
  height,
  workingCosts,
  waterCostBase = 40,
  elevation,
  pathOpts,
) {
  const { waterLevel, roadKeys, cityKeys, cityThroughMultiplier } = normalizeOpts(pathOpts);

  const startKey = startY * width + startX;
  const endKey = endY * width + endX;

  if (startKey === endKey) return [{ x: startX, y: startY }];

  const openSet = new Set([startKey]);
  const cameFrom = new Map();

  const gScore = new Float32Array(width * height).fill(Infinity);
  gScore[startKey] = 0;

  const fScore = new Float32Array(width * height).fill(Infinity);
  fScore[startKey] = heuristic(startX, startY, endX, endY);

  while (openSet.size > 0) {
    let currentKey = -1;
    let minF = Infinity;
    for (const key of openSet) {
      if (fScore[key] < minF) {
        minF = fScore[key];
        currentKey = key;
      }
    }

    if (currentKey === endKey) {
      const path = [];
      let temp = currentKey;
      while (cameFrom.has(temp)) {
        path.push({ x: temp % width, y: Math.floor(temp / width) });
        temp = cameFrom.get(temp);
      }
      path.push({ x: startX, y: startY });
      return path.reverse();
    }

    openSet.delete(currentKey);
    const cx = currentKey % width;
    const cy = Math.floor(currentKey / width);

    const neighbors = [
      { x: cx + 1, y: cy },
      { x: cx - 1, y: cy },
      { x: cx, y: cy + 1 },
      { x: cx, y: cy - 1 },
    ];

    for (const nb of neighbors) {
      if (nb.x < 0 || nb.x >= width || nb.y < 0 || nb.y >= height) continue;

      const nbKey = nb.y * width + nb.x;
      const d = neighborMoveCost(
        nbKey,
        startKey,
        endKey,
        elevation,
        waterLevel,
        waterCostBase,
        workingCosts,
        roadKeys,
        cityKeys,
        cityThroughMultiplier,
      );
      const tentativeGScore = gScore[currentKey] + d;

      if (tentativeGScore < gScore[nbKey]) {
        cameFrom.set(nbKey, currentKey);
        gScore[nbKey] = tentativeGScore;
        fScore[nbKey] = tentativeGScore + heuristic(nb.x, nb.y, endX, endY);
        openSet.add(nbKey);
      }
    }
  }

  return null;
}
