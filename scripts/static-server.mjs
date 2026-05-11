#!/usr/bin/env node
/**
 * @fileoverview Tiny zero-dep static file server. Serves the workspace root so
 * apps under `apps/<name>/` can `import` from `../../packages/<pkg>/...` via
 * the importmap in their HTML.
 *
 * Usage:
 *
 *     node scripts/static-server.mjs <root> <port>
 *
 * Example: `node scripts/static-server.mjs apps/hoenn-builder 4173` opens
 * `http://localhost:4173/apps/hoenn-builder/index.html`.
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const startUnder = args[0] || '.';
const port = Number(args[1]) || 4173;
const workspaceRoot = resolve(process.cwd());
const startPath = `/${startUnder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};

function safeJoin(rootDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const joined = normalize(join(rootDir, decoded));
  if (!joined.startsWith(rootDir + sep) && joined !== rootDir) return null;
  return joined;
}

const server = createServer((req, res) => {
  let urlPath = req.url || '/';
  if (urlPath === '/' || urlPath === '') {
    res.statusCode = 302;
    res.setHeader('Location', `${startPath}index.html`);
    res.end();
    return;
  }

  const filePath = safeJoin(workspaceRoot, urlPath);
  if (!filePath) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    res.statusCode = 404;
    res.end(`Not found: ${urlPath}`);
    return;
  }

  if (stat.isDirectory()) {
    res.statusCode = 302;
    res.setHeader('Location', `${urlPath.replace(/\/?$/, '/')}index.html`);
    res.end();
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(filePath).pipe(res);
});

/** Try `port`, then `port+1`..`port+9` if busy — friendlier than crashing. */
function listenWithFallback(initialPort, attemptsLeft = 10) {
  const tryPort = initialPort;
  const onError = (err) => {
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 1) {
      console.warn(`static-server: port ${tryPort} busy, trying ${tryPort + 1}…`);
      server.removeListener('error', onError);
      setImmediate(() => listenWithFallback(tryPort + 1, attemptsLeft - 1));
      return;
    }
    console.error(`static-server: failed to listen on ${tryPort}:`, err?.message || err);
    process.exit(1);
  };
  server.once('error', onError);
  server.listen(tryPort, () => {
    server.removeListener('error', onError);
    const where = `${startPath}index.html`;
    console.log(`static-server: http://localhost:${tryPort}${where}`);
    console.log(`              (root: ${workspaceRoot})`);
  });
}

listenWithFallback(port);
