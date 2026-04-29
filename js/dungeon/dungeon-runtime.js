import { DUNGEON_TILE_TYPES } from './tile-map.js';
import { generateDeterministicDungeon } from './dungeon-generator.js';
import { stringToSeed } from '../rng.js';

const state = {
  active: false,
  portalId: '',
  dungeonId: '',
  biomeId: 0,
  worldSeed: 0,
  map: null,
  playerX: 0,
  playerY: 0,
  facing: 'down',
  animRow: 0,
  animFrame: 0,
  animClockSec: 0,
  animMoving: false,
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
  const entranceId = String(params?.portalId || '');
  if (!entranceId) return false;
  const dungeonId = String(params?.dungeonId || entranceId);
  const worldSeed = Number(params?.worldSeed) || 0;
  const cacheKey = `${worldSeed}:${dungeonId}`;
  let generated = dungeonCache.get(cacheKey);
  if (!generated) {
    generated = generateDeterministicDungeon({
      worldSeed,
      portalId: dungeonId
    });
    dungeonCache.set(cacheKey, generated);
  }

  const spawn = resolveEntrySpawnPoint(generated.map, generated.entry, generated.exit, entranceId);
  state.active = true;
  state.portalId = entranceId;
  state.dungeonId = dungeonId;
  state.biomeId = Number(params?.biomeId) || 0;
  state.worldSeed = worldSeed;
  state.map = generated.map;
  state.entry = generated.entry;
  state.exit = generated.exit;
  state.playerX = spawn.x + 0.5;
  state.playerY = spawn.y + 0.5;
  state.facing = 'down';
  state.animRow = 0;
  state.animFrame = 0;
  state.animClockSec = 0;
  state.animMoving = false;
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
    portalId: state.portalId,
    dungeonId: state.dungeonId
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
  state.animMoving = len > 1e-4;
  if (len > 1e-4) {
    const ux = ix / len;
    const uy = iy / len;
    applyFacingFromInput(ux, uy);
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
  if (state.animMoving) {
    state.animClockSec += d;
    state.animFrame = Math.floor(state.animClockSec * 8) % 4;
  } else {
    state.animClockSec = 0;
    state.animFrame = 0;
  }

  const px = Math.floor(state.playerX);
  const py = Math.floor(state.playerY);
  const tile = state.map.get(px, py);
  if (tile !== DUNGEON_TILE_TYPES.STAIRS_DOWN) state.exitArmed = true;
  const isExitTile =
    tile === DUNGEON_TILE_TYPES.STAIRS_UP || tile === DUNGEON_TILE_TYPES.STAIRS_DOWN;
  const wantsExit = state.exitArmed && isExitTile;
  return { wantsExit };
}

function applyFacingFromInput(ix, iy) {
  const x = Number(ix) || 0;
  const y = Number(iy) || 0;
  if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) return;
  let key = 'down';
  if (x > 0.33 && y < -0.33) key = 'up-right';
  else if (x < -0.33 && y < -0.33) key = 'up-left';
  else if (x > 0.33 && y > 0.33) key = 'down-right';
  else if (x < -0.33 && y > 0.33) key = 'down-left';
  else if (Math.abs(x) >= Math.abs(y)) key = x < 0 ? 'left' : 'right';
  else key = y < 0 ? 'up' : 'down';
  state.facing = key;
  state.animRow = DIRECTION_ROW_MAP[key] || 0;
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

function isWalkableAt(x, y, map) {
  const t = map.get(Math.floor(x), Math.floor(y));
  return (
    t === DUNGEON_TILE_TYPES.FLOOR ||
    t === DUNGEON_TILE_TYPES.CORRIDOR ||
    t === DUNGEON_TILE_TYPES.STAIRS_DOWN ||
    t === DUNGEON_TILE_TYPES.STAIRS_UP
  );
}

function resolveEntrySpawnPoint(map, fallbackEntry, fallbackExit, entranceId) {
  if (!map) return fallbackEntry;
  const candidates = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.get(x, y);
      const walkable = t === DUNGEON_TILE_TYPES.FLOOR || t === DUNGEON_TILE_TYPES.CORRIDOR;
      if (!walkable) continue;
      if (x === fallbackEntry?.x && y === fallbackEntry?.y) continue;
      if (x === fallbackExit?.x && y === fallbackExit?.y) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return fallbackEntry || { x: 1, y: 1 };
  const seed = stringToSeed(String(entranceId || 'entrance-default'));
  const idx = Math.abs(seed % candidates.length);
  return candidates[idx];
}
