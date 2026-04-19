/**
 * Downloads national dex cries (MP3, dex > 151) from Pokemon Showdown CDN into audio/cries/national/.
 * Gen 1 cries stay in audio/cries/gen1/ (see scripts/download-gen1-cries-showdown.ps1).
 *
 * Usage:
 *   node scripts/download-national-cries-showdown.mjs   # 152 .. NATIONAL_DEX_MAX
 *   node scripts/download-national-cries-showdown.mjs --start 252 --end 386
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const destDir = path.join(root, 'audio', 'cries', 'national');

const SHOWDOWN_BASE = 'https://play.pokemonshowdown.com/audio/cries';

/** @returns {{ start?: number, end?: number }} only keys present when flags passed */
function parseDexRangeArgv(argv) {
  /** @type {{ start?: number, end?: number }} */
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--start' && argv[i + 1] != null) {
      o.start = Number(argv[++i]);
    } else if (a === '--end' && argv[i + 1] != null) {
      o.end = Number(argv[++i]);
    }
  }
  return o;
}

async function main() {
  fs.mkdirSync(destDir, { recursive: true });
  const { getNationalShowdownCrySlug, NATIONAL_DEX_LINES, NATIONAL_DEX_MAX } = await import(
    pathToFileURL(path.join(root, 'js', 'pokemon', 'national-dex-registry.js')).href
  );

  const parsed = parseDexRangeArgv(process.argv);
  let START_DEX = parsed.start ?? 152;
  let END_DEX = parsed.end ?? NATIONAL_DEX_MAX;
  START_DEX = Math.floor(Number(START_DEX));
  END_DEX = Math.floor(Number(END_DEX));
  if (!Number.isFinite(START_DEX) || !Number.isFinite(END_DEX)) {
    console.error('Invalid --start/--end');
    process.exit(1);
  }
  if (START_DEX < 152) {
    console.error('Use audio/cries/gen1/ for dex <= 151 (--start must be >= 152).');
    process.exit(1);
  }
  if (START_DEX > END_DEX) {
    console.error('--start must be <= --end');
    process.exit(1);
  }
  if (END_DEX > NATIONAL_DEX_MAX) {
    console.error(`--end (${END_DEX}) exceeds NATIONAL_DEX_MAX (${NATIONAL_DEX_MAX}); extend the registry first.`);
    process.exit(1);
  }

  console.log(`Downloading national cries dex ${START_DEX}..${END_DEX} -> ${destDir}`);

  const manifest = [];
  let ok = 0;
  let fail = 0;

  for (let dex = START_DEX; dex <= END_DEX; dex++) {
    const slug = getNationalShowdownCrySlug(dex);
    const pad = String(dex).padStart(3, '0');
    const url = `${SHOWDOWN_BASE}/${slug}.mp3`;
    const out = path.join(destDir, `${pad}-${slug}.mp3`);
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 256) throw new Error('too small');
      fs.writeFileSync(out, buf);
      ok++;
      manifest.push({
        dex,
        name: NATIONAL_DEX_LINES[dex - 1],
        slug,
        sourceUrl: url,
        file: `audio/cries/national/${pad}-${slug}.mp3`
      });
      console.log(`OK ${pad} ${slug}`);
    } catch (e) {
      fail++;
      if (fs.existsSync(out)) fs.unlinkSync(out);
      console.warn(`FAIL ${pad} ${slug}:`, e?.message || e);
    }
  }

  fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Done: ${ok} ok, ${fail} failed -> ${destDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
