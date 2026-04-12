/**
 * Regenerates js/pokemon/pokemon-config.js from:
 * - PokeAPI (base Speed + default typings)
 * - js/pokemon/pokemon-heights.js (heightTiles — hand-tuned)
 * - js/pokemon/gen1-name-to-dex.js (display names)
 *
 * Gen 1 type chart fixes (Red/Blue): no Steel; Clefairy/Jiggly lines are Normal;
 * Magnemite line pure Electric; Mr. Mime is Psychic-only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const heightsPath = path.join(root, 'js', 'pokemon', 'pokemon-heights.js');
const namesPath = path.join(root, 'js', 'pokemon', 'gen1-name-to-dex.js');
const outPath = path.join(root, 'js', 'pokemon', 'pokemon-config.js');

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

function parseHeights(src) {
  /** @type {Record<number, number>} */
  const h = {};
  const re = /^\s*(\d+)\s*:\s*([\d.]+)/gm;
  let m;
  while ((m = re.exec(src))) {
    h[Number(m[1])] = Number(m[2]);
  }
  return h;
}

function parseGen1Names(src) {
  const m = src.match(/GEN1_LINES = `([\s\S]*?)`/);
  if (!m) throw new Error('GEN1_LINES block not found');
  return m[1].trim().replace(/\r\n/g, '\n').split('\n');
}

async function fetchRows() {
  const rows = [];
  for (let dex = 1; dex <= 151; dex++) {
    const p = await fetch(`https://pokeapi.co/api/v2/pokemon/${dex}/`).then(
      (r) => r.json()
    );
    const types = [...p.types]
      .sort((a, b) => a.slot - b.slot)
      .map((t) => t.type.name);
    const speed = p.stats.find((s) => s.stat.name === 'speed').base_stat;
    rows.push({ dex, types, speed });
  }
  return rows;
}

function esc(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function main() {
  const heightsSrc = fs.readFileSync(heightsPath, 'utf8');
  const namesSrc = fs.readFileSync(namesPath, 'utf8');
  const heights = parseHeights(heightsSrc);
  const names = parseGen1Names(namesSrc);
  const api = await fetchRows();

  const lines = [];
  lines.push(`/**
 * Gen 1 (#1–151) species data for gameplay tuning (height, motion, type logic).
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
 * @property {string} name — matches \`gen1-name-to-dex.js\` encounter strings where possible
 * @property {PokemonTypeSlug[]} types — slot order primary → secondary; Gen 1 chart overrides baked in (see script)
 * @property {number} heightTiles — visual / collider height in tile units (from former \`pokemon-heights.js\`)
 * @property {number} baseSpeed — main-series base Speed (for motion / turn order tuning)
 * @property {PokemonBehaviorTuning} [behavior] — optional per-species behavior overrides
 */

/** @type {Record<number, PokemonSpeciesConfig>} */
export const POKEMON_CONFIG = {`);

  for (const row of api) {
    const d = row.dex;
    const h = heights[d];
    if (h === undefined) {
      throw new Error(`Missing height for dex ${d} in pokemon-heights.js`);
    }
    const name = names[d - 1];
    if (!name) throw new Error(`Missing name for dex ${d}`);
    const types = GEN1_TYPE_OVERRIDES[d] ?? row.types;
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
  if (dex < 1 || dex > 151) return null;
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
