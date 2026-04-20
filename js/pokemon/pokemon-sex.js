import { seededHashInt } from '../tessellation-logic.js';

/** @typedef {'male'|'female'|'genderless'} WildSex */

const GENDERLESS_DEX = new Set([
  81,
  82,
  100,
  101,
  120,
  132,
  137,
  144,
  145,
  146,
  150,
  151,
  201,
  202,
  233,
  243,
  244,
  245,
  249,
  250,
  251,
  292,
  337,
  338,
  343,
  344,
  351,
  374,
  375,
  376,
  377,
  378,
  379,
  380,
  381,
  382,
  383,
  384,
  385,
  386,
  436,
  437,
  462,
  474,
  479,
  480,
  481,
  482,
  483,
  484,
  485,
  486,
  487,
  489,
  490,
  491,
  492,
  493
]);

/** Approx. Gen-1 female ratios where species-specific; default 0.5. */
const FEMALE_RATIO_BY_DEX = new Map([
  [113, 1], // Chansey
  [124, 1], // Jynx
  [115, 1], // Kangaskhan
  [29, 1], // Nidoran♀
  [30, 1],
  [31, 1],
  [32, 0], // Nidoran♂
  [33, 0],
  [34, 0],
  [106, 0], // Hitmonlee
  [107, 0], // Hitmonchan
  [128, 0], // Tauros
  [35, 0.75], // Clefairy
  [36, 0.75], // Clefable
  [39, 0.75], // Jigglypuff
  [40, 0.75],
  [37, 0.75], // Vulpix
  [38, 0.75],
  [41, 0.5], // Zubat 50%
  [42, 0.5],
  [66, 0.25], // Machop line male-heavy
  [67, 0.25],
  [68, 0.25],
  [129, 0.5] // Magikarp
]);

/**
 * Deterministic sex for a wild spawn (no sprite change; gameplay + HUD).
 * @param {number} dexId
 * @param {number} salt — e.g. seed ^ slot hash
 * @returns {WildSex}
 */
export function rollWildSex(dexId, salt) {
  const dex = Math.floor(Number(dexId)) || 1;
  if (GENDERLESS_DEX.has(dex)) return 'genderless';

  const fixed = FEMALE_RATIO_BY_DEX.get(dex);
  if (fixed === 0) return 'male';
  if (fixed === 1) return 'female';

  const ratio = fixed != null ? fixed : 0.5;
  const h = seededHashInt(dex * 9973, salt & 0xffffffff, (salt ^ 0x736578) >>> 0) % 10_000;
  const u = h / 10_000;
  return u < ratio ? 'female' : 'male';
}

/**
 * @param {WildSex | string | null | undefined} sex
 * @returns {string} single-char label for canvas HUD
 */
export function wildSexHudLabel(sex) {
  if (sex === 'female') return 'F';
  if (sex === 'male') return 'M';
  return '—';
}
