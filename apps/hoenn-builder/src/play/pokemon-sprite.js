/**
 * @fileoverview Self-contained PMD sprite loader for the hoenn-builder play
 * mode. Loads `tilesets/pokemon/{NNN}_walk.png` and `_idle.png` for a given
 * national dex id, derives per-frame dimensions from
 * `js/pokemon/pmd-anim-metadata.js` (PMD sheets are NOT always square), and
 * exposes a tiny API to draw the correct cell given a facing + frame index.
 *
 * Why pull from the main game's metadata? The PNG dimensions alone aren't
 * enough — e.g. `004_walk.png` is 128×256 with 4-col rows of 32×32 cells,
 * while `004_idle.png` is 128×320 with 4-col rows of 40-tall cells. The
 * metadata gives us authoritative `frameWidth`/`frameHeight`/`durations`.
 *
 * Layout (SpriteCollab convention): 8 rows = 8 facings, columns = frames.
 * Row order matches `FACING_ROWS` below (same as the main game's PMD).
 */

import { getDexAnimMeta } from '../../../../js/pokemon/pmd-anim-metadata.js';

/** PMD/SpriteCollab row mapping for 8-way facings. */
export const FACING_ROWS = {
  down: 0,
  'down-right': 1,
  right: 2,
  'up-right': 3,
  up: 4,
  'up-left': 5,
  left: 6,
  'down-left': 7,
};

const DEFAULT_FALLBACK_DEX = 4; // Charmander — known to have all standard sheets bundled.

/**
 * @typedef {object} PmdSheet
 * @property {HTMLImageElement|null} img    Decoded image (null if load failed).
 * @property {number} frameW                 Cell width in px.
 * @property {number} frameH                 Cell height in px.
 * @property {number} cols                   Number of frames per row.
 * @property {number[]} durations            Per-frame durations (PMD ticks, ~1/60s each).
 * @property {number} totalTicks             Sum of `durations`.
 */

/**
 * @typedef {object} PokemonSprite
 * @property {number} dexId
 * @property {PmdSheet} walk
 * @property {PmdSheet} idle
 */

/** @type {Map<number, Promise<PokemonSprite>>} */
const inflight = new Map();
/** @type {Map<number, PokemonSprite>} */
const cache = new Map();

function padDex3(dexId) {
  return String(Math.max(1, Math.floor(Number(dexId) || 1))).padStart(3, '0');
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Build a `PmdSheet` from a loaded image + slice metadata. When metadata is
 * missing (or the species isn't in `PMD_ANIM_METADATA`), falls back to
 * assuming square frames with 8 rows.
 */
function buildSheet(img, slice) {
  if (!img) {
    return { img: null, frameW: 0, frameH: 0, cols: 0, durations: [], totalTicks: 0 };
  }
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  let frameW;
  let frameH;
  if (slice && slice.frameWidth && slice.frameHeight) {
    frameW = slice.frameWidth;
    frameH = slice.frameHeight;
  } else {
    frameH = Math.floor(H / 8);
    frameW = frameH;
  }
  const cols = Math.max(1, Math.floor(W / frameW));
  const durations = Array.isArray(slice?.durations) && slice.durations.length
    ? slice.durations.slice(0, cols)
    : Array(cols).fill(8);
  const totalTicks = durations.reduce((a, b) => a + b, 0);
  return { img, frameW, frameH, cols, durations, totalTicks };
}

/**
 * Load (or return cached) walk+idle PMD sheets for `dexId`. Falls back to
 * Charmander (#4) when both sheets fail to decode. Concurrent calls for the
 * same dex share the same promise.
 *
 * @param {number} dexId
 * @param {string} [baseUrl] Optional URL prefix for `tilesets/...` (defaults
 *   to a path relative to this module that points at the workspace root).
 * @returns {Promise<PokemonSprite>}
 */
export function loadPokemonSprite(dexId, baseUrl) {
  const dex = Math.max(1, Math.floor(Number(dexId) || DEFAULT_FALLBACK_DEX));
  if (cache.has(dex)) return Promise.resolve(cache.get(dex));
  const existing = inflight.get(dex);
  if (existing) return existing;

  const base = baseUrl != null ? baseUrl : new URL('../../../../', import.meta.url).href;
  const id = padDex3(dex);
  const walkUrl = `${base}tilesets/pokemon/${id}_walk.png`;
  const idleUrl = `${base}tilesets/pokemon/${id}_idle.png`;

  const promise = (async () => {
    const [walkImg, idleImg] = await Promise.all([loadImage(walkUrl), loadImage(idleUrl)]);
    const meta = getDexAnimMeta(dex);
    let walk = buildSheet(walkImg, meta?.walk);
    let idle = buildSheet(idleImg, meta?.idle);

    const walkOk = walk.img && walk.cols > 0;
    const idleOk = idle.img && idle.cols > 0;

    if ((!walkOk || !idleOk) && dex !== DEFAULT_FALLBACK_DEX) {
      const fb = await loadPokemonSprite(DEFAULT_FALLBACK_DEX, baseUrl);
      if (!walkOk) walk = fb.walk;
      if (!idleOk) idle = fb.idle;
    }

    const result = { dexId: dex, walk, idle };
    cache.set(dex, result);
    inflight.delete(dex);
    return result;
  })();

  inflight.set(dex, promise);
  return promise;
}

/**
 * Pick the frame index within a sheet given an elapsed tick. PMD durations
 * are in 60fps ticks; loops by `totalTicks`.
 *
 * @param {PmdSheet} sheet
 * @param {number} tick  Elapsed ticks since loop start (any non-negative).
 * @returns {number} 0-based column index, clamped to [0, sheet.cols - 1].
 */
export function pickFrame(sheet, tick) {
  if (!sheet || sheet.cols <= 0) return 0;
  const total = Math.max(1, sheet.totalTicks);
  const t = ((tick % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < sheet.durations.length; i++) {
    acc += sheet.durations[i];
    if (t < acc) return i;
  }
  return sheet.durations.length - 1;
}

/**
 * Convert a free direction vector (any length) to a PMD 8-way facing key.
 * Mirrors the main game's `AIM_SECTOR_TO_FACING`.
 */
export function vectorToFacing(dx, dy) {
  if (dx * dx + dy * dy < 1e-6) return 'down';
  const a = Math.atan2(dy, dx);
  const t = (a + Math.PI * 2) % (Math.PI * 2);
  const sectors = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  const sector = Math.floor((t + Math.PI / 8) / (Math.PI / 4)) % 8;
  return sectors[sector];
}

/**
 * Draw a single PMD cell at the given destination size, centered horizontally
 * on `(dstCx, dstBaseY)` with the cell's feet anchored to `dstBaseY`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {PmdSheet} sheet
 * @param {string} facing
 * @param {number} frame
 * @param {number} dstCx
 * @param {number} dstBaseY  y of the feet line in destination space
 * @param {number} dstH       desired draw height in px (width scales to keep cell aspect)
 */
export function drawSpriteAt(ctx, sheet, facing, frame, dstCx, dstBaseY, dstH) {
  if (!sheet || !sheet.img) return;
  const row = FACING_ROWS[facing] ?? FACING_ROWS.down;
  const col = Math.max(0, Math.min(sheet.cols - 1, frame | 0));
  const sx = col * sheet.frameW;
  const sy = row * sheet.frameH;
  const aspect = sheet.frameW / sheet.frameH;
  const dstW = dstH * aspect;
  const dx = Math.round(dstCx - dstW * 0.5);
  const dy = Math.round(dstBaseY - dstH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.img, sx, sy, sheet.frameW, sheet.frameH, dx, dy, Math.round(dstW), Math.round(dstH));
}
