import { TILE_TYPES } from './tile-map.js';

/**
 * Handles rendering the dungeon grid to the canvas
 */
export class GridRenderer {
    constructor(tileSize = 16) {
        this.tileSize = tileSize;
        
        // Colors for debug/placeholder
        this.colors = {
            [TILE_TYPES.VOID]: '#000',
            [TILE_TYPES.FLOOR]: '#444',
            [TILE_TYPES.WALL]: '#222',
            [TILE_TYPES.CORRIDOR]: '#333'
        };
    }

    render(ctx, map, camera) {
        const { width, height } = map;
        const ts = this.tileSize;

        // Simple culling (could be improved with camera offsets)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const type = map.get(x, y);
                ctx.fillStyle = this.colors[type] || '#f0f';
                
                // For now, just draw tiles at their grid positions
                // We'll add camera offset logic later
                ctx.fillRect(x * ts, y * ts, ts - 1, ts - 1);
            }
        }
    }
}
