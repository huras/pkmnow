import { PMD_MON_SHEET } from './pmd-default-timing.js';
import { getDexAnimMeta, getDexAnimSlice } from './pmd-anim-metadata.js';
import { POKEMON_HEIGHTS } from './pokemon-heights.js';
import { getResolvedSheets } from './pokemon-asset-loader.js';

/**
 * Frame size / column count — same rules as `render.js` PMD collect pass.
 * @param {HTMLImageElement} sheet
 * @param {boolean} isMoving
 * @param {number} dexId
 */
export function resolvePmdFrameSpec(sheet, isMoving, dexId) {
  const meta = getDexAnimMeta(dexId);
  const modeMeta = isMoving ? meta?.walk : meta?.idle;
  const fallbackCols = isMoving ? 4 : 8;
  const animCols = modeMeta?.durations?.length || fallbackCols;
  const sw = Math.max(
    1,
    Number(modeMeta?.frameWidth) ||
      Math.floor((sheet.naturalWidth || PMD_MON_SHEET.frameW * animCols) / animCols)
  );
  const sh = Math.max(
    1,
    Number(modeMeta?.frameHeight) ||
      Math.floor((sheet.naturalHeight || PMD_MON_SHEET.frameH * 8) / 8)
  );
  return { sw, sh, animCols };
}

/**
 * Frame spec for an explicit slice (e.g. dig sheet uses `dig` timings, fallback to walk).
 * @param {HTMLImageElement} sheet
 * @param {number} dexId
 * @param {'idle'|'walk'|'dig'} sliceKey
 */
export function resolvePmdFrameSpecForSlice(sheet, dexId, sliceKey) {
  const modeMeta = getDexAnimSlice(dexId, sliceKey);
  const fallbackCols = sliceKey === 'idle' ? 8 : 4;
  const animCols = modeMeta?.durations?.length || fallbackCols;
  const sw = Math.max(
    1,
    Number(modeMeta?.frameWidth) ||
      Math.floor((sheet.naturalWidth || PMD_MON_SHEET.frameW * animCols) / animCols)
  );
  const sh = Math.max(
    1,
    Number(modeMeta?.frameHeight) ||
      Math.floor((sheet.naturalHeight || PMD_MON_SHEET.frameH * 8) / 8)
  );
  return { sw, sh, animCols };
}

/**
 * Canonical frame height for stable scale across idle/walk padding (matches render).
 * @param {HTMLImageElement | undefined} wIdle
 * @param {HTMLImageElement | undefined} wWalk
 * @param {number} dexId
 */
export function resolveCanonicalPmdH(wIdle, wWalk, dexId) {
  const meta = getDexAnimMeta(dexId);
  const idleH =
    Number(meta?.idle?.frameHeight) ||
    Math.floor((wIdle?.naturalHeight || PMD_MON_SHEET.frameH * 8) / 8);
  const walkH =
    Number(meta?.walk?.frameHeight) ||
    Math.floor((wWalk?.naturalHeight || PMD_MON_SHEET.frameH * 8) / 8);
  return Math.max(1, idleH || walkH || PMD_MON_SHEET.frameH);
}

/**
 * World-space offset (micro-tile units) from logical `(x, y)` to sprite foot line.
 * Render pins `(x+0.5, y+0.5)` tileWidths as pivot; feet sit `dh * (1 - pivotYFrac)` px below
 * that pivot — in tile units that length is `(sh * targetHeightTiles / canonicalH) * (1 - pivotYFrac)`,
 * which is independent of `tileH`.
 *
 * Horizontal: pivot is sheet center (`dw/2`); no lateral offset for collision.
 * Visual foot line is south of the render pivot by `dy` tiles; **walk/collider/trunks** use the pivot row center
 * on Y (`tileY + 0.5`) so samples match shadow + `cy` base (not double-shifted south).
 *
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} dexId
 * @param {boolean} isMoving — same sheet as render (walk vs idle)
 * @returns {{ dx: number, dy: number }}
 */
export function getPmdFeetDeltaWorldTiles(imageCache, dexId, isMoving) {
  const { walk: wWalk, idle: wIdle } = getResolvedSheets(imageCache, dexId);
  const sheet = isMoving ? wWalk : wIdle;
  if (!sheet) return { dx: 0, dy: 0 };

  const { sh } = resolvePmdFrameSpec(sheet, !!isMoving, dexId);
  const canonicalH = resolveCanonicalPmdH(wIdle, wWalk, dexId);
  const targetHeightTiles = POKEMON_HEIGHTS[dexId] || 1.1;
  const dyTiles = (sh * targetHeightTiles) / canonicalH * (1 - PMD_MON_SHEET.pivotYFrac);
  return { dx: 0, dy: dyTiles };
}

/**
 * Micro-tile world position for Pokémon **walk / collider / trunk** probes: tile center on Y (shadow + pivot),
 * tile center + horizontal `dx` on X. Does **not** add PMD `dy` (foot line) so Y stays aligned with render.
 * @param {number} pivotCellX — stored logical X (same as `player.x` / wild `entity.x`; render pivot is at `x+0.5`).
 * @param {number} pivotCellY
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} dexId
 * @param {boolean} isMoving
 * @returns {{ x: number, y: number }}
 */
export function worldFeetFromPivotCell(pivotCellX, pivotCellY, imageCache, dexId, isMoving) {
  const { dx } = getPmdFeetDeltaWorldTiles(imageCache, dexId, isMoving);
  return { x: pivotCellX + 0.5 + dx, y: pivotCellY + 0.5 };
}
