import { getWindPhaseOffset } from './perlin-wind.js';

/**
 * AnimationRenderer
 * Gesto de frames pré-renderizados para balanço de vegetação (Vento).
 */
export const AnimationRenderer = {
    // Cache de frames (Tiny Canvases)
    // Key format: "imageURI-tileId-frameIndex"
    cache: new Map(),

    /**
     * 7 frames para balanço suave (antes: 3 frames com buckets grosseiros causavam "pulos" visíveis).
     * Pico ±0.07 rad ≈ ±4° — sutil, não quebra pixel art.
     * Cache cresce 2.3×, mas canopy-sway-cache suporta 1500 entries (bumpado em fix anterior).
     */
    WIND_ANGLES: [-0.07, -0.045, -0.02, 0, 0.02, 0.045, 0.07],

    /**
     * Retorna um frame pré-renderizado (Canvas) para o balanço de vento.
     * @param {HTMLImageElement} img O Tileset original
     * @param {number} tileId O ID do tile no tileset
     * @param {number} frameIndex O índice do frame (0..WIND_ANGLES.length-1)
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
     * Calcula frameIndex baseado em tempo + posição.
     * Mapa contínuo `wave (-1..1)` → `idx (0..N-1)` em vez de 3 buckets discretos.
     * @param {number} time Tempo atual (s)
     * @param {number} mx Posição X (world)
     * @param {number} my Posição Y (world)
     */
    getFrameIndex(time, mx, my) {
        // Quantização temporal: snap do tempo para bucket de 143ms (7 Hz).
        // Efeito: frameIndex só pode mudar 7×/seg em vez de 60×/seg. Imperceptível a olho humano
        // (rotação sutil de ±4°), mas elimina thrashing de compositeCache em biomas densos —
        // entre re-quantizações, o MESMO composite é reusado ~8 frames seguidos = cache hit garantido.
        const tQuant = Math.floor(time * 7) / 7;

        // Fase por célula: Perlin (escala baixa) + cache em perlin-wind.js — não recalcula todo frame.
        // Amplitude reduzida dentro de perlin-wind.js cria efeito de onda coerente (trees próximas balançam juntas).
        const phase = getWindPhaseOffset(mx, my);
        const wave = Math.sin(tQuant * 1.6 + phase); // 1.6 rad/s = ~0.25 Hz (orgânico)

        // Mapeia (-1..1) → (0..N-1) continuamente. Math.round pra ficar no frame mais próximo.
        const N = this.WIND_ANGLES.length;
        const idx = Math.round((wave + 1) * 0.5 * (N - 1));
        return idx < 0 ? 0 : idx >= N ? N - 1 : idx;
    }
};
