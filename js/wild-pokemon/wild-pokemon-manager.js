import { getMicroTile, MACRO_TILE_STRIDE } from '../chunking.js';
import {
  WILD_WANDER_RADIUS_TILES,
  WILD_MACRO_SUBDIVISION,
  WILD_MAX_SIMULTANEOUS_SLOTS
} from './wild-pokemon-constants.js';
import { seededHashInt } from '../tessellation-logic.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import {
  defaultPortraitSlugForBalloon,
  ensureSpriteCollabPortraitLoaded,
  probeSpriteCollabPortraitPrefix
} from '../pokemon/spritecollab-portraits.js';
import { WILD_EMOTION_NONPERSIST_CLEAR_SEC } from '../pokemon/emotion-display-timing.js';
import { playWildEmotionCry, playWildDamageHurtCry, preloadPokemonCry } from '../pokemon/pokemon-cries.js';
import { imageCache } from '../image-cache.js';
import { PMD_DEFAULT_MON_ANIMS } from '../pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';
import {
  canWildPokemonWalkMicroTile,
  getFoliageOverlayTileId,
  getLakeLotusFoliageWalkRole,
  pivotCellHeightTraversalOk
} from '../walkability.js';
import { resolvePivotWithFeetVsTreeTrunks } from '../circle-tree-trunk-resolve.js';
import { getPmdFeetDeltaWorldTiles, worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import { getSpeciesBehavior } from './pokemon-behavior.js';
import { getEffectiveWildBehavior } from './wild-effective-behavior.js';
import { rollWildSex } from '../pokemon/pokemon-sex.js';
import { isUndergroundBurrowerDex } from './underground-burrow.js';
import { tryCastWildMove } from '../moves/moves-manager.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { rollBossPromotedDex } from './wild-boss-variants.js';
import { getSocialActionById } from '../social/social-actions.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles,
  projectileZInPokemonHurtbox
} from '../pokemon/pokemon-combat-hurtbox.js';

const SKY_SPECIES = new Set([
  6,   // Charizard
  12,  // Butterfree
  15,  // Beedrill
  16, 17, 18, // Pidgey line
  21, 22, // Spearow line
  41, 42, // Zubat line
  49,  // Venomoth
  92, 93, 94, // Gengar line (ghosts float)
  142, // Aerodactyl
  144, 145, 146, // Birds
  149  // Dragonite
]);

/** Janela (2r+1)² células macro em torno do player; cada macro tem até N² slots (`WILD_MACRO_SUBDIVISION` em constants). */
export const WILD_WINDOW_RADIUS = 2;

function wildSubdivN() {
  const n = Math.max(1, Math.floor(Number(WILD_MACRO_SUBDIVISION)) || 1);
  return Math.min(16, n);
}

function wildSlotKey(mx, my, sx, sy) {
  return `${mx},${my},${sx},${sy}`;
}

function wildSlotCenterSqDist(mx, my, sx, sy, px, py, cellW) {
  const cx = mx * MACRO_TILE_STRIDE + (sx + 0.5) * cellW;
  const cy = my * MACRO_TILE_STRIDE + (sy + 0.5) * cellW;
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy;
}

/**
 * Candidate slots in the full macro window, capped to {@link WILD_MAX_SIMULTANEOUS_SLOTS}
 * by keeping those closest to the player (avoids despawning mons you're next to when trimming).
 */
function buildWildNeededSlotKeys(w, h, pmx, pmy, subN, cellW, playerMicroX, playerMicroY) {
  const budget = Math.max(8, Math.floor(Number(WILD_MAX_SIMULTANEOUS_SLOTS)) || 64);
  const R = WILD_WINDOW_RADIUS;
  /** @type {{ mx: number, my: number, sx: number, sy: number, d2: number }[]} */
  const slots = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const mx = pmx + dx;
      const my = pmy + dy;
      if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
      for (let sy = 0; sy < subN; sy++) {
        for (let sx = 0; sx < subN; sx++) {
          const d2 = wildSlotCenterSqDist(mx, my, sx, sy, playerMicroX, playerMicroY, cellW);
          slots.push({ mx, my, sx, sy, d2 });
        }
      }
    }
  }
  if (slots.length <= budget) {
    const needed = new Set();
    for (const s of slots) needed.add(wildSlotKey(s.mx, s.my, s.sx, s.sy));
    return needed;
  }
  slots.sort((a, b) => {
    if (a.d2 !== b.d2) return a.d2 - b.d2;
    if (a.mx !== b.mx) return a.mx - b.mx;
    if (a.my !== b.my) return a.my - b.my;
    if (a.sx !== b.sx) return a.sx - b.sx;
    return a.sy - b.sy;
  });
  const needed = new Set();
  for (let i = 0; i < budget; i++) {
    const s = slots[i];
    needed.add(wildSlotKey(s.mx, s.my, s.sx, s.sy));
  }
  return needed;
}

const SALT_SPAWN = 0x574c4450;

const WANDER_MOVE_MIN = 0.45;
const WANDER_MOVE_EXTRA = 1.2;
const WANDER_IDLE_MIN = 0.35;
const WANDER_IDLE_EXTRA = 1.0;
const MAX_SPEED = 1.65;
const WILD_GRAVITY = 45.0;
const WILD_JUMP_IMPULSE = 12.0;
/** Frames (~60 Hz) bloqueados no chão antes de tentar salto em fuga / perseguição. */
const WILD_JUMP_BLOCKED_FRAMES_FLEE = 14;
/** Idem no vagueio (saltos mais raros). */
const WILD_JUMP_BLOCKED_FRAMES_WANDER = 28;
const WILD_JUMP_COOLDOWN_SEC = 0.85;
/** Circle radius at feet for trunk separation (wild has no corner probes in wildWalkOk). */
const WILD_TREE_BODY_R = 0.28;

function ensureWildPhysicsState(entity) {
  if (entity.z == null) entity.z = 0;
  if (entity.vz == null) entity.vz = 0;
  if (entity.grounded == null) entity.grounded = true;
  if (entity.jumping == null) entity.jumping = false;
  if (entity.jumpCooldown == null) entity.jumpCooldown = 0;
  if (entity._blockedMoveFrames == null) entity._blockedMoveFrames = 0;
}

function integrateWildPokemonVertical(entity, dt) {
  ensureWildPhysicsState(entity);
  if (entity.jumpCooldown > 0) entity.jumpCooldown = Math.max(0, entity.jumpCooldown - dt);
  if (!entity.grounded) {
    entity.vz -= WILD_GRAVITY * dt;
    entity.z += entity.vz * dt;
    if (entity.z <= 0) {
      entity.z = 0;
      entity.vz = 0;
      entity.grounded = true;
      entity.jumping = false;
    }
  }
}

function tryWildPokemonJump(entity) {
  if (!entity.grounded || (entity.jumpCooldown || 0) > 0) return;
  entity.vz = WILD_JUMP_IMPULSE;
  entity.grounded = false;
  entity.jumping = true;
  entity.jumpCooldown = WILD_JUMP_COOLDOWN_SEC;
  entity._blockedMoveFrames = 0;
}

function wildFeetDeltaForEntity(entity) {
  return getPmdFeetDeltaWorldTiles(imageCache, entity.dexId ?? 1, !!entity.animMoving);
}

function wildWalkOk(destX, destY, data, srcX, srcY, entity, air, ignoreTreeTrunks = false) {
  if (!air && isUndergroundBurrowerDex(entity.dexId ?? 0) && entity.animMoving) {
    const ft = worldFeetFromPivotCell(destX, destY, imageCache, entity.dexId ?? 1, true);
    const mx = Math.floor(ft.x);
    const my = Math.floor(ft.y);
    const gw = data.width * MACRO_TILE_STRIDE;
    const gh = data.height * MACRO_TILE_STRIDE;
    if (mx < 0 || mx >= gw || my < 0 || my >= gh) return false;
    return getMicroTile(mx, my, data) != null;
  }

  const ft = worldFeetFromPivotCell(destX, destY, imageCache, entity.dexId ?? 1, !!entity.animMoving);
  const st =
    srcX !== undefined && srcY !== undefined
      ? worldFeetFromPivotCell(srcX, srcY, imageCache, entity.dexId ?? 1, !!entity.animMoving)
      : null;
  if (
    !canWildPokemonWalkMicroTile(ft.x, ft.y, data, st ? st.x : undefined, st ? st.y : undefined, air, ignoreTreeTrunks)
  ) {
    return false;
  }
  if (!air && srcX !== undefined && srcY !== undefined && !pivotCellHeightTraversalOk(destX, destY, srcX, srcY, data)) {
    return false;
  }
  return true;
}

function applyWildTreeTrunkResolution(entity, data) {
  ensureWildPhysicsState(entity);
  const air = !!entity.jumping || (entity.z || 0) > 0.05;
  if (!entity.grounded || air || !data) return;
  if (isUndergroundBurrowerDex(entity.dexId ?? 0) && entity.animMoving) return;
  const { dx, dy } = wildFeetDeltaForEntity(entity);
  const r = resolvePivotWithFeetVsTreeTrunks(
    entity.x,
    entity.y,
    dx,
    dy,
    WILD_TREE_BODY_R,
    entity.vx,
    entity.vy,
    data
  );
  entity.x = r.x;
  entity.y = r.y;
  entity.vx = r.vx;
  entity.vy = r.vy;
}

/**
 * Move horizontal: primeiro ao longo do vetor (como colisão contínua contra troncos redondos), depois sobra em eixo.
 * @returns {boolean} true se a posição mudou
 */
function tryApplyWildPokemonMove(entity, nx, ny, data, air) {
  const ox = entity.x;
  const oy = entity.y;
  const ax = nx - ox;
  const ay = ny - oy;
  if (ax * ax + ay * ay < 1e-14) return false;

  const ig = true;
  if (wildWalkOk(nx, ny, data, ox, oy, entity, air, ig)) {
    entity.x = nx;
    entity.y = ny;
    return true;
  }

  let px = ox;
  let py = oy;
  let moved = false;

  if (wildWalkOk(ox, oy, data, ox, oy, entity, air, ig)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) * 0.5;
      if (wildWalkOk(ox + ax * mid, oy + ay * mid, data, ox, oy, entity, air, ig)) lo = mid;
      else hi = mid;
    }
    const t = lo;
    px = ox + ax * t;
    py = oy + ay * t;
    if (t > 1e-7) moved = true;

    const rax = ax * (1 - t);
    const ray = ay * (1 - t);
    if (Math.abs(rax) >= Math.abs(ray)) {
      if (Math.abs(rax) > 1e-6 && wildWalkOk(px + rax, py, data, px, py, entity, air, ig)) {
        px += rax;
        moved = true;
      } else if (Math.abs(ray) > 1e-6 && wildWalkOk(px, py + ray, data, px, py, entity, air, ig)) {
        py += ray;
        moved = true;
      }
    } else {
      if (Math.abs(ray) > 1e-6 && wildWalkOk(px, py + ray, data, px, py, entity, air, ig)) {
        py += ray;
        moved = true;
      } else if (Math.abs(rax) > 1e-6 && wildWalkOk(px + rax, py, data, px, py, entity, air, ig)) {
        px += rax;
        moved = true;
      }
    }
  }

  if (moved) {
    entity.x = px;
    entity.y = py;
    return true;
  }
  if (wildWalkOk(nx, oy, data, ox, oy, entity, air, ig)) {
    entity.x = nx;
    return true;
  }
  if (wildWalkOk(ox, ny, data, ox, oy, entity, air, ig)) {
    entity.y = ny;
    return true;
  }
  return false;
}

const DIRECTION_ROW_MAP = {
  down: 0,
  'down-right': 1,
  right: 2,
  'up-right': 3,
  up: 4,
  'up-left': 5,
  left: 6,
  'down-left': 7
};

/** @type {Map<string, object>} */
const entitiesByKey = new Map();

const WILD_SOCIAL_INTERACTION_RADIUS = 9.0;
const WILD_SOCIAL_RIPPLE_RADIUS = 14.0;
const WILD_SOCIAL_REACTION_COOLDOWN_SEC = 0.45;
const WILD_SOCIAL_MEMORY_DECAY_PER_SEC = 0.55;
const WILD_SOCIAL_SIGNAL_DECAY_PER_SEC = 0.9;
const WILD_SOCIAL_SIGNAL_DELTA_TILES = 0.85;
const WILD_SOCIAL_EVENT_TTL_SEC = 10.0;
const WILD_SOCIAL_EVENT_MAX = 10;
const WILD_SOCIAL_NEARBY_EVENT_RADIUS = 8.5;
const PLAYER_SOCIAL_TACKLE_HIT_RADIUS = 2.25;
const PLAYER_SOCIAL_TACKLE_DAMAGE = 8;
const PLAYER_SOCIAL_TACKLE_KNOCKBACK = 3.2;
const PLAYER_TACKLE_WILD_DAMAGE = 12;
const PLAYER_TACKLE_WILD_KNOCKBACK = 4.15;
const PLAYER_TACKLE_WILD_SWEEP_RADIUS = 0.34;
const PLAYER_TACKLE_HIT_PROBE_BACKOFF_TILES = 0.05;
const WILD_KNOCKBACK_LOCK_SEC = 0.34;
const WILD_KNOCKBACK_DAMP_PER_SEC = 4.8;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTackleSocialAction(action) {
  if (!action) return false;
  const id = String(action.id || '').toLowerCase();
  const label = String(action.label || '').toLowerCase();
  return id === 'tackle' || id === 'challenge' || id.includes('tackle') || label.includes('tackle');
}

function applyWildKnockbackFromPoint(entity, fromX, fromY, strength) {
  if (!entity) return;
  const dx = (entity.x ?? 0) - (Number(fromX) || 0);
  const dy = (entity.y ?? 0) - (Number(fromY) || 0);
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const kb = Math.max(0.2, Number(strength) || PLAYER_FIELD_MOVE_KNOCKBACK);
  const blend = 0.05;
  entity.vx = (entity.vx || 0) * blend + nx * kb;
  entity.vy = (entity.vy || 0) * blend + ny * kb;
  entity.knockbackLockSec = Math.max(entity.knockbackLockSec || 0, WILD_KNOCKBACK_LOCK_SEC);
  if (entity.aiState !== 'sleep') {
    entity.aiState = 'alert';
    entity.alertTimer = Math.max(entity.alertTimer || 0, WILD_KNOCKBACK_LOCK_SEC * 0.9);
  }
  entity.targetX = null;
  entity.targetY = null;
  entity.wanderTimer = 0;
  entity.idlePauseTimer = 0;
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

function ensureSocialMemory(entity) {
  if (!entity.socialMemory) {
    entity.socialMemory = {
      affinity: 0,
      threat: 0,
      curiosity: 0,
      approachSignal: 0,
      retreatSignal: 0,
      reactionCooldown: 0
    };
  }
  if (!Array.isArray(entity.recentNearbyEvents)) entity.recentNearbyEvents = [];
  if (entity.lastPlayerDist == null) entity.lastPlayerDist = null;
  if (entity.lastProximitySignalAt == null) entity.lastProximitySignalAt = 999;
  return entity.socialMemory;
}

function pushRecentNearbyEvent(entity, type, intensity = 1, meta) {
  ensureSocialMemory(entity);
  const evt = {
    type: String(type || ''),
    intensity: Number.isFinite(intensity) ? intensity : 0,
    ttl: WILD_SOCIAL_EVENT_TTL_SEC
  };
  if (meta && meta.subjectDex != null) evt.subjectDex = Math.floor(Number(meta.subjectDex)) || 0;
  entity.recentNearbyEvents.push(evt);
  if (entity.recentNearbyEvents.length > WILD_SOCIAL_EVENT_MAX) {
    entity.recentNearbyEvents.splice(0, entity.recentNearbyEvents.length - WILD_SOCIAL_EVENT_MAX);
  }
}

function getNearbyEventIntensity(entity, eventType) {
  const list = entity.recentNearbyEvents;
  if (!Array.isArray(list) || !list.length) return 0;
  let total = 0;
  for (const evt of list) {
    if (evt.type === eventType) total += Number(evt.intensity) || 0;
  }
  return total;
}

function getAllySpeciesHurtIntensity(entity) {
  const myDex = entity.dexId ?? 1;
  const list = entity.recentNearbyEvents;
  if (!Array.isArray(list) || !list.length) return 0;
  let total = 0;
  for (const evt of list) {
    if (evt.type !== 'ally_species_hurt') continue;
    if (evt.subjectDex != null && evt.subjectDex !== myDex) continue;
    total += Number(evt.intensity) || 0;
  }
  return total;
}

function broadcastNearbySpeciesAllyHurt(worldX, worldY, victimDex, intensity = 1, ignoreEntity = null) {
  const vd = Math.floor(Number(victimDex)) || 1;
  for (const e of entitiesByKey.values()) {
    if (e === ignoreEntity) continue;
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
    if ((e.dexId ?? 1) !== vd) continue;
    const dist = Math.hypot(e.x - worldX, e.y - worldY);
    if (dist > WILD_SOCIAL_NEARBY_EVENT_RADIUS) continue;
    const scaled = intensity * clamp(1 - dist / WILD_SOCIAL_NEARBY_EVENT_RADIUS, 0.25, 1);
    pushRecentNearbyEvent(e, 'ally_species_hurt', scaled, { subjectDex: vd });
  }
}

function decaySocialMemory(entity, dt) {
  const memory = ensureSocialMemory(entity);
  const smoothStep = Math.max(0, dt);

  const decayTowardZero = (value, rate) => {
    if (value > 0) return Math.max(0, value - smoothStep * rate);
    if (value < 0) return Math.min(0, value + smoothStep * rate);
    return 0;
  };

  memory.affinity = decayTowardZero(memory.affinity, WILD_SOCIAL_MEMORY_DECAY_PER_SEC);
  memory.threat = decayTowardZero(memory.threat, WILD_SOCIAL_MEMORY_DECAY_PER_SEC * 0.85);
  memory.curiosity = decayTowardZero(memory.curiosity, WILD_SOCIAL_MEMORY_DECAY_PER_SEC * 0.7);
  memory.approachSignal = decayTowardZero(memory.approachSignal, WILD_SOCIAL_SIGNAL_DECAY_PER_SEC);
  memory.retreatSignal = decayTowardZero(memory.retreatSignal, WILD_SOCIAL_SIGNAL_DECAY_PER_SEC);
  memory.reactionCooldown = Math.max(0, (memory.reactionCooldown || 0) - smoothStep);

  if (!Array.isArray(entity.recentNearbyEvents) || !entity.recentNearbyEvents.length) {
    entity.recentNearbyEvents = [];
  } else {
    const kept = [];
    for (const evt of entity.recentNearbyEvents) {
      evt.ttl = (evt.ttl || 0) - smoothStep;
      if (evt.ttl > 0) kept.push(evt);
    }
    entity.recentNearbyEvents = kept;
  }

  entity.provoked01 = Math.max(0, (entity.provoked01 || 0) - smoothStep * 0.3);
  entity.wildTempAggressiveSec = Math.max(0, (entity.wildTempAggressiveSec || 0) - smoothStep);
  const allyStrain = getAllySpeciesHurtIntensity(entity);
  if (allyStrain >= 0.85) {
    entity.wildTempAggressiveSec = Math.min(22, Math.max(entity.wildTempAggressiveSec || 0, 6.5));
  }
}

function trackPlayerProximitySignals(entity, distToPlayer, dt) {
  const memory = ensureSocialMemory(entity);
  if (entity.lastPlayerDist == null) {
    entity.lastPlayerDist = distToPlayer;
    return;
  }
  const delta = distToPlayer - entity.lastPlayerDist;
  entity.lastPlayerDist = distToPlayer;
  entity.lastProximitySignalAt = (entity.lastProximitySignalAt || 0) + Math.max(0, dt);

  if (Math.abs(delta) < WILD_SOCIAL_SIGNAL_DELTA_TILES) return;
  if (delta < 0) {
    memory.approachSignal = clamp(memory.approachSignal + 0.45, -2, 2.5);
  } else {
    memory.retreatSignal = clamp(memory.retreatSignal + 0.45, -2, 2.5);
  }
  entity.lastProximitySignalAt = 0;
}

function broadcastNearbyPlayerEvent(worldX, worldY, eventType, intensity = 1, ignoreEntity = null) {
  for (const e of entitiesByKey.values()) {
    if (e === ignoreEntity) continue;
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
    const dist = Math.hypot(e.x - worldX, e.y - worldY);
    if (dist > WILD_SOCIAL_NEARBY_EVENT_RADIUS) continue;
    const scaled = intensity * clamp(1 - dist / WILD_SOCIAL_NEARBY_EVENT_RADIUS, 0.2, 1);
    pushRecentNearbyEvent(e, eventType, scaled);
  }
}

export function resetWildPokemonManager() {
  entitiesByKey.clear();
  wildUpdateFrameCounter = 0;
}

/** Keys for play-debug summons: never despawned by {@link syncWildPokemonWindow} slot budget. */
const DEBUG_SUMMON_KEY_PREFIX = 'debug:';
const DEBUG_SUMMON_MAX = 16;
let nextDebugSummonSeq = 1;

function isDebugSummonKey(k) {
  return typeof k === 'string' && k.startsWith(DEBUG_SUMMON_KEY_PREFIX);
}

function pruneDebugSummonsIfNeeded() {
  while ([...entitiesByKey.keys()].filter(isDebugSummonKey).length >= DEBUG_SUMMON_MAX) {
    for (const k of entitiesByKey.keys()) {
      if (isDebugSummonKey(k)) {
        entitiesByKey.delete(k);
        break;
      }
    }
  }
}

function bindStandardWildTakeDamage(entity) {
  entity.takeDamage = function (amount) {
    const memory = ensureSocialMemory(this);
    this.hp -= amount;
    this.hurtTimer = 0.28;
    this.hurtAnimTimer = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.hurtTimer = 0;
      this.deadState = this.animMeta?.faint ? 'faint' : 'sleep';
      this.deadTimer = 1.35;
      this.deadAnimTimer = 0;
      this.aiState = 'sleep';
      this.animMoving = false;
      this.vx = 0;
      this.vy = 0;
      setEmotion(this, 9, true, 'Pain');
      this.isDespawning = true;
    }
    this.hitFlashTimer = 0.2;

    if (this.aiState !== 'flee' && this.aiState !== 'sleep') {
      this.aiState = 'flee';
    }

    memory.threat = clamp(memory.threat + 0.9, 0, 3.5);
    memory.affinity = clamp(memory.affinity - 0.35, -2.5, 3);
    pushRecentNearbyEvent(this, 'player_damage', 1.3);
    broadcastNearbyPlayerEvent(this.x, this.y, 'player_damage', 0.85, this);
    broadcastNearbySpeciesAllyHurt(this.x, this.y, this.dexId ?? 1, 1.05, this);
    this.provoked01 = clamp((this.provoked01 || 0) + 0.42, 0, 3);
    if (this.provoked01 >= 0.38) {
      this.wildTempAggressiveSec = Math.min(22, Math.max(this.wildTempAggressiveSec || 0, 4.8));
    }

    if (amount > 0) playWildDamageHurtCry(this);
  };
}

/**
 * Find a walkable pivot near (ox, oy) in micro-tile world space.
 * @returns {{ spawnX: number, spawnY: number } | null}
 */
function findWalkableWildSpawnNear(data, dex, ox, oy) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const candidates = [[ox, oy]];
  for (let ring = 1; ring <= 12; ring++) {
    const steps = Math.max(8, ring * 8);
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      candidates.push([ox + Math.cos(ang) * ring * 0.65, oy + Math.sin(ang) * ring * 0.65]);
    }
  }
  for (const [tx, ty] of candidates) {
    if (tx < 0.5 || ty < 0.5 || tx >= microW - 0.5 || ty >= microH - 0.5) continue;
    const ft = worldFeetFromPivotCell(tx, ty, imageCache, dex, false);
    if (canWildPokemonWalkMicroTile(ft.x, ft.y, data)) return { spawnX: tx, spawnY: ty };
  }
  return null;
}

/**
 * Play mode: spawn a wild Pokémon by dex at a free tile near the player.
 * Persists across wild slot sync (see {@link isDebugSummonKey}).
 * @param {number} dexId
 * @param {object} data
 * @param {number} nearWorldX micro X
 * @param {number} nearWorldY micro Y
 * @returns {boolean}
 */
export function summonDebugWildPokemon(dexId, data, nearWorldX, nearWorldY) {
  if (!data) return false;
  const dex = Math.floor(Number(dexId)) || 0;
  if (!getPokemonConfig(dex)) return false;

  const pos = findWalkableWildSpawnNear(data, dex, nearWorldX, nearWorldY);
  if (!pos) return false;

  void preloadPokemonCry(dex);

  pruneDebugSummonsIfNeeded();
  const summonSeq = nextDebugSummonSeq++;
  const key = `${DEBUG_SUMMON_KEY_PREFIX}${summonSeq}`;
  const spawnX = pos.spawnX;
  const spawnY = pos.spawnY;
  const w = data.width;
  const h = data.height;
  const macroX = Math.floor(spawnX / MACRO_TILE_STRIDE);
  const macroY = Math.floor(spawnY / MACRO_TILE_STRIDE);
  const subN = wildSubdivN();
  const cellW = MACRO_TILE_STRIDE / subN;
  const lx = spawnX - macroX * MACRO_TILE_STRIDE;
  const ly = spawnY - macroY * MACRO_TILE_STRIDE;
  const subX = Math.max(0, Math.min(subN - 1, Math.floor(lx / cellW)));
  const subY = Math.max(0, Math.min(subN - 1, Math.floor(ly / cellW)));
  const biomeId =
    macroX >= 0 && macroY >= 0 && macroX < w && macroY < h ? data.biomes[macroY * w + macroX] : 0;
  const sexSalt = (data.seed ^ SALT_SPAWN ^ dex * 1_009 ^ summonSeq * 97) | 0;
  const sex = rollWildSex(dex, sexSalt >>> 0);

  let spawnType = 'land';
  if (SKY_SPECIES.has(dex)) {
    spawnType = 'sky';
  } else {
    const overlayId = getFoliageOverlayTileId(Math.floor(spawnX), Math.floor(spawnY), data);
    const lakeRole = getLakeLotusFoliageWalkRole(Math.floor(spawnX), Math.floor(spawnY), data);
    const isWater = overlayId !== null || lakeRole !== null;
    if (isWater) spawnType = 'water';
    else if (overlayId !== null) spawnType = 'grass';
  }

  const entity = {
    key,
    macroX,
    macroY,
    subX,
    subY,
    biomeId,
    pickIndex: -1,
    centerX: spawnX,
    centerY: spawnY,
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    dexId: dex,
    sex,
    provoked01: 0,
    wildTempAggressiveSec: 0,
    animMeta: getDexAnimMeta(dex),
    facing: 'down',
    animRow: 0,
    animFrame: 0,
    idleTimer: 0,
    _walkPhase: 0,
    wanderTimer: 0,
    idlePauseTimer: 0,
    animMoving: false,
    behavior: getSpeciesBehavior(dex),
    aiState: 'wander',
    alertTimer: 0,
    emotionType: null,
    emotionPortraitSlug: null,
    emotionAge: 0,
    emotionPersist: false,
    spawnPhase: 1,
    isDespawning: false,
    spawnType,
    targetX: null,
    targetY: null,
    z: 0,
    vz: 0,
    grounded: true,
    jumping: false,
    jumpCooldown: 0,
    _blockedMoveFrames: 0,
    hp: 50,
    maxHp: 50,
    deadState: null,
    deadTimer: 0,
    deadAnimTimer: 0,
    hurtTimer: 0,
    hurtAnimTimer: 0,
    hitFlashTimer: 0,
    isBoss: false,
    socialMemory: {
      affinity: 0,
      threat: 0,
      curiosity: 0,
      approachSignal: 0,
      retreatSignal: 0,
      reactionCooldown: 0
    },
    recentNearbyEvents: [],
    lastPlayerDist: null,
    lastProximitySignalAt: 999,
    _lodDtAccum: 0,
    _lodOffset: seededHashInt(macroX * 211 + subX * 37, macroY * 223 + subY * 41, data.seed ^ 0x6c6f64) % 4
  };
  bindStandardWildTakeDamage(entity);
  entitiesByKey.set(key, entity);
  void ensurePokemonSheetsLoaded(imageCache, dex);
  void probeSpriteCollabPortraitPrefix(dex).catch(() => {});
  return true;
}


function pickAnimFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return 0;
}

function advanceWildPokemonAnim(entity, dt) {
  const ticks = dt * 60;
  entity.animRow = DIRECTION_ROW_MAP[entity.facing] ?? 0;
  const meta = entity.animMeta || null;
  if (entity.deadState) {
    const isFaint = entity.deadState === 'faint';
    const seq = isFaint
      ? (meta?.faint?.durations?.length ? meta.faint.durations : (meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle))
      : (meta?.sleep?.durations?.length ? meta.sleep.durations : (meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle));
    const total = seq.reduce((a, b) => a + b, 0);
    entity.deadAnimTimer = (entity.deadAnimTimer || 0) + ticks;
    const t = isFaint ? Math.min(total, entity.deadAnimTimer) : (entity.deadAnimTimer % total);
    entity.animFrame = pickAnimFrame(seq, t);
    entity.animRow = 0;
  } else if (entity.hurtTimer > 0) {
    entity.hurtAnimTimer = (entity.hurtAnimTimer || 0) + ticks;
    const seq = meta?.hurt?.durations?.length ? meta.hurt.durations : meta?.idle?.durations || PMD_DEFAULT_MON_ANIMS.Idle;
    const total = seq.reduce((a, b) => a + b, 0);
    const loopTick = entity.hurtAnimTimer % total;
    entity.animFrame = pickAnimFrame(seq, loopTick);
  } else if (entity.animMoving) {
    entity._walkPhase = (entity._walkPhase || 0) + ticks;
    const seq = meta?.walk?.durations?.length ? meta.walk.durations : PMD_DEFAULT_MON_ANIMS.Walk;
    const total = seq.reduce((a, b) => a + b, 0);
    const loopTick = entity._walkPhase % total;
    entity.animFrame = pickAnimFrame(seq, loopTick);
    entity.idleTimer = 0;
  } else {
    entity.idleTimer = (entity.idleTimer || 0) + ticks;
    const seq = meta?.idle?.durations?.length ? meta.idle.durations : PMD_DEFAULT_MON_ANIMS.Idle;
    const total = seq.reduce((a, b) => a + b, 0);
    const loopTick = entity.idleTimer % total;
    entity.animFrame = pickAnimFrame(seq, loopTick);
  }

  // Handle emotion balloon animation timer
  if (entity.emotionType !== null) {
    entity.emotionAge += dt;
    // If not persistent, the balloon vanishes after completing its animation (1.0s to be safe)
    if (!entity.emotionPersist && entity.emotionAge > WILD_EMOTION_NONPERSIST_CLEAR_SEC) {
      entity.emotionType = null;
      entity.emotionPortraitSlug = null;
    }
  }
}

/**
 * @param {object} entity
 * @param {number} type — RPG Maker balloon row (0–9)
 * @param {boolean} [persist]
 * @param {string | null | undefined} [portraitSlug] — SpriteCollab basename without `.png`; default maps from balloon type
 */
function setEmotion(entity, type, persist = false, portraitSlug) {
  const resolvedSlug =
    portraitSlug === undefined || portraitSlug === null
      ? defaultPortraitSlugForBalloon(type)
      : String(portraitSlug);
  if (
    entity.emotionType === type &&
    entity.emotionAge < 2.0 &&
    (entity.emotionPortraitSlug || '') === resolvedSlug
  ) {
    return;
  }
  entity.emotionType = type;
  entity.emotionAge = 0;
  entity.emotionPersist = persist;
  entity.emotionPortraitSlug = resolvedSlug;
  ensureSpriteCollabPortraitLoaded(imageCache, entity.dexId ?? 1, resolvedSlug).catch(() => {});
  playWildEmotionCry(entity, type, resolvedSlug);
}

function updateWildMotion(entity, dt, data, playerX, playerY) {
  ensureWildPhysicsState(entity);
  if (entity.deadState) {
    entity.vx = 0;
    entity.vy = 0;
    entity.animMoving = false;
    return;
  }
  if ((entity.knockbackLockSec || 0) > 0) {
    entity.knockbackLockSec = Math.max(0, (entity.knockbackLockSec || 0) - dt);
    const airKb = wildIsAirborne(entity);
    const nxKb = entity.x + (entity.vx || 0) * dt;
    const nyKb = entity.y + (entity.vy || 0) * dt;
    const movedKb = tryApplyWildPokemonMove(entity, nxKb, nyKb, data, airKb);
    if (!movedKb) {
      entity.vx *= 0.2;
      entity.vy *= 0.2;
    }
    const damp = Math.exp(-WILD_KNOCKBACK_DAMP_PER_SEC * dt);
    entity.vx *= damp;
    entity.vy *= damp;
    entity.targetX = null;
    entity.targetY = null;
    const spKb = Math.hypot(entity.vx || 0, entity.vy || 0);
    entity.animMoving = spKb > 0.08;
    if (spKb > 0.06) {
      entity.facing = getFacingFromAngle(Math.atan2(entity.vy, entity.vx));
    }
    return;
  }
  const beh = getEffectiveWildBehavior(entity);
  const dxP = entity.x - playerX;
  const dyP = entity.y - playerY;
  const distP = Math.hypot(dxP, dyP);
  trackPlayerProximitySignals(entity, distP, dt);

  const prevState = entity.aiState;

  // Wake up sleepers!
  if (entity.aiState === 'sleep') {
    if (distP < beh.alertRadius) {
      entity.aiState = 'alert';
      entity.alertTimer = 1.0;
      setEmotion(entity, 0, true, 'Surprised'); // ! + portrait (same balloon, other faces possible)
      entity.animMoving = false;
    }
    return; // Don't wander while sleeping
  }

  // Player Awareness State Machine
  if (distP < beh.alertRadius) {
    if (beh.archetype === 'timid' || beh.archetype === 'skittish') {
      entity.aiState = 'flee';
      // Basic collision-aware steering: move away from player
      const angToPlayer = Math.atan2(dyP, dxP);
      const fleeAng = angToPlayer; // Straight away
      steerTowardAngle(entity, fleeAng, beh.fleeSpeed, data, wildIsAirborne(entity), true);
      
      entity.wanderTimer = 0;
      entity.idlePauseTimer = 0;
      entity.targetX = null;
    } else if (beh.archetype === 'aggressive') {
      entity.aiState = 'approach';
      if (distP > beh.stopDist) {
        const approachAng = Math.atan2(-dyP, -dxP); // Straight toward
        steerTowardAngle(entity, approachAng, beh.approachSpeed, data, wildIsAirborne(entity), true);
      } else {
        entity.vx = 0;
        entity.vy = 0;
        tryCastWildMove(entity, playerX, playerY, dt);
      }
      entity.wanderTimer = 0;
      entity.idlePauseTimer = 0;
      entity.targetX = null;
    } else if (beh.archetype === 'neutral') {
      if (entity.aiState !== 'alert') {
        entity.aiState = 'alert';
        entity.alertTimer = 1.0 + Math.random(); // stare for 1-2s
        entity.vx = 0;
        entity.vy = 0;
      }
    }
  } else if (distP >= beh.alertRadius * 1.5 && entity.aiState !== 'sleep') {
    entity.aiState = 'wander';
  }

  // Pokémon that are still spawning or already despawning ignore interactions
  if ((entity.spawnPhase ?? 1) < 0.5 || entity.isDespawning) {
    entity.vx = 0;
    entity.vy = 0;
    entity.animMoving = false;
    return;
  }

  // Handle emotion triggers on state transition
  if (prevState !== entity.aiState) {
    if (entity.aiState === 'flee') {
      setEmotion(entity, 5, true); // Sweat drop 💧 while fully fleeing
    } else if (entity.aiState === 'approach') {
      setEmotion(entity, 4, true); // Angry 💢
    } else if (entity.aiState === 'alert') {
      setEmotion(entity, 0, true); // Exclamation ! (holds while staring)
    } else if (entity.aiState === 'wander' && prevState !== 'sleep') {
      setEmotion(entity, 1, false); // Question ? (lost track)
    }
  }

  // Check if staring too long (almost done)
  if (entity.aiState === 'alert' && entity.alertTimer < 0.3 && entity.emotionType === 0) {
    setEmotion(entity, 7, false); // Ellipsis ...
  }

  // Handle alert/stare state
  if (entity.aiState === 'alert') {
    entity.alertTimer -= dt;
    if (entity.alertTimer <= 0) {
      entity.aiState = 'wander';
    }
    // Face player (8 directions)
    const ang = Math.atan2(-dyP, -dxP);
    entity.facing = getFacingFromAngle(ang);
    entity.animMoving = false;
    return;
  }

    if (entity.aiState === 'wander') {
    if ((entity.idlePauseTimer || 0) > 0) {
      entity.idlePauseTimer -= dt;
      entity.vx = 0;
      entity.vy = 0;
      if (entity.idlePauseTimer < 0) entity.idlePauseTimer = 0;
    }

    if ((entity.idlePauseTimer || 0) > 0) {
      entity.animMoving = false;
      return;
    }

    // Waypoint Logic: Pick a target and walk toward it
    if (entity.targetX === null || entity.targetY === null) {
      // Pick a random destination within WILD_WANDER_RADIUS_TILES that is walkable
      for (let attempt = 0; attempt < 10; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * WILD_WANDER_RADIUS_TILES;
        const tx = entity.centerX + Math.cos(ang) * dist;
        const ty = entity.centerY + Math.sin(ang) * dist;
        const wanderEntity =
          isUndergroundBurrowerDex(entity.dexId ?? 0) ? { ...entity, animMoving: true } : entity;
        if (wildWalkOk(tx, ty, data, entity.x, entity.y, wanderEntity, false, true)) {
          entity.targetX = tx;
          entity.targetY = ty;
          break;
        }
      }
      // If we couldn't find a destination, pause
      if (entity.targetX === null) {
        entity.idlePauseTimer = 1.0;
        return;
      }
    }

    // Move toward target
    const dxT = entity.targetX - entity.x;
    const dyT = entity.targetY - entity.y;
    const distT = Math.hypot(dxT, dyT);

    if (distT < 0.2) {
      // Reached destination!
      entity.targetX = null;
      entity.targetY = null;
      entity.idlePauseTimer = WANDER_IDLE_MIN + Math.random() * WANDER_IDLE_EXTRA;
      entity.vx = 0;
      entity.vy = 0;
      entity.animMoving = false;
      
      if (Math.random() < 0.15 && entity.emotionType === null) {
        const balloon = Math.random() < 0.5 ? 2 : 3;
        const happyish = ['Happy', 'Joyous', 'Inspired'];
        const slug = happyish[Math.floor(Math.random() * happyish.length)];
        setEmotion(entity, balloon, false, slug);
      }
      return;
    }

    // Greedy steering toward target
    const moveAng = Math.atan2(dyT, dxT);
    steerTowardAngle(entity, moveAng, MAX_SPEED * 0.45, data, wildIsAirborne(entity), false);
  }

  // Apply velocity speculatively with terrain bounds checking (+ deslize em cantos)
  const air = wildIsAirborne(entity);
  const nx = entity.x + entity.vx * dt;
  const ny = entity.y + entity.vy * dt;

  const moved = tryApplyWildPokemonMove(entity, nx, ny, data, air);
  if (!moved) {
    entity.vx = 0;
    entity.vy = 0;
    entity.targetX = null;
    entity._blockedMoveFrames = (entity._blockedMoveFrames || 0) + 1;

    const needJumpFrames =
      entity.aiState === 'flee' || entity.aiState === 'approach'
        ? WILD_JUMP_BLOCKED_FRAMES_FLEE
        : WILD_JUMP_BLOCKED_FRAMES_WANDER;
    if (entity.grounded && !air && entity._blockedMoveFrames >= needJumpFrames) {
      tryWildPokemonJump(entity);
    }

    if (
      (entity.aiState === 'wander' || entity.aiState === 'flee' || entity.aiState === 'approach') &&
      entity._blockedMoveFrames === needJumpFrames
    ) {
      setEmotion(entity, 6, false); // 💬 uma vez ao aproximar do salto
    }
  } else {
    entity._blockedMoveFrames = 0;
  }

  applyWildTreeTrunkResolution(entity, data);

  // Clamp wander radius
  const dx = entity.x - entity.centerX;
  const dy = entity.y - entity.centerY;
  const dist = Math.hypot(dx, dy);
  if (dist > WILD_WANDER_RADIUS_TILES && dist > 1e-6) {
    const nxc = dx / dist;
    const nyc = dy / dist;
    const clampedX = entity.centerX + nxc * WILD_WANDER_RADIUS_TILES;
    const clampedY = entity.centerY + nyc * WILD_WANDER_RADIUS_TILES;

    if (wildWalkOk(clampedX, clampedY, data, entity.x, entity.y, entity, wildIsAirborne(entity), true)) {
      entity.x = clampedX;
      entity.y = clampedY;
    }
    
    entity.targetX = null; // Turn around
    const dot = entity.vx * nxc + entity.vy * nyc;
    if (dot > 0) {
      entity.vx -= nxc * dot * 1.75;
      entity.vy -= nyc * dot * 1.75;
    }
  }

  // Update facing and animation state
  const spd = Math.hypot(entity.vx, entity.vy);
  entity.animMoving = spd > 0.1;

  if (entity.aiState === 'approach' && distP <= beh.stopDist) {
    const ang = Math.atan2(-dyP, -dxP);
    entity.facing = getFacingFromAngle(ang);
  } else if (spd > 0.06) {
    const ang = Math.atan2(entity.vy, entity.vx);
    entity.facing = getFacingFromAngle(ang);
  } else if (entity.aiState === 'flee') {
    entity.facing = getFacingFromAngle(Math.atan2(dyP, dxP));
  } else if (entity.aiState === 'approach' && distP > beh.stopDist) {
    entity.facing = getFacingFromAngle(Math.atan2(-dyP, -dxP));
  }
}

function getFacingFromAngle(ang) {
  // Quantize 360 degrees to 8 directions (45 deg increments)
  // atan2 0 is Right, PI/2 is Down.
  const deg = (ang * 180) / Math.PI;
  // Normalize deg to -22.5..337.5 for easier quantization
  const normalized = (deg + 360 + 22.5) % 360;
  const index = Math.floor(normalized / 45);
  const dirs = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  return dirs[index];
}

/**
 * Helper to steer toward an angle while avoiding obstacles.
 */
function wildIsAirborne(entity) {
  ensureWildPhysicsState(entity);
  return !!entity.jumping || (entity.z || 0) > 0.05;
}

function steerTowardAngle(entity, targetAng, speed, data, isAirborne, narrowSweep = false) {
  // Preferido primeiro; em fuga/perseguição varredura estreita evita “lateral” na borda do penhasco.
  const angles = narrowSweep
    ? [
        targetAng,
        targetAng + Math.PI / 8,
        targetAng - Math.PI / 8,
        targetAng + Math.PI / 4,
        targetAng - Math.PI / 4,
      ]
    : [
        targetAng,
        targetAng + Math.PI / 4,
        targetAng - Math.PI / 4,
        targetAng + Math.PI / 2,
        targetAng - Math.PI / 2,
      ];

  for (const ang of angles) {
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    // Increased lookahead to avoid "shoveling" into props (radius-aware)
    if (wildWalkOk(entity.x + vx * 0.4, entity.y + vy * 0.4, data, entity.x, entity.y, entity, isAirborne, true)) {
      entity.vx = vx;
      entity.vy = vy;
      entity.stuckTimer = 0; // Clear stuck state on successful move
      return;
    }
  }
  
  // Stuck? Just stop and rethink
  entity.vx = 0;
  entity.vy = 0;
  entity.targetX = null; // Forces new waypoint
  entity.stuckTimer = (entity.stuckTimer || 0) + 1.0; // Increment stuck weight
}

/**
 * Mantém slots na janela macro (2r+1)² × N²; se exceder o orçamento, mantém só os mais próximos do jogador.
 * @param {object} data mapa gerado
 * @param {number} playerMicroX tile micro X
 * @param {number} playerMicroY tile micro Y
 */
export function syncWildPokemonWindow(data, playerMicroX, playerMicroY) {
  if (!data) return;

  const w = data.width;
  const h = data.height;
  const pmx = Math.floor(playerMicroX / MACRO_TILE_STRIDE);
  const pmy = Math.floor(playerMicroY / MACRO_TILE_STRIDE);
  const subN = wildSubdivN();
  const cellW = MACRO_TILE_STRIDE / subN;

  const needed = buildWildNeededSlotKeys(w, h, pmx, pmy, subN, cellW, playerMicroX, playerMicroY);

  for (const [k, ent] of entitiesByKey.entries()) {
    if (isDebugSummonKey(k)) continue;
    if (!needed.has(k)) {
      ent.isDespawning = true;
    }
  }

  /** Per macro cell + biome: which encounter pool indices are already taken (reduces same-biome repetition). */
  const usedPickIndexesByMacroBiome = new Map();
  for (const ent of entitiesByKey.values()) {
    if (typeof ent.biomeId !== 'number' || typeof ent.pickIndex !== 'number') continue;
    if (ent.pickIndex < 0) continue;
    if (typeof ent.macroX !== 'number' || typeof ent.macroY !== 'number') continue;
    const scopeKey = `${ent.biomeId}|${ent.macroX}|${ent.macroY}`;
    let set = usedPickIndexesByMacroBiome.get(scopeKey);
    if (!set) {
      set = new Set();
      usedPickIndexesByMacroBiome.set(scopeKey, set);
    }
    set.add(ent.pickIndex);
  }

  for (const k of needed) {
    const existing = entitiesByKey.get(k);
    if (existing) {
      existing.isDespawning = false; // Restore if it was about to vanish
      continue;
    }

    const parts = k.split(',').map(Number);
    const mx = parts[0];
    const my = parts[1];
    const sx = parts.length >= 4 ? parts[2] : 0;
    const sy = parts.length >= 4 ? parts[3] : 0;
    const biomeId = data.biomes[my * w + mx];
    const pool = getEncounters(biomeId);
    const pickScopeKey = `${biomeId}|${mx}|${my}`;
    const basePick =
      seededHashInt(mx * 4733 + sx * 997, my * 3623 + sy * 683, data.seed ^ SALT_SPAWN ^ biomeId * 131) %
      pool.length;
    let pick = basePick;
    if (pool.length > 1) {
      let used = usedPickIndexesByMacroBiome.get(pickScopeKey);
      if (!used) {
        used = new Set();
        usedPickIndexesByMacroBiome.set(pickScopeKey, used);
      }
      if (used.has(pick)) {
        const jump = 1 + (seededHashInt(mx * 181 + sx * 13, my * 191 + sy * 17, data.seed ^ pick * 499) % Math.max(1, pool.length - 1));
        for (let step = 0; step < pool.length; step++) {
          const tryPick = (pick + step * jump) % pool.length;
          if (!used.has(tryPick)) {
            pick = tryPick;
            break;
          }
        }
      }
      used.add(pick);
    }

    const baseDex = encounterNameToDex(pool[pick]);
    if (baseDex == null) continue;
    const bossRoll = rollBossPromotedDex(baseDex, mx, my, sx, sy, data.seed);
    const dex = bossRoll.dex;
    void preloadPokemonCry(dex);
    const spawnHp = bossRoll.hp;
    const spawnMaxHp = bossRoll.maxHp;
    const isBoss = bossRoll.isBoss;

    const centerX = mx * MACRO_TILE_STRIDE + (sx + 0.5) * cellW;
    const centerY = my * MACRO_TILE_STRIDE + (sy + 0.5) * cellW;
    const jitterR = Math.min(5, cellW * 0.42);
    const jx = (seededHashInt(mx + 31 + sx * 17, my + 11 + sy * 13, data.seed) % 1000) / 1000 - 0.5;
    const jy = (seededHashInt(mx + 71 + sx * 7, my + 3 + sy * 19, data.seed) % 1000) / 1000 - 0.5;

    let spawnX = centerX + jx * jitterR;
    let spawnY = centerY + jy * jitterR;

    // Attempt to find a valid walkable tile for wild pokemon (allows water/lava, blocks trees/cliffs)
    const spawnFt = worldFeetFromPivotCell(spawnX, spawnY, imageCache, dex, false);
    if (!canWildPokemonWalkMicroTile(spawnFt.x, spawnFt.y, data)) {
      let found = false;
      // Search in expanding squares/circles
      for (let r = 1; r <= 5; r++) { // Increased radius to 5
        for (let a = 0; a < 8; a++) {
          const cx = spawnX + Math.cos((a * Math.PI) / 4) * r;
          const cy = spawnY + Math.sin((a * Math.PI) / 4) * r;
          const tryFt = worldFeetFromPivotCell(cx, cy, imageCache, dex, false);
          if (canWildPokemonWalkMicroTile(tryFt.x, tryFt.y, data)) {
            spawnX = cx;
            spawnY = cy;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) continue; // Skip spawning in this chunk if it's completely blocked (e.g. dense building/cliff)
    }

    // Determine Spawn Animation Type
    let spawnType = 'land';
    if (SKY_SPECIES.has(dex)) {
      spawnType = 'sky';
    } else {
      const overlayId = getFoliageOverlayTileId(Math.floor(spawnX), Math.floor(spawnY), data);
      const lakeRole = getLakeLotusFoliageWalkRole(Math.floor(spawnX), Math.floor(spawnY), data);

      const isWater = (overlayId !== null) || (lakeRole !== null);
      if (isWater) {
        spawnType = 'water';
      } else if (overlayId !== null) { // If not water but has overlay, it's likely grass/foliage
        spawnType = 'grass';
      }
    }

    // 15% chance to spawn sleeping (if they don't immediately wake up)
    const spawnSleep = Math.random() < 0.15;

    const sexSalt =
      (data.seed ^ SALT_SPAWN ^ dex * 1_009 ^ sx * 37 ^ sy * 41 ^ mx * 19 ^ my * 23) | 0;
    const sex = rollWildSex(dex, sexSalt >>> 0);

    const entity = {
      key: k,
      macroX: mx,
      macroY: my,
      subX: sx,
      subY: sy,
      biomeId,
      pickIndex: pick,
      centerX,
      centerY,
      x: spawnX,
      y: spawnY,
      vx: 0,
      vy: 0,
      dexId: dex,
      sex,
      provoked01: 0,
      wildTempAggressiveSec: 0,
      animMeta: getDexAnimMeta(dex),
      facing: 'down',
      animRow: 0,
      animFrame: 0,
      idleTimer: 0,
      _walkPhase: 0,
      wanderTimer: 0,
      idlePauseTimer: 0,
      animMoving: false,
      behavior: getSpeciesBehavior(dex),
      aiState: spawnSleep ? 'sleep' : 'wander',
      alertTimer: 0,
      emotionType: spawnSleep ? 9 : null, // 9 = Zzz
      emotionPortraitSlug: spawnSleep ? 'Normal' : null,
      emotionAge: 0,
      emotionPersist: spawnSleep, // Sleep persists until woken
      // SPAWN STATE
      spawnPhase: 0,
      isDespawning: false,
      spawnType,
      // PATHFINDING
      targetX: null,
      targetY: null,
      z: 0,
      vz: 0,
      grounded: true,
      jumping: false,
      jumpCooldown: 0,
      _blockedMoveFrames: 0,
      isBoss: !!isBoss,
      hp: spawnHp,
      maxHp: spawnMaxHp,
      deadState: null, // 'faint' | 'sleep'
      deadTimer: 0,
      deadAnimTimer: 0,
      hurtTimer: 0,
      hurtAnimTimer: 0,
      hitFlashTimer: 0,
      socialMemory: {
        affinity: 0,
        threat: 0,
        curiosity: 0,
        approachSignal: 0,
        retreatSignal: 0,
        reactionCooldown: 0
      },
      recentNearbyEvents: [],
      lastPlayerDist: null,
      lastProximitySignalAt: 999,
      _lodDtAccum: 0,
      _lodOffset:
        seededHashInt(mx * 211 + sx * 37, my * 223 + sy * 41, data.seed ^ 0x6c6f64) % WILD_UPDATE_CADENCE_FAR
    };
    bindStandardWildTakeDamage(entity);
    entitiesByKey.set(k, entity);
    ensurePokemonSheetsLoaded(imageCache, dex);
    probeSpriteCollabPortraitPrefix(dex).catch(() => {});
    if (spawnSleep) {
      ensureSpriteCollabPortraitLoaded(imageCache, dex, 'Normal').catch(() => {});
    }
  }
}

/** Skip heavy wander pathing when far (sleep/flee/approach/alert still run every frame). */
const WILD_WANDER_LOD_SKIP_DIST = 40;
/** Interaction-priority ring: keep nearby mons fully responsive. */
const WILD_INTERACTION_PRIORITY_DIST = 26;
/** Mid ring keeps reduced cadence while still feeling alive. */
const WILD_INTERACTION_MID_DIST = 48;
const WILD_UPDATE_CADENCE_MID = 2;
const WILD_UPDATE_CADENCE_FAR = 4;
/** Prevent huge simulation jumps when accumulated dt is consumed. */
const WILD_LOD_DT_CAP = 0.12;

let wildUpdateFrameCounter = 0;

function nextWildUpdateFrame() {
  wildUpdateFrameCounter = (wildUpdateFrameCounter + 1) % 1_000_000_000;
  return wildUpdateFrameCounter;
}

function wildNeedsFullRateUpdate(entity, distToPlayer) {
  return (
    distToPlayer <= WILD_INTERACTION_PRIORITY_DIST ||
    entity.aiState !== 'wander' ||
    entity.isDespawning ||
    (entity.spawnPhase ?? 1) < 1 ||
    (entity.knockbackLockSec || 0) > 0 ||
    entity.hurtTimer > 0 ||
    entity.hitFlashTimer > 0 ||
    !!entity.deadState
  );
}

function wildCadenceForDistance(distToPlayer) {
  if (distToPlayer <= WILD_INTERACTION_MID_DIST) return WILD_UPDATE_CADENCE_MID;
  return WILD_UPDATE_CADENCE_FAR;
}

export function updateWildPokemon(dt, data, playerX, playerY) {
  if (!data) return;
  const toDelete = [];
  const frameNo = nextWildUpdateFrame();
  for (const [k, e] of entitiesByKey.entries()) {
    const distToPlayer = Math.hypot(e.x - playerX, e.y - playerY);
    const isCloseEnough = distToPlayer < 24;
    const fullRate = wildNeedsFullRateUpdate(e, distToPlayer);
    const cadence = fullRate ? 1 : wildCadenceForDistance(distToPlayer);
    const lodOffset = e._lodOffset ?? 0;
    const processThisFrame = cadence === 1 || ((frameNo + lodOffset) % cadence === 0);
    e._lodDtAccum = (e._lodDtAccum || 0) + dt;
    if (!processThisFrame) continue;
    const stepDt = Math.min(WILD_LOD_DT_CAP, e._lodDtAccum);
    e._lodDtAccum = 0;
    const skipWanderMotion =
      distToPlayer > WILD_WANDER_LOD_SKIP_DIST &&
      e.aiState === 'wander' &&
      !e.isDespawning &&
      (e.spawnPhase ?? 1) >= 0.5;

    // Transition spawn phase
    if (e.isDespawning) {
      if (e.deadTimer > 0) {
        e.deadTimer = Math.max(0, e.deadTimer - stepDt);
      }
      if (e.deadTimer <= 0) {
        // Faster despawn to clean up quickly
        e.spawnPhase = Math.max(0, (e.spawnPhase ?? 1) - stepDt * 2.0);
      }
      if (e.spawnPhase <= 0) toDelete.push(k);
    } else {
      // Only start the spawn animation when the player is relatively close (within view distance)
      if (isCloseEnough || e.spawnPhase > 0) {
        // Slower spawn (approx 1.4s) for better visual impact
        e.spawnPhase = Math.min(1, (e.spawnPhase ?? 0) + stepDt * 0.7);
      }
    }

    integrateWildPokemonVertical(e, stepDt);
    decaySocialMemory(e, stepDt);
    if (!skipWanderMotion) {
      updateWildMotion(e, stepDt, data, playerX, playerY);
    } else {
      e.vx = 0;
      e.vy = 0;
      e.animMoving = false;
    }
    if (e.hurtTimer > 0) e.hurtTimer = Math.max(0, e.hurtTimer - stepDt);
    advanceWildPokemonAnim(e, stepDt);
    
    if (e.hitFlashTimer > 0) {
      e.hitFlashTimer -= stepDt;
      if (e.hitFlashTimer < 0) e.hitFlashTimer = 0;
    }
  }
  for (const k of toDelete) entitiesByKey.delete(k);
}

export function getWildPokemonEntities() {
  return Array.from(entitiesByKey.values());
}

function resolveSocialActionInput(actionInput) {
  if (!actionInput) return null;
  if (typeof actionInput === 'string') return getSocialActionById(actionInput);
  if (typeof actionInput === 'object') {
    if (actionInput.id) return getSocialActionById(actionInput.id) || actionInput;
  }
  return null;
}

function socialDeltasForIntent(intent) {
  switch (intent) {
    case 'friendly':
      return { affinity: 0.62, threat: -0.2, curiosity: 0.22 };
    case 'playful':
      return { affinity: 0.35, threat: 0.05, curiosity: 0.5 };
    case 'curious':
      return { affinity: 0.12, threat: 0, curiosity: 0.66 };
    case 'calming':
      return { affinity: 0.25, threat: -0.5, curiosity: 0.18 };
    case 'assertive':
      return { affinity: -0.05, threat: 0.45, curiosity: 0.2 };
    case 'scary':
      return { affinity: -0.25, threat: 0.86, curiosity: -0.05 };
    default:
      return { affinity: 0, threat: 0, curiosity: 0 };
  }
}

function behaviorSocialModifiers(archetype) {
  switch (archetype) {
    case 'timid':
      return { affinityMul: 0.95, threatMul: 1.18, curiosityMul: 0.8 };
    case 'skittish':
      return { affinityMul: 0.82, threatMul: 1.35, curiosityMul: 0.72 };
    case 'aggressive':
      return { affinityMul: 0.72, threatMul: 0.9, curiosityMul: 1.2 };
    default:
      return { affinityMul: 1, threatMul: 1, curiosityMul: 1 };
  }
}

function chooseEmotionByOutcome(action, outcome, memory) {
  if (outcome === 'deescalate') return action.balloonType ?? 2;
  if (outcome === 'flee') return 5;
  if (outcome === 'approach') return 4;
  if (memory.threat > 1.4) return 0;
  return action.balloonType ?? 7;
}

/** Small, tunable modifiers — keeps social reactions slightly sex-aware without hard stereotypes. */
function socialSexIntentMul(entity, intent) {
  const s = entity?.sex;
  if (!s || s === 'genderless') return { affinity: 1, threat: 1 };
  if (intent === 'scary') {
    return s === 'female' ? { affinity: 1, threat: 1.07 } : { affinity: 1, threat: 1.02 };
  }
  if (intent === 'assertive') {
    return s === 'male' ? { affinity: 0.99, threat: 1.05 } : { affinity: 1, threat: 1.03 };
  }
  if (intent === 'calming') {
    return s === 'female' ? { affinity: 1.05, threat: 1 } : { affinity: 1.02, threat: 1 };
  }
  return { affinity: 1, threat: 1 };
}

function applySocialReactionToWild(entity, action, player, influence) {
  if (!entity || !action || !player) return false;
  if ((entity.spawnPhase ?? 1) < 0.5 || entity.isDespawning || entity.deadState) return false;

  const memory = ensureSocialMemory(entity);
  if (memory.reactionCooldown > 0) return false;

  const behavior = entity.behavior || getSpeciesBehavior(entity.dexId ?? 1);
  const eff = getEffectiveWildBehavior(entity);
  const playerCfg = getPokemonConfig(player.dexId ?? 1);
  const wildCfg = getPokemonConfig(entity.dexId ?? 1);
  const playerHeight = Number(playerCfg?.heightTiles) || 2.1;
  const wildHeight = Number(wildCfg?.heightTiles) || 2.1;
  const sizeDelta = clamp((playerHeight - wildHeight) / 2.2, -1.25, 1.25);
  const intentDelta = socialDeltasForIntent(action.intent);
  const behaviorMul = behaviorSocialModifiers(behavior.archetype);
  const hostileNearby =
    getNearbyEventIntensity(entity, 'player_damage') +
    getNearbyEventIntensity(entity, 'player_field_move') +
    getNearbyEventIntensity(entity, 'hostile_social');
  const friendlyNearby = getNearbyEventIntensity(entity, 'friendly_social');

  const intimidationFactor =
    action.intent === 'assertive' || action.intent === 'scary' ? Math.max(0, sizeDelta) : 0;
  const calmingFactor = action.intent === 'calming' ? Math.max(0, sizeDelta) : 0;

  const sexM = socialSexIntentMul(entity, action.intent);

  let affinityDelta =
    (intentDelta.affinity * behaviorMul.affinityMul +
      friendlyNearby * 0.08 -
      hostileNearby * 0.06 +
      memory.retreatSignal * 0.08 -
      memory.approachSignal * 0.04 -
      intimidationFactor * 0.08) *
    influence;
  let threatDelta =
    (intentDelta.threat * behaviorMul.threatMul +
      hostileNearby * 0.2 +
      memory.approachSignal * 0.18 -
      memory.retreatSignal * 0.16 +
      intimidationFactor * 0.38 -
      calmingFactor * 0.16) *
    influence;
  const curiosityDelta =
    (intentDelta.curiosity * behaviorMul.curiosityMul +
      memory.retreatSignal * 0.1 -
      hostileNearby * 0.07) *
    influence;

  affinityDelta *= sexM.affinity;
  threatDelta *= sexM.threat;

  memory.affinity = clamp(memory.affinity + affinityDelta, -2.6, 3.1);
  memory.threat = clamp(memory.threat + threatDelta, 0, 3.8);
  memory.curiosity = clamp(memory.curiosity + curiosityDelta, -2, 3.2);

  const intentEventType = action.intent === 'scary' || action.intent === 'assertive' ? 'hostile_social' : 'friendly_social';
  pushRecentNearbyEvent(entity, intentEventType, 0.8 * influence);
  pushRecentNearbyEvent(entity, `social_${action.id}`, 0.7 * influence);

  if (action.intent === 'assertive' || action.intent === 'scary') {
    const bump = (action.intent === 'scary' ? 0.26 : 0.17) * influence;
    entity.provoked01 = clamp((entity.provoked01 || 0) + bump, 0, 3);
    if (entity.provoked01 >= 0.52) {
      entity.wildTempAggressiveSec = Math.min(22, Math.max(entity.wildTempAggressiveSec || 0, 5.0));
    }
  }

  const moodScore =
    memory.affinity +
    memory.curiosity * 0.35 -
    memory.threat -
    hostileNearby * 0.22 +
    memory.retreatSignal * 0.18 -
    memory.approachSignal * 0.2;

  let outcome = 'neutral';
  if (moodScore >= 0.95) {
    entity.aiState = 'wander';
    entity.vx = 0;
    entity.vy = 0;
    outcome = 'deescalate';
  } else if (moodScore <= -0.65) {
    if (eff.archetype === 'aggressive' && (action.intent === 'assertive' || action.intent === 'scary')) {
      entity.aiState = 'approach';
      outcome = 'approach';
    } else {
      entity.aiState = 'flee';
      outcome = 'flee';
    }
    entity.targetX = null;
    entity.targetY = null;
  } else {
    entity.aiState = 'alert';
    entity.alertTimer = Math.max(entity.alertTimer || 0, 0.8);
    outcome = 'neutral';
  }

  setEmotion(entity, chooseEmotionByOutcome(action, outcome, memory), outcome !== 'deescalate', action.portraitSlug);
  memory.reactionCooldown = WILD_SOCIAL_REACTION_COOLDOWN_SEC;
  return true;
}

/**
 * Social interaction channel from numpad. The nearest wild in radius receives full impact,
 * nearby wild receive lighter ripple updates based on distance.
 * @param {import('../social/social-actions.js').SocialAction | string} actionInput
 * @param {{ x: number, y: number, dexId?: number } | null | undefined} player
 * @param {object | null | undefined} data
 * @returns {{ consumed: boolean, reactedCount: number }}
 */
export function triggerPlayerSocialAction(actionInput, player, data) {
  if (!player || !data) return { consumed: false, reactedCount: 0 };
  const action = resolveSocialActionInput(actionInput);
  if (!action) return { consumed: false, reactedCount: 0 };

  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  /** @type {{ entity: any, dist: number }[]} */
  const nearby = [];
  let primary = null;
  let primaryDist = Infinity;

  for (const entity of entitiesByKey.values()) {
    if ((entity.spawnPhase ?? 1) < 0.5 || entity.isDespawning || entity.deadState) continue;
    const dist = Math.hypot(entity.x - px, entity.y - py);
    if (dist > WILD_SOCIAL_RIPPLE_RADIUS) continue;
    nearby.push({ entity, dist });
    if (dist <= WILD_SOCIAL_INTERACTION_RADIUS && dist < primaryDist) {
      primary = entity;
      primaryDist = dist;
    }
  }

  if (!nearby.length || !primary) return { consumed: true, reactedCount: 0 };

  let reactedCount = 0;
  if (applySocialReactionToWild(primary, action, player, 1.0)) reactedCount += 1;

  for (const entry of nearby) {
    if (entry.entity === primary) continue;
    const ripple = clamp(1 - entry.dist / WILD_SOCIAL_RIPPLE_RADIUS, 0, 1) * 0.42;
    if (ripple < 0.1) continue;
    if (applySocialReactionToWild(entry.entity, action, player, ripple)) reactedCount += 1;
  }

  if (isTackleSocialAction(action) && primaryDist <= PLAYER_SOCIAL_TACKLE_HIT_RADIUS) {
    if (typeof primary.takeDamage === 'function') primary.takeDamage(PLAYER_SOCIAL_TACKLE_DAMAGE);
    setEmotion(primary, 5, false, 'Pain');
    applyWildKnockbackFromPoint(primary, px, py, PLAYER_SOCIAL_TACKLE_KNOCKBACK);
    pushRecentNearbyEvent(primary, 'player_field_move', 1.1);
    broadcastNearbyPlayerEvent(primary.x, primary.y, 'player_field_move', 0.75, primary);
  }

  const eventType = action.intent === 'scary' || action.intent === 'assertive' ? 'hostile_social' : 'friendly_social';
  broadcastNearbyPlayerEvent(px, py, eventType, 0.45);
  return { consumed: true, reactedCount };
}

/** Euclidean distance from tile center (micro) to wild pivot for a field move to register. */
const PLAYER_FIELD_MOVE_HIT_RADIUS = 1.55;
const PLAYER_FIELD_MOVE_KNOCKBACK = 2.4;

/**
 * Game mode: right-click field move — wild mon near the targeted tile gets a pain balloon and knockback from the player.
 * @param {number} mx
 * @param {number} my
 * @param {object} data
 * @param {{ x: number, y: number }} player
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
  return { hit: true, dexId: best.dexId };
}

/**
 * LMB tackle melee hit against nearest wild along the tackle segment.
 * @param {{ x?: number, y?: number, z?: number, tackleDirNx?: number, tackleDirNy?: number, _tackleReachTiles?: number } | null | undefined} player
 * @param {object | null | undefined} data
 * @returns {{ hit: boolean, dexId?: number }}
 */
export function tryPlayerTackleHitWild(player, data) {
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

  if (typeof best.takeDamage === 'function') best.takeDamage(PLAYER_TACKLE_WILD_DAMAGE);
  setEmotion(best, 5, false, 'Pain');
  applyWildKnockbackFromPoint(best, px, py, PLAYER_TACKLE_WILD_KNOCKBACK);
  pushRecentNearbyEvent(best, 'player_field_move', 1.18);
  broadcastNearbyPlayerEvent(best.x, best.y, 'player_field_move', 0.78, best);
  return { hit: true, dexId: best.dexId };
}
