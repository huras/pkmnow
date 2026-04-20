/* --- Base Group Tuning --- */
export const ENABLE_BOIDS = false;
export const WILD_GROUP_RADIUS = 3.6;     // General radius for alignment and cohesion
export const WILD_GROUP_TOLERANCE = 3.85; // How loosely others are allowed to drift (0.5 = tight, 1.5 = very loose)

/* --- Derived Boids Radii --- */
export const WILD_BOIDS_SEPARATION_RADIUS = Math.max(0.65, WILD_GROUP_RADIUS * 0.32 * WILD_GROUP_TOLERANCE);
export const WILD_BOIDS_ALIGNMENT_RADIUS = WILD_GROUP_RADIUS * 1.0;
export const WILD_BOIDS_COHESION_RADIUS = WILD_GROUP_RADIUS * 1.15 * WILD_GROUP_TOLERANCE;

/* --- Derived Boids Weights --- */
export const WILD_BOIDS_WEIGHT_SEPARATION = 1.85 / Math.max(0.2, WILD_GROUP_TOLERANCE);
export const WILD_BOIDS_WEIGHT_ALIGNMENT = 0.65;
export const WILD_BOIDS_WEIGHT_COHESION = 0.55 * WILD_GROUP_TOLERANCE;
export const WILD_BOIDS_WEIGHT_LEADER_ALIGN = 0.85;

/* --- Group Follow Tuning --- */
export const WILD_GROUP_FOLLOW_MAX_DIST = WILD_GROUP_RADIUS * 1.4 * WILD_GROUP_TOLERANCE;
export const WILD_GROUP_FOLLOW_BASE_TRAIL = WILD_BOIDS_SEPARATION_RADIUS * 1.05;
export const WILD_GROUP_FOLLOW_TRAIL_STEP = 0.8 * WILD_GROUP_TOLERANCE;
export const WILD_GROUP_FOLLOW_LATERAL_BASE = 0.65 * WILD_GROUP_TOLERANCE;
export const WILD_GROUP_FOLLOW_LATERAL_STEP = 0.25 * WILD_GROUP_TOLERANCE;
export const WILD_GROUP_FOLLOW_STRENGTH = 0.75;

/* --- Cohesion Force Tuning --- */
export const WILD_GROUP_COHESION_MIN_DIST = WILD_BOIDS_SEPARATION_RADIUS * 1.1;
export const WILD_GROUP_COHESION_MAX_DIST = WILD_GROUP_RADIUS * 2.0;
export const WILD_GROUP_COHESION_BLEND = 0.42;

/* --- Phase Lifecycle Tuning --- */
export const PHASE_ROAM_MIN_SEC = 45;
export const PHASE_ROAM_MAX_SEC = 75;
export const PHASE_EXPLORE_MIN_SEC = 30;
export const PHASE_EXPLORE_MAX_SEC = 50;
export const DISCOVERY_CHANCE_TICK = 0.08; // Chance per second during explore phase

/** @param {number} x @param {number} y */
export function normalizeVec(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len, len };
}

export function ensureGroupBehaviorState(entity) {
  if (entity.groupCohesionSec == null) entity.groupCohesionSec = 0;
  if (entity._followerTackleCooldownSec == null) entity._followerTackleCooldownSec = 0;
  if (entity.groupPhase == null) entity.groupPhase = 'ROAM';
  if (entity.groupPhaseTimer == null) {
    entity.groupPhaseTimer = PHASE_ROAM_MIN_SEC + Math.random() * (PHASE_ROAM_MAX_SEC - PHASE_ROAM_MIN_SEC);
  }
  if (entity.discoveryCooldown == null) entity.discoveryCooldown = 10; // Extra buffer before first discovery possible
  if (entity.scenicCooldown == null) entity.scenicCooldown = 15.0 + Math.random() * 20.0;
}

/** @param {string | null | undefined} facing */
function unitVecFromFacing(facing) {
  switch (String(facing || 'down')) {
    case 'up':
      return { x: 0, y: -1 };
    case 'up-right':
      return { x: 0.7071, y: -0.7071 };
    case 'right':
      return { x: 1, y: 0 };
    case 'down-right':
      return { x: 0.7071, y: 0.7071 };
    case 'down':
      return { x: 0, y: 1 };
    case 'down-left':
      return { x: -0.7071, y: 0.7071 };
    case 'left':
      return { x: -1, y: 0 };
    case 'up-left':
      return { x: -0.7071, y: -0.7071 };
    default:
      return { x: 0, y: 1 };
  }
}

/**
 * @param {object} entity
 * @param {Map<string, any>} entitiesByKey
 */
export function resolveGroupFollowTarget(entity, entitiesByKey) {
  const groupId = String(entity.groupId || '');
  if (!groupId) return null;
  const leaderKey = String(entity.groupLeaderKey || '');
  if (!leaderKey) return null;
  const leader = entitiesByKey.get(leaderKey);
  if (!leader || String(leader.groupId || '') !== groupId || leader.isDespawning || leader.deadState) return null;
  if (String(entity.key || '') === leaderKey) return { isLeader: true, leader };

  const lvx = Number(leader.vx) || 0;
  const lvy = Number(leader.vy) || 0;
  const lsp = Math.hypot(lvx, lvy);
  const heading = lsp > 0.08 ? normalizeVec(lvx, lvy) : unitVecFromFacing(leader.facing);
  const memberIndex = Math.max(1, Math.floor(Number(entity.groupMemberIndex) || 1));
  const slotIndex = memberIndex - 1;
  const row = Math.floor(slotIndex / 2) + 1;
  const side = slotIndex % 2 === 0 ? -1 : 1;
  const trailDist = WILD_GROUP_FOLLOW_BASE_TRAIL + (row - 1) * WILD_GROUP_FOLLOW_TRAIL_STEP;
  const lateral = side * (WILD_GROUP_FOLLOW_LATERAL_BASE + (row - 1) * WILD_GROUP_FOLLOW_LATERAL_STEP);
  const perpX = -heading.y;
  const perpY = heading.x;
  let tx = (Number(leader.x) || 0) - heading.x * trailDist + perpX * lateral;
  let ty = (Number(leader.y) || 0) - heading.y * trailDist + perpY * lateral;

  const fromLeaderX = tx - (Number(leader.x) || 0);
  const fromLeaderY = ty - (Number(leader.y) || 0);
  const dLeader = Math.hypot(fromLeaderX, fromLeaderY);
  if (dLeader > WILD_GROUP_FOLLOW_MAX_DIST) {
    const n = normalizeVec(fromLeaderX, fromLeaderY);
    tx = (Number(leader.x) || 0) + n.x * WILD_GROUP_FOLLOW_MAX_DIST;
    ty = (Number(leader.y) || 0) + n.y * WILD_GROUP_FOLLOW_MAX_DIST;
  }
  return { isLeader: false, leader, targetX: tx, targetY: ty };
}

/**
 * @param {object} entity
 * @param {Map<string, any>} entitiesByKey
 * @param {(value:number,min:number,max:number)=>number} clamp
 */
export function resolveGroupCohesionTarget(entity, entitiesByKey, clamp) {
  if (!ENABLE_BOIDS) return null;
  const groupId = String(entity.groupId || '');
  if (!groupId) return null;
  const ttl = Number(entity.groupCohesionSec) || 0;
  if (ttl <= 0) return null;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const other of entitiesByKey.values()) {
    if (other === entity) continue;
    if (String(other.groupId || '') !== groupId) continue;
    if ((other.spawnPhase ?? 1) < 0.35 || other.isDespawning || other.deadState) continue;
    sumX += Number(other.x) || 0;
    sumY += Number(other.y) || 0;
    count += 1;
  }
  let tx;
  let ty;
  if (count > 0) {
    tx = sumX / count;
    ty = sumY / count;
  } else if (Number.isFinite(entity.groupHomeX) && Number.isFinite(entity.groupHomeY)) {
    tx = Number(entity.groupHomeX);
    ty = Number(entity.groupHomeY);
  } else {
    return null;
  }
  const dx = tx - (Number(entity.x) || 0);
  const dy = ty - (Number(entity.y) || 0);
  const dist = Math.hypot(dx, dy);
  if (dist < WILD_GROUP_COHESION_MIN_DIST) return null;
  const w = clamp((dist - WILD_GROUP_COHESION_MIN_DIST) / (WILD_GROUP_COHESION_MAX_DIST - WILD_GROUP_COHESION_MIN_DIST), 0, 1);
  return { x: tx, y: ty, weight: w };
}

/**
 * @param {object} entity
 * @param {Map<string, any>} entitiesByKey
 * @param {(value:number,min:number,max:number)=>number} clamp
 */
export function resolveGroupBoidsSteer(entity, entitiesByKey, clamp) {
  if (!ENABLE_BOIDS) return null;
  const groupId = String(entity.groupId || '');
  if (!groupId) return null;
  if ((Number(entity.groupCohesionSec) || 0) <= 0) return null;

  const leaderKey = String(entity.groupLeaderKey || '');
  const isFollower = !!leaderKey && leaderKey !== String(entity.key || '');

  let sepX = 0;
  let sepY = 0;
  let alignX = 0;
  let alignY = 0;
  let alignCount = 0;
  let cohX = 0;
  let cohY = 0;
  let cohCount = 0;
  let minDist = Infinity;

  const ex = Number(entity.x) || 0;
  const ey = Number(entity.y) || 0;

  for (const other of entitiesByKey.values()) {
    if (other === entity) continue;
    if (String(other.groupId || '') !== groupId) continue;
    if ((other.spawnPhase ?? 1) < 0.35 || other.isDespawning || other.deadState) continue;

    const ox = Number(other.x) || 0;
    const oy = Number(other.y) || 0;
    const dx = ox - ex;
    const dy = oy - ey;
    const d = Math.hypot(dx, dy);
    if (d <= 1e-6) continue;
    minDist = Math.min(minDist, d);

    // 1. Separation
    if (d <= WILD_BOIDS_SEPARATION_RADIUS) {
      const inv = 1 / Math.max(0.05, d * d);
      sepX -= dx * inv;
      sepY -= dy * inv;
    }

    // 2. Alignment
    if (d <= WILD_BOIDS_ALIGNMENT_RADIUS) {
      const ovx = Number(other.vx) || 0;
      const ovy = Number(other.vy) || 0;
      const sp = Math.hypot(ovx, ovy);
      if (sp > 0.02) {
        let weight = 1.0;
        // Treat leader alignment as higher priority
        if (String(other.key || '') === leaderKey) {
          weight = 2.5;
        }
        alignX += (ovx / sp) * weight;
        alignY += (ovy / sp) * weight;
        alignCount += weight;
      }
    }

    // 3. Cohesion
    if (d <= WILD_BOIDS_COHESION_RADIUS) {
      cohX += ox;
      cohY += oy;
      cohCount += 1;
    }
  }

  let steerX = 0;
  let steerY = 0;
  let contributors = 0;

  // Separation: very strong at close range
  if (Math.abs(sepX) + Math.abs(sepY) > 1e-5) {
    const n = normalizeVec(sepX, sepY);
    const sepPressure = clamp((WILD_BOIDS_SEPARATION_RADIUS - minDist) / WILD_BOIDS_SEPARATION_RADIUS, 0, 1);
    const strength = WILD_BOIDS_WEIGHT_SEPARATION * (0.6 + 1.2 * sepPressure);
    steerX += n.x * strength;
    steerY += n.y * strength;
    contributors += 1;
  }

  // Alignment
  if (alignCount > 0) {
    const n = normalizeVec(alignX / alignCount, alignY / alignCount);
    steerX += n.x * WILD_BOIDS_WEIGHT_ALIGNMENT;
    steerY += n.y * WILD_BOIDS_WEIGHT_ALIGNMENT;
    contributors += 1;
  }

  // Cohesion
  if (cohCount > 0) {
    const cx = cohX / cohCount;
    const cy = cohY / cohCount;
    const n = normalizeVec(cx - ex, cy - ey);
    const cohStrength = clamp((n.len - 0.45) / WILD_BOIDS_COHESION_RADIUS, 0, 1);
    if (cohStrength > 0.001) {
      steerX += n.x * WILD_BOIDS_WEIGHT_COHESION * cohStrength;
      steerY += n.y * WILD_BOIDS_WEIGHT_COHESION * cohStrength;
      contributors += 1;
    }
  }

  if (contributors <= 0) return null;
  const out = normalizeVec(steerX, steerY);
  if (out.len < 1e-5) return null;

  return {
    nx: out.x,
    ny: out.y,
    strength: clamp(
      out.len / (WILD_BOIDS_WEIGHT_SEPARATION + WILD_BOIDS_WEIGHT_ALIGNMENT + WILD_BOIDS_WEIGHT_COHESION),
      0,
      1
    ),
    neighborCount: Math.ceil(cohCount)
  };
}

/**
 * When the slot leader dies or starts despawning, followers still reference `groupLeaderKey`
 * but `resolveGroupFollowTarget` returns null. Wander + slot-radius clamp then anchor to the
 * **spawn slot** (`centerX`/`centerY`), not the world position — huge snap / “teleport”.
 * Detach followers, clear group fields, and re-anchor wander to their current coordinates.
 *
 * Safe to call multiple times; only the entity whose `key === groupLeaderKey` triggers work.
 *
 * @param {object} leaderEntity
 * @param {Map<string, any>} entitiesByKey
 */
/**
 * ROAM/EXPLORE timer transitions for the **slot leader** only (`key === groupLeaderKey`).
 * Scenario discovery and SCENIC remain in `updateWildMotion` (full AI).
 *
 * @param {object} entity
 * @param {number} dt
 */
export function advanceWildGroupLeaderPhaseTimer(entity, dt) {
  if (!entity || !dt) return;
  const gid = entity.groupId;
  if (!gid) return;
  const lKey = String(entity.key || '');
  if (String(entity.groupLeaderKey || '') !== lKey) return;

  ensureGroupBehaviorState(entity);
  entity.groupPhaseTimer = (entity.groupPhaseTimer || 0) - dt;

  if (entity.groupPhase === 'ROAM' && entity.groupPhaseTimer <= 0) {
    entity.groupPhase = 'EXPLORE';
    entity.groupPhaseTimer =
      PHASE_EXPLORE_MIN_SEC + Math.random() * (PHASE_EXPLORE_MAX_SEC - PHASE_EXPLORE_MIN_SEC);
  } else if (entity.groupPhase === 'EXPLORE' && entity.groupPhaseTimer <= 0) {
    entity.groupPhase = 'ROAM';
    entity.groupPhaseTimer =
      PHASE_ROAM_MIN_SEC + Math.random() * (PHASE_ROAM_MAX_SEC - PHASE_ROAM_MIN_SEC);
  }
}

/**
 * Only the leader advances `groupPhase` / `groupPhaseTimer`; followers kept in sync for UI and debugging.
 *
 * @param {object} leader
 * @param {Map<string, any>} entitiesByKey
 */
export function syncWildGroupPhaseFromLeader(leader, entitiesByKey) {
  if (!leader || !entitiesByKey) return;
  const gid = String(leader.groupId || '');
  if (!gid) return;
  const lKey = String(leader.key || '');
  if (String(leader.groupLeaderKey || '') !== lKey) return;

  const phase = leader.groupPhase;
  const timer = leader.groupPhaseTimer;
  for (const o of entitiesByKey.values()) {
    if (!o || String(o.groupId || '') !== gid) continue;
    o.groupPhase = phase;
    o.groupPhaseTimer = timer;
  }
}

/**
 * When wander motion is LOD-skipped, world time should still advance group ROAM/EXPLORE.
 *
 * @param {object} entity
 * @param {number} dt
 * @param {Map<string, any>} entitiesByKey
 */
export function tickWildGroupLeaderPhaseWhenMotionSkipped(entity, dt, entitiesByKey) {
  if (!entity || !dt) return;
  if (entity.aiState !== 'wander') return;
  advanceWildGroupLeaderPhaseTimer(entity, dt);
  syncWildGroupPhaseFromLeader(entity, entitiesByKey);
}

export function releaseWildGroupFollowersFromLeader(leaderEntity, entitiesByKey) {
  if (!leaderEntity || !entitiesByKey) return;
  const gid = leaderEntity.groupId;
  if (!gid) return;
  const lKey = String(leaderEntity.key || '');
  if (String(leaderEntity.groupLeaderKey || '') !== lKey) return;

  const gidStr = String(gid);
  for (const e of entitiesByKey.values()) {
    if (!e || e === leaderEntity) continue;
    if (String(e.groupId || '') !== gidStr) continue;

    e.groupId = null;
    e.groupLeaderKey = null;
    e.groupMemberIndex = 0;
    e.groupSize = 1;
    e.groupCohesionSec = 0;
    e.groupHomeX = null;
    e.groupHomeY = null;
    e.groupPhase = 'ROAM';
    e.groupPhaseTimer = PHASE_ROAM_MIN_SEC + Math.random() * (PHASE_ROAM_MAX_SEC - PHASE_ROAM_MIN_SEC);
    e.discoveryCooldown = 0;
    e.targetX = null;
    e.targetY = null;
    e.vx = 0;
    e.vy = 0;

    if (Number.isFinite(e.x) && Number.isFinite(e.y)) {
      e.centerX = e.x;
      e.centerY = e.y;
    }
    ensureGroupBehaviorState(e);
  }
}
