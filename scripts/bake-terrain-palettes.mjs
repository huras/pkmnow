/**
 * Lê apenas os masters (nunca os altera):
 *   tilesets/rocky-terrain.png  → tilesets/palettes/base-*.png
 *   tilesets/grassy-terrain.png → tilesets/palettes/grassy-*.png
 *   npm run build:palettes
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { remapRgbaPixelData } from '../js/terrain-palette-remap-core.js';
import { getTerrainPaletteBakeJobs } from '../js/terrain-palette-base.js';
import { getGrassyPaletteBakeJobs } from '../js/terrain-palette-grassy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function bakeFromMaster(masterRel, jobs, label) {
  const masterPath = join(root, masterRel);
  if (!existsSync(masterPath)) {
    console.error(`[${label}] Missing master:`, masterPath);
    process.exit(1);
  }
  const masterBuf = readFileSync(masterPath);
  const masterPng = PNG.sync.read(masterBuf);
  const w = masterPng.width;
  const h = masterPng.height;
  let n = 0;
  for (const { outFile, pairs } of jobs) {
    const outPath = join(root, outFile);
    mkdirSync(dirname(outPath), { recursive: true });
    const copy = Buffer.from(masterPng.data);
    remapRgbaPixelData(copy, pairs);
    const outPng = new PNG({ width: w, height: h });
    outPng.data = copy;
    writeFileSync(outPath, PNG.sync.write(outPng));
    console.log('Wrote', outFile);
    n++;
  }
  return n;
}

let total = 0;
total += bakeFromMaster('tilesets/rocky-terrain.png', getTerrainPaletteBakeJobs(), 'rocky');
total += bakeFromMaster('tilesets/grassy-terrain.png', getGrassyPaletteBakeJobs(), 'grassy');
console.log('Done.', total, 'palette PNG(s).');
