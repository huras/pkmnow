import { CHUNK_SIZE } from './chunking.js';
import { canWalkMicroTile } from './walkability.js';
import { PMD_DEFAULT_MON_ANIMS } from './pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from './pokemon/pmd-anim-metadata.js';

const MOVE_DURATION = 0.15; // segundos para andar 1 tile (estilo Pokémon)

const SAVED_DEX_KEY = 'pkmn_player_dex_id';
const initialDex = parseInt(localStorage.getItem(SAVED_DEX_KEY)) || 94;

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
  moveTimer: 0,
  dexId: initialDex
};

export function setPlayerSpecies(dexId) {
  player.dexId = dexId;
  localStorage.setItem(SAVED_DEX_KEY, dexId);
}

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
  // Colisão: canWalkMicroTile(floor) num único tile; ver ordem em walkability.js → canWalkMicroTile
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

/** Idle column index for the long “waiting” pose (frame 0 — first entry in Idle sequence). Used e.g. for grass-in-front overlay. */
export const PLAYER_IDLE_WAITING_FRAME_INDEX = 0;

export function isPlayerIdleOnWaitingFrame() {
  return !player.moving && player.animFrame === PLAYER_IDLE_WAITING_FRAME_INDEX;
}

/**
 * Atualiza a posição visual e animação do player por frame.
 * @param {number} dt - delta time em segundos
 * @param {number} multiplier - multiplicador de velocidade (não afeta o tempo da animação interna do PMD)
 */
export function updatePlayer(dt, multiplier = 1) {
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;
  
  // Ticks do motor PMD (60 ticks por segundo)
  const ticks = dt * 60;

  if (player.moving) {
    player.moveProgress += (dt * multiplier) / MOVE_DURATION;
    if (player.moveProgress >= 1) {
      player.moveProgress = 1;
      player.moving = false;
    }

    const t = player.moveProgress;
    player.visualX = player.fromX + (player.x - player.fromX) * t;
    player.visualY = player.fromY + (player.y - player.fromY) * t;

    // Fetch dynamic animation sequence from metadata
    const meta = getDexAnimMeta(player.dexId);
    const seq = meta?.walk?.durations || PMD_DEFAULT_MON_ANIMS.Walk;
    const totalTicks = seq.reduce((a, b) => a + b, 0);
    
    // Synchronize movement progress with anim cycle
    const currentTick = t * totalTicks;
    let accumulated = 0;
    player.animFrame = 0;
    for (let i = 0; i < seq.length; i++) {
       accumulated += seq[i];
       if (currentTick <= accumulated) {
         player.animFrame = i;
         break;
       }
    }
    player.idleTimer = 0;
  } else {
    player.visualX = player.x;
    player.visualY = player.y;
    
    const meta = getDexAnimMeta(player.dexId);
    const seq = meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle;
    const totalTicks = seq.reduce((a, b) => a + b, 0);
    
    player.idleTimer += ticks;
    const loopTick = player.idleTimer % totalTicks;
    
    let accumulated = 0;
    player.animFrame = 0;
    for (let i = 0; i < seq.length; i++) {
       accumulated += seq[i];
       if (loopTick <= accumulated) {
         player.animFrame = i;
         break;
       }
    }
  }
}
