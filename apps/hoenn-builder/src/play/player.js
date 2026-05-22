/**
 * @fileoverview WASD/arrow-key player driving a PMD-sprited pokémon. Position
 * is in micro-tile units (matches `region-walkability.canWalkMicroTile`).
 * Movement is collision-checked per-axis for wall-sliding.
 *
 * Extras vs. the minimal version:
 *  - 8-way facing (cardinals + diagonals).
 *  - HP / stamina / level / EXP / dexId, with sprint draining stamina.
 *  - `animFrame` driven by distance walked (so PMD walk cycles look natural).
 *  - `idleTimer` advanced in ticks (~1/60s) for idle PMD loops.
 */

import { canWalkMicroTile } from 'region-walkability/walkability.js';
import { vectorToFacing } from './pokemon-sprite.js';
import { DEFAULT_PLAYER_DEX_ID } from './pokemon-names.js';

const KEY_DIRECTION = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

const BASE_SPEED = 4.5;        // micro tiles / second
const SPRINT_MUL = 2.0;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_PER_SEC = 28;  // while sprinting
const STAMINA_REGEN_PER_SEC = 18;  // while idle / walking
const STAMINA_REGEN_DELAY = 0.45;  // s after sprint stops before regen kicks in

/** Walk-cycle period in micro tiles (one full loop every this much distance). */
const WALK_DISTANCE_CYCLE = 3.5;

/**
 * @param {{ x: number, y: number, world: object, dexId?: number }} opts
 */
export function createPlayer({ x, y, world, dexId = DEFAULT_PLAYER_DEX_ID }) {
  const state = {
    x,
    y,
    z: 0,
    facing: 'down',
    dexId,
    speed: BASE_SPEED,
    sprintMul: SPRINT_MUL,
    keys: { up: false, down: false, left: false, right: false, sprint: false },
    /** Distance walked since spawn (drives walk anim). */
    distMoved: 0,
    /** Tick counter for idle anim (PMD ticks ~60Hz). */
    idleTimer: 0,
    /** Current frame index within the active sheet (renderer picks the sheet). */
    animFrame: 0,
    /** True while sprint speed is being applied (and stamina > 0). */
    sprinting: false,
    /** True while WASD direction is held this frame. */
    moving: false,
    hp: 100,
    maxHp: 100,
    stamina: STAMINA_MAX,
    maxStamina: STAMINA_MAX,
    level: 1,
    exp: 0,
    expToNext: 100,
    /** Seconds since stamina last drained — gates regen. */
    _staminaIdle: 0,
    world,
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      state.keys.sprint = true;
      return;
    }
    const dir = KEY_DIRECTION[e.code];
    if (!dir) return;
    state.keys[dir] = true;
  }

  function onKeyUp(e) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      state.keys.sprint = false;
      return;
    }
    const dir = KEY_DIRECTION[e.code];
    if (!dir) return;
    state.keys[dir] = false;
  }

  function attachInput(target) {
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
  }

  function detachInput(target) {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    state.keys.up = state.keys.down = state.keys.left = state.keys.right = false;
    state.keys.sprint = false;
  }

  function setDex(dexId) {
    state.dexId = Math.max(1, Math.floor(Number(dexId) || DEFAULT_PLAYER_DEX_ID));
    state.hp = state.maxHp;
    state.stamina = state.maxStamina;
    state.animFrame = 0;
    state.idleTimer = 0;
  }

  function update(dt) {
    let dx = 0;
    let dy = 0;
    if (state.keys.left) dx -= 1;
    if (state.keys.right) dx += 1;
    if (state.keys.up) dy -= 1;
    if (state.keys.down) dy += 1;

    state.moving = dx !== 0 || dy !== 0;
    state.sprinting = !!(state.moving && state.keys.sprint && state.stamina > 0.5);

    if (state.moving) {
      state.facing = vectorToFacing(dx, dy);
      const len = Math.hypot(dx, dy) || 1;
      const speed = state.speed * (state.sprinting ? state.sprintMul : 1);
      const stepX = (dx / len) * speed * dt;
      const stepY = (dy / len) * speed * dt;

      const ox = state.x;
      const oy = state.y;
      // Per-axis collision: lets you slide along walls.
      const nx = ox + stepX;
      if (canWalkMicroTile(nx, oy, state.world)) state.x = nx;
      const ny = state.y + stepY;
      if (canWalkMicroTile(state.x, ny, state.world)) state.y = ny;

      state.distMoved += Math.hypot(state.x - ox, state.y - oy);
    }

    // Stamina: drains while sprinting, regens after a short delay.
    if (state.sprinting) {
      state.stamina = Math.max(0, state.stamina - STAMINA_DRAIN_PER_SEC * dt);
      state._staminaIdle = 0;
    } else {
      state._staminaIdle += dt;
      if (state._staminaIdle >= STAMINA_REGEN_DELAY) {
        state.stamina = Math.min(state.maxStamina, state.stamina + STAMINA_REGEN_PER_SEC * dt);
      }
    }

    // PMD-style anim timers: walk advances with distance, idle advances with time.
    if (state.moving) {
      state.idleTimer = 0;
    } else {
      state.idleTimer += dt * 60;
    }
  }

  return { state, attachInput, detachInput, setDex, update, WALK_DISTANCE_CYCLE };
}

export { WALK_DISTANCE_CYCLE };
