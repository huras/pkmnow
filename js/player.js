import { CHUNK_SIZE, getMicroTile } from './chunking.js';
import { canWalkMicroTile, getMicroTileRole, WALL_ROLES } from './walkability.js';
import { BIOME_TO_TERRAIN } from './biome-tiles.js';
import { PMD_DEFAULT_MON_ANIMS } from './pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from './pokemon/pmd-anim-metadata.js';

const MOVE_DURATION = 0.15; // segundos para andar 1 tile (estilo Pokémon)
const JUMP_DURATION = 0.35; // duração do salto (um pouco mais lento que o andar)
const JUMP_PEAK = 0.55;    // altura máxima do salto em tiles

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
  dexId: initialDex,
  jumping: false,
  jumpProgress: 0,
  z: 0
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
  player.jumping = false;
  player.jumpProgress = 0;
  player.z = 0;
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;
}

export function canWalk(x, y, data, srcX, srcY, cachedFoliageOverlayId) {
  return canWalkMicroTile(x, y, data, srcX, srcY, cachedFoliageOverlayId);
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
  if (canWalk(nx, ny, data, player.x, player.y)) {
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
 * Tenta pular. 
 * - Se estiver de frente para um degrau de 1 nível (subida ou descida) que é uma "Ledge" andável: pula 1 tile.
 * - Se estiver de frente para um "Muro" (EDGE_S, EDGE_W, EDGE_E), tenta saltar por cima: pula 2 tiles.
 * - Se estiver no plano, faz apenas um pulinho (hop) no lugar para feedback visual.
 */
export function tryJumpPlayer(data) {
  if (player.moving || player.jumping) return false;

  let dx = 0, dy = 0;
  if (player.facing === 'up') dy = -1;
  else if (player.facing === 'down') dy = 1;
  else if (player.facing === 'left') dx = -1;
  else if (player.facing === 'right') dx = 1;

  const smx = Math.floor(player.x);
  const smy = Math.floor(player.y);
  
  const nx1 = player.x + dx;
  const ny1 = player.y + dy;
  const nx2 = player.x + dx * 2;
  const ny2 = player.y + dy * 2;
  
  const t0 = getMicroTile(smx, smy, data);
  if (!t0) return false;

  const t1 = (nx1 >= 0 && ny1 >= 0 && nx1 < data.width * CHUNK_SIZE && ny1 < data.height * CHUNK_SIZE) 
    ? getMicroTile(nx1, ny1, data) : null;
  const t2 = (nx2 >= 0 && ny2 >= 0 && nx2 < data.width * CHUNK_SIZE && ny2 < data.height * CHUNK_SIZE) 
    ? getMicroTile(nx2, ny2, data) : null;

  // CASO 1: Leap (2 tiles) - Saltando por cima de um muro
  if (t1 && t2) {
    const role1 = getMicroTileRole(nx1, ny1, data);
    const isWallAt1 = WALL_ROLES.has(role1);
    
    // Se o tile adjacente é um muro e o tile depois dele tem +-1 de altura
    if (isWallAt1 && Math.abs(t2.heightStep - t0.heightStep) === 1) {
      if (canWalkMicroTile(nx2, ny2, data, undefined, undefined)) {
        player.fromX = player.x;
        player.fromY = player.y;
        player.x = nx2;
        player.y = ny2;
        player.moving = true;
        player.jumping = true;
        player.jumpProgress = 0;
        player.moveProgress = 0;
        return true;
      }
    }
  }

  // CASO 2: Hop (1 tile) - Pulando um degrau direto (andável)
  if (t1 && Math.abs(t1.heightStep - t0.heightStep) === 1) {
    if (canWalkMicroTile(nx1, ny1, data, undefined, undefined)) {
      player.fromX = player.x;
      player.fromY = player.y;
      player.x = nx1;
      player.y = ny1;
      player.moving = true;
      player.jumping = true;
      player.jumpProgress = 0;
      player.moveProgress = 0;
      return true;
    }
  }

  // FLAT HOP: Small jump in place for visual feedback
  player.fromX = player.x;
  player.fromY = player.y;
  player.moving = true;
  player.jumping = true;
  player.jumpProgress = 0;
  player.moveProgress = 0;
  return true;
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
    const duration = player.jumping ? JUMP_DURATION : MOVE_DURATION;
    player.moveProgress += (dt * multiplier) / duration;
    if (player.moveProgress >= 1) {
      player.moveProgress = 1;
      player.moving = false;
    }

    const t = player.moveProgress;
    player.visualX = player.fromX + (player.x - player.fromX) * t;
    player.visualY = player.fromY + (player.y - player.fromY) * t;

    if (player.jumping) {
      player.jumpProgress = t;
      // Parabola: sin(t * pi) gives a 0->1->0 curve over duration
      player.z = Math.sin(t * Math.PI) * JUMP_PEAK;
      
      if (t >= 1) {
        player.jumping = false;
        player.z = 0;
      }
    } else {
      player.z = 0;
    }

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
    player.z = 0;
    player.jumping = false;
    
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
