import { seededHashInt } from '../tessellation-logic.js';

export const PokemonNature = {
  ADAMANT: 'Adamant',
  JOLLY: 'Jolly',
  TIMID: 'Timid',
  BOLD: 'Bold',
  QUIET: 'Quiet'
};

/**
 * Deterministically rolls a nature based on entity key and world seed.
 */
export function rollNature(entityKey, seed) {
  const h = seededHashInt(String(entityKey).length, 42, seededHashInt(0, 0, seed ^ 0x6e6174757265));
  const keys = Object.values(PokemonNature);
  return keys[h % keys.length];
}

/**
 * Returns affinity modification for a nature towards a specific stimuly slug.
 */
export function getNatureAffinityFor(nature, slug) {
  if (slug === 'flower' || slug === 'gracidea') {
    if (nature === PokemonNature.JOLLY) return 0.5;
    if (nature === PokemonNature.ADAMANT) return -0.4;
    if (nature === PokemonNature.TIMID) return 0.1;
  }
  return 0;
}
