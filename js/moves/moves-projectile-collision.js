import {
  COLLISION_BROAD_PHASE_TILES,
  EMBER_TRAIL_INTERVAL
} from './move-constants.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles,
  projectileZInPokemonHurtbox
} from '../pokemon/pokemon-combat-hurtbox.js';
import { formalTreeTrunkBlocksWorldPoint, scatterTreeTrunkBlocksWorldPoint } from '../walkability.js';
import { getMicroTile } from '../chunking.js';
import { TREE_MOVE_HITBOX_RADIUS_MULT } from '../scatter-collider-config.js';
import { emitWorldReactionFromProjectile } from '../simulation/world-reactions.js';

const TREE_BLOCKING_FIRE_PROJECTILE_TYPES = new Set([
  'ember',
  'flamethrowerShot',
  'fireSpinBurst',
  'incinerateShard',
  'incinerateCore',
  'fireBlastCore',
  'fireBlastShard'
]);

/** XY overlap for damage: projectile circle vs target hurt radius (tiles), not walk collider. */
export function checkDamageHitCircle(px, py, projRadius, targetX, targetY, targetHurtRadiusTiles) {
  const dist = Math.hypot(targetX - px, targetY - py);
  return dist < projRadius + targetHurtRadiusTiles;
}

const BROAD_PHASE_RADIUS2 = COLLISION_BROAD_PHASE_TILES * COLLISION_BROAD_PHASE_TILES;
const WILD_SPATIAL_CELL_TILES = Math.max(1, COLLISION_BROAD_PHASE_TILES);

function wildSpatialCellKey(cx, cy) {
  return `${cx},${cy}`;
}

export function buildWildSpatialIndex(wildList, data) {
  /** @type {Map<string, Array<{wild: object, hx: number, hy: number, dex: number, absZ: number}>>} */
  const cells = new Map();
  for (const wild of wildList) {
    if (!wild || wild.isDespawning || (wild.hp !== undefined && wild.hp <= 0)) continue;
    const dex = wild.dexId ?? 1;
    const { hx, hy } = getPokemonHurtboxCenterWorldXY(wild.x, wild.y, dex);
    const cx = Math.floor(hx / WILD_SPATIAL_CELL_TILES);
    const cy = Math.floor(hy / WILD_SPATIAL_CELL_TILES);
    const key = wildSpatialCellKey(cx, cy);
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    const t = data ? getMicroTile(Math.floor(wild.x + 0.5), Math.floor(wild.y + 0.5), data) : null;
    const absZ = (t ? (t.heightStep || 0) : 0) + (wild.z ?? 0);
    bucket.push({ wild, hx, hy, dex, absZ });
  }
  return cells;
}

export function queryWildSpatialIndexInAabb(cells, minX, minY, maxX, maxY, visit) {
  const cx0 = Math.floor(minX / WILD_SPATIAL_CELL_TILES);
  const cy0 = Math.floor(minY / WILD_SPATIAL_CELL_TILES);
  const cx1 = Math.floor(maxX / WILD_SPATIAL_CELL_TILES);
  const cy1 = Math.floor(maxY / WILD_SPATIAL_CELL_TILES);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const bucket = cells.get(wildSpatialCellKey(cx, cy));
      if (!bucket?.length) continue;
      for (const entry of bucket) visit(entry);
    }
  }
}

export function applyWildKnockbackFromProjectile(wild, proj) {
  if (!wild || !proj) return;
  const kb = Math.max(0.2, Number(proj.tackleKnockback) || 3.1);
  const kbLock = Math.max(0.08, Number(proj.tackleKnockbackLockSec) || 0.3);
  const sx = Number.isFinite(proj?.sourceEntity?.x)
    ? Number(proj.sourceEntity.x)
    : (Number(proj.x) || 0) - (Number(proj.vx) || 0) * 0.07;
  const sy = Number.isFinite(proj?.sourceEntity?.y)
    ? Number(proj.sourceEntity.y)
    : (Number(proj.y) || 0) - (Number(proj.vy) || 0) * 0.07;
  const dx = (wild.x ?? 0) - sx;
  const dy = (wild.y ?? 0) - sy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const blend = 0.05;
  wild.vx = (wild.vx || 0) * blend + nx * kb;
  wild.vy = (wild.vy || 0) * blend + ny * kb;
  wild.knockbackLockSec = Math.max(wild.knockbackLockSec || 0, kbLock);
  if (wild.aiState !== 'sleep') {
    wild.aiState = 'alert';
    wild.alertTimer = Math.max(wild.alertTimer || 0, kbLock * 0.9);
  }
  wild.targetX = null;
  wild.targetY = null;
  wild.wanderTimer = 0;
  wild.idlePauseTimer = 0;
}

/** Shortest distance from point P to segment A–B (tile XY plane). */
export function distPointToSegmentTiles(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

export function broadPhaseOk(px, py, tx, ty) {
  const dx = tx - px;
  const dy = ty - py;
  return dx * dx + dy * dy <= BROAD_PHASE_RADIUS2;
}

export function isProjectileBlockedByTree(proj, data) {
  if (!proj || !data) return false;
  if (!TREE_BLOCKING_FIRE_PROJECTILE_TYPES.has(proj.type)) return false;
  const z = Number(proj.z) || 0;
  if (Math.abs(z) > 1.35) return false;
  // Move-vs-tree detection: test against the expanded move hitbox so splash / thin projectiles
  // "clip" the canopy instead of requiring a dead-center trunk hit.
  return (
    formalTreeTrunkBlocksWorldPoint(proj.x, proj.y, data, TREE_MOVE_HITBOX_RADIUS_MULT) ||
    scatterTreeTrunkBlocksWorldPoint(proj.x, proj.y, data, TREE_MOVE_HITBOX_RADIUS_MULT)
  );
}

export function emitProjectileWorldReactionOnce(proj, data, x, y) {
  if (!proj || !data) return;
  if (proj._worldReactionEmitted) return;
  emitWorldReactionFromProjectile(proj, data, x, y);
  proj._worldReactionEmitted = true;
}

/**
 * @param {import('../player.js').player} player
 */
export function checkPlayerHit(proj, player, projAbsZ, playerAbsZ) {
  if (!proj.hitsPlayer) return false;
  const px = player.visualX ?? player.x;
  const py = player.visualY ?? player.y;
  const dex = player.dexId ?? 1;
  const { hx, hy } = getPokemonHurtboxCenterWorldXY(px, py, dex);
  if (!broadPhaseOk(proj.x, proj.y, hx, hy)) return false;
  if (!projectileZInPokemonHurtbox(projAbsZ, dex, playerAbsZ)) return false;
  const hurtR = getPokemonHurtboxRadiusTiles(dex);
  return checkDamageHitCircle(proj.x, proj.y, proj.radius, hx, hy, hurtR);
}

/** @param {number | null | undefined} effectZ — impact height; default `proj.z` (spawn altitude). */
export function spawnIncinerateShards(proj, pushProjectileRef, effectZ) {
  const z0 = effectZ !== undefined && effectZ !== null ? Number(effectZ) || 0 : proj.z || 0;
  const count = 10;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const speed = 8.8 + Math.random() * 1.8;
    pushProjectileRef({
      type: 'incinerateShard',
      x: proj.x,
      y: proj.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      z: z0,
      radius: 0.2,
      timeToLive: 0.42 + Math.random() * 0.18,
      damage: (proj.splashDamage || 2) * 0.8,
      sourceEntity: proj.sourceEntity,
      fromWild: proj.fromWild,
      hitsWild: proj.hitsWild,
      hitsPlayer: proj.hitsPlayer,
      trailAcc: EMBER_TRAIL_INTERVAL * (i / count)
    });
  }
}

/** Radial ember burst when a Fire Blast core detonates — scales with charge tier. */
export function spawnFireBlastBurst(proj, pushProjectileRef, effectZ) {
  const z0 = effectZ !== undefined && effectZ !== null ? Number(effectZ) || 0 : proj.z || 0;
  const tier = Number(proj.blastTier) || 2;
  const count = Math.max(8, Math.min(34, Number(proj.fireBlastBurstShards) || (tier === 3 ? 26 : tier === 2 ? 16 : 10)));
  const baseDmg = (proj.splashDamage || 3) * (tier === 3 ? 0.68 : tier === 2 ? 0.74 : 0.82);
  const speedLo = tier === 3 ? 10.2 : tier === 2 ? 9.2 : 8.4;
  const speedHi = tier === 3 ? 13.4 : tier === 2 ? 11.8 : 10.6;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
    const speed = speedLo + Math.random() * (speedHi - speedLo);
    pushProjectileRef({
      type: 'fireBlastShard',
      x: proj.x,
      y: proj.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      z: z0,
      radius: tier === 3 ? 0.28 : tier === 2 ? 0.24 : 0.22,
      timeToLive: (tier === 3 ? 0.55 : tier === 2 ? 0.46 : 0.42) + Math.random() * 0.22,
      damage: baseDmg * (0.88 + Math.random() * 0.22),
      sourceEntity: proj.sourceEntity,
      fromWild: proj.fromWild,
      hitsWild: proj.hitsWild,
      hitsPlayer: proj.hitsPlayer,
      trailAcc: EMBER_TRAIL_INTERVAL * (i / count)
    });
  }
}

/** @param {number | undefined} splashAbsZ — world absolute height for splash */
export function applySplashToWild(proj, wildList, splashAbsZ, wildSpatial = null, data = null) {
  const r = proj.splashRadius || 0;
  const d = proj.splashDamage || 0;
  if (r <= 0 || d <= 0) return;
  const minX = proj.x - r;
  const minY = proj.y - r;
  const maxX = proj.x + r;
  const maxY = proj.y + r;
  const visit = ({ wild, hx, hy, dex, absZ: z }) => {
    if (wild === proj.sourceEntity) return;
    if (Math.hypot(hx - proj.x, hy - proj.y) > r) return;
    if (!projectileZInPokemonHurtbox(splashAbsZ, dex, z)) return;
    if (wild.takeDamage) wild.takeDamage(d);
  };
  if (wildSpatial) {
    queryWildSpatialIndexInAabb(wildSpatial, minX, minY, maxX, maxY, visit);
    return;
  }
  for (const wild of wildList) {
    if (wild === proj.sourceEntity || wild.isDespawning || (wild.hp !== undefined && wild.hp <= 0)) continue;
    const splashDex = wild.dexId ?? 1;
    const { hx: shx, hy: shy } = getPokemonHurtboxCenterWorldXY(wild.x, wild.y, splashDex);
    const wt = data ? getMicroTile(Math.floor(wild.x + 0.5), Math.floor(wild.y + 0.5), data) : null;
    visit({ wild, hx: shx, hy: shy, dex: splashDex, absZ: (wt ? (wt.heightStep || 0) : 0) + (wild.z ?? 0) });
  }
}
