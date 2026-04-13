import { padDex3 } from './gen1-name-to-dex.js';
import { getDexAnimMeta } from './pmd-anim-metadata.js';

const FALLBACK_WALK = 'tilesets/gengar_walk.png';
const FALLBACK_IDLE = 'tilesets/gengar_idle.png';

/** Only species with explicit `dig` in PMD metadata may load `NNN_dig.png` (avoids wrong/stale assets for others). */
function speciesHasDedicatedDigSheetMeta(dexId) {
  const m = getDexAnimMeta(dexId);
  return !!(m && Object.prototype.hasOwnProperty.call(m, 'dig'));
}

/** @type {Map<string, Promise<void>>} */
const inflight = new Map();

function loadOne(imageCache, src, fallbackSrc) {
  if (imageCache.has(src)) return Promise.resolve();
  const existing = inflight.get(src);
  if (existing) return existing;

  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      inflight.delete(src);
      resolve();
    };
    img.onerror = () => {
      const fb = imageCache.get(fallbackSrc);
      if (fb) {
        imageCache.set(src, fb);
      }
      inflight.delete(src);
      resolve();
    };
    img.src = src;
  });
  inflight.set(src, p);
  return p;
}

/**
 * Lazy-load species sheets (same layout as Gengar). Missing files fall back to Gengar assets.
 * @param {Map<string, HTMLImageElement>} imageCache same as render.imageCache
 * @param {number} dexId 1..151
 */
export function ensurePokemonSheetsLoaded(imageCache, dexId) {
  const id = padDex3(dexId);
  const walk = `tilesets/pokemon/${id}_walk.png`;
  const idle = `tilesets/pokemon/${id}_idle.png`;
  const dig = `tilesets/pokemon/${id}_dig.png`;
  const tasks = [
    loadOne(imageCache, walk, FALLBACK_WALK),
    loadOne(imageCache, idle, FALLBACK_IDLE)
  ];
  if (speciesHasDedicatedDigSheetMeta(dexId)) {
    tasks.push(loadOne(imageCache, dig, walk));
  }
  return Promise.all(tasks);
}

export function getPokemonSheetPaths(dexId) {
  const id = padDex3(dexId);
  const walk = `tilesets/pokemon/${id}_walk.png`;
  return {
    walk,
    idle: `tilesets/pokemon/${id}_idle.png`,
    dig: `tilesets/pokemon/${id}_dig.png`,
    fallbackWalk: FALLBACK_WALK,
    fallbackIdle: FALLBACK_IDLE
  };
}

/**
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} dexId
 * @returns {{ walk: HTMLImageElement | undefined, idle: HTMLImageElement | undefined, dig: HTMLImageElement | undefined }}
 */
export function getResolvedSheets(imageCache, dexId) {
  const { walk, idle, dig, fallbackWalk, fallbackIdle } = getPokemonSheetPaths(dexId);
  const w = imageCache.get(walk) || imageCache.get(fallbackWalk);
  const useDedicatedDig = speciesHasDedicatedDigSheetMeta(dexId);
  const digSheet = useDedicatedDig ? imageCache.get(dig) || w : w;
  return {
    walk: w,
    idle: imageCache.get(idle) || imageCache.get(fallbackIdle),
    /** Walk sheet unless species has PMD `dig` + optional `NNN_dig.png`. */
    dig: digSheet
  };
}
