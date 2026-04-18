import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { ensureSpriteCollabPortraitLoaded } from '../pokemon/spritecollab-portraits.js';
import { imageCache } from '../image-cache.js';
import { ensurePokemondbItemIconInCache } from './pokemondb-item-icon-paths.js';
import { normalizeSpeechBubbleSegments } from './speech-bubble-types.js';

const DEFAULT_DURATION_SEC = 4.25;

/**
 * @param {import('./speech-bubble-types.js').SpeechBubbleSegment[]} segments
 */
async function preloadSpeechBubbleAssets(entity, segments) {
  const dex = Math.max(1, Math.floor(Number(entity?.dexId) || 1));
  let needMon = false;
  const jobs = [];
  for (const s of segments) {
    if (s.kind === 'item') {
      jobs.push(
        ensurePokemondbItemIconInCache(s.slug).then((r) => {
          if (r?.path) /** @type {{ _iconPath?: string }} */ (s)._iconPath = r.path;
        })
      );
    }
    if (s.kind === 'portrait') {
      const slug = String(/** @type {{ slug?: string }} */ (s).slug || 'Normal')
        .replace(/[^\w.-]/g, '')
        .trim() || 'Normal';
      jobs.push(ensureSpriteCollabPortraitLoaded(imageCache, dex, slug));
    }
    if (s.kind === 'monsprite') needMon = true;
  }
  await Promise.all(jobs);
  if (needMon) await ensurePokemonSheetsLoaded(imageCache, dex);
}

/**
 * Rich Sims-style bubble (rounded panel + tail). Mutually exclusive with classic `wildEmotion` in the collector when active.
 *
 * @param {object} entity wild entity
 * @param {import('./speech-bubble-types.js').SpeechBubbleSegment[]} segments
 * @param {{ durationSec?: number, kind?: import('./speech-bubble-types.js').SpeechBubbleKind }} [opts]
 */
export function setWildSpeechBubble(entity, segments, opts = {}) {
  if (!entity) return;
  const norm = normalizeSpeechBubbleSegments(segments);
  if (!norm.length) {
    entity.speechBubble = null;
    return;
  }
  const durationSec = Math.max(0.6, Number(opts.durationSec) || DEFAULT_DURATION_SEC);
  const kind = opts.kind === 'think' ? 'think' : 'say';
  entity.speechBubble = {
    segments: norm,
    ageSec: 0,
    durationSec,
    kind
  };
  void preloadSpeechBubbleAssets(entity, norm);
}

/** @param {object} entity */
export function clearWildSpeechBubble(entity) {
  if (entity) entity.speechBubble = null;
}

/**
 * @param {{ speechBubble?: object | null } | null | undefined} player
 * @param {import('./speech-bubble-types.js').SpeechBubbleSegment[]} segments
 * @param {{ durationSec?: number, kind?: import('./speech-bubble-types.js').SpeechBubbleKind }} [opts]
 */
export function setPlayerSpeechBubble(player, segments, opts = {}) {
  if (!player) return;
  const norm = normalizeSpeechBubbleSegments(segments);
  if (!norm.length) {
    player.speechBubble = null;
    return;
  }
  const durationSec = Math.max(0.6, Number(opts.durationSec) || DEFAULT_DURATION_SEC);
  const kind = opts.kind === 'think' ? 'think' : 'say';
  player.speechBubble = {
    segments: norm,
    ageSec: 0,
    durationSec,
    kind
  };
  void preloadSpeechBubbleAssets(player, norm);
}

/** @param {{ speechBubble?: object | null } | null | undefined} player */
export function clearPlayerSpeechBubble(player) {
  if (player) player.speechBubble = null;
}

/** @param {{ speechBubble?: object | null } | null | undefined} player */
export function advancePlayerSpeechBubble(player, dt) {
  const b = player?.speechBubble;
  if (!b) return;
  b.ageSec = (b.ageSec || 0) + Math.max(0, dt);
  if (b.ageSec >= (b.durationSec || DEFAULT_DURATION_SEC)) {
    player.speechBubble = null;
  }
}

/**
 * Short “got item” bubble over the player (scatter / crystal drop pickups).
 * @param {{ speechBubble?: object | null } | null | undefined} player
 * @param {string} itemKey
 * @param {number} [stack]
 */
export function setPlayerSpeechBubbleForDetailPickup(player, itemKey, stack = 1) {
  if (!player) return;
  const k = String(itemKey || '');
  const n = Math.max(1, Math.floor(Number(stack) || 1));
  const crystal = k.toLowerCase().includes('crystal');
  const firstTok = k.split(/\s+/)[0] || '';
  const slugCand = firstTok.toLowerCase();
  const label = k
    .replace(/\s*\[[^\]]*\]\s*/g, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .slice(0, 24);

  /** @type {import('./speech-bubble-types.js').SpeechBubbleSegment[]} */
  const segs = [];
  const iconSlug = crystal
    ? 'star-piece'
    : /^[a-z][a-z0-9-]*$/i.test(slugCand)
      ? slugCand
      : null;
  if (iconSlug) segs.push({ kind: 'item', slug: iconSlug });
  else if (label) segs.push({ kind: 'text', text: label });
  segs.push({ kind: 'text', text: n > 1 ? `×${n}` : 'Got it!' });
  setPlayerSpeechBubble(player, segs, { durationSec: 1.85, kind: 'say' });
}

/** @param {object} entity */
export function advanceWildSpeechBubble(entity, dt) {
  const b = entity?.speechBubble;
  if (!b) return;
  b.ageSec = (b.ageSec || 0) + Math.max(0, dt);
  if (b.ageSec >= (b.durationSec || DEFAULT_DURATION_SEC)) {
    entity.speechBubble = null;
  }
}
