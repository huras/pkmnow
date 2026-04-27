import { TILE_TYPES, DungeonMap } from './tile-map.js';

/**
 * Simple Random Room Generator for Mystery Dungeon
 */
export class DungeonGenerator {
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }

    generate(params = {}) {
        const {
            minRooms = 5,
            maxRooms = 10,
            minRoomSize = 3,
            maxRoomSize = 8
        } = params;

        const map = new DungeonMap(this.width, this.height);
        map.fill(TILE_TYPES.WALL);

        const rooms = [];
        const numRooms = Math.floor(Math.random() * (maxRooms - minRooms + 1)) + minRooms;

        for (let i = 0; i < numRooms; i++) {
            const w = Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1)) + minRoomSize;
            const h = Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1)) + minRoomSize;
            const x = Math.floor(Math.random() * (this.width - w - 2)) + 1;
            const y = Math.floor(Math.random() * (this.height - h - 2)) + 1;

            const newRoom = { x, y, w, h, centerX: Math.floor(x + w / 2), centerY: Math.floor(y + h / 2) };

            // Simple overlap check
            const overlaps = rooms.some(r => {
                return !(newRoom.x + newRoom.w < r.x ||
                         newRoom.x > r.x + r.w ||
                         newRoom.y + newRoom.h < r.y ||
                         newRoom.y > r.y + r.h);
            });

            if (!overlaps) {
                // Dig room
                for (let ry = newRoom.y; ry < newRoom.y + h; ry++) {
                    for (let rx = newRoom.x; rx < newRoom.x + w; rx++) {
                        map.set(rx, ry, TILE_TYPES.FLOOR);
                    }
                }

                if (rooms.length > 0) {
                    // Connect to previous room
                    const prev = rooms[rooms.length - 1];
                    this.createCorridor(map, prev.centerX, prev.centerY, newRoom.centerX, newRoom.centerY);
                }

                rooms.push(newRoom);
            }
        }

        return map;
    }

    createCorridor(map, x1, y1, x2, y2) {
        // Horizontal then vertical
        if (Math.random() > 0.5) {
            this.hLine(map, x1, x2, y1);
            this.vLine(map, y1, y2, x2);
        } else {
            this.vLine(map, y1, y2, x1);
            this.hLine(map, x1, x2, y2);
        }
    }

    hLine(map, x1, x2, y) {
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
            map.set(x, y, TILE_TYPES.FLOOR);
        }
    }

    vLine(map, y1, y2, x) {
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
            map.set(x, y, TILE_TYPES.FLOOR);
        }
    }
}
