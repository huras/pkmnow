import { WORLD_MAX_WALK_SPEED_TILES_PER_SEC } from './world-movement-constants.js';

/** Default max stamina for player and wild entities. */
export const ENTITY_STAMINA_MAX = 100;
/** Must recover above this to get sprint speed again (avoids flicker at 0). */
export const ENTITY_STAMINA_MIN_TO_START_SPRINT = 0.75;

const DRAIN_PER_SEC = 30;
const REGEN_PER_SEC = 16;
/** Wild sprint: horizontal speed above walk cap counts as running for stamina. */
const WILD_SPRINT_OVER_WALK = 1.08;

/**
 * @param {{ stamina?: number, maxStamina?: number } | null | undefined} entity
 */
export function ensureEntityStamina(entity) {
  if (!entity) return;
  if (entity.maxStamina == null) entity.maxStamina = ENTITY_STAMINA_MAX;
  entity.maxStamina = Math.max(1, Number(entity.maxStamina) || ENTITY_STAMINA_MAX);
  if (entity.stamina == null) entity.stamina = entity.maxStamina;
  entity.stamina = Math.max(0, Math.min(entity.maxStamina, Number(entity.stamina) || entity.maxStamina));
}

/**
 * @param {{ stamina?: number, maxStamina?: number } | null | undefined} entity
 */
export function canEntityStartSprint(entity) {
  ensureEntityStamina(entity);
  return entity.stamina > ENTITY_STAMINA_MIN_TO_START_SPRINT;
}

/**
 * @param {{ grounded?: boolean, deadState?: string | null, vx?: number, vy?: number } | null | undefined} entity
 * @param {number} [spd] optional precomputed speed
 */
export function isWildSprinting(entity, spd) {
  if (!entity || entity.deadState) return false;
  if (!entity.grounded) return false;
  const sp = Number.isFinite(spd) ? spd : Math.hypot(Number(entity.vx) || 0, Number(entity.vy) || 0);
  return sp > WORLD_MAX_WALK_SPEED_TILES_PER_SEC * WILD_SPRINT_OVER_WALK;
}

/**
 * @param {{ stamina?: number, maxStamina?: number } | null | undefined} entity
 * @param {number} dt
 * @param {boolean} isRunning when true, drain; otherwise regen toward max
 */
export function tickEntityStamina(entity, dt, isRunning) {
  ensureEntityStamina(entity);
  const d = Math.max(0, dt || 0);
  if (d <= 0) return;
  if (isRunning) {
    entity.stamina = Math.max(0, entity.stamina - DRAIN_PER_SEC * d);
  } else {
    entity.stamina = Math.min(entity.maxStamina, entity.stamina + REGEN_PER_SEC * d);
  }
}

/**
 * When stamina is depleted, cap horizontal speed to walk cap (wild flee/chase).
 * @param {{ vx?: number, vy?: number, stamina?: number, maxStamina?: number } | null | undefined} entity
 */
export function clampVelocityToWalkCapIfNoStamina(entity) {
  ensureEntityStamina(entity);
  if (entity.stamina > 1e-4) return;
  const cap = WORLD_MAX_WALK_SPEED_TILES_PER_SEC;
  const sp = Math.hypot(Number(entity.vx) || 0, Number(entity.vy) || 0);
  if (sp <= cap + 1e-6) return;
  const k = cap / sp;
  entity.vx = (Number(entity.vx) || 0) * k;
  entity.vy = (Number(entity.vy) || 0) * k;
}
