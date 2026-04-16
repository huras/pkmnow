/**
 * Sims-style speech / thought bubble content (rich inline segments).
 *
 * @typedef {'say' | 'think'} SpeechBubbleKind
 *
 * @typedef {{ kind: 'text', text: string }} SpeechBubbleTextSeg
 * @typedef {{ kind: 'emoji', text: string }} SpeechBubbleEmojiSeg
 * @typedef {{ kind: 'item', slug: string }} SpeechBubbleItemSeg
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
  if (k === 'item') return typeof /** @type {{ slug?: string }} */ (v).slug === 'string';
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
    if (isSpeechBubbleSegment(x)) out.push(/** @type {SpeechBubbleSegment} */ (x));
  }
  return out;
}
