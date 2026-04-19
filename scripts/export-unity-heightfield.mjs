/**
 * Export heightfield + metadata for Unity (PokemonOpenWild_v1 M1 bridge).
 * See docs/UNITY-HEIGHTFIELD-CONTRACT.md
 *
 * Usage:
 *   node scripts/export-unity-heightfield.mjs [seed] [outDir]
 * Defaults: seed "demo", outDir "unity-export/latest"
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const generatorUrl = pathToFileURL(join(repoRoot, 'js', 'generator.js')).href;
const { generate, DEFAULT_CONFIG } = await import(generatorUrl);

const seedArg = process.argv[2] ?? 'demo';
const outRelative = process.argv[3] ?? join('unity-export', 'latest');
const outDir = resolve(repoRoot, outRelative);

const world = generate(seedArg, DEFAULT_CONFIG);
const { width, height, cells, config, seed } = world;
const waterLevel =
  typeof config?.waterLevel === 'number' && Number.isFinite(config.waterLevel)
    ? config.waterLevel
    : 0.21;

const heightsFile = 'world.heights.f32';
const meta = {
  schemaVersion: 1,
  width,
  height,
  seed: seed >>> 0,
  seedInput: String(seedArg),
  waterLevel,
  heightsEncoding: 'float32le',
  heightsFile,
  rowOrder: 'ZMajor',
  gridToWorld: {
    originX: 0,
    originZ: 0,
    metersPerCell: 2,
    terrainHeightMeters: 64
  }
};

mkdirSync(outDir, { recursive: true });

const buf = Buffer.from(cells.buffer, cells.byteOffset, cells.byteLength);
writeFileSync(join(outDir, heightsFile), buf);
writeFileSync(join(outDir, 'world.heightfield.json'), JSON.stringify(meta, null, 2), 'utf8');

const DEFAULT_UNITY_PROJECT = 'H:/cursor/Unity Projects/PokemonOpenWild_v1';
const unityProjectRoot = process.env.UNITY_POKEMON_OPEN_WILD_ROOT
  ? resolve(process.env.UNITY_POKEMON_OPEN_WILD_ROOT)
  : DEFAULT_UNITY_PROJECT;
const unityStreaming = join(unityProjectRoot, 'Assets', 'StreamingAssets', 'World');
if (existsSync(join(unityProjectRoot, 'Assets'))) {
  mkdirSync(unityStreaming, { recursive: true });
  copyFileSync(join(outDir, heightsFile), join(unityStreaming, heightsFile));
  copyFileSync(join(outDir, 'world.heightfield.json'), join(unityStreaming, 'world.heightfield.json'));
  console.log('Also copied to:', unityStreaming);
} else {
  console.log('Unity project not found at', unityProjectRoot, '(set UNITY_POKEMON_OPEN_WILD_ROOT to copy there)');
}

console.log('Wrote', outDir);
console.log(meta);
