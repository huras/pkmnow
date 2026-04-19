import { MACRO_TILE_STRIDE } from '../chunking.js';
import { clamp, entitiesByKey } from './wild-core-state.js';
import {
  applyWildKnockbackFromPoint,
  broadcastNearbyPlayerEvent,
  broadcastNearbySpeciesAllyHurt,
  ensureSocialMemory,
  pushRecentNearbyEvent
} from './wild-social-system.js';
import { setEmotion } from './wild-motion-ai.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles,
  projectileZInPokemonHurtbox
} from '../pokemon/pokemon-combat-hurtbox.js';
import { playModerateSwordHitSfx } from '../audio/moderate-sword-hit-sfx.js';
import { markWildMinimapSpeciesKnown } from './wild-minimap-species-known.js';

const PLAYER_FIELD_MOVE_HIT_RADIUS = 1.55;
const PLAYER_FIELD_MOVE_KNOCKBACK = 2.4;

const PLAYER_TACKLE_WILD_DAMAGE = 12;
const PLAYER_TACKLE_WILD_KNOCKBACK = 4.15;
const PLAYER_TACKLE_WILD_SWEEP_RADIUS = 0.34;
const PLAYER_TACKLE_HIT_PROBE_BACKOFF_TILES = 0.05;

const PLAYER_CUT_WILD_DAMAGE = 9;
const PLAYER_CUT_WILD_KNOCKBACK = 3.35;
const WILD_MELEE_HITSTOP_SEC = 0.075;

function applyMeleeHitStop(entity) {
  if (!entity) return;
  entity.meleeHitStopSec = Math.max(entity.meleeHitStopSec || 0, WILD_MELEE_HITSTOP_SEC);
  entity.vx = 0;
  entity.vy = 0;
  entity.animMoving = false;
}

function segmentCircleFirstHitT(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (a <= 1e-8) return c <= 0 ? 0 : null;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sd = Math.sqrt(disc);
  const t0 = (-b - sd) / (2 * a);
  const t1 = (-b + sd) / (2 * a);
  if (t0 >= 0 && t0 <= 1) return t0;
  if (t1 >= 0 && t1 <= 1) return t1;
  return null;
}

/**
 * Game mode: right-click field move — wild mon near the targeted tile gets a pain balloon and knockback from the player.
 * @returns {{ hit: boolean, dexId?: number }}
 */
export function tryPlayerFieldMoveOnTile(mx, my, data, player) {
  if (!data || !player) return { hit: false };
  const maxMX = data.width * MACRO_TILE_STRIDE;
  const maxMY = data.height * MACRO_TILE_STRIDE;
  if (mx < 0 || my < 0 || mx >= maxMX || my >= maxMY) return { hit: false };

  const tx = mx + 0.5;
  const ty = my + 0.5;
  let best = null;
  let bestD = Infinity;
  for (const e of entitiesByKey.values()) {
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning) continue;
    const d = Math.hypot(e.x - tx, e.y - ty);
    if (d <= PLAYER_FIELD_MOVE_HIT_RADIUS && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return { hit: false };

  const memory = ensureSocialMemory(best);
  setEmotion(best, 5, false);
  applyWildKnockbackFromPoint(best, player.x, player.y, PLAYER_FIELD_MOVE_KNOCKBACK);
  memory.threat = clamp(memory.threat + 0.55, 0, 3.5);
  memory.affinity = clamp(memory.affinity - 0.2, -2.5, 3);
  best.provoked01 = clamp((best.provoked01 || 0) + 0.52, 0, 3);
  if (best.provoked01 >= 0.35) {
    best.wildTempAggressiveSec = Math.min(22, Math.max(best.wildTempAggressiveSec || 0, 4.2));
  }
  pushRecentNearbyEvent(best, 'player_field_move', 1.0);
  broadcastNearbyPlayerEvent(best.x, best.y, 'player_field_move', 0.7, best);
  broadcastNearbySpeciesAllyHurt(best.x, best.y, best.dexId ?? 1, 0.78, best);
  markWildMinimapSpeciesKnown(best);
  return { hit: true, dexId: best.dexId };
}

/**
 * LMB tackle melee hit against nearest wild along the tackle segment.
 * @returns {{ hit: boolean, dexId?: number }}
 */
export function tryPlayerTackleHitWild(player, data, opts = {}) {
  if (!player || !data) return { hit: false };
  const px = Number(player.x);
  const py = Number(player.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { hit: false };

  let nx = Number(player.tackleDirNx);
  let ny = Number(player.tackleDirNy);
  let len = Math.hypot(nx, ny);
  if (!Number.isFinite(len) || len < 1e-4) {
    nx = 0;
    ny = 1;
    len = 1;
  }
  nx /= len;
  ny /= len;

  const reach = Math.max(0.2, Number(player._tackleReachTiles) || 2);
  const probeReach = Math.max(0.2, reach - PLAYER_TACKLE_HIT_PROBE_BACKOFF_TILES);
  const ex = px + nx * probeReach;
  const ey = py + ny * probeReach;
  const pz = Number(player.z) || 0;

  let best = null;
  let bestT = Infinity;
  for (const e of entitiesByKey.values()) {
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
    const dex = e.dexId ?? 1;
    if (!projectileZInPokemonHurtbox(pz, dex, e.z ?? 0)) continue;
    const { hx, hy } = getPokemonHurtboxCenterWorldXY(e.x, e.y, dex);
    const r = getPokemonHurtboxRadiusTiles(dex) + PLAYER_TACKLE_WILD_SWEEP_RADIUS;
    const t = segmentCircleFirstHitT(px, py, ex, ey, hx, hy, r);
    if (t == null) continue;
    if (t < bestT) {
      bestT = t;
      best = e;
    }
  }
  if (!best) return { hit: false };

  const damage = Math.max(1, Number(opts.damage) || PLAYER_TACKLE_WILD_DAMAGE);
  const knockback = Math.max(0.2, Number(opts.knockback) || PLAYER_TACKLE_WILD_KNOCKBACK);
  if (typeof best.takeDamage === 'function') best.takeDamage(damage);
  applyMeleeHitStop(best);
  setEmotion(best, 5, false, 'Pain');
  applyWildKnockbackFromPoint(best, px, py, knockback);
  pushRecentNearbyEvent(best, 'player_field_move', 1.18);
  broadcastNearbyPlayerEvent(best.x, best.y, 'player_field_move', 0.78, best);
  return { hit: true, dexId: best.dexId };
}

/**
 * Melee hit along an arbitrary segment (e.g. Flame Charge dash path). Picks the nearest wild
 * along \([ax,ay] \to [bx,by]\) like tackle.
 * @returns {{ hit: boolean, dexId?: number }}
 */
export function tryPlayerFlameChargeHitWildAlongSegment(player, data, ax, ay, bx, by, opts = {}) {
  if (!player || !data) return { hit: false };
  const px = Number(ax);
  const py = Number(ay);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { hit: false };
  const ex = Number(bx);
  const ey = Number(by);
  if (!Number.isFinite(ex) || !Number.isFinite(ey)) return { hit: false };
  const pz = Number(player.z) || 0;

  let best = null;
  let bestT = Infinity;
  for (const e of entitiesByKey.values()) {
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
    const dex = e.dexId ?? 1;
    if (!projectileZInPokemonHurtbox(pz, dex, e.z ?? 0)) continue;
    const { hx, hy } = getPokemonHurtboxCenterWorldXY(e.x, e.y, dex);
    const r = getPokemonHurtboxRadiusTiles(dex) + PLAYER_TACKLE_WILD_SWEEP_RADIUS;
    const t = segmentCircleFirstHitT(px, py, ex, ey, hx, hy, r);
    if (t == null) continue;
    if (t < bestT) {
      bestT = t;
      best = e;
    }
  }
  if (!best) return { hit: false };

  const damage = Math.max(1, Number(opts.damage) || PLAYER_TACKLE_WILD_DAMAGE);
  const knockback = Math.max(0.2, Number(opts.knockback) || PLAYER_TACKLE_WILD_KNOCKBACK);
  if (typeof best.takeDamage === 'function') best.takeDamage(damage);
  applyMeleeHitStop(best);
  setEmotion(best, 5, false, 'Pain');
  applyWildKnockbackFromPoint(best, ex, ey, knockback);
  pushRecentNearbyEvent(best, 'player_field_move', 1.18);
  broadcastNearbyPlayerEvent(best.x, best.y, 'player_field_move', 0.78, best);
  return { hit: true, dexId: best.dexId };
}

/**
 * Same damage / knockback / feedback as `tryPlayerTackleHitWild`, from an arbitrary impact point (e.g. thrown rock).
 * @returns {boolean} true if the entity was valid and effects were applied
 */
export function applyPlayerTackleEffectOnWildFromPoint(entity, fromX, fromY) {
  if (!entity || entity.isDespawning || entity.deadState) return false;
  const px = Number(fromX);
  const py = Number(fromY);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  if (typeof entity.takeDamage === 'function') entity.takeDamage(PLAYER_TACKLE_WILD_DAMAGE);
  setEmotion(entity, 5, false, 'Pain');
  applyWildKnockbackFromPoint(entity, px, py, PLAYER_TACKLE_WILD_KNOCKBACK);
  pushRecentNearbyEvent(entity, 'player_field_move', 1.18);
  broadcastNearbyPlayerEvent(entity.x, entity.y, 'player_field_move', 0.78, entity);
  return true;
}

/**
 * Circular melee hit used by field skills like Cut (and charged spin when `opts` matches).
 * @param {{ damage?: number, knockback?: number, cutWildHitSound?: boolean, ignoreProjectileZForGroundWave?: boolean }} [opts]
 *   When `cutWildHitSound` is true, each wild hit plays Cut contact SFX (not used for tackle spin).
 *   `ignoreProjectileZForGroundWave`: Earthquake-style floor wave — hit any wild in horizontal radius regardless of float height.
 * @returns {{ hit: boolean, hitCount: number }}
 */
export function tryPlayerCutHitWildCircle(player, data, centerX, centerY, radiusTiles, opts = {}) {
  if (!player || !data) return { hit: false, hitCount: 0 };
  const cx = Number(centerX);
  const cy = Number(centerY);
  const radius = Math.max(0.2, Number(radiusTiles) || 0);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius)) {
    return { hit: false, hitCount: 0 };
  }
  const damage = Math.max(1, Number(opts.damage) || PLAYER_CUT_WILD_DAMAGE);
  const knockback = Math.max(0.2, Number(opts.knockback) || PLAYER_CUT_WILD_KNOCKBACK);
  const playCutHitSfx = !!opts.cutWildHitSound;
  const pz = Number(player.z) || 0;
  const skipZ = !!opts.ignoreProjectileZForGroundWave;
  let hitCount = 0;
  for (const e of entitiesByKey.values()) {
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
    const dex = e.dexId ?? 1;
    if (!skipZ && !projectileZInPokemonHurtbox(pz, dex, e.z ?? 0)) continue;
    const { hx, hy } = getPokemonHurtboxCenterWorldXY(e.x, e.y, dex);
    const rr = radius + getPokemonHurtboxRadiusTiles(dex);
    const dx = hx - cx;
    const dy = hy - cy;
    if (dx * dx + dy * dy > rr * rr) continue;
    hitCount++;
    if (playCutHitSfx) playModerateSwordHitSfx({ x: hx, y: hy, z: e.z ?? 0 });
    if (typeof e.takeDamage === 'function') e.takeDamage(damage);
    applyMeleeHitStop(e);
    setEmotion(e, 5, false, 'Pain');
    applyWildKnockbackFromPoint(e, player.x ?? cx, player.y ?? cy, knockback);
    pushRecentNearbyEvent(e, 'player_field_move', 1.08);
    broadcastNearbyPlayerEvent(e.x, e.y, 'player_field_move', 0.72, e);
  }
  return { hit: hitCount > 0, hitCount };
}

