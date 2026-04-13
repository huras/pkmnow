/**
 * Ground aim (z = 0) with horizontal range clamp — legs of the right triangle on the floor.
 * @returns {{ aimX: number, aimY: number, dirX: number, dirY: number, dist0: number }}
 */
export function clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxRangeTiles) {
  const dx0 = targetX - sourceX;
  const dy0 = targetY - sourceY;
  const dist0 = Math.hypot(dx0, dy0);
  if (dist0 < 1e-6) return { aimX: sourceX + 1, aimY: sourceY, dirX: 1, dirY: 0, dist0: 1 };
  const dirX = dx0 / dist0;
  const dirY = dy0 / dist0;
  if (dist0 <= maxRangeTiles) return { aimX: targetX, aimY: targetY, dirX, dirY, dist0 };
  return {
    aimX: sourceX + dirX * maxRangeTiles,
    aimY: sourceY + dirY * maxRangeTiles,
    dirX,
    dirY,
    dist0: maxRangeTiles
  };
}

/**
 * Point `spawnTiles` along the 3D segment from (sx,sy,sz) toward ground (tx,ty,0).
 */
export function spawnAlongHypotTowardGround(sx, sy, sz, tx, ty, spawnTiles) {
  const z0 = Math.max(0, Number(sz) || 0);
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = 0 - z0;
  const L = Math.hypot(dx, dy, dz) || 1e-6;
  const ux = dx / L;
  const uy = dy / L;
  const uz = dz / L;
  const off = Number(spawnTiles) || 0;
  return {
    startX: sx + ux * off,
    startY: sy + uy * off,
    startZ: Math.max(0, z0 + uz * off),
    ux,
    uy,
    uz,
    len3: L
  };
}

/**
 * Constant-speed velocity from start toward (tx, ty, 0) — direction is the hypotenuse
 * of the vertical leg (start.z) and horizontal leg (tx-start.x, ty-start.y) on the floor.
 */
export function velocityFromToGround(startX, startY, startZ, tx, ty, speed, opt = {}) {
  const ttlMargin = opt.ttlMargin ?? 1.12;
  const ttlPad = opt.ttlPad ?? 0.1;
  const sz = Number(startZ) || 0;
  const dx = tx - startX;
  const dy = ty - startY;
  const dz = 0 - sz;
  const L = Math.hypot(dx, dy, dz) || 1e-6;
  const vx = (dx / L) * speed;
  const vy = (dy / L) * speed;
  const vz = (dz / L) * speed;
  return {
    vx,
    vy,
    vz,
    timeToLive: (L / speed) * ttlMargin + ttlPad,
    pathLen3: L
  };
}

/**
 * Smallest t>0 where horizontal distance from (originX,originY) to (startX+vx*t, startY+vy*t) equals maxRadius,
 * if such t exists; else a safe fallback from horizontal speed.
 */
function timeToReachHorizontalRadius(originX, originY, startX, startY, vx, vy, maxRadius) {
  const ox = startX - originX;
  const oy = startY - originY;
  const a = vx * vx + vy * vy;
  if (a < 1e-14) {
    if (Math.hypot(ox, oy) >= maxRadius) return 0.05;
    return 1.2;
  }
  const b = 2 * (ox * vx + oy * vy);
  const c = ox * ox + oy * oy - maxRadius * maxRadius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    return Math.max(0.12, maxRadius / (Math.hypot(vx, vy) + 1e-9));
  }
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);
  const hits = [t1, t2].filter((t) => t > 1e-5);
  if (!hits.length) return Math.max(0.12, maxRadius / (Math.hypot(vx, vy) + 1e-9));
  return Math.min(...hits);
}

/**
 * Aim direction uses the true floor point (tx, ty) — do not clamp the target for the ray.
 * Projectile dies once horizontal distance from (rangeOriginX, rangeOriginY) reaches maxHorizontalTiles
 * (same gameplay cap as {@link clampFloorAimToMaxRange}, without bending the 3D trajectory when flying high).
 */
export function velocityFromToGroundWithHorizontalRangeFrom(
  startX,
  startY,
  startZ,
  targetX,
  targetY,
  rangeOriginX,
  rangeOriginY,
  speed,
  maxHorizontalTiles,
  opt = {}
) {
  const ttlMargin = opt.ttlMargin ?? 1.12;
  const ttlPad = opt.ttlPad ?? 0.1;
  const sz = Number(startZ) || 0;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dz = 0 - sz;
  const L = Math.hypot(dx, dy, dz) || 1e-6;
  const vx = (dx / L) * speed;
  const vy = (dy / L) * speed;
  const vz = (dz / L) * speed;
  let ttlCore = timeToReachHorizontalRadius(
    rangeOriginX,
    rangeOriginY,
    startX,
    startY,
    vx,
    vy,
    maxHorizontalTiles
  );
  if (opt.capAtGroundZ !== false && vz < -1e-6 && startZ > 1e-5) {
    const tGround = startZ / (-vz);
    if (tGround > 1e-5) ttlCore = Math.min(ttlCore, tGround);
  }
  return {
    vx,
    vy,
    vz,
    timeToLive: ttlCore * ttlMargin + ttlPad,
    pathLen3: L
  };
}
