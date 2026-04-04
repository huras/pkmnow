/**
 * AnimationRenderer
 * Gesto de frames pré-renderizados para balanço de vegetação (Vento).
 */
export const AnimationRenderer = {
    // Cache de frames (Tiny Canvases)
    // Key format: "imageURI-tileId-frameIndex"
    cache: new Map(),

    // Configurações de balanço (Sutil)
    // Usamos 3 frames para o balanço clássico sutil
    WIND_ANGLES: [-0.04, 0, 0.04],

    /**
     * Retorna um frame pré-renderizado (Canvas) para o balanço de vento.
     * @param {HTMLImageElement} img O Tileset original
     * @param {number} tileId O ID do tile no tileset
     * @param {number} frameIndex O índice do frame (0, 1, 2)
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
        // Mesmo offset das árvores para sincronizar o "mar de vegetação"
        const offset = (mx * 0.3 + my * 0.7);
        const wave = Math.sin(time * 2.0 + offset);
        
        // Mapeia Seno (-1 a 1) para índice (0, 1, 2)
        if (wave < -0.33) return 0; // Esquerda
        if (wave > 0.33) return 2;  // Direita
        return 1;                   // Centro
    }
};
