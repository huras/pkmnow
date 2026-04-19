/**
 * Downloads national dex #152–251 cries (MP3) from Pokemon Showdown CDN into audio/cries/national/.
 * Gen 1 cries stay in audio/cries/gen1/ (see scripts/download-gen1-cries-showdown.ps1).
 *
 * Usage: node scripts/download-national-cries-showdown.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const destDir = path.join(root, 'audio', 'cries', 'national');

const SHOWDOWN_BASE = 'https://play.pokemonshowdown.com/audio/cries';

const START_DEX = 152;
const END_DEX = 251;

async function main() {
  fs.mkdirSync(destDir, { recursive: true });
  const { getNationalShowdownCrySlug, NATIONAL_DEX_LINES } = await import(
    pathToFileURL(path.join(root, 'js', 'pokemon', 'national-dex-registry.js')).href
  );

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
