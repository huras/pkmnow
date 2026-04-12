/**
 * Circle-vs-trunk resolution: push feet center out of trunk circles (MTD),
 * then remove velocity into the contact normal (slide), matching the flow in
 * H:/cursor/25D-collision-detection (separate + resolve along normal, no bounce).
 *
 * Circles include formal trees, scatter **trees**, and (when
 * `EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER`) scatter non-tree solids (rocks/crystals/etc.)
 * from `gatherTreeTrunkCirclesNearWorldPoint`.
 *
 * Performance: gather once per resolve (tight window in walkability),
 * skip entirely when feet cannot interact with any listed circle, iterate only that small list.
 */

import { gatherTreeTrunkCirclesNearWorldPoint } from './walkability.js';

const SEP_ITERS = 5;
const VEL_SLIDE_PASSES = 3;
const TOUCH_EPS = 0.035;

function feetMayInteractWithCircles(fx, fy, bodyR, circles) {
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const maxd = bodyR + c.r + 0.08;
    const dx = fx - c.cx;
    const dy = fy - c.cy;
    if (dx * dx + dy * dy <= maxd * maxd) return true;
  }
  return false;
}

/**
 * @param {number} wx
 * @param {number} wy
 * @param {number} radius
 * @param {Array<{ cx: number, cy: number, r: number }>} circles
 */
function separateWorldCircleFromTrunkList(wx, wy, radius, circles) {
  let cx = wx;
  let cy = wy;
  for (let it = 0; it < SEP_ITERS; it++) {
    let maxO = 0;
    let nx = 1;
    let ny = 0;
    for (let i = 0; i < circles.length; i++) {
      const { cx: tcx, cy: tcy, r: tr } = circles[i];
      const ddx = cx - tcx;
      const ddy = cy - tcy;
      const dist = Math.hypot(ddx, ddy);
      const need = radius + tr;
      if (dist >= need - 1e-10) continue;
      if (dist < 1e-9) {
        const o = need;
        if (o > maxO) {
          maxO = o;
          nx = 1;
          ny = 0;
        }
        continue;
      }
      const o = need - dist;
      if (o > maxO) {
        maxO = o;
        nx = ddx / dist;
        ny = ddy / dist;
      }
    }
    if (maxO < 1e-10) break;
    cx += nx * maxO;
    cy += ny * maxO;
  }
  return { x: cx, y: cy };
}

/**
 * @param {number} feetX
 * @param {number} feetY
 * @param {number} radius
 * @param {number} vx
 * @param {number} vy
 * @param {Array<{ cx: number, cy: number, r: number }>} circles
 */
function slideVelocityVsTrunkListAtFeet(feetX, feetY, radius, vx, vy, circles) {
  let nx = vx;
  let ny = vy;
  for (let pass = 0; pass < VEL_SLIDE_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < circles.length; i++) {
      const { cx: tcx, cy: tcy, r: tr } = circles[i];
      const ddx = feetX - tcx;
      const ddy = feetY - tcy;
      const dist = Math.hypot(ddx, ddy);
      if (dist >= radius + tr - TOUCH_EPS || dist < 1e-8) continue;
      changed = true;
      const nnx = ddx / dist;
      const nny = ddy / dist;
      const vn = nx * nnx + ny * nny;
      if (vn < 0) {
        nx -= vn * nnx;
        ny -= vn * nny;
      }
    }
    if (!changed) break;
  }
  return { vx: nx, vy: ny };
}

/**
 * @param {number} pivotX
 * @param {number} pivotY
 * @param {number} feetDx
 * @param {number} feetDy
 * @param {number} bodyRadius
 * @param {number} vx
 * @param {number} vy
 * @param {object} data
 * @returns {{ x: number, y: number, vx: number, vy: number }}
 */
export function resolvePivotWithFeetVsTreeTrunks(pivotX, pivotY, feetDx, feetDy, bodyRadius, vx, vy, data) {
  // Same Y as shadow / sprite pivot base (`pivot + 0.5`); horizontal uses feetDx only (dy not applied — matches canWalk).
  const fx0 = pivotX + 0.5 + feetDx;
  const fy0 = pivotY + 0.5;
  const circles = gatherTreeTrunkCirclesNearWorldPoint(fx0, fy0, data);
  if (circles.length === 0 || !feetMayInteractWithCircles(fx0, fy0, bodyRadius, circles)) {
    return { x: pivotX, y: pivotY, vx, vy };
  }

  const sep = separateWorldCircleFromTrunkList(fx0, fy0, bodyRadius, circles);
  const dfx = sep.x - fx0;
  const dfy = sep.y - fy0;
  const circlesSlide =
    dfx * dfx + dfy * dfy > 1e-6 ? gatherTreeTrunkCirclesNearWorldPoint(sep.x, sep.y, data) : circles;
  const slid = slideVelocityVsTrunkListAtFeet(sep.x, sep.y, bodyRadius, vx, vy, circlesSlide);
  return {
    x: pivotX + dfx,
    y: pivotY + dfy,
    vx: slid.vx,
    vy: slid.vy
  };
}
