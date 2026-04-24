import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'node_modules/lz-string/libs/lz-string.min.js'), 'utf8');
const idx = src.indexOf(';"function"==typeof define');
if (idx < 0) throw new Error('Unexpected lz-string.min.js shape');
const out = `${src.slice(0, idx)};\nexport default LZString;\n`;
const dir = path.join(root, 'js/vendor');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'lz-string.mjs'), out);
