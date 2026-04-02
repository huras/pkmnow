import { BIOMES } from './biomes.js';

export const player = {
  x: 0,
  y: 0
};

export function setPlayerPos(x, y) {
  player.x = Math.floor(x);
  player.y = Math.floor(y);
}

export function canWalk(x, y, data) {
  if (x < 0 || x >= data.width || y < 0 || y >= data.height) return false;
  
  const idx = y * data.width + x;
  const bId = data.biomes[idx];
  
  // Terrenos inescaláveis
  if (bId === BIOMES.PEAK.id || bId === BIOMES.VOLCANO.id || bId === BIOMES.MOUNTAIN.id) {
    return false;
  }
  
  // Água bloqueia, a não ser que tenha uma rota (ponte)
  if (bId === BIOMES.OCEAN.id) {
    if (data.roadTraffic && data.roadTraffic[idx] > 0) return true;
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
