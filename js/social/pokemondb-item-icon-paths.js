/** Resolved once; maps item slug → repo-relative icon path (see items-icons/pokemondb-sprites/manifest.json). */

import { imageCache } from '../image-cache.js';

const MANIFEST_URL = new URL('../../items-icons/pokemondb-sprites/manifest.json', import.meta.url);

/** @type {Promise<Map<string, string>> | null} */
let loadPromise = null;

async function loadSlugToPathMap() {
  const res = await fetch(MANIFEST_URL.href, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const json = await res.json();
  const by = json?.bySlug;
  if (!by || typeof by !== 'object') throw new Error('manifest.bySlug missing');
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const [slug, row] of Object.entries(by)) {
    const p = row?.path;
    if (typeof p === 'string' && p.length) m.set(String(slug).toLowerCase(), p);
  }
  return m;
}

export function getPokemondbItemIconPathMap() {
  if (!loadPromise) loadPromise = loadSlugToPathMap();
  return loadPromise;
}

/** @param {string} slug */
export async function getPokemondbItemIconPath(slug) {
  const m = await getPokemondbItemIconPathMap();
  return m.get(String(slug || '').toLowerCase()) ?? null;
}

/**
 * Synchronous version for use in the render loop (only works if manifest already loaded).
 * @param {string} slug 
 */
export function getPokemondbItemIconPathSync(slug) {
  // We use a private internal reference to the map if it's already resolved.
  // Actually, we can just check if the promise is resolved.
  // But let's just use the loadPromise's resolved value if available.
  if (!resolvedMap) return null;
  return resolvedMap.get(String(slug || '').toLowerCase()) ?? null;
}

let resolvedMap = null;
getPokemondbItemIconPathMap().then(m => { resolvedMap = m; });

/**
 * Loads the PNG into `imageCache` under its manifest path key (same as tilesets).
 * @param {string} slug
 * @returns {Promise<{ path: string, img: HTMLImageElement | null } | null>}
 */
export function ensurePokemondbItemIconInCache(slug) {
  return (async () => {
    const path = await getPokemondbItemIconPath(slug);
    if (!path) return null;
    const existing = imageCache.get(path);
    if (existing && existing.naturalWidth) return { path, img: existing };

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(path, img);
        resolve({ path, img });
      };
      img.onerror = () => resolve({ path, img: null });
      img.src = path;
    });
  })();
}
