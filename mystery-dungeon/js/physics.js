import { TILE_TYPES } from './tile-map.js';

/**
 * Handles circle-to-tilemap collision detection and response
 */
export class Physics {
    static moveAndCollide(entity, map, dt) {
        const nextX = entity.x + entity.vx * dt;
        const nextY = entity.y + entity.vy * dt;
        
        // Horizontal collision
        if (this.isWalkable(nextX, entity.y, entity.radius, map)) {
            entity.x = nextX;
        } else {
            // Snap to wall? Or just stop. For now, just stop.
            entity.vx = 0;
        }

        // Vertical collision
        if (this.isWalkable(entity.x, nextY, entity.radius, map)) {
            entity.y = nextY;
        } else {
            entity.vy = 0;
        }
    }

    static isWalkable(x, y, r, map) {
        // Check corners of the bounding box
        const checkPoints = [
            { x: x - r, y: y - r },
            { x: x + r, y: y - r },
            { x: x - r, y: y + r },
            { x: x + r, y: y + r }
        ];

        for (const p of checkPoints) {
            const tx = Math.floor(p.x);
            const ty = Math.floor(p.y);
            const type = map.get(tx, ty);
            
            if (type === TILE_TYPES.WALL || type === TILE_TYPES.VOID) {
                return false;
            }
        }

        return true;
    }
}
