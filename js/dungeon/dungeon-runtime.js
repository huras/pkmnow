import { DUNGEON_TILE_TYPES } from './tile-map.js';
import { generateDeterministicDungeon } from './dungeon-generator.js';

const state = {
  active: false,
  portalId: '',
  worldSeed: 0,
  map: null,
  playerX: 0,
  playerY: 0,
  lastPlayerX: 0,
  lastPlayerY: 0,
  entry: null,
  exit: null,
  returnWorldX: 0,
  returnWorldY: 0,
  exitArmed: false
};

const dungeonCache = new Map();
const DUNGEON_MOVE_SPEED = 3.9;

export function isDungeonActive() {
  return state.active;
}

export function getDungeonState() {
  return state;
}

export function enterDungeon(params) {
  const portalId = String(params?.portalId || '');
  if (!portalId) return false;
  const worldSeed = Number(params?.worldSeed) || 0;
  const cacheKey = `${worldSeed}:${portalId}`;
  let generated = dungeonCache.get(cacheKey);
  if (!generated) {
    generated = generateDeterministicDungeon({
      worldSeed,
      portalId
    });
    dungeonCache.set(cacheKey, generated);
  }

  state.active = true;
  state.portalId = portalId;
  state.worldSeed = worldSeed;
  state.map = generated.map;
  state.entry = generated.entry;
  state.exit = generated.exit;
  state.playerX = generated.entry.x + 0.5;
  state.playerY = generated.entry.y + 0.5;
  state.lastPlayerX = state.playerX;
  state.lastPlayerY = state.playerY;
  state.returnWorldX = Number(params?.returnWorldX) || 0;
  state.returnWorldY = Number(params?.returnWorldY) || 0;
  state.exitArmed = false;
  return true;
}

export function leaveDungeon() {
  if (!state.active) return null;
  state.active = false;
  const out = {
    returnWorldX: state.returnWorldX,
    returnWorldY: state.returnWorldY,
    portalId: state.portalId
  };
  return out;
}

export function updateDungeonRuntime(dt, inputX, inputY) {
  if (!state.active || !state.map) return { wantsExit: false };
  const d = Math.max(0, Number(dt) || 0);
  const ix = Number(inputX) || 0;
  const iy = Number(inputY) || 0;
  let nx = state.playerX;
  let ny = state.playerY;
  const len = Math.hypot(ix, iy);
  if (len > 1e-4) {
    const ux = ix / len;
    const uy = iy / len;
    const step = DUNGEON_MOVE_SPEED * d;
    const tx = state.playerX + ux * step;
    const ty = state.playerY + uy * step;
    if (isWalkableAt(tx, state.playerY, state.map)) nx = tx;
    if (isWalkableAt(nx, ty, state.map)) ny = ty;
  }
  state.lastPlayerX = state.playerX;
  state.lastPlayerY = state.playerY;
  state.playerX = nx;
  state.playerY = ny;

  const px = Math.floor(state.playerX);
  const py = Math.floor(state.playerY);
  const tile = state.map.get(px, py);
  if (tile !== DUNGEON_TILE_TYPES.STAIRS_DOWN) state.exitArmed = true;
  const wantsExit = state.exitArmed && tile === DUNGEON_TILE_TYPES.STAIRS_UP;
  return { wantsExit };
}

function isWalkableAt(x, y, map) {
  const t = map.get(Math.floor(x), Math.floor(y));
  return (
    t === DUNGEON_TILE_TYPES.FLOOR ||
    t === DUNGEON_TILE_TYPES.CORRIDOR ||
    t === DUNGEON_TILE_TYPES.STAIRS_DOWN ||
    t === DUNGEON_TILE_TYPES.STAIRS_UP
  );
}
