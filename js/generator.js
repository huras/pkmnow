import { createRng, stringToSeed } from './rng.js';

/**
 * Aceita número finito (unsigned) ou string (hash FNV).
 * @param {string|number} input
 * @returns {number} seed efetiva 32-bit
 */
export function normalizeSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input >>> 0;
  }
  const s = String(input).trim();
  if (s === '') return stringToSeed('default');
  if (/^\d+$/.test(s)) {
    return Number(s) >>> 0;
  }
  return stringToSeed(s);
}

/**
 * Fase 0: retorna um grid demo para validar seed + pipeline render.
 * Fases seguintes substituem `cells` por estrutura real (grafo, macro, tiles).
 *
 * @param {string|number} seedInput
 * @returns {{ version: number, phase: number, seed: number, width: number, height: number, cells: Float32Array }}
 */
export function generate(seedInput) {
  const seed = normalizeSeed(seedInput);
  const rng = createRng(seed);
  const width = 32;
  const height = 32;
  const cells = new Float32Array(width * height);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = rng.next();
  }
  return {
    version: 0,
    phase: 0,
    seed,
    width,
    height,
    cells,
  };
}
