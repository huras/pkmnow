import { getWindPhaseOffset } from './perlin-wind.js';

/**
 * AnimationRenderer
 * Gesto de frames pré-renderizados para balanço de vegetação (Vento).
 */
export const AnimationRenderer = {
    // Cache de frames (Tiny Canvases)
    // Key format: "imageURI-tileId-frameIndex"
    cache: new Map(),

    // Configurações de balanço (Sutil)
    // 11 frames deixam o vento ainda mais suave e fluido ao longo do ciclo.
    WIND_ANGLES: [
        -0.06,
        -0.048,
        -0.036,
        -0.024,
        -0.012,
        0,
        0.012,
        0.024,
        0.036,
        0.048,
        0.06
    ],

    /**
     * Retorna um frame pré-renderizado (Canvas) para o balanço de vento.
     * @param {HTMLImageElement} img O Tileset original
     * @param {number} tileId O ID do tile no tileset
     * @param {number} frameIndex O índice do frame (0 a WIND_ANGLES.length - 1)
     * @param {number} cols Número de colunas no tileset
     */
    getWindFrame(img, tileId, frameIndex, cols) {
        if (!img || tileId == null || tileId < 0) return null;

        const key = `${img.src}-${tileId}-${frameIndex}`;
        if (this.cache.has(key)) return this.cache.get(key);

        // Criar um novo mini-canvas para este frame
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 32; // Dobramos a altura para garantir que topos não sejam cortados
        const ctx = canvas.getContext('2d', { alpha: true });
        ctx.imageSmoothingEnabled = false; // PIXEL ART: Mantém os pixels nítidos na rotação

        const angle = this.WIND_ANGLES[frameIndex] || 0;
        const sx = (tileId % cols) * 16;
        const sy = Math.floor(tileId / cols) * 16;

        // Desenhar rotacionado
        ctx.save();
        // Pivot no rodapé do tile (x:8, y:31)
        ctx.translate(8, 31);
        ctx.rotate(angle);
        ctx.drawImage(
            img,
            sx, sy, 16, 16,
            -8, -15, 16, 16
        );
        ctx.restore();

        this.cache.set(key, canvas);
        return canvas;
    },

    /**
     * Calcula qual frameIndex usar baseado no tempo e posição.
     * @param {number} time Tempo atual (s)
     * @param {number} mx Posição X (world)
     * @param {number} my Posição Y (world)
     */
    getFrameIndex(time, mx, my) {
        // Fase por célula: Perlin (escala baixa) + cache em perlin-wind.js — não recalcula todo frame.
        const phase = getWindPhaseOffset(mx, my);
        const wave = Math.sin(time * 2.0 + phase);
        
        const frameCount = this.WIND_ANGLES.length || 1;
        // Mapeia Seno (-1 a 1) para índice de frame (0 a frameCount - 1)
        const normalized = (wave + 1) * 0.5;
        const idx = Math.floor(normalized * frameCount);
        return Math.max(0, Math.min(frameCount - 1, idx));
    }
};
