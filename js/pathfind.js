/**
 * Implementação de A* (A-Star) para grid 2D com pesos de terreno.
 */

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number} Manhattan distance
 */
function heuristic(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}


/**
 * A* Search.
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @param {number} width
 * @param {number} height
 * @param {Float32Array} costMatrix - Valores em [0, 1] onde 1 é muito custoso.
 * @param {number} [waterCostBase=40] - Custo base para atravessar água.
 * @returns {Array<{x: number, y: number}> | null} Lista de pontos do caminho.
 */
export function findPath(startX, startY, endX, endY, width, height, costMatrix, waterCostBase = 40) {
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
      { x: cx + 1, y: cy }, { x: cx - 1, y: cy },
      { x: cx, y: cy + 1 }, { x: cx, y: cy - 1 },
    ];

    for (const nb of neighbors) {
      if (nb.x < 0 || nb.x >= width || nb.y < 0 || nb.y >= height) continue;

      const nbKey = nb.y * width + nb.x;
      const v = costMatrix[nbKey];
      
      let d = 1;
      if (v < 0.051) {
        d = 0.05; // Estrada já existente
      } else if (v < 0.3) {
        d = waterCostBase; // Custo dinâmico para pontes
      } else if (v > 0.7) {
        d = 1 + Math.pow(v, 2) * 15; // Montanha
      } else {
        d = 1 + Math.pow(v, 2) * 3; // Grama
      }
      
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
