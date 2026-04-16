/**
 * Downloads item sprites listed in data/pokemondb-items/items-with-images.json
 * into items-icons/pokemondb-sprites/<category-slug>/<slug>.<ext>
 *
 * Requires: npm run crawl:pokemondb-items (JSON must exist).
 *
 * Usage:
 *   node scripts/download-pokemondb-item-images.mjs
 *   node scripts/download-pokemondb-item-images.mjs --force
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ITEMS_JSON = join(ROOT, 'data', 'pokemondb-items', 'items-with-images.json');
const OUT_ROOT = join(ROOT, 'items-icons', 'pokemondb-sprites');

const UA = 'experimento-gerador-regiao-pkmn/1.0 (item sprites download; respectful fetch)';
const ITEM_SPRITE_BASE = 'https://img.pokemondb.net/sprites/items/';
const CONCURRENCY = 5;
const RETRIES = 2;
const RETRY_DELAY_MS = 400;

/** CDN file names sometimes differ from modern item slugs on the list page. */
const SLUG_TO_SPRITE_FILE = {
  upgrade: 'up-grade',
  leek: 'stick'
};

function categorySlug(category) {
  const s = String(category || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'uncategorized';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extFromUrl(imageUrl) {
  try {
    const e = extname(new URL(imageUrl).pathname).toLowerCase();
    if (e === '.png' || e === '.gif' || e === '.webp') return e;
  } catch {
    /* ignore */
  }
  return '.png';
}

function webRel(fromRootPosix) {
  return fromRootPosix.split('\\').join('/');
}

/** Ordered URLs to try (list-page URL first, then known CDN aliases). */
function spriteUrlCandidates(slug, listPageUrl) {
  const out = [];
  const add = (u) => {
    if (!u || typeof u !== 'string') return;
    if (!out.includes(u)) out.push(u);
  };
  add(listPageUrl);
  if (slug.endsWith('-feather')) {
    add(`${ITEM_SPRITE_BASE}${slug.replace(/-feather$/, '-wing')}.png`);
  }
  const altFile = SLUG_TO_SPRITE_FILE[slug];
  if (altFile) add(`${ITEM_SPRITE_BASE}${altFile}.png`);
  return out;
}

async function fetchBinary(url) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'image/*,*/*' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('empty body');
      return buf;
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastErr;
}

async function fetchFirstCandidateBuffer(candidates) {
  let lastErr;
  for (const url of candidates) {
    try {
      const buf = await fetchBinary(url);
      return { buf, url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function run(force) {
  if (!existsSync(ITEMS_JSON)) {
    throw new Error(`Missing ${ITEMS_JSON} — run: npm run crawl:pokemondb-items`);
  }
  const raw = readFileSync(ITEMS_JSON, 'utf8');
  /** @type {Array<{ name: string, slug: string, category: string, effect: string, imageUrl: string, itemUrl: string }>} */
  const items = JSON.parse(raw);
  if (!Array.isArray(items) || !items.length) {
    throw new Error('items-with-images.json is empty or invalid');
  }

  mkdirSync(OUT_ROOT, { recursive: true });

  /** @type {Record<string, { path: string, category: string, name: string, sourceUrl: string, downloadedFrom?: string }>} */
  const manifestItems = {};
  const failures = [];

  async function downloadOne(it) {
    const cat = categorySlug(it.category);
    const ext = extFromUrl(it.imageUrl);
    const dir = join(OUT_ROOT, cat);
    const fileName = `${it.slug}${ext}`;
    const dest = join(dir, fileName);
    const relFromProject = webRel(join('items-icons', 'pokemondb-sprites', cat, fileName));

    if (!force && existsSync(dest)) {
      try {
        if (statSync(dest).size > 0) {
          manifestItems[it.slug] = {
            path: relFromProject,
            category: it.category,
            name: it.name,
            sourceUrl: it.imageUrl
          };
          return { ok: true, skipped: true };
        }
      } catch {
        /* redownload */
      }
    }

    mkdirSync(dir, { recursive: true });
    try {
      const candidates = spriteUrlCandidates(it.slug, it.imageUrl);
      const { buf, url: usedUrl } = await fetchFirstCandidateBuffer(candidates);
      writeFileSync(dest, buf);
      const entry = {
        path: relFromProject,
        category: it.category,
        name: it.name,
        sourceUrl: it.imageUrl,
        downloadedFrom: usedUrl
      };
      if (usedUrl === it.imageUrl) delete entry.downloadedFrom;
      manifestItems[it.slug] = entry;
      return { ok: true, skipped: false };
    } catch (e) {
      failures.push({
        slug: it.slug,
        tried: spriteUrlCandidates(it.slug, it.imageUrl),
        error: String(e?.message || e)
      });
      return { ok: false, skipped: false };
    }
  }

  let ok = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((it) => downloadOne(it)));
    for (const r of results) {
      if (r.ok) {
        if (r.skipped) skipped += 1;
        else ok += 1;
      }
    }
    process.stdout.write(`\r${Math.min(i + CONCURRENCY, items.length)}/${items.length}`);
  }
  process.stdout.write('\n');

  const meta = {
    generatedAt: new Date().toISOString(),
    sourceJson: webRel(join('data', 'pokemondb-items', 'items-with-images.json')),
    outRoot: webRel(join('items-icons', 'pokemondb-sprites')),
    totalListed: items.length,
    downloaded: ok,
    skippedExisting: skipped,
    failed: failures.length,
    layout: 'items-icons/pokemondb-sprites/<category-slug>/<slug>.<ext>',
    note: 'Use manifest.bySlug[slug].path as src/href from repo root (same as play.html).'
  };

  const manifest = {
    version: 1,
    meta,
    bySlug: manifestItems
  };

  writeFileSync(join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(OUT_ROOT, 'download-meta.json'), JSON.stringify({ ...meta, failures }, null, 2), 'utf8');

  console.log(
    `Done: ${ok} downloaded, ${skipped} skipped (existing), ${failures.length} failed → ${OUT_ROOT}`
  );
  if (failures.length) {
    console.log('Failures (first 10):', failures.slice(0, 10));
  }
}

const force = process.argv.includes('--force');
run(force).catch((err) => {
  console.error(err);
  process.exit(1);
});
