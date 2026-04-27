import { Entity } from './entity.js';
import { Physics } from './physics.js';

/**
 * Real-time Player Controller
 */
export class Player extends Entity {
    constructor(x, y) {
        super(x, y);
        this.radius = 0.35;
        this.speed = 5.0;
    }

    update(dt, map, input) {
        const ax = input.axisX;
        const ay = input.axisY;

        // Normalization for diagonal movement
        if (ax !== 0 && ay !== 0) {
            const mag = Math.sqrt(ax * ax + ay * ay);
            this.vx = (ax / mag) * this.speed;
            this.vy = (ay / mag) * this.speed;
        } else {
            this.vx = ax * this.speed;
            this.vy = ay * this.speed;
        }

        if (ax < 0) this.facing = 'left';
        else if (ax > 0) this.facing = 'right';
        if (ay < 0) this.facing = 'up';
        else if (ay > 0) this.facing = 'down';

        // Apply physics
        Physics.moveAndCollide(this, map, dt);
    }

    draw(ctx, tileSize) {
        // Draw player as a blue circle for now
        ctx.fillStyle = '#42a5f5';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#42a5f5';
        
        ctx.beginPath();
        ctx.arc(
            this.x * tileSize, 
            this.y * tileSize, 
            this.radius * tileSize, 
            0, Math.PI * 2
        );
        ctx.fill();
        
        // Facing indicator
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.x * tileSize, this.y * tileSize);
        let fx = this.x;
        let fy = this.y;
        if (this.facing === 'left') fx -= 0.3;
        else if (this.facing === 'right') fx += 0.3;
        else if (this.facing === 'up') fy -= 0.3;
        else if (this.facing === 'down') fy += 0.3;
        
        ctx.lineTo(fx * tileSize, fy * tileSize);
        ctx.stroke();
        
        ctx.shadowBlur = 0;
    }
}
