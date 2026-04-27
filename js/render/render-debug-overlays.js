import { worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles
} from '../pokemon/pokemon-combat-hurtbox.js';

/**
 * Play collider overlay: walk feet on the ground plane + optional dashed Z axis + body circle
 * at `item.airZ` tiles high (matches sprite / projectile `z` convention).
 */
export function drawPlayEntityFootAndAirCollider(ctx, item, tileW, tileH, snapPx, imageCache) {
  const zLift = Math.max(0, Number(item.airZ) || 0);
  const r = 0.32 * Math.min(tileW, tileH);
  const dex = item.dexId ?? 94;
  const ft = worldFeetFromPivotCell(item.x, item.y, imageCache, dex, !!item.animMoving);
  const fcx = snapPx(ft.x * tileW);
  const fcyGround = snapPx(ft.y * tileH);
  const fcyBody = snapPx(ft.y * tileH - zLift * tileH);

  const topY = zLift > 0.02 ? fcyBody : fcyGround;
  const baseY = fcyGround;
  const showCylinder = zLift > 0.02;

  // Top cap
  ctx.strokeStyle = 'rgba(0, 255, 140, 0.62)';
  ctx.fillStyle = 'rgba(0, 255, 140, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(fcx, topY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (showCylinder) {
    // Base cap + side rulings for true cylinder debug visual.
    ctx.strokeStyle = 'rgba(0, 255, 140, 0.35)';
    ctx.fillStyle = 'rgba(0, 255, 140, 0.05)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(fcx, baseY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 255, 140, 0.45)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(fcx - r, topY); ctx.lineTo(fcx - r, baseY);
    ctx.moveTo(fcx + r, topY); ctx.lineTo(fcx + r, baseY);
    ctx.moveTo(fcx, topY - r); ctx.lineTo(fcx, baseY - r);
    ctx.moveTo(fcx, topY + r); ctx.lineTo(fcx, baseY + r);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(fcx - 2, topY - 2, 4, 4);
}

/** Combat hurtbox (damage) — sprite-centered XY, same z lift as body circle; not walk feet. */
export function drawPlayEntityCombatHurtbox(ctx, item, tileW, tileH, snapPx) {
  const zLift = Math.max(0, Number(item.airZ) || 0);
  const dex = item.dexId ?? 94;
  const { hx, hy } = getPokemonHurtboxCenterWorldXY(item.x, item.y, dex);
  const hr = getPokemonHurtboxRadiusTiles(dex);
  const hcx = snapPx(hx * tileW);
  const hcy = snapPx(hy * tileH - zLift * tileH);
  const rx = Math.max(2, hr * tileW);
  const ry = Math.max(2, hr * tileH);

  ctx.strokeStyle = 'rgba(255, 130, 55, 0.92)';
  ctx.fillStyle = 'rgba(255, 100, 40, 0.07)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.ellipse(hcx, hcy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 200, 140, 0.95)';
  ctx.fillRect(hcx - 2, hcy - 2, 4, 4);
}
