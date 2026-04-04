import { CHUNK_SIZE } from './chunking.js';
import { canWalkMicroTile } from './walkability.js';

const MOVE_DURATION = 0.15; // segundos para andar 1 tile (estilo Pokémon)

export const player = {
  x: 0,         // posição lógica (tile)
  y: 0,
  visualX: 0,   // posição visual (interpolada)
  visualY: 0,
  moving: false,
  moveProgress: 0,
  fromX: 0,
  fromY: 0,
  facing: 'down' // 'up' | 'down' | 'left' | 'right'
};

export function setPlayerPos(x, y) {
  player.x = Math.floor(x);
  player.y = Math.floor(y);
  player.visualX = player.x;
  player.visualY = player.y;
  player.moving = false;
  player.moveProgress = 0;
}

export function canWalk(x, y, data) {
  return canWalkMicroTile(x, y, data);
}

/**
 * Tenta iniciar um movimento. Retorna true se o movimento foi iniciado.
 * Não move instantaneamente — apenas marca o destino.
 */
export function tryMovePlayer(dx, dy, data) {
  if (player.moving) return false; // Já está andando

  // Direção do facing
  if (dy < 0) player.facing = 'up';
  else if (dy > 0) player.facing = 'down';
  else if (dx < 0) player.facing = 'left';
  else if (dx > 0) player.facing = 'right';

  const nx = player.x + dx;
  const ny = player.y + dy;
  if (canWalk(nx, ny, data)) {
    player.fromX = player.x;
    player.fromY = player.y;
    player.x = nx;
    player.y = ny;
    player.moving = true;
    player.moveProgress = 0;
    return true;
  }
  return false;
}

/**
 * Atualiza a posição visual do player por frame.
 * @param {number} dt - delta time em segundos
 * @param {number} multiplier - multiplicador de velocidade (ex: 5 para correr)
 */
export function updatePlayer(dt, multiplier = 1) {
  if (!player.moving) return;

  player.moveProgress += (dt * multiplier) / MOVE_DURATION;
  if (player.moveProgress >= 1) {
    player.moveProgress = 1;
    player.moving = false;
  }

  // Lerp suave
  const t = player.moveProgress;
  player.visualX = player.fromX + (player.x - player.fromX) * t;
  player.visualY = player.fromY + (player.y - player.fromY) * t;
}
