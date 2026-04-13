/**
 * Head portraits from SpriteCollab (`…/portrait/NNNN/*.png`), paired with the RPG Maker
 * emotion balloon row in render. Same balloon icon + different portrait = different “utterance”
 * for social / group behavior tuning.
 *
 * Canonical copy: `tilesets/spritecollab-portraits/` (same layout as SpriteCollab `portrait/`).
 * Optional `window.__SPRITECOLLAB_PORTRAIT_BASE__` overrides; probe also tries `../SpriteCollab/portrait`
 * if the project copy is missing. Re-sync: `scripts/copy-spritecollab-portraits.ps1`.
 *
 * Slugs match file basenames (PascalCase / Teary-Eyed.png → slug `Teary-Eyed`). Not every species has every file;
 * missing files fall back to `Normal.png` for that species folder. After one 404 per dex+slug,
 * further loads skip the missing URL (see `portraitPrimaryMiss`).
 */

/** @type {Map<string, Promise<string | null>>} */
const prefixProbeInflight = new Map();

/** @type {Map<number, string | null>} resolved URL prefix including trailing slash, or null if none */
const portraitPrefixByDex = new Map();

/** @type {Map<string, Promise<void>>} */
const portraitLoadInflight = new Map();

/**
 * `${dex}:${slug}` → primary emotion PNG returned 404 once; skip further GETs and load `Normal.png` only.
 * (SpriteCollab rarely ships every slug per species; avoids console spam and wasted requests.)
 * @type {Set<string>}
 */
const portraitPrimaryMiss = new Set();

export function getSpriteCollabPortraitBase() {
  if (typeof window !== 'undefined' && window.__SPRITECOLLAB_PORTRAIT_BASE__) {
    return String(window.__SPRITECOLLAB_PORTRAIT_BASE__).replace(/\/+$/, '');
  }
  return 'tilesets/spritecollab-portraits';
}

/**
 * Tries each root until `Normal.png` is found for this dex (covers different static-server roots).
 * @returns {string[]}
 */
export function getPortraitSearchRoots() {
  const out = [];
  const push = (b) => {
    const s = String(b || '')
      .trim()
      .replace(/\/+$/, '');
    if (s && !out.includes(s)) out.push(s);
  };
  if (typeof window !== 'undefined' && window.__SPRITECOLLAB_PORTRAIT_BASE__) {
    push(window.__SPRITECOLLAB_PORTRAIT_BASE__);
  }
  push('tilesets/spritecollab-portraits');
  push('../SpriteCollab/portrait');
  return out;
}

export function padPortraitDex4(dexId) {
  const n = Math.max(0, Math.min(9999, Math.floor(Number(dexId) || 0)));
  return String(n).padStart(4, '0');
}

/**
 * Balloon sprite row index (RPG Maker sheet) → default portrait slug for that “speech act”.
 * Override per call via `setEmotion(..., portraitSlug)`.
 */
export const DEFAULT_PORTRAIT_SLUG_BY_BALLOON = {
  0: 'Surprised',
  1: 'Worried',
  2: 'Joyous',
  3: 'Happy',
  4: 'Angry',
  5: 'Pain',
  6: 'Determined',
  7: 'Sigh',
  8: 'Surprised',
  9: 'Normal'
};

export function defaultPortraitSlugForBalloon(balloonType) {
  const t = Math.max(0, Math.min(9, Math.floor(Number(balloonType) || 0)));
  return DEFAULT_PORTRAIT_SLUG_BY_BALLOON[t] ?? 'Normal';
}

/**
 * Union of emotion filenames commonly seen under `portrait/NNNN/` (for UI / tools — not exhaustive).
 * @type {readonly string[]}
 */
export const COMMON_PORTRAIT_SLUGS = Object.freeze([
  'Angry',
  'Crying',
  'Determined',
  'Dizzy',
  'Happy',
  'Inspired',
  'Joyous',
  'Normal',
  'Pain',
  'Sad',
  'Shouting',
  'Sigh',
  'Special1',
  'Special2',
  'Stunned',
  'Surprised',
  'Teary-Eyed',
  'Worried'
]);

function probeKey(dexId) {
  return `pfx:${dexId}`;
}

/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function imageLoads(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(!!img.naturalWidth);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * Find a folder layout that contains `Normal.png` for this dex (flat vs nested form paths).
 * @param {number} dexId
 * @returns {Promise<string | null>}
 */
export async function probeSpriteCollabPortraitPrefix(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  if (d < 1 || d > 9999) return null;
  if (portraitPrefixByDex.has(d)) return portraitPrefixByDex.get(d) ?? null;

  const k = probeKey(d);
  let inflight = prefixProbeInflight.get(k);
  if (!inflight) {
    const pad = padPortraitDex4(d);
    const layouts = (base) => [
      `${base}/${pad}/`,
      `${base}/${pad}/0000/0001/`,
      `${base}/${pad}/0000/`,
      `${base}/${pad}/0001/`
    ];
    inflight = (async () => {
      for (const base of getPortraitSearchRoots()) {
        for (const prefix of layouts(base)) {
          if (await imageLoads(`${prefix}Normal.png`)) {
            portraitPrefixByDex.set(d, prefix);
            return prefix;
          }
        }
      }
      portraitPrefixByDex.set(d, null);
      return null;
    })();
    prefixProbeInflight.set(k, inflight);
  }
  return inflight;
}

/**
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {string} cacheKey
 * @param {string} src
 * @param {string} fallbackSrc
 * @param {string | null} missKey — `${dex}:${slug}` for portraitPrimaryMiss; null skips miss tracking
 */
function loadPortraitWithFallback(imageCache, cacheKey, src, fallbackSrc, missKey) {
  if (imageCache.has(cacheKey)) return Promise.resolve();
  const existing = portraitLoadInflight.get(cacheKey);
  if (existing) return existing;

  const loadFallbackOnly = () =>
    new Promise((resolve) => {
      const fb = new Image();
      fb.onload = () => {
        imageCache.set(cacheKey, fb);
        portraitLoadInflight.delete(cacheKey);
        resolve();
      };
      fb.onerror = () => {
        portraitLoadInflight.delete(cacheKey);
        resolve();
      };
      fb.src = fallbackSrc;
    });

  if (src === fallbackSrc) {
    const p = loadFallbackOnly();
    portraitLoadInflight.set(cacheKey, p);
    return p;
  }

  if (missKey && portraitPrimaryMiss.has(missKey)) {
    const p = loadFallbackOnly();
    portraitLoadInflight.set(cacheKey, p);
    return p;
  }

  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(cacheKey, img);
      portraitLoadInflight.delete(cacheKey);
      resolve();
    };
    img.onerror = () => {
      if (missKey) portraitPrimaryMiss.add(missKey);
      const fb = new Image();
      fb.onload = () => {
        imageCache.set(cacheKey, fb);
        portraitLoadInflight.delete(cacheKey);
        resolve();
      };
      fb.onerror = () => {
        portraitLoadInflight.delete(cacheKey);
        resolve();
      };
      fb.src = fallbackSrc;
    };
    img.src = src;
  });
  portraitLoadInflight.set(cacheKey, p);
  return p;
}

/**
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} dexId
 * @param {string} slug — basename without `.png` (e.g. `Worried`, `Teary-Eyed`)
 */
export async function ensureSpriteCollabPortraitLoaded(imageCache, dexId, slug) {
  const d = Math.floor(Number(dexId) || 0);
  const prefix = await probeSpriteCollabPortraitPrefix(d);
  if (!prefix) return;
  const safe = String(slug || 'Normal').replace(/[^\w.-]/g, '') || 'Normal';
  const primary = `${prefix}${safe}.png`;
  const fallback = `${prefix}Normal.png`;
  const cacheKey = `portrait:${d}:${safe}`;
  const missKey = `${d}:${safe}`;
  return loadPortraitWithFallback(imageCache, cacheKey, primary, fallback, missKey);
}

/**
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} dexId
 * @param {string} slug
 * @returns {HTMLImageElement | undefined}
 */
export function getSpriteCollabPortraitImage(imageCache, dexId, slug) {
  const d = Math.floor(Number(dexId) || 0);
  const safe = String(slug || 'Normal').replace(/[^\w.-]/g, '') || 'Normal';
  return imageCache.get(`portrait:${d}:${safe}`);
}

/**
 * @param {number} dexId
 */
export function hasSpriteCollabPortraitPrefix(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  return portraitPrefixByDex.get(d) != null;
}
