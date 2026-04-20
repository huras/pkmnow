import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const outRoot = path.join(root, 'dist', 'newgrounds');
const packageDir = path.join(outRoot, 'package');
const zipPath = path.join(outRoot, 'newgrounds-upload.zip');

const requiredRootFiles = ['index.html'];

const copyEntries = [
  'index.html',
  'play.html',
  'splash-and-game-menu.html',
  'debug-play.html',
  'social-simulation.html',
  'terrain-relief-lab.html',
  'terrain-13-blocks.html',
  'pokemon-anim-lab.html',
  'tile-block-grid-lab.html',
  'css',
  'js',
  'audio',
  'items-icons'
];

function toPosixRelative(absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

function powershellSingleQuotedLiteral(rawPath) {
  return rawPath.replace(/'/g, "''");
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureRequiredFiles() {
  for (const rel of requiredRootFiles) {
    const abs = path.join(packageDir, rel);
    if (!(await pathExists(abs))) {
      throw new Error(`Required file missing from package root: ${rel}`);
    }
  }
}

async function collectTextFiles(baseDir) {
  /** @type {string[]} */
  const out = [];
  const stack = [baseDir];
  const allowedExt = new Set(['.html', '.css', '.json', '.txt']);
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = await fs.promises.readdir(cur, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (allowedExt.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  }
  return out;
}

async function findLocalMachinePathReferences() {
  const files = await collectTextFiles(packageDir);
  const localPathRegex = /(?:[A-Za-z]:\\|file:\/\/)/;
  /** @type {string[]} */
  const hits = [];
  for (const file of files) {
    const src = await fs.promises.readFile(file, 'utf8');
    if (localPathRegex.test(src)) {
      hits.push(toPosixRelative(file));
    }
  }
  return hits;
}

async function copyRuntimeFiles() {
  /** @type {string[]} */
  const copied = [];
  /** @type {string[]} */
  const skipped = [];

  for (const rel of copyEntries) {
    const from = path.join(root, rel);
    const to = path.join(packageDir, rel);
    if (!(await pathExists(from))) {
      skipped.push(rel);
      continue;
    }
    await fs.promises.cp(from, to, { recursive: true, force: true });
    copied.push(rel);
  }

  return { copied, skipped };
}

async function zipPackageWindows() {
  const packageWildcard = powershellSingleQuotedLiteral(path.join(packageDir, '*'));
  const zipLiteral = powershellSingleQuotedLiteral(zipPath);
  const cmd = `Compress-Archive -Path '${packageWildcard}' -DestinationPath '${zipLiteral}' -Force`;
  await execFileAsync('powershell', ['-NoProfile', '-Command', cmd], { cwd: root });
}

async function zipPackagePosix() {
  await execFileAsync('tar', ['-a', '-cf', zipPath, '-C', packageDir, '.'], { cwd: root });
}

async function zipPackage() {
  try {
    // Prefer tar everywhere because it is much faster than Compress-Archive on big asset folders.
    await zipPackagePosix();
  } catch (err) {
    if (process.platform === 'win32') {
      console.warn('[newgrounds] tar zip failed, falling back to Compress-Archive');
      await zipPackageWindows();
      return;
    }
    throw err;
  }
}

async function main() {
  await fs.promises.rm(outRoot, { recursive: true, force: true });
  await fs.promises.mkdir(packageDir, { recursive: true });

  const { copied, skipped } = await copyRuntimeFiles();
  await ensureRequiredFiles();
  const localPathHits = await findLocalMachinePathReferences();

  await zipPackage();

  const zipStats = await fs.promises.stat(zipPath);
  console.log('[newgrounds] Package ready');
  console.log('[newgrounds] Zip:', toPosixRelative(zipPath));
  console.log('[newgrounds] Size MB:', (zipStats.size / (1024 * 1024)).toFixed(2));
  console.log('[newgrounds] Copied:', copied.join(', '));
  if (skipped.length > 0) {
    console.log('[newgrounds] Skipped missing entries:', skipped.join(', '));
  }
  if (localPathHits.length > 0) {
    console.warn(
      '[newgrounds] Warning: possible local-machine paths found in:',
      localPathHits.slice(0, 10).join(', ')
    );
    if (localPathHits.length > 10) {
      console.warn(`[newgrounds] Warning: ...and ${localPathHits.length - 10} more file(s).`);
    }
  }
  console.log('[newgrounds] Upload this zip to Newgrounds HTML5 submission.');
}

main().catch((err) => {
  console.error('[newgrounds] Publish failed');
  console.error(err);
  process.exit(1);
});
