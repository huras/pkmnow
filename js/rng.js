/**
 * PRNG determinístico (mulberry32) + hash de string para seed.
 * Evita Math.random() para reprodutibilidade entre execuções.
 */

/** FNV-1a 32-bit: string → seed estável */
export function stringToSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {number} seed - inteiro unsigned 32-bit
 * @returns {{ next: () => number }} next() retorna float em [0, 1)
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
