export const playChunkMap = new Map();

let lastDataForCache = null;
let lastTileWForCache = 0;

/** Invalida o cache global de blocos se os dados básicos (mapa ou escala) mudarem. */
export function syncPlayChunkCache(data, tileW, appMode) {
  if (appMode !== 'play' || data !== lastDataForCache || tileW !== lastTileWForCache) {
    playChunkMap.clear();
    lastDataForCache = data;
    lastTileWForCache = tileW;
  }
}
