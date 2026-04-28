import { createRng, stringToSeed } from '../rng.js';
import { DUNGEON_TILE_TYPES, DungeonTileMap } from './tile-map.js';

function randomInt(rng, minInclusive, maxInclusive) {
  return Math.floor(rng.next() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

export function generateDeterministicDungeon(params) {
  const {
    width = 64,
    height = 64,
    worldSeed = 0,
    portalId = 'default-portal',
    minRooms = 8,
    maxRooms = 15,
    minRoomSize = 4,
    maxRoomSize = 9
  } = params || {};

  const map = new DungeonTileMap(width, height);
  map.fill(DUNGEON_TILE_TYPES.WALL);

  const seed = stringToSeed(`${worldSeed}:${portalId}`);
  const rng = createRng(seed);
  const rooms = [];
  const targetRooms = randomInt(rng, minRooms, maxRooms);

  for (let i = 0; i < targetRooms; i++) {
    const rw = randomInt(rng, minRoomSize, maxRoomSize);
    const rh = randomInt(rng, minRoomSize, maxRoomSize);
    const rx = randomInt(rng, 1, Math.max(1, width - rw - 2));
    const ry = randomInt(rng, 1, Math.max(1, height - rh - 2));
    const newRoom = {
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      centerX: Math.floor(rx + rw / 2),
      centerY: Math.floor(ry + rh / 2)
    };
    const overlaps = rooms.some((room) => {
      return !(
        newRoom.x + newRoom.w + 1 < room.x ||
        newRoom.x > room.x + room.w + 1 ||
        newRoom.y + newRoom.h + 1 < room.y ||
        newRoom.y > room.y + room.h + 1
      );
    });
    if (overlaps) continue;

    for (let y = newRoom.y; y < newRoom.y + newRoom.h; y++) {
      for (let x = newRoom.x; x < newRoom.x + newRoom.w; x++) {
        map.set(x, y, DUNGEON_TILE_TYPES.FLOOR);
      }
    }

    const prev = rooms[rooms.length - 1];
    if (prev) {
      if (rng.next() > 0.5) {
        digH(map, prev.centerX, newRoom.centerX, prev.centerY);
        digV(map, prev.centerY, newRoom.centerY, newRoom.centerX);
      } else {
        digV(map, prev.centerY, newRoom.centerY, prev.centerX);
        digH(map, prev.centerX, newRoom.centerX, newRoom.centerY);
      }
    }

    rooms.push(newRoom);
  }

  if (rooms.length === 0) {
    const fallbackX = Math.floor(width / 2);
    const fallbackY = Math.floor(height / 2);
    map.set(fallbackX, fallbackY, DUNGEON_TILE_TYPES.FLOOR);
    rooms.push({ centerX: fallbackX, centerY: fallbackY });
  }

  const first = rooms[0];
  const last = rooms[rooms.length - 1];
  map.set(first.centerX, first.centerY, DUNGEON_TILE_TYPES.STAIRS_DOWN);
  map.set(last.centerX, last.centerY, DUNGEON_TILE_TYPES.STAIRS_UP);

  return {
    seed,
    map,
    entry: { x: first.centerX, y: first.centerY },
    exit: { x: last.centerX, y: last.centerY }
  };
}

function digH(map, x1, x2, y) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    map.set(x, y, DUNGEON_TILE_TYPES.CORRIDOR);
  }
}

function digV(map, y1, y2, x) {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    map.set(x, y, DUNGEON_TILE_TYPES.CORRIDOR);
  }
}
