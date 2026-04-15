/**
 * Fase de vento por célula: Perlin 2D em escala baixa + cache (não recalcula a cada frame).
 */

/** Frequência no espaço (coords mundo); valores baixos = variação suave em blocos grandes. */
export const WIND_NOISE_SCALE = 0.08;

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);

function makePerm(seed) {
  const a = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  return p;
}

const perm = makePerm(0x57494e44); // 'WIND'

function grad2(hash, x, y) {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) !== 0 ? -u : u) + ((h & 2) !== 0 ? -v : v);
}

/**
 * Perlin 2D ~[-1, 1] (tipicamente contido; clamp suave implícito).
 */
export function perlin2(x, y) {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = perm[xi] + yi;
  const ab = aa + 1;
  const ba = perm[xi + 1] + yi;
  const bb = ba + 1;

  const x1 = lerp(grad2(perm[aa], xf, yf), grad2(perm[ba], xf - 1, yf), u);
  const x2 = lerp(grad2(perm[ab], xf, yf - 1), grad2(perm[bb], xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

/** mx, my: coords micro do mundo (inteiros). */
const phaseCache = new Map();

/**
 * Offset de fase para Math.sin(ωt + phase). Calcula Perlin só no primeiro uso da célula.
 *
 * A fase final combina 2 componentes:
 * 1. **Bias direcional linear** (domina): cria efeito de "onda viajando" diagonalmente pelo mapa.
 *    Vizinhos balançam quase juntos (diferença pequena = ~0.1 rad = quase mesmo frame).
 * 2. **Perlin com amplitude reduzida** (π/4 em vez de 2π): adiciona variação orgânica sutil,
 *    sem jogar vizinhos em fases opostas como antes.
 *
 * Antes: Perlin × 2π espalhava fases caoticamente — trees próximas iam em direções opostas.
 * Agora: trees próximas se movem em sync, padrão de onda coerente emerge naturalmente.
 */
export function getWindPhaseOffset(mx, my) {
  const key = `${mx},${my}`;
  let phase = phaseCache.get(key);
  if (phase !== undefined) return phase;

  const n = perlin2(mx * WIND_NOISE_SCALE, my * WIND_NOISE_SCALE);
  // Bias linear: mx contribui mais que my (vento "horizontal"), espaçamento ~6 tiles por ciclo
  const directionalBias = (mx * 0.18 + my * 0.08);
  // Perlin reduzido: ±π/4 em vez de ±2π (elimina caos, mantém variação)
  const perlinJitter = n * Math.PI * 0.25;
  phase = directionalBias + perlinJitter;
  phaseCache.set(key, phase);
  return phase;
}

/** Testes ou troca de mundo: limpar fases cacheadas. */
export function clearWindPhaseCache() {
  phaseCache.clear();
}
