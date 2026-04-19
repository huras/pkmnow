import { imageCache } from '../image-cache.js';
import { ensurePokemonSheetsLoaded, getResolvedSheets } from '../pokemon/pokemon-asset-loader.js';
import { resolvePmdFrameSpecForSlice, resolveCanonicalPmdH } from '../pokemon/pmd-layout-metrics.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';
import { PMD_DEFAULT_MON_ANIMS, PMD_MON_SHEET } from '../pokemon/pmd-default-timing.js';
import { POKEMON_HEIGHTS } from '../pokemon/pokemon-config.js';

const DIRECTION_ROW_MAP = Object.freeze({
  down: 0,
  'down-right': 1,
  right: 2,
  'up-right': 3,
  up: 4,
  'up-left': 5,
  left: 6,
  'down-left': 7
});

/** @type {(keyof typeof DIRECTION_ROW_MAP)[]} */
const FACINGS = [
  'down',
  'down-right',
  'right',
  'up-right',
  'up',
  'up-left',
  'left',
  'down-left'
];

function pickPmdSeqFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return Math.max(0, seq.length - 1);
}

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * PMD walk/idle preview for Pokémon Box detail — random facings + idle pauses.
 * @param {HTMLCanvasElement} canvas
 * @param {number} dexId
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startPokemonBoxDetailSpritePreview(canvas, dexId) {
  const d = Math.max(1, Math.floor(Number(dexId) || 1));
  await ensurePokemonSheetsLoaded(imageCache, d);
  const { walk: wWalk, idle: wIdle } = getResolvedSheets(imageCache, d);
  if (!wWalk && !wIdle) {
    return { stop() {} };
  }

  const reducedMotion =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let stopped = false;
  let raf = 0;
  let lastPerfMs = performance.now();
  /** @type {'idle'|'walk'} */
  let mode = 'idle';
  let modeEndSec = 0;
  /** @type {keyof typeof DIRECTION_ROW_MAP} */
  let facing = 'down';
  let animRow = 0;
  let animFrame = 0;
  let idleTick = 0;
  let walkDist = 0;
  let facingChangeAt = 0;

  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop() {} };

  function pickFacing() {
    return FACINGS[Math.floor(Math.random() * FACINGS.length)];
  }

  function tickFrame(nowMs) {
    const nowSec = nowMs * 0.001;
    if (nowSec >= modeEndSec) {
      if (mode === 'idle') {
        mode = 'walk';
        modeEndSec = nowSec + rnd(1.5, 3.2);
        facing = pickFacing();
        animRow = DIRECTION_ROW_MAP[facing] ?? 0;
        facingChangeAt = nowSec + rnd(0.35, 0.95);
      } else {
        mode = 'idle';
        modeEndSec = nowSec + rnd(0.85, 2.4);
      }
    }

    const meta = getDexAnimMeta(d);
    const dt = Math.min(0.12, (nowMs - lastPerfMs) * 0.001);
    lastPerfMs = nowMs;

    if (reducedMotion) {
      const seq = meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle;
      animFrame = 0;
      animRow = DIRECTION_ROW_MAP.down;
      idleTick += dt * 60;
      const totalTicks = seq.reduce((a, b) => a + b, 0);
      const loopTick = idleTick % totalTicks;
      animFrame = pickPmdSeqFrame(seq, loopTick);
      return;
    }

    if (mode === 'walk') {
      if (nowSec >= facingChangeAt) {
        facing = pickFacing();
        animRow = DIRECTION_ROW_MAP[facing] ?? 0;
        facingChangeAt = nowSec + rnd(0.38, 1.05);
      }
      walkDist += dt * 2.9;
      const seq = meta?.walk?.durations || PMD_DEFAULT_MON_ANIMS.Walk;
      const totalTicks = seq.reduce((a, b) => a + b, 0);
      const loopTick = (walkDist * 60 * 0.34) % totalTicks;
      animFrame = pickPmdSeqFrame(seq, loopTick);
    } else {
      idleTick += dt * 60;
      const seq = meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle;
      const totalTicks = seq.reduce((a, b) => a + b, 0);
      const loopTick = idleTick % totalTicks;
      animFrame = pickPmdSeqFrame(seq, loopTick);
    }
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    const useWalk = mode === 'walk' && wWalk;
    const sheet = useWalk ? wWalk : wIdle || wWalk;
    if (!sheet) {
      ctx.restore();
      return;
    }
    const slice = useWalk ? 'walk' : 'idle';
    const { sw, sh, animCols } = resolvePmdFrameSpecForSlice(sheet, d, slice);
    const canonicalH = resolveCanonicalPmdH(wIdle || wWalk, wWalk || wIdle, d);
    const targetHeightTiles = POKEMON_HEIGHTS[d] || 1.1;
    const virtualTileH = 36;
    const finalScale = (targetHeightTiles * virtualTileH) / Math.max(1, canonicalH);
    const dw = sw * finalScale;
    const dh = sh * finalScale;
    const sx = (animFrame % animCols) * sw;
    const sy = animRow * sh;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(w / 2), Math.round(h * 0.52));
    ctx.drawImage(sheet, sx, sy, sw, sh, -dw * 0.5, -dh * PMD_MON_SHEET.pivotYFrac, dw, dh);
    ctx.restore();
  }

  function loop(t) {
    if (stopped) return;
    tickFrame(t);
    draw();
    raf = requestAnimationFrame(loop);
  }

  mode = 'idle';
  modeEndSec = performance.now() * 0.001 + rnd(0.45, 1.1);
  lastPerfMs = performance.now();
  raf = requestAnimationFrame(loop);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    }
  };
}
