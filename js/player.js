import { CHUNK_SIZE, getMicroTile } from './chunking.js';
import { canWalkMicroTile, getMicroTileRole, WALL_ROLES } from './walkability.js';
import { BIOME_TO_TERRAIN } from './biome-tiles.js';
import { PMD_DEFAULT_MON_ANIMS } from './pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from './pokemon/pmd-anim-metadata.js';

const MAX_SPEED = 3.2;
const ACCEL = 32.0;
const FRICTION = 20.0;
const GRAVITY = 45.0;
const JUMP_IMPULSE = 14.5;
const GROUND_R = 0.32; // Raio de colisão

const SAVED_DEX_KEY = 'pkmn_player_dex_id';
const initialDex = parseInt(localStorage.getItem(SAVED_DEX_KEY)) || 94;

export const player = {
  x: 0,
  y: 0,
  visualX: 0,
  visualY: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  z: 0,
  inputX: 0,
  inputY: 0,
  facing: 'down',
  animRow: 0,
  animFrame: 0,
  idleTimer: 0,
  totalDistMoved: 0,
  dexId: initialDex,
  jumping: false,
  grounded: true
};

export function setPlayerSpecies(dexId) {
  player.dexId = dexId;
  localStorage.setItem(SAVED_DEX_KEY, dexId);
}

export function setPlayerPos(x, y) {
  player.x = x;
  player.y = y;
  player.visualX = x;
  player.visualY = y;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.z = 0;
  player.grounded = true;
  player.jumping = false;
  player.totalDistMoved = 0;
  player.animFrame = 0;
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;
}

export function canWalk(x, y, data, srcX, srcY, isAirborne = false) {
  // 1. LOGICAL TRAVERSAL (The "Feet"):
  // Se estiver no ar, o centro pode ignorar clifs. 
  // Se estiver no chão, o centro DEVE obedecer às regras de altura (escadas, mesma altura, etc).
  if (!isAirborne) {
    if (!canWalkMicroTile(x, y, data, srcX, srcY, undefined, isAirborne)) {
      return false;
    }
  } else {
    // No ar, verificamos apenas se o centro não bateu em algo sólido (prop horizontal).
    // canWalkMicroTile sem srcX/Y pula o check de altura.
    if (!canWalkMicroTile(x, y, data, undefined, undefined, undefined, isAirborne)) {
      return false;
    }
  }

  // 2. PHYSICAL BODY (The "Corners"):
  // O corpo físico só pára por obstáculos REAIS (paredes, árvores, casas).
  // Ele NÃO liga para altura do chão (heightStep).
  const points = [
    { x: x - GROUND_R, y: y - GROUND_R },
    { x: x + GROUND_R, y: y - GROUND_R },
    { x: x - GROUND_R, y: y + GROUND_R },
    { x: x + GROUND_R, y: y + GROUND_R }
  ];

  for (const p of points) {
    const mx = Math.floor(p.x);
    const my = Math.floor(p.y);
    if (mx < 0 || my < 0 || mx >= data.width * CHUNK_SIZE || my >= data.height * CHUNK_SIZE) return false;

    // Chamamos canWalkMicroTile SEM srcX/srcY para ignorar o check de "heightStepMismatch".
    // Isso permite que um ombro do player sobreponha um tile de altura diferente sem travar.
    if (!canWalkMicroTile(p.x, p.y, data, undefined, undefined, undefined, isAirborne)) {
      return false;
    }
  }

  return true;
}

const DIRECTION_ROW_MAP = {
  down: 0,
  'down-right': 1,
  right: 2,
  'up-right': 3,
  up: 4,
  'up-left': 5,
  left: 6,
  'down-left': 7
};

// tryMovePlayer is now handled directly by inputX/Y in the gameLoop
export function tryMovePlayer(dx, dy, data) {
  return false;
}

/** 
 * Tenta pular. 
 * - Se estiver de frente para um degrau de 1 nível (subida ou descida) que é uma "Ledge" andável: pula 1 tile.
 * - Se estiver de frente para um "Muro" (EDGE_S, EDGE_W, EDGE_E), tenta saltar por cima: pula 2 tiles.
 * - Se estiver no plano, faz apenas um pulinho (hop) no lugar para feedback visual.
 */
export function tryJumpPlayer(data) {
  if (!player.grounded) return false;
  player.vz = JUMP_IMPULSE;
  player.grounded = false;
  player.jumping = true;
  return true;
}

/** Idle column index for the long “waiting” pose (frame 0 — first entry in Idle sequence). Used e.g. for grass-in-front overlay. */
export const PLAYER_IDLE_WAITING_FRAME_INDEX = 0;

export function isPlayerIdleOnWaitingFrame() {
  return player.grounded && player.vx === 0 && player.vy === 0 && player.animFrame === PLAYER_IDLE_WAITING_FRAME_INDEX;
}

/**
 * Atualiza a posição visual e animação do player por frame.
 * @param {number} dt - delta time em segundos
 * @param {number} multiplier - multiplicador de velocidade (não afeta o tempo da animação interna do PMD)
 */
export function updatePlayer(dt, data) {
  const isAirborne = player.jumping || player.z > 0.05;

  // 1. Horizontal Input & Physics
  if (player.inputX !== 0 || player.inputY !== 0) {
    // Determine facing
    if (player.inputX === 0 && player.inputY < 0) player.facing = 'up';
    else if (player.inputX === 0 && player.inputY > 0) player.facing = 'down';
    else if (player.inputX < 0 && player.inputY === 0) player.facing = 'left';
    else if (player.inputX > 0 && player.inputY === 0) player.facing = 'right';
    else if (player.inputX > 0 && player.inputY < 0) player.facing = 'up-right';
    else if (player.inputX < 0 && player.inputY < 0) player.facing = 'up-left';
    else if (player.inputX > 0 && player.inputY > 0) player.facing = 'down-right';
    else if (player.inputX < 0 && player.inputY > 0) player.facing = 'down-left';

    // Accelerate
    player.vx += player.inputX * ACCEL * dt;
    player.vy += player.inputY * ACCEL * dt;
  } else {
    // Friction
    const spd = Math.hypot(player.vx, player.vy);
    if (spd > 0) {
       const drop = FRICTION * dt;
       const newSpd = Math.max(0, spd - drop);
       player.vx *= newSpd / spd;
       player.vy *= newSpd / spd;
    }
  }

  // Clamp Speed
  const inputMag = Math.hypot(player.inputX, player.inputY);
  const currentMaxSpeed = MAX_SPEED * Math.max(1.0, inputMag);
  const spd = Math.hypot(player.vx, player.vy);
  if (spd > currentMaxSpeed) {
     player.vx *= currentMaxSpeed / spd;
     player.vy *= currentMaxSpeed / spd;
  }

  // 2. Continuous Collision & Position Update (Sliding)
  const nextX = player.x + player.vx * dt;
  const nextY = player.y + player.vy * dt;

  if (canWalk(nextX, nextY, data, player.x, player.y, isAirborne)) {
    player.x = nextX;
    player.y = nextY;
  } else {
    // Sliding Resolution: Try X then Y
    if (canWalk(nextX, player.y, data, player.x, player.y, isAirborne)) {
      player.x = nextX;
      player.vy = 0;
    } else if (canWalk(player.x, nextY, data, player.x, player.y, isAirborne)) {
      player.y = nextY;
      player.vx = 0;
    } else {
      player.vx = 0;
      player.vy = 0;
    }
  }

  // 3. Vertical Physics (Jump)
  if (!player.grounded) {
     player.vz -= GRAVITY * dt;
     player.z += player.vz * dt;

     if (player.z <= 0) {
        player.z = 0;
        player.vz = 0;
        player.grounded = true;
        player.jumping = false;
        // Ao aterrissar, não fazemos nada especial; o próximo frame de canWalk 
        // usará player.x/y (já no novo tile) como src, então o check de altura passará.
     }
  }

  // 4. Update Visual and Animation
  player.visualX = player.x;
  player.visualY = player.y;
  player.animRow = DIRECTION_ROW_MAP[player.facing] || 0;

  if (spd > 0.1 && player.grounded) {
    player.totalDistMoved += spd * dt;
    const meta = getDexAnimMeta(player.dexId);
    const seq = meta?.walk?.durations || PMD_DEFAULT_MON_ANIMS.Walk;
    const totalTicks = seq.reduce((a, b) => a + b, 0);

    const walkDistanceCycle = 3.5; 
    const animT = (player.totalDistMoved % walkDistanceCycle) / walkDistanceCycle;
    const currentTick = animT * totalTicks;
    
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
    const meta = getDexAnimMeta(player.dexId);
    const seq = meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle;
    const totalTicks = seq.reduce((a, b) => a + b, 0);
    
    player.idleTimer += dt * 60;
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
