import { lootSlugForItemKey } from './play-item-inventory-icon.js';

/**
 * Sims-style speech / thought bubble content (rich inline segments).
 *
 * @typedef {'say' | 'think'} SpeechBubbleKind
 *
 * @typedef {{ kind: 'text', text: string }} SpeechBubbleTextSeg
 * @typedef {{ kind: 'emoji', text: string }} SpeechBubbleEmojiSeg
 * @typedef {{ kind: 'item', slug: string, itemKey?: string }} SpeechBubbleItemSeg
 * @typedef {{ kind: 'monsprite' }} SpeechBubbleMonSpriteSeg
 * @typedef {{ kind: 'portrait', slug: string, fallbackEmoji?: string }} SpeechBubblePortraitSeg
 *
 * @typedef {SpeechBubbleTextSeg | SpeechBubbleEmojiSeg | SpeechBubbleItemSeg | SpeechBubbleMonSpriteSeg | SpeechBubblePortraitSeg} SpeechBubbleSegment
 */

/** @param {unknown} v */
export function isSpeechBubbleSegment(v) {
  if (!v || typeof v !== 'object') return false;
  const k = /** @type {{ kind?: string }} */ (v).kind;
  if (k === 'text') return typeof /** @type {{ text?: string }} */ (v).text === 'string';
  if (k === 'emoji') return typeof /** @type {{ text?: string }} */ (v).text === 'string';
  if (k === 'item') {
    const slugOk = typeof /** @type {{ slug?: string }} */ (v).slug === 'string' && /** @type {{ slug?: string }} */ (v).slug.trim().length > 0;
    const itemKeyOk =
      typeof /** @type {{ itemKey?: string }} */ (v).itemKey === 'string' &&
      /** @type {{ itemKey?: string }} */ (v).itemKey.trim().length > 0;
    return slugOk || itemKeyOk;
  }
  if (k === 'monsprite') return true;
  if (k === 'portrait') return typeof /** @type {{ slug?: string }} */ (v).slug === 'string';
  return false;
}

/**
 * @param {unknown} arr
 * @returns {SpeechBubbleSegment[]}
 */
export function normalizeSpeechBubbleSegments(arr) {
  if (!Array.isArray(arr)) return [];
  /** @type {SpeechBubbleSegment[]} */
  const out = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const o = /** @type {Record<string, unknown>} */ (x);
    if (o.kind === 'item') {
      const itemKey = typeof o.itemKey === 'string' ? o.itemKey.trim() : '';
      let slug = typeof o.slug === 'string' ? o.slug.trim().toLowerCase() : '';
      if (!slug && itemKey) slug = lootSlugForItemKey(itemKey) || '';
      if (!slug) continue;
      /** @type {SpeechBubbleItemSeg} */
      const seg = itemKey ? { kind: 'item', slug, itemKey } : { kind: 'item', slug };
      out.push(seg);
      continue;
    }
    if (isSpeechBubbleSegment(x)) out.push(/** @type {SpeechBubbleSegment} */ (x));
  }
  return out;
}
