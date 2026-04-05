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
  facing: 'down', // 'up' | 'down' | 'left' | 'right'
  animFrame: 1,
  animTimer: 0
};

export function setPlayerPos(x, y) {
  player.x = Math.floor(x);
  player.y = Math.floor(y);
  player.visualX = player.x;
  player.visualY = player.y;
  player.moving = false;
  player.moveProgress = 0;
  player.animTimer = 0;
  player.animFrame = 1; // Down-idle
}

export function canWalk(x, y, data, cachedFoliageOverlayId) {
  return canWalkMicroTile(x, y, data, cachedFoliageOverlayId);
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

const FRAME_MAP = {
  down: [0, 1, 2, 1],
  up: [3, 4, 5, 4],
  left: [6, 7, 8, 7],
  right: [9, 10, 11, 10]
};

/**
 * Atualiza a posição visual e animação do player por frame.
 * @param {number} dt - delta time em segundos
 * @param {number} multiplier - multiplicador de velocidade (ex: 0.5 andar, 10 correr com Shift)
 */
export function updatePlayer(dt, multiplier = 1) {
  if (player.moving) {
    player.moveProgress += (dt * multiplier) / MOVE_DURATION;
    if (player.moveProgress >= 1) {
      player.moveProgress = 1;
      player.moving = false;
    }

    // Lerp suave para posição visual
    const t = player.moveProgress;
    player.visualX = player.fromX + (player.x - player.fromX) * t;
    player.visualY = player.fromY + (player.y - player.fromY) * t;

    // Lógica de Animação: 
    // Um ciclo completo (4 beats: Pé A, Idle, Pé B, Idle) leva 2 tiles de distância se MOVE_DURATION é por tile.
    player.animTimer += dt * multiplier;
    const cycleDuration = MOVE_DURATION * 2; 
    const beat = Math.floor((player.animTimer % cycleDuration) / (cycleDuration / 4));
    player.animFrame = FRAME_MAP[player.facing][beat];
  } else {
    // VisualX/Y fixos na posição lógica
    player.visualX = player.x;
    player.visualY = player.y;
    
    // Frame de Idle (sempre o segundo frame do grupo de 3 de cada direção)
    player.animFrame = FRAME_MAP[player.facing][1];
    player.animTimer = 0; // Reseta para começar com o primeiro pé no próximo passo
  }
}
