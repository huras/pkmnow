export const CHARGE_LEVEL_BAR_COUNT = 3;
export const CHARGE_LEVEL_SEGMENT_SIZE = 1 / CHARGE_LEVEL_BAR_COUNT;

/** First charge bar completely filled (same as one segment at 100%). */
export const CHARGE_STRONG_ATTACK_MIN_01 = CHARGE_LEVEL_SEGMENT_SIZE;

/**
 * LMB field skills: `charged` release uses this floor on `charge01` (see play-mouse-combat).
 * RMB tap/charge uses a time threshold instead; pass a different `minRelease01` when needed.
 */
export const CHARGE_FIELD_RELEASE_MIN_01 = 0.16;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

/**
 * True when the first bar is full — unlocks the full "charged" variant (e.g. Cut spin, full tackle scaling).
 * @param {number} charge01
 */
export function isChargeStrongAttackEligible(charge01) {
  return clamp01(charge01) >= CHARGE_STRONG_ATTACK_MIN_01 - 1e-9;
}

/**
 * 0..1 progress between minimum release charge and first full bar (for mild partial-charged scaling).
 * @param {number} charge01
 * @param {number} [minRelease01]
 */
export function getWeakPartialChargeT(charge01, minRelease01 = CHARGE_FIELD_RELEASE_MIN_01) {
  const p = clamp01(charge01);
  const hi = CHARGE_STRONG_ATTACK_MIN_01;
  if (p >= hi) return 1;
  const lo = Math.min(Math.max(0, minRelease01), hi - 1e-6);
  if (p <= lo) return 0;
  return clamp01((p - lo) / (hi - lo));
}

/**
 * Charge progress for each of the 3 bars, in order.
 * bar 1: [0..1/3], bar 2: (1/3..2/3], bar 3: (2/3..1].
 * @param {number} charge01
 * @returns {[number, number, number]}
 */
export function getChargeBarProgresses(charge01) {
  const p = clamp01(charge01);
  const p1 = clamp01(p / CHARGE_LEVEL_SEGMENT_SIZE);
  const p2 = clamp01((p - CHARGE_LEVEL_SEGMENT_SIZE) / CHARGE_LEVEL_SEGMENT_SIZE);
  const p3 = clamp01((p - CHARGE_LEVEL_SEGMENT_SIZE * 2) / CHARGE_LEVEL_SEGMENT_SIZE);
  return [p1, p2, p3];
}

/**
 * Integer level [0..3] based on how many bars have started filling.
 * @param {number} charge01
 * @returns {0 | 1 | 2 | 3}
 */
export function getChargeLevel(charge01) {
  const [p1, p2, p3] = getChargeBarProgresses(charge01);
  if (p3 > 0.001) return 3;
  if (p2 > 0.001) return 2;
  if (p1 > 0.001) return 1;
  return 0;
}

/**
 * First bar only: used for range scaling.
 * @param {number} charge01
 */
export function getChargeRange01(charge01) {
  return getChargeBarProgresses(charge01)[0];
}

/**
 * Bars 2+3 only: used for damage scaling.
 * @param {number} charge01
 */
export function getChargeDamage01(charge01) {
  const [, p2, p3] = getChargeBarProgresses(charge01);
  return clamp01((p2 + p3) * 0.5);
}
