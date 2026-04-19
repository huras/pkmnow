/**
 * Regenerates js/pokemon/pokemon-config.js from:
 * - PokeAPI (base Speed + default typings + height in decimeters for Gen 2+ fallbacks)
 * - Existing js/pokemon/pokemon-config.js (heightTiles for dex already present — preserves Gen 1 tuning)
 * - js/pokemon/national-dex-registry.js (display names)
 *
 * Gen 1 type chart fixes (Red/Blue): no Steel; Clefairy/Jiggly lines are Normal;
 * Magnemite line pure Electric; Mr. Mime is Psychic-only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const configPath = path.join(root, 'js', 'pokemon', 'pokemon-config.js');
const registryPath = path.join(root, 'js', 'pokemon', 'national-dex-registry.js');
const outPath = path.join(root, 'js', 'pokemon', 'pokemon-config.js');

const { NATIONAL_DEX_MAX } = await import(pathToFileURL(path.join(root, 'js', 'pokemon', 'national-dex-registry.js')).href);

/** @type {Record<number, string[]>} */
const GEN1_TYPE_OVERRIDES = {
  35: ['normal'],
  36: ['normal'],
  39: ['normal'],
  40: ['normal'],
  81: ['electric'],
  82: ['electric'],
  122: ['psychic']
};

function parseHeightsFromPokemonConfig(src) {
  /** @type {Record<number, number>} */
  const h = {};
  const re = /^\s*(\d+)\s*:\s*\{[^}]*heightTiles:\s*([\d.]+)/gm;
  let m;
  while ((m = re.exec(src))) {
    h[Number(m[1])] = Number(m[2]);
  }
  return h;
}

/** Heuristic heightTiles when not present in existing config (Gen 2+); PokeAPI `height` is decimeters. */
function heightTilesFromApiHeightDm(heightDm) {
  const hd = Math.max(1, Number(heightDm) || 1);
  const raw = hd * 0.22 + 1.1;
  return Math.max(1.0, Math.min(9.0, Math.round(raw * 10) / 10));
}

async function fetchRows(maxDex) {
  const rows = [];
  for (let dex = 1; dex <= maxDex; dex++) {
    const p = await fetch(`https://pokeapi.co/api/v2/pokemon/${dex}/`).then((r) => {
      if (!r.ok) throw new Error(`PokeAPI ${dex}: ${r.status}`);
      return r.json();
    });
    const types = [...p.types]
      .sort((a, b) => a.slot - b.slot)
      .map((t) => t.type.name);
    const speed = p.stats.find((s) => s.stat.name === 'speed').base_stat;
    rows.push({ dex, types, speed, height: p.height });
  }
  return rows;
}

function esc(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function main() {
  const configSrc = fs.readFileSync(configPath, 'utf8');
  const heights = parseHeightsFromPokemonConfig(configSrc);
  const { NATIONAL_DEX_LINES } = await import(pathToFileURL(registryPath).href);
  if (!Array.isArray(NATIONAL_DEX_LINES) || NATIONAL_DEX_LINES.length !== NATIONAL_DEX_MAX) {
    throw new Error(`Expected ${NATIONAL_DEX_MAX} national dex names`);
  }

  const api = await fetchRows(NATIONAL_DEX_MAX);

  const lines = [];
  lines.push(`/**
 * National Dex #1–${NATIONAL_DEX_MAX} species data for gameplay tuning (height, motion, type logic).
 * Regenerate: \`node scripts/build-pokemon-config.mjs\` (needs network).
 *
 * @typedef {'bug'|'dark'|'dragon'|'electric'|'fairy'|'fighting'|'fire'|'flying'|'ghost'|'grass'|'ground'|'ice'|'normal'|'poison'|'psychic'|'rock'|'steel'|'water'} PokemonTypeSlug
 *
 * @typedef {Object} PokemonBehaviorTuning
 * @property {number} [walkSpeedMul] — multiply walk tick scale (1 = default)
 * @property {number} [scatterWeight] — encounter / prop scatter preference weight
 * @property {number} [turnBias] — −1..1 AI turn randomness bias (reserved)
 *
 * @typedef {Object} PokemonSpeciesConfig
 * @property {string} name — matches encounter strings in national-dex-registry.js where possible
 * @property {PokemonTypeSlug[]} types — slot order primary → secondary; Gen 1 chart overrides baked in (see script)
 * @property {number} heightTiles — visual / collider height in tile units
 * @property {number} baseSpeed — main-series base Speed (for motion / turn order tuning)
 * @property {PokemonBehaviorTuning} [behavior] — optional per-species behavior overrides
 */

/** @type {Record<number, PokemonSpeciesConfig>} */
export const POKEMON_CONFIG = {`);

  for (const row of api) {
    const d = row.dex;
    const hExisting = heights[d];
    const h = hExisting !== undefined ? hExisting : heightTilesFromApiHeightDm(row.height);
    const name = NATIONAL_DEX_LINES[d - 1];
    if (!name) throw new Error(`Missing name for dex ${d}`);
    const types = d <= 151 && GEN1_TYPE_OVERRIDES[d] ? GEN1_TYPE_OVERRIDES[d] : row.types;
    const typesStr = types.map((t) => `'${t}'`).join(', ');
    lines.push(
      `  ${d}: { name: '${esc(name)}', types: [${typesStr}], heightTiles: ${h}, baseSpeed: ${row.speed} },`
    );
  }

  lines.push(`};

const _heightEntries = Object.entries(POKEMON_CONFIG).map(([dex, c]) => [
  Number(dex),
  c.heightTiles
]);

/** @type {Record<number, number>} — dex → tile height (same keys as legacy \`pokemon-heights.js\`) */
export const POKEMON_HEIGHTS = Object.fromEntries(_heightEntries);

/**
 * @param {number} dexId
 * @returns {PokemonSpeciesConfig & { dexId: number, behavior: PokemonBehaviorTuning } | null}
 */
export function getPokemonConfig(dexId) {
  const n = Number(dexId);
  if (!Number.isFinite(n)) return null;
  const dex = Math.floor(n);
  if (dex < 1 || dex > ${NATIONAL_DEX_MAX}) return null;
  const row = POKEMON_CONFIG[dex];
  if (!row) return null;
  const behavior = {
    walkSpeedMul: 1,
    scatterWeight: 1,
    turnBias: 0,
    ...(row.behavior || {})
  };
  return { dexId: dex, ...row, behavior };
}
`);

  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log('Wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
