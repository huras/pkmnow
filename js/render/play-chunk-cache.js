export const playChunkMap = new Map();

let lastDataForCache = null;
let lastTileWForCache = 0;

/**
 * Invalida o cache global de blocos se os dados básicos (mapa ou escala) mudarem.
 * @returns {boolean} true se o cache foi limpo (novo mapa / escala).
 */
export function syncPlayChunkCache(data, tileW, appMode) {
  if (appMode !== 'play' || data !== lastDataForCache || tileW !== lastTileWForCache) {
    playChunkMap.clear();
    lastDataForCache = data;
    lastTileWForCache = tileW;
    return true;
  }
  return false;
}
