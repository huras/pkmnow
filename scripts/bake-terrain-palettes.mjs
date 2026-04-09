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
import {
  getTerrainPaletteBakeJobs,
  getPaletteBaseTransitionBakeJobs
} from '../js/terrain-palette-base.js';
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

function blendTwoPngsToFile(root, pathA, pathB, outRel) {
  const fullA = join(root, pathA);
  const fullB = join(root, pathB);
  if (!existsSync(fullA) || !existsSync(fullB)) {
    console.error('[trans] Missing input:', pathA, 'or', pathB);
    process.exit(1);
  }
  const pngA = PNG.sync.read(readFileSync(fullA));
  const pngB = PNG.sync.read(readFileSync(fullB));
  if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
    console.error('[trans] Size mismatch', pathA, pathB);
    process.exit(1);
  }
  const w = pngA.width;
  const h = pngA.height;
  const outBuf = Buffer.alloc(pngA.data.length);
  for (let i = 0; i < pngA.data.length; i += 4) {
    outBuf[i] = Math.round((pngA.data[i] + pngB.data[i]) / 2);
    outBuf[i + 1] = Math.round((pngA.data[i + 1] + pngB.data[i + 1]) / 2);
    outBuf[i + 2] = Math.round((pngA.data[i + 2] + pngB.data[i + 2]) / 2);
    outBuf[i + 3] = Math.round((pngA.data[i + 3] + pngB.data[i + 3]) / 2);
  }
  const outPath = join(root, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  const outPng = new PNG({ width: w, height: h });
  outPng.data = outBuf;
  writeFileSync(outPath, PNG.sync.write(outPng));
  console.log('Wrote', outRel);
}

let total = 0;
total += bakeFromMaster('tilesets/rocky-terrain.png', getTerrainPaletteBakeJobs(), 'rocky');
total += bakeFromMaster('tilesets/grassy-terrain.png', getGrassyPaletteBakeJobs(), 'grassy');

for (const { pathA, pathB, outFile } of getPaletteBaseTransitionBakeJobs()) {
  blendTwoPngsToFile(root, pathA, pathB, outFile);
  total++;
}

console.log('Done.', total, 'palette PNG(s).');
