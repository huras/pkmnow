import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function printUsageAndExit() {
  console.log('Usage: node scripts/list-image-colors.mjs <image-path-relative-to-root>');
  console.log('Example: node scripts/list-image-colors.mjs "tilesets/rocky-terrain.png"');
  process.exit(1);
}

const inputRel = process.argv[2];
if (!inputRel) {
  printUsageAndExit();
}

const inputAbs = join(root, inputRel);
if (!existsSync(inputAbs)) {
  console.error('Image not found:', inputAbs);
  process.exit(1);
}

if (!inputRel.toLowerCase().endsWith('.png')) {
  console.error('Only PNG is supported in this script:', inputRel);
  process.exit(1);
}

const png = PNG.sync.read(readFileSync(inputAbs));
const uniqueColors = new Set();

for (let i = 0; i < png.data.length; i += 4) {
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  const a = png.data[i + 3];
  uniqueColors.add(`${r},${g},${b},${a}`);
}

const sortedColors = [...uniqueColors].sort((left, right) => {
  const la = left.split(',').map(Number);
  const ra = right.split(',').map(Number);
  for (let i = 0; i < 4; i++) {
    if (la[i] !== ra[i]) return la[i] - ra[i];
  }
  return 0;
});

console.log(`Image: ${inputRel}`);
console.log(`Size: ${png.width}x${png.height}`);
console.log(`Total unique colors (RGBA): ${sortedColors.length}`);
console.log('--- Colors (r,g,b,a) ---');
for (const color of sortedColors) {
  console.log(color);
}
