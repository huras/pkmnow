/**
 * @fileoverview Minimal WASD/arrow-key player. Position is in micro-tile units
 * (so it lines up with `region-walkability.canWalkMicroTile`). Movement is
 * collision-checked per-axis to allow wall-sliding.
 */

import { canWalkMicroTile } from 'region-walkability/walkability.js';

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

export function createPlayer({ x, y, world }) {
  const state = {
    x, y,
    z: 0,
    facing: 'down',
    speed: 4.5, // micro-tiles per second
    sprintMul: 2.2,
    keys: { up: false, down: false, left: false, right: false, sprint: false },
    world,
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { state.keys.sprint = true; return; }
    const dir = KEY_MAP[e.code];
    if (!dir) return;
    state.keys[dir] = true;
    state.facing = dir;
  }

  function onKeyUp(e) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { state.keys.sprint = false; return; }
    const dir = KEY_MAP[e.code];
    if (!dir) return;
    state.keys[dir] = false;
  }

  function attachInput(target) {
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
  }

  function update(dt) {
    let dx = 0;
    let dy = 0;
    if (state.keys.left) dx -= 1;
    if (state.keys.right) dx += 1;
    if (state.keys.up) dy -= 1;
    if (state.keys.down) dy += 1;
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const speed = state.speed * (state.keys.sprint ? state.sprintMul : 1);
    const stepX = (dx / len) * speed * dt;
    const stepY = (dy / len) * speed * dt;

    const tryMove = (nx, ny) => canWalkMicroTile(nx, ny, state.world);

    const nx = state.x + stepX;
    if (tryMove(nx, state.y)) state.x = nx;
    const ny = state.y + stepY;
    if (tryMove(state.x, ny)) state.y = ny;
  }

  return { state, attachInput, update };
}
