import { BIOMES } from './biomes.js';
import { getMicroTile, CHUNK_SIZE } from './chunking.js';

export const player = {
  x: 0,
  y: 0
};

export function setPlayerPos(x, y) {
  player.x = Math.floor(x);
  player.y = Math.floor(y);
}

export function canWalk(x, y, data) {
  if (x < 0 || x >= data.width * CHUNK_SIZE || y < 0 || y >= data.height * CHUNK_SIZE) return false;
  
  const tile = getMicroTile(Math.floor(x), Math.floor(y), data);
  const bId = tile.biomeId;
  
  // Terrenos inescaláveis
  if (bId === BIOMES.PEAK.id || bId === BIOMES.VOLCANO.id || bId === BIOMES.MOUNTAIN.id) {
    return false;
  }
  
  // Água bloqueia, mas as pontes agora viram BEACH no microtile, então não caem aqui
  if (bId === BIOMES.OCEAN.id) {
    return false;
  }
  
  return true;
}

export function tryMovePlayer(dx, dy, data) {
  const nx = player.x + dx;
  const ny = player.y + dy;
  if (canWalk(nx, ny, data)) {
    player.x = nx;
    player.y = ny;
    return true;
  }
  return false;
}
