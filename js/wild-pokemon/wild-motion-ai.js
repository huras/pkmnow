import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import { imageCache } from '../image-cache.js';
import { PMD_DEFAULT_MON_ANIMS } from '../pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';
import { getPmdFeetDeltaWorldTiles, worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import { rollWildSex } from '../pokemon/pokemon-sex.js';
import { getSpeciesBehavior } from './pokemon-behavior.js';
import { getEffectiveWildBehavior } from './wild-effective-behavior.js';
import { isUndergroundBurrowerDex } from './underground-burrow.js';
import { canWildPokemonWalkMicroTile, isCliffDrop, pivotCellHeightTraversalOk, gatherTreeTrunkCirclesNearWorldPoint, syncEntityZWithTerrain } from '../walkability.js';
import { resolvePivotWithFeetVsTreeTrunks } from '../circle-tree-trunk-resolve.js';
import { WILD_WANDER_RADIUS_TILES } from './wild-pokemon-constants.js';
import { WILD_EMOTION_NONPERSIST_CLEAR_SEC } from '../pokemon/emotion-display-timing.js';
import {
  defaultPortraitSlugForBalloon,
  ensureSpriteCollabPortraitLoaded,
  probeSpriteCollabPortraitPrefix
} from '../pokemon/spritecollab-portraits.js';
import { playWildEmotionCry, playWildDamageHurtCry, preloadPokemonCry } from '../pokemon/pokemon-cries.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { tryCastWildMove } from '../moves/moves-manager.js';
import { tryBreakDetailsAlongSegment } from '../main/play-crystal-tackle.js';
import { clamp, entitiesByKey, wildSubdivN } from './wild-core-state.js';
import { seededHashInt } from '../tessellation-logic.js';
import { rollBossPromotedDex } from './wild-boss-variants.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { advanceWildSpeechBubble, setWildSpeechBubble } from '../social/speech-bubble-state.js';
import { getEncounters } from '../ecodex.js';
import { WORLD_MAX_WALK_SPEED_TILES_PER_SEC } from '../world-movement-constants.js';
import {
  ensureEntityStamina,
  tickEntityStamina,
  clampVelocityToWalkCapIfNoStamina,
  isWildSprinting
} from '../entity-stamina.js';
import * as groupBehavior from './wild-group-behavior.js';
import { scenarioOrchestrator } from './wild-scenario-orchestrator.js';
import { WILD_SOCIAL_SCENARIOS } from './wild-scenario-data.js';
import { sampleWorldDangerEscapeAngle, sampleWorldDangerScore } from '../simulation/world-reactions.js';
import { advanceFootFloorStepsForDistance } from '../audio/foot-floor-sfx.js';
import { playFloorHit2Sfx } from '../audio/floor-hit-2-sfx.js';

const WANDER_MOVE_MIN = 0.45;
const WANDER_MOVE_EXTRA = 1.2;
const WANDER_IDLE_MIN = 0.35;
const WANDER_IDLE_EXTRA = 1.0;
const WILD_GRAVITY = 45.0;
const WILD_JUMP_IMPULSE = 12.0;
const WILD_JUMP_BLOCKED_FRAMES_FLEE = 14;
const WILD_JUMP_BLOCKED_FRAMES_WANDER = 28;
const WILD_JUMP_COOLDOWN_SEC = 0.85;
const WILD_TREE_BODY_R = 0.28;
const WILD_VISION_RANGE_BASE_MULT = 1.45;
const WILD_VISION_RANGE_MIN_TILES = 8.5;
const WILD_STALL_PROGRESS_THRESHOLD = 0.015;
const WILD_STALL_ABANDON_SEC = 0.9;

export function ensureWildPhysicsState(entity) {
  if (entity.z == null) entity.z = 0;
  if (entity.vz == null) entity.vz = 0;
  if (entity.grounded == null) entity.grounded = true;
  if (entity.jumping == null) entity.jumping = false;
  if (entity.jumpSerial == null) entity.jumpSerial = 0;
  if (entity.jumpCooldown == null) entity.jumpCooldown = 0;
  if (entity._blockedMoveFrames == null) entity._blockedMoveFrames = 0;
  if (entity._wanderLastNx == null) entity._wanderLastNx = 0;
  if (entity._wanderLastNy == null) entity._wanderLastNy = 1;
  if (entity._neutralPostAlertCooldown == null) entity._neutralPostAlertCooldown = 0;
  ensureEntityStamina(entity);
  groupBehavior.ensureGroupBehaviorState(entity);
}

// Redundant group functions removed. Now using groupBehavior module.

function enforceFollowerLeaderMaxDistance(entity, data) {
  const follow = groupBehavior.resolveGroupFollowTarget(entity, entitiesByKey);
  if (!follow || follow.isLeader || !follow.leader) return;
  const lx = Number(follow.leader.x) || 0;
  const ly = Number(follow.leader.y) || 0;
  const dx = (Number(entity.x) || 0) - lx;
  const dy = (Number(entity.y) || 0) - ly;
  const d = Math.hypot(dx, dy);
  if (d <= groupBehavior.WILD_GROUP_FOLLOW_MAX_DIST + 1e-6) return;

  const n = groupBehavior.normalizeVec(dx, dy);
  const tx = lx + n.x * groupBehavior.WILD_GROUP_FOLLOW_MAX_DIST;
  const ty = ly + n.y * groupBehavior.WILD_GROUP_FOLLOW_MAX_DIST;
  const air = wildIsAirborne(entity);

  // Never teleport/snap follower. Keep movement continuous.
  assignWildTargetIfEndpointClear(entity, tx, ty, data, air);

  // Fallback: force a catch-up impulse toward leader if clamped point is blocked.
  const pull = groupBehavior.normalizeVec(lx - (Number(entity.x) || 0), ly - (Number(entity.y) || 0));
  const catchupSpeed = WORLD_MAX_WALK_SPEED_TILES_PER_SEC * 1.1;
  entity.vx = pull.x * catchupSpeed;
  entity.vy = pull.y * catchupSpeed;
  if (!assignWildTargetIfEndpointClear(entity, follow.targetX, follow.targetY, data, air)) {
    entity.targetX = null;
    entity.targetY = null;
  }
}

function steerFollowerSimple(entity, targetAng, speed, data, isAirborne, targetX, targetY) {
  const angles = [targetAng, targetAng + Math.PI / 10, targetAng - Math.PI / 10];
  for (const ang of angles) {
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    if (wildWalkOk(entity.x + vx * 0.35, entity.y + vy * 0.35, data, entity.x, entity.y, entity, isAirborne, true)) {
      entity.vx = vx;
      entity.vy = vy;
      return true;
    }
  }
  entity.vx = 0;
  entity.vy = 0;
  if ((entity._followerTackleCooldownSec || 0) <= 0 && Number.isFinite(targetX) && Number.isFinite(targetY)) {
    const dx = Number(targetX) - (Number(entity.x) || 0);
    const dy = Number(targetY) - (Number(entity.y) || 0);
    const d = Math.hypot(dx, dy);
    if (d > 0.35) {
      const reach = Math.min(1.35, d);
      const nx = dx / d;
      const ny = dy / d;
      const ax = Number(entity.x) || 0;
      const ay = Number(entity.y) || 0;
      const bx = ax + nx * reach;
      const by = ay + ny * reach;
      tryBreakDetailsAlongSegment(ax, ay, bx, by, data, { hitSource: 'tackle', pz: entity.z ?? 0 });
      entity._followerTackleCooldownSec = 0.55;
    }
  }
  return false;
}

export function integrateWildPokemonVertical(entity, dt) {
  ensureWildPhysicsState(entity);
  if (entity.jumpCooldown > 0) entity.jumpCooldown = Math.max(0, entity.jumpCooldown - dt);
  if (!entity.grounded) {
    const zWildPrev = entity.z ?? 0;
    entity.vz -= WILD_GRAVITY * dt;
    entity.z += entity.vz * dt;
    if (entity.z <= 0) {
      entity.z = 0;
      entity.vz = 0;
      entity.grounded = true;
      entity.jumping = false;
      if (zWildPrev > 0.04) playFloorHit2Sfx(entity);
    }
  }
}

export function tryWildPokemonJump(entity) {
  if (!entity.grounded || (entity.jumpCooldown || 0) > 0) return;
  entity.vz = WILD_JUMP_IMPULSE;
  entity.grounded = false;
  entity.jumping = true;
  entity.jumpSerial = (entity.jumpSerial || 0) + 1;
  entity.jumpCooldown = WILD_JUMP_COOLDOWN_SEC;
  entity._blockedMoveFrames = 0;
}

export function wildFeetDeltaForEntity(entity) {
  return getPmdFeetDeltaWorldTiles(imageCache, entity.dexId ?? 1, !!entity.animMoving);
}

const WILD_TARGET_ENDPOINT_CLEARANCE = 0.24;

function isWildTargetEndpointClear(entity, targetX, targetY, data, air) {
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !data || !entity) return false;
  const ft = worldFeetFromPivotCell(targetX, targetY, imageCache, entity.dexId ?? 1, !!entity.animMoving);
  if (!canWildPokemonWalkMicroTile(ft.x, ft.y, data, undefined, undefined, !!air, false)) return false;
  if (air) return true;

  const r = WILD_TARGET_ENDPOINT_CLEARANCE;
  const samples = [
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
    [r * 0.7071, r * 0.7071],
    [r * 0.7071, -r * 0.7071],
    [-r * 0.7071, r * 0.7071],
    [-r * 0.7071, -r * 0.7071]
  ];
  for (const [ox, oy] of samples) {
    if (!canWildPokemonWalkMicroTile(ft.x + ox, ft.y + oy, data, undefined, undefined, false, false)) return false;
  }
  return true;
}

function assignWildTargetIfEndpointClear(entity, targetX, targetY, data, air) {
  if (!isWildTargetEndpointClear(entity, targetX, targetY, data, air)) return false;
  entity.targetX = targetX;
  entity.targetY = targetY;
  return true;
}

export function wildWalkOk(destX, destY, data, srcX, srcY, entity, air, ignoreTreeTrunks = false) {
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

export function applyWildTreeTrunkResolution(entity, data) {
  ensureWildPhysicsState(entity);
  const air = !!entity.jumping || (entity.z || 0) > 0.05;
  if (!entity.grounded || air || !data) return;
  if (isUndergroundBurrowerDex(entity.dexId ?? 0) && entity.animMoving) return;
  const fd = getPmdFeetDeltaWorldTiles(imageCache, entity.dexId ?? 1, true);
  const r = resolvePivotWithFeetVsTreeTrunks(entity.x, entity.y, fd.dx, fd.dy, WILD_TREE_BODY_R, entity.vx, entity.vy, data);
  syncEntityZWithTerrain(entity, entity.x, entity.y, r.x, r.y, data);
  entity.x = r.x;
  entity.y = r.y;
  entity.vx = r.vx;
  entity.vy = r.vy;
}

export function tryApplyWildPokemonMove(entity, nx, ny, data, air) {
  const ox = entity.x;
  const oy = entity.y;
  const ax = nx - ox;
  const ay = ny - oy;
  if (ax * ax + ay * ay < 1e-14) return false;

  const ig = true;
  if (wildWalkOk(nx, ny, data, ox, oy, entity, air, ig)) {
    syncEntityZWithTerrain(entity, ox, oy, nx, ny, data);
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
    syncEntityZWithTerrain(entity, ox, oy, px, py, data);
    entity.x = px;
    entity.y = py;
    return true;
  }
  if (wildWalkOk(nx, oy, data, ox, oy, entity, air, ig)) {
    syncEntityZWithTerrain(entity, ox, oy, nx, oy, data);
    entity.x = nx;
    return true;
  }
  if (wildWalkOk(ox, ny, data, ox, oy, entity, air, ig)) {
    syncEntityZWithTerrain(entity, ox, oy, ox, ny, data);
    entity.y = ny;
    return true;
  }
  return false;
}

export const DIRECTION_ROW_MAP = {
  down: 0,
  'down-right': 1,
  right: 2,
  'up-right': 3,
  up: 4,
  'up-left': 5,
  left: 6,
  'down-left': 7
};

export function pickAnimFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return 0;
}

export function advanceWildPokemonAnim(entity, dt) {
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

  if (entity.emotionType !== null) {
    entity.emotionAge += dt;
    if (!entity.emotionPersist && entity.emotionAge > WILD_EMOTION_NONPERSIST_CLEAR_SEC) {
      entity.emotionType = null;
      entity.emotionPortraitSlug = null;
    }
  }
  advanceWildSpeechBubble(entity, dt);
}

export function setEmotion(entity, type, persist = false, portraitSlug) {
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

export function getFacingFromAngle(ang) {
  const deg = (ang * 180) / Math.PI;
  const normalized = (deg + 360 + 22.5) % 360;
  const index = Math.floor(normalized / 45);
  const dirs = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  return dirs[index];
}

export function wildIsAirborne(entity) {
  ensureWildPhysicsState(entity);
  return !!entity.jumping || (entity.z || 0) > 0.05;
}

export function steerTowardAngle(entity, targetAng, speed, data, isAirborne, narrowSweep = false) {
  // Ledge penalty must match real movement: grounded mons (including Flying-type) still use
  // `wildWalkOk(..., air=false)` / height checks — ignoring cliffs only while airborne avoids
  // steering toward drops the physics cannot follow (stutter, jump spam, “doidão” roam).
  const ignoreLedgePenalty = !!isAirborne;

  const angles = narrowSweep
    ? [
        targetAng,
        targetAng + Math.PI / 8,
        targetAng - Math.PI / 8,
        targetAng + Math.PI / 4,
        targetAng - Math.PI / 4
      ]
    : [
        targetAng,
        targetAng + Math.PI / 4,
        targetAng - Math.PI / 4,
        targetAng + Math.PI / 2,
        targetAng - Math.PI / 2
      ];

  const trunkCircles = gatherTreeTrunkCirclesNearWorldPoint(entity.x, entity.y, data);

  const desiredNx = Math.cos(targetAng);
  const desiredNy = Math.sin(targetAng);
  const curSpd = Math.hypot(entity.vx || 0, entity.vy || 0);
  let memNx;
  let memNy;
  if (curSpd > 0.07) {
    memNx = (entity.vx || 0) / curSpd;
    memNy = (entity.vy || 0) / curSpd;
  } else {
    memNx = Number(entity._wanderLastNx) || desiredNx;
    memNy = Number(entity._wanderLastNy) || desiredNy;
    const mlen = Math.hypot(memNx, memNy) || 1;
    memNx /= mlen;
    memNy /= mlen;
  }

  let bestAng = /** @type {number | null} */ (null);
  let bestScore = -Infinity;
  for (const ang of angles) {
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    
    let penalty = 0;
    
    // Do not discard! Add a penalty. This allows Pokémon to try to walk into cliffs if it's the best path,
    // which will correctly trigger the jump logic instead of zig-zagging.
    if (!wildWalkOk(entity.x + vx * 0.4, entity.y + vy * 0.4, data, entity.x, entity.y, entity, isAirborne, true)) {
      penalty += 1.25;
    }

    if (!ignoreLedgePenalty) {
      const tx = entity.x + vx * 0.45;
      const ty = entity.y + vy * 0.45;
      if (isCliffDrop(entity.x, entity.y, tx, ty, data)) {
        penalty += 0.85; // Strong penalty for walking off cliffs while roaming
      }
    }
    
    // Smart steering around circular colliders (trees/rocks)
    for (let i = 0; i < trunkCircles.length; i++) {
       const circle = trunkCircles[i];
       const dxToTree = circle.cx - entity.x;
       const dyToTree = circle.cy - entity.y;
       const distSq = dxToTree * dxToTree + dyToTree * dyToTree;
       
       if (distSq < 9) { // Only evaluate trees within ~3 tiles
           const dot = dxToTree * nx + dyToTree * ny;
           if (dot > 0) { // Tree is somewhat in front
               const projX = nx * dot;
               const projY = ny * dot;
               const perpDistSq = (dxToTree - projX)**2 + (dyToTree - projY)**2;
               
               const avoidanceRadius = circle.r + 0.65; // padding for entity body
               if (perpDistSq < avoidanceRadius * avoidanceRadius) {
                   // Repulsion penalty based on how close we would pass and how near the tree is
                   penalty += (avoidanceRadius * avoidanceRadius - perpDistSq) * (1.0 / Math.max(0.1, dot)) * 0.8;
               }
           }
       }
    }

    const alignGoal = nx * desiredNx + ny * desiredNy;
    const alignMem = nx * memNx + ny * memNy;

    const score = alignGoal + 0.38 * alignMem - penalty - 0.02 * Math.abs(Math.atan2(Math.sin(ang - targetAng), Math.cos(ang - targetAng)));
    if (score > bestScore) {
      bestScore = score;
      bestAng = ang;
    }
  }

  if (bestAng != null) {
    entity.vx = Math.cos(bestAng) * speed;
    entity.vy = Math.sin(bestAng) * speed;
    entity.stuckTimer = 0;
    return;
  }

  entity.vx = 0;
  entity.vy = 0;
  entity.stuckTimer = (entity.stuckTimer || 0) + 1.0;
}

const WILD_KNOCKBACK_DAMP_PER_SEC = 4.8;

/* ── High-Affinity Follow ───────────────────────────────────────────────── */
const FOLLOW_PLAYER_AFFINITY_ENTER = 2.2;   // affinity needed to START following
const FOLLOW_PLAYER_AFFINITY_EXIT  = 1.0;   // drop below this → stop following
const FOLLOW_PLAYER_STOP_DIST      = 2.2;   // tiles – stop walking when this close
const FOLLOW_PLAYER_WALK_SPEED     = 1.6;   // tiles/sec when following

export function updateWildMotion(entity, dt, data, playerX, playerY) {
  ensureWildPhysicsState(entity);
  scenarioOrchestrator.update(dt);
  
  if ((entity._followerTackleCooldownSec || 0) > 0) {
    entity._followerTackleCooldownSec = Math.max(0, (entity._followerTackleCooldownSec || 0) - dt);
  }
  if (entity.deadState) {
    entity.vx = 0;
    entity.vy = 0;
    entity.animMoving = false;
    return;
  }
  if ((entity.meleeHitStopSec || 0) > 0) {
    entity.meleeHitStopSec = Math.max(0, (entity.meleeHitStopSec || 0) - dt);
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
  if ((entity._neutralPostAlertCooldown || 0) > 0) {
    entity._neutralPostAlertCooldown = Math.max(0, entity._neutralPostAlertCooldown - dt);
  }
  if ((entity.groupCohesionSec || 0) > 0) {
    entity.groupCohesionSec = Math.max(0, (entity.groupCohesionSec || 0) - dt);
  }
  const effectiveAlertRadius = Math.max(
    WILD_VISION_RANGE_MIN_TILES,
    (beh.alertRadius || 0) * WILD_VISION_RANGE_BASE_MULT + (entity.wildTempAggressiveSec > 0 ? 1.0 : 0)
  );
  const dxP = entity.x - playerX;
  const dyP = entity.y - playerY;
  const distP = Math.hypot(dxP, dyP);
  const groupFollowEarly = groupBehavior.resolveGroupFollowTarget(entity, entitiesByKey);
  const followerTeamMode = !!groupFollowEarly && !groupFollowEarly.isLeader;
  const envDanger = sampleWorldDangerScore(entity.x, entity.y, data);
  const envEscapeAng = envDanger > 0.35 ? sampleWorldDangerEscapeAngle(entity.x, entity.y, data) : null;

  if (entity.aiState === 'scenic') {
    entity.vx = 0;
    entity.vy = 0;
    entity.animMoving = false;
    return;
  }

  /* ── follow_player state ──────────────────────────────────────────── */
  if (entity.aiState === 'follow_player') {
    const mem = entity.socialMemory;
    const aff = mem ? (mem.affinity || 0) : 0;
    // Exit condition: affinity dropped or player too far
    if (aff < FOLLOW_PLAYER_AFFINITY_EXIT || distP > 30) {
      entity.aiState = 'wander';
      setEmotion(entity, 7, false); // Sigh (goodbye)
      entity.targetX = null;
      entity.targetY = null;
    } else if (distP > FOLLOW_PLAYER_STOP_DIST) {
      // Walk toward player
      const ang = Math.atan2(-dyP, -dxP);
      steerTowardAngle(entity, ang, FOLLOW_PLAYER_WALK_SPEED, data, wildIsAirborne(entity), false);
    } else {
      // Close enough — idle and face player
      entity.vx = 0;
      entity.vy = 0;
      entity.animMoving = false;
      entity.facing = getFacingFromAngle(Math.atan2(-dyP, -dxP));
      // Occasionally show a happy emotion
      if (!entity.speechBubble && entity.emotionType === null && Math.random() < 0.003) {
        setEmotion(entity, 3, false); // Happy
      }
    }
    return;
  }

  const prevState = entity.aiState;

  if (entity.aiState === 'sleep') {
    if (distP < effectiveAlertRadius) {
      entity.aiState = 'alert';
      entity.alertTimer = 1.0;
      setEmotion(entity, 0, true, 'Surprised');
      entity.animMoving = false;
    }
    return;
  }

  const playerThreatInRange = distP < effectiveAlertRadius;
  const environmentalThreatInRange = !followerTeamMode && envDanger > 0.62;
  const isFollowingPlayer = entity.aiState === 'follow_player';

  if ((playerThreatInRange || environmentalThreatInRange) && !isFollowingPlayer) {
    if (followerTeamMode) {
      // Followers stay in team-follow mode and do not run independent player reaction states.
      entity.aiState = 'wander';
      entity.alertTimer = 0;
      entity._neutralPostAlertCooldown = 0;
    } else if (!playerThreatInRange && environmentalThreatInRange) {
      entity.aiState = 'flee';
      let hazardFleeAng = envEscapeAng ?? Math.atan2(dyP, dxP);
      
      const isFlocking = (Number(entity.groupCohesionSec) || 0) > 1000;
      if (isFlocking && entity.groupId) {
        const groupBoids = groupBehavior.resolveGroupBoidsSteer(entity, entitiesByKey, clamp);
        if (groupBoids) {
          let combinedNx = Math.cos(hazardFleeAng);
          let combinedNy = Math.sin(hazardFleeAng);
          const boidsBlend = 0.65 * groupBoids.strength;
          combinedNx = combinedNx * (1 - boidsBlend) + groupBoids.nx * boidsBlend;
          combinedNy = combinedNy * (1 - boidsBlend) + groupBoids.ny * boidsBlend;
          hazardFleeAng = Math.atan2(combinedNy, combinedNx);
        }
      }

      const hazardFleeSpeed = Math.max(beh.fleeSpeed || 0, WORLD_MAX_WALK_SPEED_TILES_PER_SEC * 0.92);
      steerTowardAngle(entity, hazardFleeAng, hazardFleeSpeed, data, wildIsAirborne(entity), true);
      entity.wanderTimer = 0;
      entity.idlePauseTimer = 0;
      entity.targetX = null;
    } else if (beh.archetype === 'timid' || beh.archetype === 'skittish') {
      entity.aiState = 'flee';
      let fleeAng = playerThreatInRange ? Math.atan2(dyP, dxP) : envEscapeAng ?? Math.atan2(dyP, dxP);
      
      const isFlocking = (Number(entity.groupCohesionSec) || 0) > 1000;
      if (isFlocking && entity.groupId) {
        const groupBoids = groupBehavior.resolveGroupBoidsSteer(entity, entitiesByKey, clamp);
        if (groupBoids) {
          let combinedNx = Math.cos(fleeAng);
          let combinedNy = Math.sin(fleeAng);
          const boidsBlend = 0.65 * groupBoids.strength;
          combinedNx = combinedNx * (1 - boidsBlend) + groupBoids.nx * boidsBlend;
          combinedNy = combinedNy * (1 - boidsBlend) + groupBoids.ny * boidsBlend;
          fleeAng = Math.atan2(combinedNy, combinedNx);
        }
      }

      steerTowardAngle(entity, fleeAng, beh.fleeSpeed, data, wildIsAirborne(entity), true);
      entity.wanderTimer = 0;
      entity.idlePauseTimer = 0;
      entity.targetX = null;
    } else if (beh.archetype === 'aggressive') {
      entity.aiState = 'approach';
      if (distP > beh.stopDist) {
        const approachAng = Math.atan2(-dyP, -dxP);
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
      // Without a post-alert cooldown, neutral mons flip alert→wander→alert every frame the player
      // stays in radius, replaying the exclamation bubble forever.
      if (entity.aiState !== 'alert' && (entity._neutralPostAlertCooldown || 0) <= 0) {
        entity.aiState = 'alert';
        entity.alertTimer = 1.0 + Math.random();
        entity.vx = 0;
        entity.vy = 0;
      }
    }
  } else if (distP >= effectiveAlertRadius * 1.5 && envDanger < 0.28 && entity.aiState !== 'sleep' && !isFollowingPlayer) {
    entity.aiState = 'wander';
    entity._neutralPostAlertCooldown = 0;
  }

  if ((entity.spawnPhase ?? 1) < 0.5 || entity.isDespawning) {
    entity.vx = 0;
    entity.vy = 0;
    entity.animMoving = false;
    return;
  }

  if (prevState !== entity.aiState) {
    if (entity.aiState === 'flee') {
      setEmotion(entity, 5, true);
    } else if (entity.aiState === 'approach') {
      setEmotion(entity, 4, true);
    } else if (entity.aiState === 'alert') {
      setEmotion(entity, 0, true);
    } else if (entity.aiState === 'wander' && prevState !== 'sleep') {
      setEmotion(entity, 1, false);
    }
  }

  if (entity.aiState === 'alert' && entity.alertTimer < 0.3 && entity.emotionType === 0) {
    setEmotion(entity, 7, false);
  }

  if (entity.aiState === 'alert') {
    entity.alertTimer -= dt;
    if (entity.alertTimer <= 0) {
      entity.aiState = 'wander';
      if (beh.archetype === 'neutral') {
        entity._neutralPostAlertCooldown = 2.6 + Math.random() * 2.8;
      }
    }
    const ang = Math.atan2(-dyP, -dxP);
    entity.facing = getFacingFromAngle(ang);
    entity.animMoving = false;
    return;
  }

  if (entity.aiState === 'wander') {
    const groupFollow = groupBehavior.resolveGroupFollowTarget(entity, entitiesByKey);
    const followerMode = !!groupFollow && !groupFollow.isLeader;

    // ── High-Affinity → Follow Player ──
    if (!followerMode && entity.socialMemory) {
      const aff = entity.socialMemory.affinity || 0;
      if (aff >= FOLLOW_PLAYER_AFFINITY_ENTER && distP < 18 && !entity.groupPhase?.startsWith('SCENIC')) {
        entity.aiState = 'follow_player';
        setEmotion(entity, 2, false); // Joyous
        return;
      }
    }

    // ── Phase Lifecycle & Organic Discovery ──
    if (entity.groupId && !followerMode) {
      groupBehavior.advanceWildGroupLeaderPhaseTimer(entity, dt);
      groupBehavior.syncWildGroupPhaseFromLeader(entity, entitiesByKey);
    }

    // Organic Discovery Check (Any member can find while in EXPLORE)
    if (entity.groupId && entity.groupPhase === 'EXPLORE' && (entity.discoveryCooldown || 0) <= 0) {
        // Chance per second (clamped)
        const chance = groupBehavior.DISCOVERY_CHANCE_TICK * dt;
        if (Math.random() < chance && distP > 10.0) {
            const pool = WILD_SOCIAL_SCENARIOS.filter(s => s.minMembers <= (entity.groupSize || 1));
            if (pool.length > 0) {
                const scenario = pool[Math.floor(Math.random() * pool.length)];
                const groupMembers = [...entitiesByKey.values()]
                    .filter(e => e.groupId === entity.groupId)
                    .sort((a, b) => (a.groupMemberIndex || 0) - (b.groupMemberIndex || 0));
                
                if (groupMembers.length >= scenario.minMembers) {
                    scenarioOrchestrator.startScenario(entity.groupId, scenario.id, groupMembers, entity.key);
                    
                    // Mark entire group as Scenic
                    for(const m of groupMembers) {
                      m.groupPhase = 'SCENIC';
                      m.discoveryCooldown =
                        groupBehavior.DISCOVERY_GROUP_COOLDOWN_MIN_SEC +
                        Math.random() * (groupBehavior.DISCOVERY_GROUP_COOLDOWN_MAX_SEC - groupBehavior.DISCOVERY_GROUP_COOLDOWN_MIN_SEC);
                    }
                }
            }
        }
    }
    
    if ((entity.discoveryCooldown || 0) > 0) entity.discoveryCooldown -= dt;
    
    // Followers SCALE cohesion and boids weights but still use them for separation/alignment.
    const groupCohesion = groupBehavior.resolveGroupCohesionTarget(entity, entitiesByKey, clamp);
    const groupBoids = groupBehavior.resolveGroupBoidsSteer(entity, entitiesByKey, clamp);
    if ((entity.idlePauseTimer || 0) > 0) {
      entity.idlePauseTimer -= dt;
      entity.vx = 0;
      entity.vy = 0;
      if (entity.idlePauseTimer < 0) entity.idlePauseTimer = 0;
    }

    if ((entity.idlePauseTimer || 0) > 0 && !followerMode) {
      entity.animMoving = false;
      return;
    }

    if (followerMode) {
      entity.idlePauseTimer = 0;
      if (!assignWildTargetIfEndpointClear(entity, groupFollow.targetX, groupFollow.targetY, data, wildIsAirborne(entity))) {
        entity.targetX = null;
        entity.targetY = null;
      }
    }

    if (entity.targetX === null || entity.targetY === null) {
      if (followerMode) {
        assignWildTargetIfEndpointClear(entity, groupFollow.targetX, groupFollow.targetY, data, wildIsAirborne(entity));
      } else {
        if (groupBoids) {
          const pull = Math.max(1.25, Math.min(WILD_WANDER_RADIUS_TILES * 0.28, 1.8 + groupBoids.neighborCount * 0.4));
          const tx = entity.x + groupBoids.nx * pull;
          const ty = entity.y + groupBoids.ny * pull;
          assignWildTargetIfEndpointClear(entity, tx, ty, data, false);
        }
        if (groupCohesion) {
          const dxG = groupCohesion.x - entity.x;
          const dyG = groupCohesion.y - entity.y;
          const distG = Math.hypot(dxG, dyG);
          if (distG > groupBehavior.WILD_GROUP_COHESION_MIN_DIST) {
            const pullDist = Math.max(0.85, Math.min(WILD_WANDER_RADIUS_TILES * 0.78, distG * 0.72));
            const tx = entity.x + (dxG / (distG || 1)) * pullDist;
            const ty = entity.y + (dyG / (distG || 1)) * pullDist;
            assignWildTargetIfEndpointClear(entity, tx, ty, data, false);
          }
        }
        for (let attempt = 0; attempt < 10; attempt++) {
          if (followerMode) break;
          if (entity.targetX != null && entity.targetY != null) break;
          const ang = Math.random() * Math.PI * 2;
          const dist = Math.random() * WILD_WANDER_RADIUS_TILES;
          const tx = entity.centerX + Math.cos(ang) * dist;
          const ty = entity.centerY + Math.sin(ang) * dist;
          // Path may be blocked; only the endpoint must be valid and not too close to colliders.
          if (!isCliffDrop(entity.x, entity.y, tx, ty, data) && assignWildTargetIfEndpointClear(entity, tx, ty, data, false)) {
            break;
          }
        }
      }
      if (entity.targetX === null) {
        entity.idlePauseTimer = 1.0;
        return;
      }
    }

    const dxT = entity.targetX - entity.x;
    const dyT = entity.targetY - entity.y;
    const distT = Math.hypot(dxT, dyT);

    if (distT < 1.0) {
      if (followerMode) {
        entity.vx = 0;
        entity.vy = 0;
        if (Number.isFinite(entity.targetX) && Number.isFinite(entity.targetY)) {
          const fx = Number(entity.targetX) - (Number(entity.x) || 0);
          const fy = Number(entity.targetY) - (Number(entity.y) || 0);
          if (Math.hypot(fx, fy) > 1e-4) entity.facing = getFacingFromAngle(Math.atan2(fy, fx));
        }
        entity.animMoving = false;
        return;
      }
      entity.targetX = null;
      entity.targetY = null;
      entity.idlePauseTimer = WANDER_IDLE_MIN + Math.random() * WANDER_IDLE_EXTRA;
      entity.vx = 0;
      entity.vy = 0;
      entity.animMoving = false;

      if (Math.random() < 0.18 && entity.emotionType === null && !entity.speechBubble) {
        if (Math.random() < 0.4) {
          const lines = [
            [{ kind: 'text', text: 'Hmm…' }, { kind: 'monsprite' }],
            [{ kind: 'text', text: 'Oh!' }, { kind: 'monsprite' }],
            [
              { kind: 'text', text: 'Need' },
              { kind: 'item', slug: 'antidote' },
              { kind: 'text', text: '?' }
            ],
            [{ kind: 'text', text: 'Sniff sniff…' }, { kind: 'monsprite' }],
            [
              { kind: 'text', text: '…' },
              { kind: 'monsprite' },
              { kind: 'text', text: "Wonder what's over there." }
            ]
          ];
          const segs = lines[Math.floor(Math.random() * lines.length)];
          const think = Math.random() < 0.45;
          setWildSpeechBubble(entity, segs, {
            durationSec: 3.2 + Math.random() * 1.4,
            kind: think ? 'think' : 'say'
          });
        } else {
          const balloon = Math.random() < 0.5 ? 2 : 3;
          const happyish = ['Happy', 'Joyous', 'Inspired'];
          const slug = happyish[Math.floor(Math.random() * happyish.length)];
          setEmotion(entity, balloon, false, slug);
        }
      }
      return;
    }

    let moveAng = Math.atan2(dyT, dxT);
    const nxT = Math.cos(moveAng);
    const nyT = Math.sin(moveAng);
    
    let combinedNx = nxT;
    let combinedNy = nyT;

    if (groupCohesion) {
      const dxG = groupCohesion.x - entity.x;
      const dyG = groupCohesion.y - entity.y;
      const distG = Math.hypot(dxG, dyG);
      if (distG > groupBehavior.WILD_GROUP_COHESION_MIN_DIST) {
        const nxG = dxG / (distG || 1);
        const nyG = dyG / (distG || 1);
        const blend = groupBehavior.WILD_GROUP_COHESION_BLEND * groupCohesion.weight * (followerMode ? 0.35 : 1.0);
        combinedNx = combinedNx * (1 - blend) + nxG * blend;
        combinedNy = combinedNy * (1 - blend) + nyG * blend;
      }
    }

    if (groupBoids) {
      const boidsBlend = 0.65 * groupBoids.strength;
      combinedNx = combinedNx * (1 - boidsBlend) + groupBoids.nx * boidsBlend;
      combinedNy = combinedNy * (1 - boidsBlend) + groupBoids.ny * boidsBlend;
    }

    moveAng = Math.atan2(combinedNy, combinedNx);

    if (followerMode) {
      // Followers always use the simple sweep to stay agile
      steerFollowerSimple(
        entity,
        moveAng,
        WORLD_MAX_WALK_SPEED_TILES_PER_SEC,
        data,
        wildIsAirborne(entity),
        entity.targetX,
        entity.targetY
      );
    } else {
      steerTowardAngle(entity, moveAng, WORLD_MAX_WALK_SPEED_TILES_PER_SEC, data, wildIsAirborne(entity), false);
    }

    // Leader logic for triggering Scenic Scenarios
    // End of Scenic phase is handled by scenarioOrchestrator ending, 
    // which resets aiState. We need to ensure groupPhase resets too.
    if (!followerTeamMode && entity.groupId && entity.groupPhase === 'SCENIC' && entity.aiState !== 'scenic') {
        entity.groupPhase = 'ROAM';
        entity.groupPhaseTimer = groupBehavior.PHASE_ROAM_MIN_SEC + Math.random() * (groupBehavior.PHASE_ROAM_MAX_SEC - groupBehavior.PHASE_ROAM_MIN_SEC);
        groupBehavior.syncWildGroupPhaseFromLeader(entity, entitiesByKey);
    }
  }

  const wildFootX0 = entity.x;
  const wildFootY0 = entity.y;

  let air = wildIsAirborne(entity);
  const nx = entity.x + entity.vx * dt;
  const ny = entity.y + entity.vy * dt;

  const stepLen = Math.hypot((entity.vx || 0) * dt, (entity.vy || 0) * dt);
  if (
    entity.grounded &&
    !air &&
    (entity.jumpCooldown || 0) <= 0 &&
    stepLen > 0.045 &&
    !wildWalkOk(nx, ny, data, entity.x, entity.y, entity, false, true) &&
    wildWalkOk(nx, ny, data, entity.x, entity.y, entity, true, true)
  ) {
    tryWildPokemonJump(entity);
    air = wildIsAirborne(entity);
  }

  const moved = tryApplyWildPokemonMove(entity, nx, ny, data, air);
  if (!moved) {
    entity.vx = 0;
    entity.vy = 0;
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
      setEmotion(entity, 6, false);
    }

    if (entity.aiState === 'wander' && entity._blockedMoveFrames >= needJumpFrames * 2) {
      entity.targetX = null;
      entity.targetY = null;
    }
  } else {
    entity._blockedMoveFrames = 0;
    const spdMove = Math.hypot(entity.vx || 0, entity.vy || 0);
    if (spdMove > 0.08) {
      entity._wanderLastNx = (entity.vx || 0) / spdMove;
      entity._wanderLastNy = (entity.vy || 0) / spdMove;
    }
  }

  applyWildTreeTrunkResolution(entity, data);
  enforceFollowerLeaderMaxDistance(entity, data);

  if (!followerTeamMode) {
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

      entity.targetX = null;
      const dot = entity.vx * nxc + entity.vy * nyc;
      if (dot > 0) {
        entity.vx -= nxc * dot * 1.75;
        entity.vy -= nyc * dot * 1.75;
      }
    }
  }

  const wildMovedTiles = Math.hypot(entity.x - wildFootX0, entity.y - wildFootY0);

  // Stall detection: entity has velocity and a target but trunk resolution keeps
  // pushing it back (e.g. trying to squeeze between two close circle colliders).
  const expectedMove = Math.hypot(entity.vx || 0, entity.vy || 0) * dt;
  if (
    entity.targetX != null &&
    expectedMove > WILD_STALL_PROGRESS_THRESHOLD &&
    wildMovedTiles < expectedMove * 0.15
  ) {
    entity._stallProgressSec = (entity._stallProgressSec || 0) + dt;
    if (entity._stallProgressSec >= WILD_STALL_ABANDON_SEC) {
      entity.targetX = null;
      entity.targetY = null;
      entity.vx = 0;
      entity.vy = 0;
      entity._stallProgressSec = 0;
    }
  } else {
    entity._stallProgressSec = 0;
  }

  clampVelocityToWalkCapIfNoStamina(entity);
  const spd = Math.hypot(entity.vx, entity.vy);
  tickEntityStamina(entity, dt, isWildSprinting(entity, spd));
  entity.animMoving = spd > 0.1;

  const wantWildFootFloor =
    !!entity.grounded && !wildIsAirborne(entity) && !(isUndergroundBurrowerDex(entity.dexId ?? 0) && entity.animMoving);
  advanceFootFloorStepsForDistance(entity, wildMovedTiles, wantWildFootFloor, entity);

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

