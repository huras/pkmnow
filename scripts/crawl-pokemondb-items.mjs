/**
 * Crawls https://pokemondb.net/item/all and writes JSON for items that have a real
 * sprite on the list page (img src under /sprites/items/). Placeholder icons use
 * https://img.pokemondb.net/s.png and are excluded.
 *
 * Usage:
 *   node scripts/crawl-pokemondb-items.mjs
 *   node scripts/crawl-pokemondb-items.mjs --split   # also writes data/pokemondb-items/by-slug/<slug>.json
 */
import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'data', 'pokemondb-items');

const LIST_URL = 'https://pokemondb.net/item/all';
const SITE_ORIGIN = 'https://pokemondb.net';

const UA = 'experimento-gerador-regiao-pkmn/1.0 (items crawler; respectful fetch)';

function hasRealItemSprite(imgSrc) {
  if (!imgSrc || typeof imgSrc !== 'string') return false;
  try {
    const u = new URL(imgSrc, SITE_ORIGIN);
    return u.pathname.includes('/sprites/items/');
  } catch {
    return imgSrc.includes('/sprites/items/');
  }
}

function categorySlug(category) {
  const s = String(category || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'uncategorized';
}

function parseArgs(argv) {
  return { split: argv.includes('--split') };
}

function main() {
  const { split } = parseArgs(process.argv.slice(2));
  return run(split);
}

async function run(split) {
  mkdirSync(OUT_DIR, { recursive: true });

  const res = await fetch(LIST_URL, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${LIST_URL}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  /** @type {Array<{ name: string, slug: string, category: string, effect: string, imageUrl: string, itemUrl: string }>} */
  const items = [];

  $('table.data-table tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const $img = $tr.find('img.icon-item-img').first();
    const rawSrc = $img.attr('src') || '';
    if (!hasRealItemSprite(rawSrc)) return;

    const $a = $tr.find('a.ent-name').first();
    const name = $a.text().trim();
    const href = $a.attr('href') || '';
    const slug = href.replace(/^\/?item\//, '').replace(/\/+$/, '');
    if (!name || !slug) return;

    const $cells = $tr.find('> td');
    const category = $cells.eq(1).text().trim();
    const effect = $cells.eq(2).text().trim();
    const imageUrl = new URL(rawSrc, SITE_ORIGIN).href;
    const itemUrl = new URL(href, SITE_ORIGIN).href;

    items.push({ name, slug, category, effect, imageUrl, itemUrl });
  });

  items.sort((a, b) => a.slug.localeCompare(b.slug));

  const fetchedAt = new Date().toISOString();
  const meta = {
    source: LIST_URL,
    fetchedAt,
    count: items.length,
    note: 'Only rows whose list-page icon URL path includes /sprites/items/ (excludes pokemondb placeholder icons such as /s.png).'
  };

  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  writeFileSync(join(OUT_DIR, 'items-with-images.json'), JSON.stringify(items, null, 2), 'utf8');

  /** @type {Record<string, typeof items>} */
  const byCategory = {};
  for (const it of items) {
    const key = categorySlug(it.category);
    if (!byCategory[key]) byCategory[key] = [];
    byCategory[key].push(it);
  }

  const catDir = join(OUT_DIR, 'by-category');
  mkdirSync(catDir, { recursive: true });
  for (const [key, list] of Object.entries(byCategory)) {
    writeFileSync(join(catDir, `${key}.json`), JSON.stringify(list, null, 2), 'utf8');
  }

  if (split) {
    const slugDir = join(OUT_DIR, 'by-slug');
    mkdirSync(slugDir, { recursive: true });
    for (const it of items) {
      writeFileSync(join(slugDir, `${it.slug}.json`), JSON.stringify(it, null, 2), 'utf8');
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${items.length} items with real sprites → ${OUT_DIR}\n` +
      `  meta.json, items-with-images.json, by-category/*.json` +
      (split ? ', by-slug/*.json' : '')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
