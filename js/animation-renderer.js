import { getWindPhaseOffset } from './perlin-wind.js';

/** Bins do seno (esquerda / centro / direita) — visual; cache só assa 2 ângulos. */
export const WIND_SWAY_BIN_COUNT = 3;

/**
 * Ângulos assados onde o tilt negativo é obtido por flip do tilt positivo (copas + grama espelhável).
 */
export const WIND_BAKE_ANGLES = [0, 0.03];

/** Grama assimétrica: três rotações explícitas no cache. */
const WIND_GRASS_BAKE_ANGLES = [-0.03, 0, 0.03];

/** IDs 1x1 no nature tileset com arte espelhável — 2 bakes + flip como as copas. */
const WIND_GRASS_MIRROR_TILE_IDS = new Set([117, 118, 60, 61]);

/**
 * @param {number} logicalFrameIndex índice de 0 .. WIND_SWAY_BIN_COUNT-1
 * @returns {{ bakeSlot: number, flipX: boolean }} bakeSlot indexa WIND_BAKE_ANGLES
 */
export function resolveWindSwayBake(logicalFrameIndex) {
  const i = Math.max(0, Math.min(WIND_SWAY_BIN_COUNT - 1, logicalFrameIndex | 0));
  if (i === 1) return { bakeSlot: 0, flipX: false };
  if (i === 0) return { bakeSlot: 1, flipX: true };
  return { bakeSlot: 1, flipX: false };
}

/**
 * AnimationRenderer
 * Gesto de frames pré-renderizados para balanço de vegetação (Vento).
 */
export const AnimationRenderer = {
  // Cache de frames (Tiny Canvases)
  // Keys: …-g0|g1|g2 (grama assimétrica), …-sym-b0|b1 (grama / copas com flip)
  cache: new Map(),

  /**
   * @param {HTMLImageElement} img O Tileset original
   * @param {number} tileId O ID do tile no tileset
   * @param {number} logicalFrameIndex bin do vento (0..WIND_SWAY_BIN_COUNT-1)
   * @param {number} cols Número de colunas no tileset
   * @returns {{ canvas: HTMLCanvasElement, flipX: boolean } | null}
   */
  getWindFrame(img, tileId, logicalFrameIndex, cols) {
    if (!img || tileId == null || tileId < 0) return null;

    const i = Math.max(0, Math.min(WIND_SWAY_BIN_COUNT - 1, logicalFrameIndex | 0));

    const bakeOne = (angleRad) => {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 32;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = false;
      const sx = (tileId % cols) * 16;
      const sy = Math.floor(tileId / cols) * 16;
      ctx.save();
      ctx.translate(8, 31);
      ctx.rotate(angleRad);
      ctx.drawImage(img, sx, sy, 16, 16, -8, -15, 16, 16);
      ctx.restore();
      return canvas;
    };

    if (WIND_GRASS_MIRROR_TILE_IDS.has(tileId)) {
      const { bakeSlot, flipX } = resolveWindSwayBake(i);
      const key = `${img.src}-${tileId}-sym-b${bakeSlot}`;
      let canvas = this.cache.get(key);
      if (!canvas) {
        const angle = WIND_BAKE_ANGLES[bakeSlot] || 0;
        canvas = bakeOne(angle);
        if (!canvas) return null;
        this.cache.set(key, canvas);
      }
      return { canvas, flipX };
    }

    const key = `${img.src}-${tileId}-g${i}`;
    let canvas = this.cache.get(key);
    if (!canvas) {
      const angle = WIND_GRASS_BAKE_ANGLES[i] || 0;
      canvas = bakeOne(angle);
      if (!canvas) return null;
      this.cache.set(key, canvas);
    }
    return { canvas, flipX: false };
  },

  /**
   * @param {number} time Tempo atual (s)
   * @param {number} mx Posição X (world)
   * @param {number} my Posição Y (world)
   */
  getFrameIndex(time, mx, my) {
    const phase = getWindPhaseOffset(mx, my);
    const wave = Math.sin(time * 2.0 + phase);

    const frameCount = WIND_SWAY_BIN_COUNT || 1;
    const normalized = (wave + 1) * 0.5;
    const idx = Math.floor(normalized * frameCount);
    return Math.max(0, Math.min(frameCount - 1, idx));
  }
};
