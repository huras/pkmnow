export const DUNGEON_TILE_TYPES = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  CORRIDOR: 3,
  STAIRS_DOWN: 4,
  STAIRS_UP: 5
};

export class DungeonTileMap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Int8Array(width * height).fill(DUNGEON_TILE_TYPES.VOID);
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return DUNGEON_TILE_TYPES.VOID;
    return this.data[y * this.width + x];
  }

  set(x, y, type) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[y * this.width + x] = type;
  }

  fill(type) {
    this.data.fill(type);
  }
}
