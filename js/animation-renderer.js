import { getWindPhaseOffset } from './perlin-wind.js';

/** Master switch: when false, wind mirror optimization is disabled. */
export const ENABLE_WIND_MIRROR_OPTIMIZATION = false;

/** Tree canopy sway bins (left-strong, left-soft, center, right-soft, right-strong). */
export const TREE_WIND_SWAY_BIN_COUNT = 5;
/** Grass sway bins kept coarse to protect cache/CPU. */
const GRASS_WIND_SWAY_BIN_COUNT = 3;

/**
 * Mirror-optimized bake slots (center, soft, strong).
 */
export const WIND_BAKE_ANGLES = [0, 0.015, 0.03];

/** Grama assimétrica: três rotações explícitas no cache. */
const WIND_GRASS_BAKE_ANGLES = [-0.03, 0, 0.03];

/** IDs 1x1 no nature tileset com arte espelhável — 2 bakes + flip como as copas. */
const WIND_GRASS_MIRROR_TILE_IDS = new Set([117, 118, 60, 61]);

/**
 * @param {number} logicalFrameIndex
 * @param {number} frameCount
 * @returns {{ bakeSlot: number, flipX: boolean }} bakeSlot indexa WIND_BAKE_ANGLES
 */
export function resolveWindSwayBake(logicalFrameIndex, frameCount = TREE_WIND_SWAY_BIN_COUNT) {
  const n = Math.max(1, Math.floor(frameCount || 1));
  const i = Math.max(0, Math.min(n - 1, logicalFrameIndex | 0));

  if (!ENABLE_WIND_MIRROR_OPTIMIZATION) {
    // Direct bins: no horizontal flip reuse.
    return { bakeSlot: i, flipX: false };
  }

  // 5-bin canopy profile: strong/soft/center/soft/strong.
  if (n >= 5) {
    if (i <= 1) return { bakeSlot: 2 - i, flipX: true };
    if (i === 2) return { bakeSlot: 0, flipX: false };
    if (i >= n - 2) return { bakeSlot: i - (n - 3), flipX: false };
  }

  // 3-bin profile: left/center/right using strong tilt only.
  if (n === 3) {
    if (i === 1) return { bakeSlot: 0, flipX: false };
    if (i === 0) return { bakeSlot: 2, flipX: true };
    return { bakeSlot: 2, flipX: false };
  }

  // Fallback for unexpected counts.
  if (i === 0) return { bakeSlot: 2, flipX: true };
  if (i === n - 1) return { bakeSlot: 2, flipX: false };
  return { bakeSlot: 0, flipX: false };
}

/**
 * Returns the angle for a resolved bake slot.
 * With mirror optimization disabled, uses full non-mirrored angle ramps.
 *
 * @param {number} bakeSlot
 * @param {number} frameCount
 */
export function getWindBakeAngle(bakeSlot, frameCount = TREE_WIND_SWAY_BIN_COUNT) {
  if (ENABLE_WIND_MIRROR_OPTIMIZATION) {
    return WIND_BAKE_ANGLES[bakeSlot] || 0;
  }
  if (frameCount >= 5) {
    const fullAngles5 = [-0.03, -0.015, 0, 0.015, 0.03];
    return fullAngles5[bakeSlot] || 0;
  }
  const fullAngles3 = [-0.03, 0, 0.03];
  return fullAngles3[bakeSlot] || 0;
}

/**
 * AnimationRenderer
 * Gesto de frames pré-renderizados para balanço de vegetação (Vento).
 */
export const AnimationRenderer = {
  // Cache de frames (Tiny Canvases)
  // Keys: …-g0|g1|g2 (grama assimétrica), …-sym-b0|b1|b2 (grama / copas com flip)
  cache: new Map(),

  /**
   * @param {HTMLImageElement} img O Tileset original
   * @param {number} tileId O ID do tile no tileset
   * @param {number} logicalFrameIndex bin do vento da grama (0..GRASS_WIND_SWAY_BIN_COUNT-1)
   * @param {number} cols Número de colunas no tileset
   * @returns {{ canvas: HTMLCanvasElement, flipX: boolean } | null}
   */
  getWindFrame(img, tileId, logicalFrameIndex, cols) {
    if (!img || tileId == null || tileId < 0) return null;

    const i = Math.max(0, Math.min(GRASS_WIND_SWAY_BIN_COUNT - 1, logicalFrameIndex | 0));

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

    if (ENABLE_WIND_MIRROR_OPTIMIZATION && WIND_GRASS_MIRROR_TILE_IDS.has(tileId)) {
      const { bakeSlot, flipX } = resolveWindSwayBake(i, GRASS_WIND_SWAY_BIN_COUNT);
      const key = `${img.src}-${tileId}-sym-b${bakeSlot}`;
      let canvas = this.cache.get(key);
      if (!canvas) {
        const angle = getWindBakeAngle(bakeSlot, GRASS_WIND_SWAY_BIN_COUNT);
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

    const frameCount = TREE_WIND_SWAY_BIN_COUNT || 1;
    const normalized = (wave + 1) * 0.5;
    const idx = Math.floor(normalized * frameCount);
    return Math.max(0, Math.min(frameCount - 1, idx));
  },

  /**
   * @param {number} time Tempo atual (s)
   * @param {number} mx Posição X (world)
   * @param {number} my Posição Y (world)
   */
  getGrassFrameIndex(time, mx, my) {
    const phase = getWindPhaseOffset(mx, my);
    const wave = Math.sin(time * 2.0 + phase);

    const frameCount = GRASS_WIND_SWAY_BIN_COUNT || 1;
    const normalized = (wave + 1) * 0.5;
    const idx = Math.floor(normalized * frameCount);
    return Math.max(0, Math.min(frameCount - 1, idx));
  }
};
