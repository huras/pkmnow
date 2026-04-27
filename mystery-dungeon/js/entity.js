/**
 * Base class for all moving objects in the dungeon
 */
export class Entity {
    constructor(x, y) {
        this.x = x; // Grid coordinates (float)
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = 0.3; // Collision radius (units of tiles)
        this.speed = 4.5; // Tiles per second
        
        this.facing = 'down';
    }

    update(dt, map) {
        // Basic movement logic would be overridden or called by children
    }

    draw(ctx, tileSize) {
        // Placeholder draw
        ctx.fillStyle = '#ff0';
        ctx.beginPath();
        ctx.arc(this.x * tileSize, this.y * tileSize, this.radius * tileSize, 0, Math.PI * 2);
        ctx.fill();
    }
}
