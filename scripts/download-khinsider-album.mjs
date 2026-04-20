/**
 * Crawls a KHInsider album page and downloads all song MP3 files.
 *
 * Usage:
 *   node scripts/download-khinsider-album.mjs
 *   node scripts/download-khinsider-album.mjs --album-url "https://downloads.khinsider.com/game-soundtracks/album/pokemon-mystery-dungeon-explorers-of-sky" --dest "H:/path/to/folder"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load } from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const DEFAULT_ALBUM_URL =
  'https://downloads.khinsider.com/game-soundtracks/album/pokemon-mystery-dungeon-explorers-of-sky';
const DEFAULT_DEST = path.join(
  root,
  'audio',
  'bgm',
  'Sacanamon Mystery Dungeon Explorers of Sky (DS) (gamerip) (2009)'
);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseArgs(argv) {
  /** @type {{ albumUrl: string, dest: string, overwrite: boolean }} */
  const out = {
    albumUrl: DEFAULT_ALBUM_URL,
    dest: DEFAULT_DEST,
    overwrite: false
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--album-url' && argv[i + 1]) {
      out.albumUrl = String(argv[++i]);
    } else if (a === '--dest' && argv[i + 1]) {
      out.dest = String(argv[++i]);
    } else if (a === '--overwrite') {
      out.overwrite = true;
    }
  }

  return out;
}

function decodeRepeatedly(value) {
  let cur = value;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

function toAbsoluteUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function fetchContentLength(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow'
    });
    if (!res.ok) return -1;
    const v = res.headers.get('content-length');
    const n = Number(v);
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

async function chooseBestMp3Url(candidates) {
  if (candidates.length <= 1) return candidates[0] ?? null;
  let best = candidates[0];
  let bestSize = -1;
  for (const url of candidates) {
    const size = await fetchContentLength(url);
    if (size > bestSize) {
      bestSize = size;
      best = url;
    }
  }
  return best;
}

function collectSongPageUrls(albumHtml, albumUrl) {
  const $ = load(albumHtml);
  const set = new Set();
  $('table#songlist td.clickable-row a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const abs = toAbsoluteUrl(href, albumUrl);
    if (!abs) return;
    if (!abs.includes('/game-soundtracks/album/')) return;
    if (!abs.toLowerCase().includes('.mp3')) return;
    set.add(abs);
  });
  return [...set];
}

function collectMp3CandidatesFromSongPage(songHtml, songUrl) {
  const $ = load(songHtml);
  const set = new Set();

  $('span.songDownloadLink').each((_, el) => {
    const label = $(el).text().toLowerCase();
    if (!label.includes('mp3')) return;
    const href = $(el).closest('a').attr('href');
    const abs = toAbsoluteUrl(href, songUrl);
    if (!abs) return;
    if (!abs.toLowerCase().includes('.mp3')) return;
    set.add(abs);
  });

  // Fallback in case site markup changes and link text/span is different.
  $('a[href*=".mp3"]').each((_, el) => {
    const href = $(el).attr('href');
    const abs = toAbsoluteUrl(href, songUrl);
    if (!abs) return;
    if (!abs.toLowerCase().includes('.mp3')) return;
    if (!abs.includes('vgmtreasurechest.com')) return;
    set.add(abs);
  });

  return [...set];
}

function outputNameFromUrl(mp3Url) {
  const u = new URL(mp3Url);
  let base = path.basename(u.pathname);
  base = decodeRepeatedly(base);
  base = sanitizeFileName(base);
  if (!base.toLowerCase().endsWith('.mp3')) base += '.mp3';
  return base;
}

async function downloadMp3(url, outPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error('Downloaded file too small');
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

async function main() {
  const { albumUrl, dest, overwrite } = parseArgs(process.argv);
  fs.mkdirSync(dest, { recursive: true });

  console.log(`Album: ${albumUrl}`);
  console.log(`Dest:  ${dest}`);
  console.log(`Mode:  ${overwrite ? 'overwrite existing files' : 'skip existing files'}`);

  const albumHtml = await fetchText(albumUrl);

  const songPages = collectSongPageUrls(albumHtml, albumUrl);
  if (songPages.length === 0) {
    throw new Error('No song pages found in table#songlist; page format may have changed.');
  }

  console.log(`Found ${songPages.length} song pages in album table.`);

  /** @type {{ sourcePage: string, mp3Url: string }[]} */
  const targets = [];
  const seenMp3 = new Set();

  for (let i = 0; i < songPages.length; i++) {
    const pageUrl = songPages[i];
    try {
      const songHtml = await fetchText(pageUrl);
      const candidates = collectMp3CandidatesFromSongPage(songHtml, pageUrl);
      const chosen = await chooseBestMp3Url(candidates);
      if (!chosen) {
        console.warn(`WARN [${i + 1}/${songPages.length}] no MP3 candidate: ${pageUrl}`);
        continue;
      }
      if (seenMp3.has(chosen)) continue;
      seenMp3.add(chosen);
      targets.push({ sourcePage: pageUrl, mp3Url: chosen });
      console.log(`LINK [${i + 1}/${songPages.length}] ${chosen}`);
    } catch (e) {
      console.warn(`WARN [${i + 1}/${songPages.length}] ${pageUrl}: ${e?.message || e}`);
    }
  }

  console.log(`Will download ${targets.length} MP3 files.`);

  let ok = 0;
  let fail = 0;
  const manifest = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const name = outputNameFromUrl(t.mp3Url);
    const outPath = path.join(dest, name);
    try {
      if (!overwrite && fs.existsSync(outPath) && fs.statSync(outPath).size > 128 * 1024) {
        ok++;
        manifest.push({
          file: outPath,
          sourcePage: t.sourcePage,
          mp3Url: t.mp3Url,
          skipped: true
        });
        console.log(`SKIP [${i + 1}/${targets.length}] ${name}`);
        continue;
      }

      const bytes = await downloadMp3(t.mp3Url, outPath);
      ok++;
      manifest.push({
        file: outPath,
        sourcePage: t.sourcePage,
        mp3Url: t.mp3Url,
        bytes
      });
      console.log(`OK   [${i + 1}/${targets.length}] ${name} (${bytes} bytes)`);
    } catch (e) {
      fail++;
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      console.warn(`FAIL [${i + 1}/${targets.length}] ${name}: ${e?.message || e}`);
    }
  }

  const manifestPath = path.join(dest, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Done: ${ok} ok, ${fail} failed`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
