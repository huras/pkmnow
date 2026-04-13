import { padDex3 } from './gen1-name-to-dex.js';
import { getDexAnimMeta } from './pmd-anim-metadata.js';

const FALLBACK_WALK = 'tilesets/gengar_walk.png';
const FALLBACK_IDLE = 'tilesets/gengar_idle.png';

/** Only species with explicit `dig` in PMD metadata may load `NNN_dig.png` (avoids wrong/stale assets for others). */
function speciesHasDedicatedDigSheetMeta(dexId) {
  const m = getDexAnimMeta(dexId);
  return !!(m && Object.prototype.hasOwnProperty.call(m, 'dig'));
}

/** Only load optional action sheets when metadata explicitly declares the slice. */
export function speciesHasDedicatedSliceMeta(dexId, sliceKey) {
  const m = getDexAnimMeta(dexId);
  return !!(m && Object.prototype.hasOwnProperty.call(m, sliceKey));
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

/** Optional sheet: on failure do not cache (so combat HUD can detect missing asset). */
function loadOptionalSheet(imageCache, src) {
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
  const hurt = `tilesets/pokemon/${id}_hurt.png`;
  const sleep = `tilesets/pokemon/${id}_sleep.png`;
  const faint = `tilesets/pokemon/${id}_faint.png`;
  const charge = `tilesets/pokemon/${id}_charge.png`;
  const shoot = `tilesets/pokemon/${id}_shoot.png`;
  const tasks = [
    loadOne(imageCache, walk, FALLBACK_WALK),
    loadOne(imageCache, idle, FALLBACK_IDLE)
  ];
  if (speciesHasDedicatedDigSheetMeta(dexId)) {
    tasks.push(loadOne(imageCache, dig, walk));
  }
  if (speciesHasDedicatedSliceMeta(dexId, 'hurt')) {
    tasks.push(loadOne(imageCache, hurt, idle));
  }
  if (speciesHasDedicatedSliceMeta(dexId, 'sleep')) {
    tasks.push(loadOne(imageCache, sleep, idle));
  }
  if (speciesHasDedicatedSliceMeta(dexId, 'faint')) {
    tasks.push(loadOne(imageCache, faint, idle));
  }
  if (speciesHasDedicatedSliceMeta(dexId, 'charge')) {
    tasks.push(loadOptionalSheet(imageCache, charge));
  }
  if (speciesHasDedicatedSliceMeta(dexId, 'shoot')) {
    tasks.push(loadOptionalSheet(imageCache, shoot));
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
    hurt: `tilesets/pokemon/${id}_hurt.png`,
    sleep: `tilesets/pokemon/${id}_sleep.png`,
    faint: `tilesets/pokemon/${id}_faint.png`,
    charge: `tilesets/pokemon/${id}_charge.png`,
    shoot: `tilesets/pokemon/${id}_shoot.png`,
    fallbackWalk: FALLBACK_WALK,
    fallbackIdle: FALLBACK_IDLE
  };
}

/**
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} dexId
 * @returns {{ walk: HTMLImageElement | undefined, idle: HTMLImageElement | undefined, dig: HTMLImageElement | undefined, hurt: HTMLImageElement | undefined, sleep: HTMLImageElement | undefined, faint: HTMLImageElement | undefined, charge?: HTMLImageElement | undefined, shoot?: HTMLImageElement | undefined }}
 */
export function getResolvedSheets(imageCache, dexId) {
  const { walk, idle, dig, hurt, sleep, faint, charge, shoot, fallbackWalk, fallbackIdle } = getPokemonSheetPaths(dexId);
  const w = imageCache.get(walk) || imageCache.get(fallbackWalk);
  const useDedicatedDig = speciesHasDedicatedDigSheetMeta(dexId);
  const useDedicatedHurt = speciesHasDedicatedSliceMeta(dexId, 'hurt');
  const useDedicatedSleep = speciesHasDedicatedSliceMeta(dexId, 'sleep');
  const useDedicatedFaint = speciesHasDedicatedSliceMeta(dexId, 'faint');
  const useChargeAsset =
    speciesHasDedicatedSliceMeta(dexId, 'charge') && !!(imageCache.get(charge)?.naturalWidth || imageCache.get(charge)?.width);
  const useShootAsset =
    speciesHasDedicatedSliceMeta(dexId, 'shoot') && !!(imageCache.get(shoot)?.naturalWidth || imageCache.get(shoot)?.width);
  const idleSheet = imageCache.get(idle) || imageCache.get(fallbackIdle);
  const digSheet = useDedicatedDig ? imageCache.get(dig) || w : w;
  return {
    walk: w,
    idle: idleSheet,
    /** Walk sheet unless species has PMD `dig` + optional `NNN_dig.png`. */
    dig: digSheet,
    /** Optional sheet for dedicated `hurt` timings/frames, fallback to idle. */
    hurt: useDedicatedHurt
      ? imageCache.get(hurt) || idleSheet
      : idleSheet,
    /** Optional sheet for dedicated `sleep` timings/frames, fallback to idle. */
    sleep: useDedicatedSleep
      ? imageCache.get(sleep) || idleSheet
      : idleSheet,
    /** Optional sheet for dedicated `faint` timings/frames, fallback to idle. */
    faint: useDedicatedFaint
      ? imageCache.get(faint) || idleSheet
      : idleSheet,
    /** Optional `NNN_charge.png` when metadata + file exist. */
    charge: useChargeAsset ? imageCache.get(charge) : undefined,
    /** Optional `NNN_shoot.png` when metadata + file exist. */
    shoot: useShootAsset ? imageCache.get(shoot) : undefined
  };
}
