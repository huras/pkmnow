/**
 * Rewrites play.html static fallbacks to pt-BR without reformatting the file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE, MESSAGES } from '../js/i18n/messages.js';

const root = path.resolve(import.meta.dirname, '..');
const playPath = path.join(root, 'play.html');

function resolvePath(obj, keyPath) {
  const parts = String(keyPath || '').split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function escAttr(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
}

const dict = MESSAGES[DEFAULT_LOCALE];
let html = fs.readFileSync(playPath, 'utf8');

html = html.replace('<html lang="ja-JP"', '<html lang="pt-BR"');

const docTitle = resolvePath(dict, 'play.docTitle');
if (typeof docTitle === 'string') {
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${docTitle}</title>`);
}

html = html.replace(/data-i18n="([^"]+)"([^>]*)>([^<]*)</g, (all, key, attrs, _text) => {
  const msg = resolvePath(dict, key);
  if (typeof msg !== 'string') return all;
  return `data-i18n="${key}"${attrs}>${msg}<`;
});

html = html.replace(
  /data-i18n-title="([^"]+)"([\s\S]*?)\btitle="[^"]*"/g,
  (all, key, mid) => {
    const msg = resolvePath(dict, key);
    if (typeof msg !== 'string') return all;
    return `data-i18n-title="${key}"${mid}title="${escAttr(msg)}"`;
  }
);

html = html.replace(
  /data-i18n-aria-label="([^"]+)"([\s\S]*?)\baria-label="[^"]*"/g,
  (all, key, mid) => {
    const msg = resolvePath(dict, key);
    if (typeof msg !== 'string') return all;
    return `data-i18n-aria-label="${key}"${mid}aria-label="${escAttr(msg)}"`;
  }
);

html = html.replace(/data-i18n-placeholder="([^"]+)"([^>]*)\bplaceholder="[^"]*"/g, (all, key, mid) => {
  const msg = resolvePath(dict, key);
  if (typeof msg !== 'string') return all;
  return `data-i18n-placeholder="${key}"${mid}placeholder="${escAttr(msg)}"`;
});

fs.writeFileSync(playPath, html, 'utf8');
