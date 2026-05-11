/**
 * @fileoverview Formal tree canopy pass — draws the *tops* of formal trees
 * (broadleaf/pine/palm) over already-baked terrain.
 *
 * Why this exists: `bakeChunk` intentionally bakes only the trunk *base* of
 * formal trees because canopies must Y-sort with entities (player walks
 * behind canopy, in front of trunk). The main game runs a separate dynamic
 * canopy pass in `js/render/render-play-shadow-canopy.js`; that file is tied
 * to gameplay (hit-shake, berry trees) and wasn't extracted to this package.
 *
 * This module provides a leaner alternative that the hoenn-builder apps can
 * call right after blitting baked chunks. It supports the no-wind, no-hit-
 * shake "still" version of the canopy (`time = 0`) which the existing cache
 * already memoizes as a shared composite — so subsequent frames just blit.
 *
 * Enumeration logic mirrors the formal-root detection in `bakeChunk`
 * (`Pass 2 → 1. Formal Trees`). Keep them aligned: any change in eligibility
 * (heightStep test, role test, destruction registry) must be applied to both.
 */

import { getMicroTile, MACRO_TILE_STRIDE, foliageDensity } from 'region-map-gen/chunking.js';
import {
  TREE_TILES,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  BIOME_TO_TERRAIN,
  tileSurfaceAllowsScatterVegetation,
} from 'region-terrain-tiles/biome-tiles.js';
import { TERRAIN_SETS } from 'region-terrain-tiles/tessellation-data.js';
import { getRoleForCell, terrainRoleAllowsScatter2CContinuation } from 'region-map-gen/tessellation-logic.js';
import { imageCache } from 'region-terrain-tiles/image-cache.js';
import {
  isFormalTreeRootDestroyed,
  getFormalTreeRegrowVisualAlpha01,
} from 'region-walkability/destroyed-objects-registry.js';
import { PLAY_CHUNK_SIZE, VEG_MULTITILE_OVERLAP_PX } from './render-constants.js';
import { getFormalTreeCanopyComposite } from './canopy-sway-cache.js';
import { TCOLS_NATURE } from './render-utils-internal.js';

const NATURE_IMG_PATH = 'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png';

/**
 * Enumerate the valid formal-tree roots (left trunk cell) whose left half lies
 * inside the chunk identified by `(chunkCX, chunkCY)`. Right halves spilling
 * out of the chunk are still part of the same root and will be picked up when
 * processing the neighboring chunk.
 *
 * `world` here is the `region-map-gen` world object the caller already has —
 * for the hoenn-builder this is the finite window built by `window-world.js`.
 *
 * @param {number} chunkCX
 * @param {number} chunkCY
 * @param {object} world
 * @returns {Array<{ mx: number, my: number, treeType: string }>}
 */
export function enumerateFormalTreeRootsInChunk(chunkCX, chunkCY, world) {
  const startX = chunkCX * PLAY_CHUNK_SIZE;
  const startY = chunkCY * PLAY_CHUNK_SIZE;
  const endX = startX + PLAY_CHUNK_SIZE;
  const endY = startY + PLAY_CHUNK_SIZE;
  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const seed = world.seed;

  const roots = [];
  const isAtOrAbove = (level) => (r, c) => (getMicroTile(c, r, world)?.heightStep ?? -99) >= level;

  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const tile = getMicroTile(mx, my, world);
      if (!tileSurfaceAllowsScatterVegetation(tile)) continue;
      const treeType = getTreeType(tile.biomeId, mx, my, seed);
      if (!treeType) continue;
      if ((mx + my) % 3 !== 0) continue;
      if (foliageDensity(mx, my, seed + 5555, TREE_NOISE_SCALE) < TREE_DENSITY_THRESHOLD) continue;
      if (isFormalTreeRootDestroyed(mx, my)) continue;
      if (getFormalTreeRegrowVisualAlpha01(mx, my) < 0.999) continue;

      const setRoot = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
      const roleOrig = setRoot
        ? getRoleForCell(my, mx, microH, microW, isAtOrAbove(tile.heightStep), setRoot.type)
        : 'CENTER';
      if (roleOrig !== 'CENTER') continue;

      const rx = mx + 1;
      const rightTile = getMicroTile(rx, my, world);
      if (rightTile?.heightStep !== tile.heightStep) continue;

      const roleRight = setRoot
        ? getRoleForCell(my, rx, microH, microW, isAtOrAbove(tile.heightStep), setRoot.type)
        : 'CENTER';
      if (!terrainRoleAllowsScatter2CContinuation(roleRight)) continue;

      roots.push({ mx, my, treeType });
    }
  }
  return roots;
}

/**
 * Draw all formal-tree canopies for a single chunk, on top of whatever the
 * caller already blitted there. Coordinates given in canvas-pixel space.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} chunkCX
 * @param {number} chunkCY
 * @param {object} world
 * @param {number} tileW - bake tile width in painter-pixel units (PLAY_BAKE_TILE_PX)
 * @param {number} tileH
 * @param {number} chunkScreenX - canvas x of the top-left corner of the chunk
 * @param {number} chunkScreenY - canvas y of the top-left corner of the chunk
 * @param {number} [scale=1]    - canvas-px per painter-px (for editor zoom)
 */
export function drawChunkFormalTreeCanopies(
  ctx,
  chunkCX,
  chunkCY,
  world,
  tileW,
  tileH,
  chunkScreenX,
  chunkScreenY,
  scale = 1,
) {
  const natureImg = imageCache.get(NATURE_IMG_PATH);
  if (!natureImg) return;

  const startX = chunkCX * PLAY_CHUNK_SIZE;
  const startY = chunkCY * PLAY_CHUNK_SIZE;
  const roots = enumerateFormalTreeRootsInChunk(chunkCX, chunkCY, world);
  if (roots.length === 0) return;

  for (const { mx, my, treeType } of roots) {
    const ids = TREE_TILES[treeType];
    if (!ids?.top?.length) continue;
    const { canvas, ox, oy } = getFormalTreeCanopyComposite(
      0,
      treeType,
      mx,
      my,
      ids.top,
      natureImg,
      TCOLS_NATURE,
      tileW,
      tileH,
    );
    // Anchor mirrors the main game's `render-play-shadow-canopy.js`:
    //   px = (originX + 1) * tileW   ← bottom of the trunk-right column
    //   py = (originY + 1) * tileH   ← ground line just below the trunks
    // That point is what `getFormalTreeCanopyComposite` reports its (ox, oy)
    // relative to — so subtracting them puts the canopy bitmap exactly where
    // it sits in the live game, with the leaves overhanging the trunk to the
    // left and rising up by `canopyRows * tileH - overlap` pixels.
    const anchorPainterX = (mx + 1 - startX) * tileW;
    const anchorPainterY = (my + 1 - startY) * tileH;
    const dstX = chunkScreenX + (anchorPainterX - ox) * scale;
    const dstY = chunkScreenY + (anchorPainterY - oy) * scale;
    ctx.drawImage(
      canvas,
      dstX,
      dstY,
      canvas.width * scale,
      canvas.height * scale,
    );
    // `VEG_MULTITILE_OVERLAP_PX` is already folded into the composite's
    // placements inside `getFormalTreeCanopyComposite`; nothing to add here.
    void VEG_MULTITILE_OVERLAP_PX;
  }
}
