function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// Far-cry visual tuning knobs (opacity/fade per ring).
const FAR_CRY_SCREEN_RING_COUNT = 3;
const FAR_CRY_SCREEN_ALPHA_BASE = 0.32;
const FAR_CRY_SCREEN_ALPHA_PER_RING = 0.045;
const FAR_CRY_SCREEN_ALPHA_CUTOFF = 0.003;

const FAR_CRY_MINIMAP_RING_COUNT = 3;
const FAR_CRY_MINIMAP_ALPHA_BASE = 0.7;
const FAR_CRY_MINIMAP_ALPHA_PER_RING = 0.14;
const FAR_CRY_MINIMAP_ALPHA_CUTOFF = 0.01;

/**
 * Draw directional "Far Cry" rings entering from the screen edge.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ dirX: number, dirY: number, age: number, maxAge: number, seed?: number }>} waves
 * @param {{ w: number, h: number }} canvasSize
 */
export function drawFarCryScreenWaves(ctx, waves, canvasSize) {
  if (!Array.isArray(waves) || waves.length === 0) return;
  const w = Math.max(1, Number(canvasSize?.w) || 0);
  const h = Math.max(1, Number(canvasSize?.h) || 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  for (const wave of waves) {
    const maxAge = Math.max(0.001, Number(wave.maxAge) || 0.001);
    const t = clamp01((Number(wave.age) || 0) / maxAge);
    const fade = 1 - t;
    if (fade <= 0.001) continue;
    const dxRaw = Number(wave.dirX) || 0;
    const dyRaw = Number(wave.dirY) || 1;
    const len = Math.hypot(dxRaw, dyRaw) || 1;
    const dx = dxRaw / len;
    const dy = dyRaw / len;
    const edgeRadius = Math.hypot(w * 0.5, h * 0.5);
    const edgePad = Math.max(18, Math.min(w, h) * 0.06);
    const cx = w * 0.5 + dx * (edgeRadius + edgePad);
    const cy = h * 0.5 + dy * (edgeRadius + edgePad);
    const seed = Number(wave.seed) || 0;
    for (let i = 0; i < FAR_CRY_SCREEN_RING_COUNT; i++) {
      const phase = clamp01(t - i * 0.11);
      if (phase <= 0) continue;
      const r =
        Math.max(w, h) * (0.1 + phase * 0.6) +
        (i * 5 + seed * 9);
      const alpha = fade * (FAR_CRY_SCREEN_ALPHA_BASE - i * FAR_CRY_SCREEN_ALPHA_PER_RING);
      if (alpha <= FAR_CRY_SCREEN_ALPHA_CUTOFF) continue;
      const lineW = Math.max(1.2, Math.min(w, h) * (0.0028 + (1 - phase) * 0.0018));
      ctx.strokeStyle = `rgba(140, 220, 255, ${alpha.toFixed(4)})`;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Draw minimap echo rings at far-cry origin points.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ x: number, y: number, age: number, maxAge: number }>} echoes macro-space origins
 * @param {{ scale: number, ox: number, oy: number }} tf minimap transform
 * @param {{ w: number, h: number }} canvasSize
 */
export function drawFarCryMinimapEchoes(ctx, echoes, tf, canvasSize) {
  if (!Array.isArray(echoes) || echoes.length === 0) return;
  const w = Math.max(1, Number(canvasSize?.w) || 0);
  const h = Math.max(1, Number(canvasSize?.h) || 0);
  const scale = Math.max(0.001, Number(tf?.scale) || 0.001);
  const ox = Number(tf?.ox) || 0;
  const oy = Number(tf?.oy) || 0;
  ctx.save();
  for (const fx of echoes) {
    const maxAge = Math.max(0.001, Number(fx.maxAge) || 0.001);
    const t = clamp01((Number(fx.age) || 0) / maxAge);
    const fade = 1 - t;
    if (fade <= 0.001) continue;
    const sx = (Number(fx.x) - ox + 0.5) * scale;
    const sy = (Number(fx.y) - oy + 0.5) * scale;
    if (sx < -24 || sy < -24 || sx > w + 24 || sy > h + 24) continue;
    for (let i = 0; i < FAR_CRY_MINIMAP_RING_COUNT; i++) {
      const phase = clamp01(t - i * 0.12);
      if (phase <= 0) continue;
      const r = Math.max(4, scale * (0.16 + phase * 0.9)) + i * 1.7;
      const alpha = fade * (FAR_CRY_MINIMAP_ALPHA_BASE - i * FAR_CRY_MINIMAP_ALPHA_PER_RING);
      if (alpha <= FAR_CRY_MINIMAP_ALPHA_CUTOFF) continue;
      ctx.strokeStyle = `rgba(120, 240, 255, ${alpha.toFixed(4)})`;
      ctx.lineWidth = Math.max(1, Math.min(2.4, scale * 0.06));
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
