/**
 * Wild "boss" rolls: promote base encounter dex to a strong evolution stage + extra HP.
 * Only species with a mapped evolution target are eligible.
 */

import { seededHashInt } from '../tessellation-logic.js';
import { NATIONAL_DEX_MAX } from '../pokemon/gen1-name-to-dex.js';

/** Chance 0..255 that a spawn eligible for promotion becomes a boss (evolved + high HP). */
export const WILD_BOSS_ROLL_THRESHOLD = 52; // ~20%

/** Boss HP multiplier vs normal wild (50 base HP). */
export const WILD_BOSS_HP_MULT = 4.6;

/** Dex IDs that never become boss *targets* (stay rare spawns as themselves). */
const BOSS_PROMOTE_TARGET_BLOCK = new Set([
  144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251,
  377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493
]);

/**
 * Base dex → final (or strongest) evolution in the same family (Gen 1–4 scope).
 * Singles / no evolution: omit key → no boss promotion from that base.
 */
export const WILD_BOSS_EVOLVE_TO = {
  1: 3,
  2: 3,
  4: 6,
  5: 6,
  7: 9,
  8: 9,
  10: 12,
  11: 12,
  13: 15,
  14: 15,
  16: 18,
  17: 18,
  19: 20,
  21: 22,
  23: 24,
  25: 26,
  27: 28,
  29: 31,
  30: 31,
  32: 34,
  33: 34,
  35: 36,
  37: 38,
  39: 40,
  41: 42,
  43: 45,
  44: 45,
  46: 47,
  48: 49,
  50: 51,
  52: 53,
  54: 55,
  56: 57,
  58: 59,
  60: 62,
  61: 62,
  63: 65,
  64: 65,
  66: 68,
  67: 68,
  69: 71,
  70: 71,
  72: 73,
  74: 76,
  75: 76,
  77: 78,
  79: 80,
  81: 82,
  84: 85,
  86: 87,
  88: 89,
  90: 91,
  92: 94,
  93: 94,
  96: 97,
  98: 99,
  100: 101,
  102: 103,
  104: 105,
  109: 110,
  111: 112,
  116: 117,
  118: 119,
  120: 121,
  129: 130,
  133: 134, // Eevee — see `rollBossPromotedDex` (5-way: Vaporeon / Jolteon / Flareon / Leafeon / Glaceon)
  138: 139,
  140: 141,
  147: 149,
  148: 149,
  152: 154,
  153: 154,
  155: 157,
  156: 157,
  158: 160,
  159: 160,
  161: 162,
  163: 164,
  165: 166,
  167: 168,
  170: 171,
  175: 176,
  177: 178,
  179: 181,
  183: 184,
  187: 189,
  191: 192,
  194: 195,
  204: 205,
  209: 210,
  216: 217,
  218: 219,
  220: 221,
  223: 224,
  228: 229,
  231: 232,
  236: 237,
  239: 125,
  240: 126,
  246: 248,
  252: 254,
  253: 254,
  255: 257,
  256: 257,
  258: 260,
  259: 260,
  261: 262,
  263: 264,
  265: 267,
  266: 267,
  268: 269,
  270: 272,
  271: 272,
  273: 275,
  274: 275,
  276: 277,
  278: 279,
  280: 282,
  281: 282,
  283: 284,
  285: 286,
  287: 289,
  288: 289,
  290: 291,
  293: 295,
  294: 295,
  296: 297,
  298: 184,
  300: 301,
  304: 306,
  305: 306,
  307: 308,
  309: 310,
  316: 317,
  318: 319,
  320: 321,
  322: 323,
  325: 326,
  328: 330,
  329: 330,
  331: 332,
  333: 334,
  339: 340,
  341: 342,
  343: 344,
  345: 346,
  347: 348,
  349: 350,
  353: 354,
  355: 356,
  360: 202,
  361: 362,
  363: 365,
  364: 365,
  366: 367,
  371: 373,
  372: 373,
  374: 376,
  375: 376,
  82: 462,
  108: 463,
  112: 464,
  114: 465,
  125: 466,
  126: 467,
  176: 468,
  198: 430,
  200: 429,
  207: 472,
  215: 461,
  221: 473,
  233: 474,
  299: 476,
  315: 407,
  356: 477,
  387: 389,
  388: 389,
  390: 392,
  391: 392,
  393: 395,
  394: 395,
  396: 398,
  397: 398,
  399: 400,
  401: 402,
  403: 405,
  404: 405,
  406: 407,
  408: 409,
  410: 411,
  412: 414,
  415: 416,
  418: 419,
  420: 421,
  422: 423,
  425: 426,
  427: 428,
  431: 432,
  434: 435,
  436: 437,
  438: 185,
  439: 122,
  440: 242,
  443: 445,
  444: 445,
  446: 143,
  447: 448,
  449: 450,
  451: 452,
  453: 454,
  456: 457,
  458: 226,
  459: 460,
  433: 358
};

/**
 * @param {number} baseDex
 * @param {number} mx
 * @param {number} my
 * @param {number} sx
 * @param {number} sy
 * @param {number} worldSeed
 * @returns {{ dex: number, isBoss: boolean, hp: number, maxHp: number }}
 */
export function rollBossPromotedDex(baseDex, mx, my, sx, sy, worldSeed) {
  const d0 = Math.floor(Number(baseDex)) || 0;
  if (d0 < 1 || d0 > NATIONAL_DEX_MAX) return { dex: d0, isBoss: false, hp: 50, maxHp: 50 };

  let target = WILD_BOSS_EVOLVE_TO[d0];
  if (target == null || target === d0) {
    return { dex: d0, isBoss: false, hp: 50, maxHp: 50 };
  }

  const roll = seededHashInt(mx * 1607 + sx * 251, my * 1303 + sy * 199, worldSeed ^ 0xb055f00d) & 255;
  if (roll >= WILD_BOSS_ROLL_THRESHOLD) {
    return { dex: d0, isBoss: false, hp: 50, maxHp: 50 };
  }

  if (BOSS_PROMOTE_TARGET_BLOCK.has(target)) {
    return { dex: d0, isBoss: false, hp: 50, maxHp: 50 };
  }

  // Eevee: split boss forms (Gen 1–4 eeveelutions).
  if (d0 === 133) {
    const j = seededHashInt(mx * 59 + sx, my * 61 + sy, worldSeed ^ 0xee3e) % 5;
    target = j === 0 ? 134 : j === 1 ? 135 : j === 2 ? 136 : j === 3 ? 470 : 471;
  }

  const maxHp = Math.max(80, Math.round(50 * WILD_BOSS_HP_MULT));
  return { dex: target, isBoss: true, hp: maxHp, maxHp };
}
