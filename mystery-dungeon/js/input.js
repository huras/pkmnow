/**
 * Handles keyboard input for real-time control
 */
export class InputHandler {
    constructor() {
        this.keys = new Set();
        
        window.addEventListener('keydown', (e) => {
            this.keys.add(e.code);
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys.delete(e.code);
        });
    }

    isPressed(code) {
        return this.keys.has(code);
    }

    get axisX() {
        let x = 0;
        if (this.isPressed('ArrowLeft') || this.isPressed('KeyA')) x -= 1;
        if (this.isPressed('ArrowRight') || this.isPressed('KeyD')) x += 1;
        return x;
    }

    get axisY() {
        let y = 0;
        if (this.isPressed('ArrowUp') || this.isPressed('KeyW')) y -= 1;
        if (this.isPressed('ArrowDown') || this.isPressed('KeyS')) y += 1;
        return y;
    }

    get isActionPressed() {
        return this.isPressed('Space') || this.isPressed('KeyZ');
    }
}
