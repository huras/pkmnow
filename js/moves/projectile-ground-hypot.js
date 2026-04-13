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
