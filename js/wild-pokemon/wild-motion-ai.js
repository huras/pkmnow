import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import { imageCache } from '../image-cache.js';
import { PMD_DEFAULT_MON_ANIMS } from '../pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';
import { getPmdFeetDeltaWorldTiles, worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import { rollWildSex } from '../pokemon/pokemon-sex.js';
import { getSpeciesBehavior } from './pokemon-behavior.js';
import { getEffectiveWildBehavior } from './wild-effective-behavior.js';
import { isUndergroundBurrowerDex } from './underground-burrow.js';
import {
  canWildPokemonWalkMicroTile,
  getFoliageOverlayTileId,
  getLakeLotusFoliageWalkRole,
  pivotCellHeightTraversalOk
} from '../walkability.js';
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
import { clamp, entitiesByKey, wildSubdivN } from './wild-core-state.js';
import { seededHashInt } from '../tessellation-logic.js';
import { rollBossPromotedDex } from './wild-boss-variants.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { getEncounters } from '../ecodex.js';

const WANDER_MOVE_MIN = 0.45;
const WANDER_MOVE_EXTRA = 1.2;
const WANDER_IDLE_MIN = 0.35;
const WANDER_IDLE_EXTRA = 1.0;
const MAX_SPEED = 1.65;
const WILD_GRAVITY = 45.0;
const WILD_JUMP_IMPULSE = 12.0;
const WILD_JUMP_BLOCKED_FRAMES_FLEE = 14;
const WILD_JUMP_BLOCKED_FRAMES_WANDER = 28;
const WILD_JUMP_COOLDOWN_SEC = 0.85;
const WILD_TREE_BODY_R = 0.28;
const WILD_VISION_RANGE_BASE_MULT = 1.45;
const WILD_VISION_RANGE_MIN_TILES = 8.5;

export function ensureWildPhysicsState(entity) {
  if (entity.z == null) entity.z = 0;
  if (entity.vz == null) entity.vz = 0;
  if (entity.grounded == null) entity.grounded = true;
  if (entity.jumping == null) entity.jumping = false;
  if (entity.jumpSerial == null) entity.jumpSerial = 0;
  if (entity.jumpCooldown == null) entity.jumpCooldown = 0;
  if (entity._blockedMoveFrames == null) entity._blockedMoveFrames = 0;
}

export function integrateWildPokemonVertical(entity, dt) {
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

export function tryApplyWildPokemonMove(entity, nx, ny, data, air) {
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

  for (const ang of angles) {
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    if (wildWalkOk(entity.x + vx * 0.4, entity.y + vy * 0.4, data, entity.x, entity.y, entity, isAirborne, true)) {
      entity.vx = vx;
      entity.vy = vy;
      entity.stuckTimer = 0;
      return;
    }
  }

  entity.vx = 0;
  entity.vy = 0;
  entity.targetX = null;
  entity.stuckTimer = (entity.stuckTimer || 0) + 1.0;
}

const WILD_KNOCKBACK_DAMP_PER_SEC = 4.8;

export function updateWildMotion(entity, dt, data, playerX, playerY) {
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
  const effectiveAlertRadius = Math.max(
    WILD_VISION_RANGE_MIN_TILES,
    (beh.alertRadius || 0) * WILD_VISION_RANGE_BASE_MULT + (entity.wildTempAggressiveSec > 0 ? 1.0 : 0)
  );
  const dxP = entity.x - playerX;
  const dyP = entity.y - playerY;
  const distP = Math.hypot(dxP, dyP);

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

  if (distP < effectiveAlertRadius) {
    if (beh.archetype === 'timid' || beh.archetype === 'skittish') {
      entity.aiState = 'flee';
      const angToPlayer = Math.atan2(dyP, dxP);
      const fleeAng = angToPlayer;
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
      if (entity.aiState !== 'alert') {
        entity.aiState = 'alert';
        entity.alertTimer = 1.0 + Math.random();
        entity.vx = 0;
        entity.vy = 0;
      }
    }
  } else if (distP >= effectiveAlertRadius * 1.5 && entity.aiState !== 'sleep') {
    entity.aiState = 'wander';
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
    }
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

    if (entity.targetX === null || entity.targetY === null) {
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
      if (entity.targetX === null) {
        entity.idlePauseTimer = 1.0;
        return;
      }
    }

    const dxT = entity.targetX - entity.x;
    const dyT = entity.targetY - entity.y;
    const distT = Math.hypot(dxT, dyT);

    if (distT < 0.2) {
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

    const moveAng = Math.atan2(dyT, dxT);
    steerTowardAngle(entity, moveAng, MAX_SPEED * 0.45, data, wildIsAirborne(entity), false);
  }

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
      setEmotion(entity, 6, false);
    }
  } else {
    entity._blockedMoveFrames = 0;
  }

  applyWildTreeTrunkResolution(entity, data);

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

