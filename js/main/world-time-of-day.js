/** @typedef {'dawn' | 'day' | 'afternoon' | 'night'} DayPhase */

/** Inclusive start hour on 24h clock (night wraps midnight). */
export const PHASE_DAWN_START = 6;
export const PHASE_DAY_START = 10;
export const PHASE_AFTERNOON_START = 17;
export const PHASE_NIGHT_START = 22;

/** Snap targets for the dev panel (hours in [0, 24)). */
export const PRESET_HOUR = {
  dawn: 7,
  day: 12,
  afternoon: 19,
  night: 1
};

/**
 * @param {number} h hour in [0, 24)
 * @returns {DayPhase}
 */
export function getDayPhaseFromHours(h) {
  const x = wrapHours(h);
  if (x >= PHASE_NIGHT_START || x < PHASE_DAWN_START) return 'night';
  if (x < PHASE_DAY_START) return 'dawn';
  if (x < PHASE_AFTERNOON_START) return 'day';
  return 'afternoon';
}

/**
 * @param {number} h
 * @returns {number} hour in [0, 24)
 */
export function wrapHours(h) {
  let x = h % 24;
  if (x < 0) x += 24;
  return x;
}

/**
 * Multiply-layer tint for canvas (identity when day / white).
 * @param {DayPhase} phase
 * @returns {{ r: number, g: number, b: number } | null} null = skip draw
 */
export function getDayCycleTintRgb(phase) {
  switch (phase) {
    case 'night':
      return { r: 148, g: 168, b: 228 };
    case 'dawn':
      return { r: 255, g: 228, b: 210 };
    case 'afternoon':
      return { r: 255, g: 218, b: 190 };
    case 'day':
    default:
      return null;
  }
}

/** Multiply identity for lerps (day = no chromatic tint). */
export function getDayCycleTintRgbForBlend(phase) {
  const t = getDayCycleTintRgb(phase);
  return t ?? { r: 255, g: 255, b: 255 };
}

const DAY_CYCLE_TINT_BLEND_SEC = 3;

/** @type {{ r: number, g: number, b: number }} */
let _tintDisplay = { r: 255, g: 255, b: 255 };
/** @type {{ r: number, g: number, b: number }} */
let _tintFrom = { r: 255, g: 255, b: 255 };
/** @type {{ r: number, g: number, b: number }} */
let _tintTo = { r: 255, g: 255, b: 255 };
let _tintElapsedSec = DAY_CYCLE_TINT_BLEND_SEC;
/** @type {DayPhase | null} */
let _tintLastPhase = null;

function lerpChannel(a, b, w) {
  return a + (b - a) * w;
}

/** Snap smoothed tint to the phase implied by `worldHours` (slider / enter play). */
export function snapDayCycleTintSmoothToHours(worldHoursWrapped) {
  const phase = getDayPhaseFromHours(worldHoursWrapped);
  const rgb = getDayCycleTintRgbForBlend(phase);
  _tintDisplay = { ...rgb };
  _tintFrom = { ...rgb };
  _tintTo = { ...rgb };
  _tintElapsedSec = DAY_CYCLE_TINT_BLEND_SEC;
  _tintLastPhase = phase;
}

/**
 * Advance smoothed multiply-tint toward the current day phase (call each play frame).
 * @param {number} dt seconds
 * @param {number} worldHoursWrapped hour in [0, 24)
 */
export function tickDayCycleTintSmooth(dt, worldHoursWrapped) {
  const phase = getDayPhaseFromHours(worldHoursWrapped);
  if (phase !== _tintLastPhase) {
    _tintLastPhase = phase;
    _tintFrom = { ..._tintDisplay };
    _tintTo = getDayCycleTintRgbForBlend(phase);
    _tintElapsedSec = 0;
  }
  const d = Math.max(0, dt);
  _tintElapsedSec += d;
  const w = Math.min(1, _tintElapsedSec / DAY_CYCLE_TINT_BLEND_SEC);
  _tintDisplay = {
    r: lerpChannel(_tintFrom.r, _tintTo.r, w),
    g: lerpChannel(_tintFrom.g, _tintTo.g, w),
    b: lerpChannel(_tintFrom.b, _tintTo.b, w)
  };
}

/**
 * Tint for canvas multiply pass; null when effectively neutral (skip draw).
 * @returns {{ r: number, g: number, b: number } | null}
 */
export function getSmoothedDayCycleTintForRender() {
  const { r, g, b } = _tintDisplay;
  if (r >= 254.5 && g >= 254.5 && b >= 254.5) return null;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

/**
 * @param {number} worldHours
 * @param {number} dt
 * @param {boolean} running
 * @param {number} hoursPerRealSecond
 * @returns {number}
 */
export function advanceWorldHours(worldHours, dt, running, hoursPerRealSecond) {
  if (!running || hoursPerRealSecond <= 0) return wrapHours(worldHours);
  return wrapHours(worldHours + dt * hoursPerRealSecond);
}

/**
 * @param {DayPhase} phase
 * @returns {string}
 */
export function dayPhaseLabelEn(phase) {
  switch (phase) {
    case 'dawn':
      return 'Dawn';
    case 'day':
      return 'Day';
    case 'afternoon':
      return 'Afternoon';
    case 'night':
      return 'Night';
    default:
      return String(phase);
  }
}
