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
  animRow: 0,
  animFrame: 0,
  idleTimer: 0,
  moveTimer: 0
};

export function setPlayerPos(x, y) {
  player.x = Math.floor(x);
  player.y = Math.floor(y);
  player.visualX = player.x;
  player.visualY = player.y;
  player.moving = false;
  player.moveProgress = 0;
  player.idleTimer = 0;
  player.moveTimer = 0;
  player.animFrame = 0;
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;
}

export function canWalk(x, y, data, cachedFoliageOverlayId) {
  return canWalkMicroTile(x, y, data, cachedFoliageOverlayId);
}

const DIRECTION_ROW_MAP = {
  down: 0,
  right: 2,
  up: 4,
  left: 6
};

/**
 * Tenta iniciar um movimento. Retorna true se o movimento foi iniciado.
 */
export function tryMovePlayer(dx, dy, data) {
  if (player.moving) return false;

  // Direção do facing
  if (dy < 0) player.facing = 'up';
  else if (dy > 0) player.facing = 'down';
  else if (dx < 0) player.facing = 'left';
  else if (dx > 0) player.facing = 'right';

  // Atualiza linha da animação (PMD Format)
  player.animRow = DIRECTION_ROW_MAP[player.facing];

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
 * Atualiza a posição visual e animação do player por frame.
 * @param {number} dt - delta time em segundos
 * @param {number} multiplier - multiplicador de velocidade
 */
export function updatePlayer(dt, multiplier = 1) {
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;

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

    // PMD Walk: 12 frames
    // Um ciclo (12 frames) por tile.
    player.animFrame = Math.floor(t * 12) % 12;
    player.idleTimer = 0;
  } else {
    // VisualX/Y fixos na posição lógica
    player.visualX = player.x;
    player.visualY = player.y;
    
    // PMD Idle: 6 frames
    player.idleTimer += dt;
    const idleCycleDuration = 0.8; 
    player.animFrame = Math.floor((player.idleTimer % idleCycleDuration) / (idleCycleDuration / 6));
  }
}
