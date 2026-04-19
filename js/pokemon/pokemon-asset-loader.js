import { padDex3 } from './gen1-name-to-dex.js';
import { getDexAnimMeta } from './pmd-anim-metadata.js';

const FALLBACK_WALK = 'tilesets/gengar_walk.png';
const FALLBACK_IDLE = 'tilesets/gengar_idle.png';
const tumblePathByDex = new Map();
const tumbleProbeInflight = new Map();

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

function tumbleBaseCandidates() {
  const out = [];
  const push = (v) => {
    if (typeof v !== 'string') return;
    const s = v.trim().replace(/[\\/]+$/, '');
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };
  push(globalThis?.window?.__SPRITECOLLAB_SPRITE_BASE__);
  push('tilesets/spritecollab-sprite');
  push('../SpriteCollab/sprite');
  push('../../SpriteCollab/sprite');
  return out;
}

function probeImageUrl(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

async function probeSpriteCollabTumblePath(dexId) {
  const dNum = Math.floor(Number(dexId) || 0);
  if (dNum < 1 || dNum > 9999) return null;
  const d = padDex3(dNum);
  const d4 = String(dNum).padStart(4, '0');
  if (tumblePathByDex.has(d)) return tumblePathByDex.get(d) || null;
  const existing = tumbleProbeInflight.get(d);
  if (existing) return existing;

  const p = (async () => {
    const candidates = tumbleBaseCandidates();
    // Probe all candidates concurrently to avoid sequential HTTP waits
    const results = await Promise.all(
      candidates.map(async (base) => {
        const src = `${base}/${d4}/Tumble-Anim.png`;
        const ok = await probeImageUrl(src);
        return ok ? src : null;
      })
    );
    // Find the first successful source
    const found = results.find((r) => r !== null) || null;
    tumblePathByDex.set(d, found);
    tumbleProbeInflight.delete(d);
    return found;
  })();
  tumbleProbeInflight.set(d, p);
  return p;
}

/**
 * Lazy-load species sheets (same layout as Gengar). Missing files fall back to Gengar assets.
 * @param {Map<string, HTMLImageElement>} imageCache same as render.imageCache
 * @param {number} dexId national dex; missing sheets fall back to Gengar
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
  const attack = `tilesets/pokemon/${id}_attack.png`;
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
  if (speciesHasDedicatedSliceMeta(dexId, 'attack')) {
    tasks.push(loadOptionalSheet(imageCache, attack));
  }
  tasks.push(
    probeSpriteCollabTumblePath(dexId).then((src) => {
      if (!src) return;
      return loadOptionalSheet(imageCache, src);
    })
  );
  return Promise.all(tasks);
}

export function getPokemonSheetPaths(dexId) {
  const id = padDex3(dexId);
  const tumble = tumblePathByDex.get(id) || null;
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
    attack: `tilesets/pokemon/${id}_attack.png`,
    tumble,
    fallbackWalk: FALLBACK_WALK,
    fallbackIdle: FALLBACK_IDLE
  };
}

/**
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} dexId
 * @returns {{ walk: HTMLImageElement | undefined, idle: HTMLImageElement | undefined, dig: HTMLImageElement | undefined, hurt: HTMLImageElement | undefined, sleep: HTMLImageElement | undefined, faint: HTMLImageElement | undefined, tumble?: HTMLImageElement | undefined, charge?: HTMLImageElement | undefined, shoot?: HTMLImageElement | undefined, attack?: HTMLImageElement | undefined }}
 */
export function getResolvedSheets(imageCache, dexId) {
  const { walk, idle, dig, hurt, sleep, faint, tumble, charge, shoot, attack, fallbackWalk, fallbackIdle } =
    getPokemonSheetPaths(dexId);
  const w = imageCache.get(walk) || imageCache.get(fallbackWalk);
  const useDedicatedDig = speciesHasDedicatedDigSheetMeta(dexId);
  const useDedicatedHurt = speciesHasDedicatedSliceMeta(dexId, 'hurt');
  const useDedicatedSleep = speciesHasDedicatedSliceMeta(dexId, 'sleep');
  const useDedicatedFaint = speciesHasDedicatedSliceMeta(dexId, 'faint');
  const useChargeAsset =
    speciesHasDedicatedSliceMeta(dexId, 'charge') && !!(imageCache.get(charge)?.naturalWidth || imageCache.get(charge)?.width);
  const useShootAsset =
    speciesHasDedicatedSliceMeta(dexId, 'shoot') && !!(imageCache.get(shoot)?.naturalWidth || imageCache.get(shoot)?.width);
  const useAttackAsset =
    speciesHasDedicatedSliceMeta(dexId, 'attack') && !!(imageCache.get(attack)?.naturalWidth || imageCache.get(attack)?.width);
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
    /** Optional SpriteCollab tumble sheet (`.../sprite/NNN/Tumble-Anim.png`). */
    tumble: tumble ? imageCache.get(tumble) : undefined,
    /** Optional `NNN_charge.png` when metadata + file exist. */
    charge: useChargeAsset ? imageCache.get(charge) : undefined,
    /** Optional `NNN_shoot.png` when metadata + file exist. */
    shoot: useShootAsset ? imageCache.get(shoot) : undefined,
    /** Optional `NNN_attack.png` when metadata + file exist. */
    attack: useAttackAsset ? imageCache.get(attack) : undefined
  };
}

/**
 * Which sheet + PMD slice name to draw for LMB “attack” (shoot → charge → walk).
 * @param {number} dexId
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {{ walk?: HTMLImageElement, idle?: HTMLImageElement, charge?: HTMLImageElement, shoot?: HTMLImageElement, attack?: HTMLImageElement }} r from {@link getResolvedSheets}
 * @returns {{ sheet: HTMLImageElement | undefined, slice: 'shoot' | 'charge' | 'walk' | 'attack' }}
 */
export function resolvePlayerLmbAttackSheetAndSlice(dexId, imageCache, r) {
  const meta = getDexAnimMeta(dexId);
  if (meta?.attack && speciesHasDedicatedSliceMeta(dexId, 'attack')) {
    const sheet = r.attack;
    if (sheet && (sheet.naturalWidth || sheet.width)) return { sheet, slice: 'attack' };
  }
  if (meta?.shoot && r.shoot) return { sheet: r.shoot, slice: 'shoot' };
  if (meta?.charge && r.charge) return { sheet: r.charge, slice: 'charge' };
  return { sheet: r.walk, slice: 'walk' };
}
