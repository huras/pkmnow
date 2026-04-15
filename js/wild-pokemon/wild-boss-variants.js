/**
 * Wild "boss" rolls: promote base encounter dex to a strong Gen-1 stage + extra HP.
 * Only species with a real Gen-1 evolution target are eligible.
 */

import { seededHashInt } from '../tessellation-logic.js';

/** Chance 0..255 that a spawn eligible for promotion becomes a boss (evolved + high HP). */
export const WILD_BOSS_ROLL_THRESHOLD = 52; // ~20%

/** Boss HP multiplier vs normal wild (50 base HP). */
export const WILD_BOSS_HP_MULT = 4.6;

/** Dex IDs that never become boss *targets* (stay rare spawns as themselves). */
const BOSS_PROMOTE_TARGET_BLOCK = new Set([144, 145, 146, 150, 151]);

/**
 * Base dex → final (or strongest) Gen-1 evolution in the same family.
 * Singles / no Gen-1 evolution: omit key → no boss promotion from that base.
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
  133: 134, // Eevee → Vaporeon (Jolteon/Flareon via `rollBossPromotedDex` jitter)
  138: 139,
  140: 141,
  147: 149,
  148: 149
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
  if (d0 < 1 || d0 > 151) return { dex: d0, isBoss: false, hp: 50, maxHp: 50 };

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

  // Eevee: split boss forms across slots.
  if (d0 === 133) {
    const j = seededHashInt(mx * 59 + sx, my * 61 + sy, worldSeed ^ 0xee3e) % 3;
    target = j === 0 ? 134 : j === 1 ? 135 : 136;
  }

  const maxHp = Math.max(80, Math.round(50 * WILD_BOSS_HP_MULT));
  return { dex: target, isBoss: true, hp: maxHp, maxHp };
}
