/**
 * Read-only report: sprite sheets, PMD metadata, portrait Normal.png, cries (gen1 + national).
 *
 * Usage: node scripts/audit-national-dex-assets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const { NATIONAL_DEX_MAX, padDex3, getNationalShowdownCrySlug } = await import(
  pathToFileURL(path.join(root, 'js', 'pokemon', 'national-dex-registry.js')).href
);

const tilesetsPokemon = path.join(root, 'tilesets', 'pokemon');
const portraitRoots = [
  path.join(root, 'tilesets', 'spritecollab-portraits'),
  path.join(root, '..', 'SpriteCollab', 'portrait')
];

function fileExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function portraitNormalExists(dex) {
  const pad4 = String(Math.max(1, Math.min(9999, dex))).padStart(4, '0');
  const layouts = (base) => [
    path.join(base, pad4, 'Normal.png'),
    path.join(base, pad4, '0000', '0001', 'Normal.png'),
    path.join(base, pad4, '0000', 'Normal.png'),
    path.join(base, pad4, '0001', 'Normal.png')
  ];
  for (const base of portraitRoots) {
    for (const p of layouts(base)) {
      if (fileExists(p)) return true;
    }
  }
  return false;
}

/** @type {Set<string>} */
let pmdKeys = new Set();
try {
  const pmdPath = path.join(root, 'js', 'pokemon', 'pmd-anim-metadata.js');
  const src = fs.readFileSync(pmdPath, 'utf8');
  const m = src.match(/export const PMD_ANIM_METADATA = (\{[\s\S]*?\n\});\s*\n/);
  if (m) {
    const json = m[1].replace(/,(\s*[}\]])/g, '$1');
    const obj = JSON.parse(json);
    pmdKeys = new Set(Object.keys(obj));
  }
} catch {
  // ignore parse failures; report will show no metadata
}

let missingWalk = 0;
let missingIdle = 0;
let missingMeta = 0;
let missingPortrait = 0;
let missingCry = 0;

for (let dex = 1; dex <= NATIONAL_DEX_MAX; dex++) {
  const id = padDex3(dex);
  const walk = path.join(tilesetsPokemon, `${id}_walk.png`);
  const idle = path.join(tilesetsPokemon, `${id}_idle.png`);
  if (!fileExists(walk)) missingWalk++;
  if (!fileExists(idle)) missingIdle++;
  if (!pmdKeys.has(id)) missingMeta++;
  if (!portraitNormalExists(dex)) missingPortrait++;
  const slug = getNationalShowdownCrySlug(dex);
  const cry =
    dex <= 151
      ? path.join(root, 'audio', 'cries', 'gen1', `${id}-${slug}.mp3`)
      : path.join(root, 'audio', 'cries', 'national', `${id}-${slug}.mp3`);
  if (!fileExists(cry)) missingCry++;
}

console.log(`National dex audit (1..${NATIONAL_DEX_MAX})`);
console.log(`tilesets/pokemon: missing *_walk.png: ${missingWalk} (fallback to Gengar at runtime if needed)`);
console.log(`tilesets/pokemon: missing *_idle.png: ${missingIdle}`);
console.log(`pmd-anim-metadata keys: ${pmdKeys.size} entries; species without entry: ${missingMeta}`);
console.log(`portrait Normal.png (searched known roots): missing ~${missingPortrait} (probe also tries ../SpriteCollab/portrait)`);
console.log(`cries mp3 (gen1 folder dex<=151, national dex>151): missing files: ${missingCry}`);
