import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import {
  canWalkMicroTile,
  formalTreeTrunkOverlapsMicroCell,
  scatterPhysicsCircleOverlapsMicroCellAny,
  getFormalTreeTrunkWorldXSpan,
  scatterPhysicsCircleAtOrigin,
  beginWildWalkProbeCache,
  endWildWalkProbeCache,
  FORMAL_TREE_CANOPY_Z,
  SCATTER_TREE_CANOPY_Z
} from '../walkability.js';
import { scatterItemKeyIsTree } from '../scatter-pass2-debug.js';
import { worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';

/** Same radius as the play collider overlay in `render.js`. */
/** Same radius as the play collider overlay in `render.js`. Reduced to 25 to keep the overlay responsive but larger than before. */
export const PLAY_COLLIDER_OVERLAY_RADIUS = 25;

const CELL_BLOCKED = 1;
const CELL_FORMAL = 2;
const CELL_SCATTER = 3;

/**
 * @typedef {{ seed: number, mxMin: number, mxMax: number, myMin: number, myMax: number, stride: number, cellFlags: Uint8Array, formalEllipses: Array<{ cx: number, cy: number, radius: number, radiusTop: number, topZ: number }>, scatterEllipses: Array<{ cx: number, cy: number, radius: number, radiusTop: number, isTree: boolean, topZ: number }> }} PlayColliderOverlayCache
 */

/** @type {PlayColliderOverlayCache | null} */
let overlayCache = null;

export function circleAabbIntersectsRect(cx, cy, r, x0, y0, x1, y1) {
  const closestX = Math.max(x0, Math.min(cx, x1));
  const closestY = Math.max(y0, Math.min(cy, y1));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r + 1e-10;
}

/**
 * @param {object} data
 * @param {{ x: number, y: number, dexId?: number, grounded?: boolean, vx?: number, vy?: number }} player
 * @param {import('../image-cache.js').imageCache} imageCache
 * @param {boolean} overlayFeetMoving - same idea as `isPlayerWalkingAnim` in render (feet offset for walk)
 */
export function buildPlayColliderOverlayCache(data, player, imageCache, overlayFeetMoving) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const seed = data.seed;
  const anchorMx = Math.floor(player.x);
  const anchorMy = Math.floor(player.y);
  const mxMin = Math.max(0, anchorMx - PLAY_COLLIDER_OVERLAY_RADIUS);
  const mxMax = Math.min(microW - 1, anchorMx + PLAY_COLLIDER_OVERLAY_RADIUS);
  const myMin = Math.max(0, anchorMy - PLAY_COLLIDER_OVERLAY_RADIUS);
  const myMax = Math.min(microH - 1, anchorMy + PLAY_COLLIDER_OVERLAY_RADIUS);
  const stride = mxMax - mxMin + 1;
  const rectH = myMax - myMin + 1;
  const cellFlags = new Uint8Array(stride * rectH);
  const overlayFeetDex = player.dexId || 94;

  beginWildWalkProbeCache();
  try {
    for (let my = myMin; my <= myMax; my++) {
      for (let mx = mxMin; mx <= mxMax; mx++) {
        const ftCell = worldFeetFromPivotCell(mx, my, imageCache, overlayFeetDex, !!overlayFeetMoving);
        const feetOk = canWalkMicroTile(ftCell.x, ftCell.y, data, ftCell.x, ftCell.y, undefined, false);
        let v = 0;
        if (!feetOk) v = CELL_BLOCKED;
        else if (formalTreeTrunkOverlapsMicroCell(mx, my, data)) v = CELL_FORMAL;
        else if (scatterPhysicsCircleOverlapsMicroCellAny(mx, my, data)) v = CELL_SCATTER;
        cellFlags[(my - myMin) * stride + (mx - mxMin)] = v;
      }
    }

    const formalEllipses = [];
    const seenFormal = new Set();
    for (let my = myMin - 1; my <= myMax; my++) {
      if (my < 0 || my >= microH) continue;
      for (let rootX = mxMin - 1; rootX <= mxMax; rootX++) {
        if (rootX < 0 || rootX + 1 >= microW) continue;
        const span = getFormalTreeTrunkWorldXSpan(rootX, my, data);
        if (!span) continue;
        const rCull = Math.max(span.radius, span.radiusTop);
        if (!circleAabbIntersectsRect(span.cx, span.cy, rCull, mxMin, myMin, mxMax + 1, myMax + 1)) continue;
        const k = `f:${rootX},${my}`;
        if (seenFormal.has(k)) continue;
        seenFormal.add(k);
        formalEllipses.push({
          cx: span.cx,
          cy: span.cy,
          radius: span.radius,
          radiusTop: span.radiusTop,
          topZ: FORMAL_TREE_CANOPY_Z
        });
      }
    }

    const scatterEllipses = [];
    const seenScatter = new Set();
    for (let oxS = mxMin - 8; oxS <= mxMax + 2; oxS++) {
      if (oxS < 0 || oxS >= microW) continue;
      for (let oyS = myMin - 10; oyS <= myMax + 3; oyS++) {
        if (oyS < 0 || oyS >= microH) continue;
        const p = scatterPhysicsCircleAtOrigin(oxS, oyS, data);
        if (!p) continue;
        const rCullS = Math.max(p.radius, p.radiusTop);
        if (!circleAabbIntersectsRect(p.cx, p.cy, rCullS, mxMin, myMin, mxMax + 1, myMax + 1)) continue;
        const k = `s:${oxS},${oyS}`;
        if (seenScatter.has(k)) continue;
        seenScatter.add(k);
        scatterEllipses.push({
          cx: p.cx,
          cy: p.cy,
          radius: p.radius,
          radiusTop: p.radiusTop,
          isTree: scatterItemKeyIsTree(p.itemKey),
          topZ: scatterItemKeyIsTree(p.itemKey) ? SCATTER_TREE_CANOPY_Z : 0
        });
      }
    }

    overlayCache = {
      seed,
      mxMin,
      mxMax,
      myMin,
      myMax,
      stride,
      cellFlags,
      formalEllipses,
      scatterEllipses
    };
  } finally {
    endWildWalkProbeCache();
  }
}

export function clearPlayColliderOverlayCache() {
  overlayCache = null;
}

/** @returns {PlayColliderOverlayCache | null} */
export function getPlayColliderOverlayCache() {
  return overlayCache;
}

/**
 * Rebuild cache if play colliders are on but cache is missing or world changed.
 * Now dynamic: rebuilds if player gets near the edges of the cached zone.
 */
export function ensurePlayColliderOverlayCache(data, player, imageCache, collidersOn) {
  if (!collidersOn || !data) {
    clearPlayColliderOverlayCache();
    return;
  }
  const overlayFeetMoving =
    !!player.grounded && Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1;

  let needRebuild = !overlayCache || overlayCache.seed !== data.seed;
  if (!needRebuild && overlayCache) {
    const margin = 8;
    const px = player.x;
    const py = player.y;
    if (
      px < overlayCache.mxMin + margin ||
      px > overlayCache.mxMax - margin ||
      py < overlayCache.myMin + margin ||
      py > overlayCache.myMax - margin
    ) {
      needRebuild = true;
    }
  }

  if (needRebuild) {
    buildPlayColliderOverlayCache(data, player, imageCache, overlayFeetMoving);
  }
}

/**
 * @deprecated Dynamic rebuilds mean we no longer need to clamp the player.
 */
export function clampPlayerToPlayColliderBoundsIfActive(player) {
  // No-op
}
