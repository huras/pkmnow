import { getSpeciesBehavior } from './pokemon-behavior.js';

/**
 * Runtime overlay: non-aggressive species can temporarily act aggressive
 * (`wildTempAggressiveSec` on the entity, managed in `wild-pokemon-manager.js`).
 *
 * @param {object | null | undefined} entity
 */
export function getEffectiveWildBehavior(entity) {
  const base = entity?.behavior || getSpeciesBehavior(entity?.dexId ?? 1);
  const t = Number(entity?.wildTempAggressiveSec) || 0;
  if (t <= 0 || base.archetype === 'aggressive') return base;

  let approachSpeed = 1.12;
  if (base.archetype === 'timid') approachSpeed = 0.92;
  else if (base.archetype === 'skittish') approachSpeed = 1.02;
  else if (base.archetype === 'neutral') approachSpeed = 1.18;

  const alertRadius = Math.max(6, (base.alertRadius || 5) + 0.35);
  return Object.freeze({
    archetype: 'aggressive',
    alertRadius,
    fleeSpeed: 0,
    approachSpeed,
    stopDist: 2.45
  });
}

/**
 * Shorter wild move cooldown when a peaceful species is provoked into aggression.
 * @param {object | null | undefined} entity
 * @returns {number} multiplier in (0,1]
 */
export function getWildAggressiveMoveCooldownMultiplier(entity) {
  const base = entity?.behavior || getSpeciesBehavior(entity?.dexId ?? 1);
  if (base.archetype === 'aggressive') return 1;
  if ((Number(entity?.wildTempAggressiveSec) || 0) <= 0) return 1;
  return 0.88;
}
