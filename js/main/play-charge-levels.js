export const CHARGE_LEVEL_BAR_COUNT = 4;
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

/** t in [0,1] — fast start, slow finish (first charge bar). */
function easeOutCubic(t) {
  const u = clamp01(t);
  return 1 - (1 - u) ** 3;
}

/** t in [0,1] — mild ease-in for bars 2–4 (softer than cubic). */
function easeInQuad(t) {
  const u = clamp01(t);
  return u * u;
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
 * Charge progress for each of the 4 bars, in order (0..1 per bar for HUD / scaling).
 * `charge01` is still linear in hold time; bar fills use easing: bar 1 ease-out, bars 2–4 ease-in.
 * @param {number} charge01
 * @returns {[number, number, number, number]}
 */
export function getChargeBarProgresses(charge01) {
  const p = clamp01(charge01);
  const seg = CHARGE_LEVEL_SEGMENT_SIZE;
  const raw1 = clamp01(p / seg);
  const raw2 = p <= seg ? 0 : clamp01((p - seg) / seg);
  const raw3 = p <= seg * 2 ? 0 : clamp01((p - seg * 2) / seg);
  const raw4 = p <= seg * 3 ? 0 : clamp01((p - seg * 3) / seg);
  return [easeOutCubic(raw1), easeInQuad(raw2), easeInQuad(raw3), easeInQuad(raw4)];
}

/**
 * Integer level [0..4] from linear `charge01` segment (eased bar fills would delay L2+ otherwise).
 * @param {number} charge01
 * @returns {0 | 1 | 2 | 3 | 4}
 */
export function getChargeLevel(charge01) {
  const p = clamp01(charge01);
  const seg = CHARGE_LEVEL_SEGMENT_SIZE;
  if (p <= 0.0005) return 0;
  if (p < seg) return 1;
  if (p < seg * 2) return 2;
  if (p < seg * 3) return 3;
  return 4;
}

/**
 * First bar only: used for range scaling.
 * @param {number} charge01
 */
export function getChargeRange01(charge01) {
  return getChargeBarProgresses(charge01)[0];
}

/**
 * Bars 2+3+4 only: used for damage scaling (average eased fill of the upper three segments).
 * @param {number} charge01
 */
export function getChargeDamage01(charge01) {
  const [, p2, p3, p4] = getChargeBarProgresses(charge01);
  return clamp01((p2 + p3 + p4) / 3);
}
