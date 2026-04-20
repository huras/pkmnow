import { getWildPokemonEntities, setWildSpeechBubble } from '../wild-pokemon/index.js';
import { lootSlugForItemKey } from '../social/play-item-inventory-icon.js';

/** How long the item HUD stays fully opaque after a pickup (ms). */
export const PLAY_ITEM_HUD_PICKUP_OPAQUE_MS = 3200;

/** How long a slot stays in the “pop” state map (ms); should cover the CSS pop animation tail. */
export const PLAY_ITEM_HUD_POP_MS = 1000;

/** Wild mon within this tile radius of the player may react to a ground pickup. */
export const WILD_NOTICE_PLAYER_PICKUP_RADIUS_TILES = 4;

function itemKeyLooksLikeCrystal(itemKey) {
  return String(itemKey || '').toLowerCase().includes('crystal');
}

/**
 * Player ground pickup: HUD flash + slot pop (via `play-item-hud-pickup` event). No player speech bubble.
 * Optionally a nearby wild shows a short thought bubble (only if they are not already in one).
 *
 * @param {{ x?: number, y?: number } | null | undefined} player
 * @param {string} itemKey
 * @param {number} [stack]
 */
export function notifyPlayDetailItemPickupFeedback(player, itemKey, stack = 1) {
  const k = String(itemKey || '');
  window.dispatchEvent(
    new CustomEvent('play-item-hud-pickup', {
      detail: { itemKey: k, stack: Math.max(1, Math.floor(Number(stack) || 1)) }
    })
  );

  const px = Number(player?.x);
  const py = Number(player?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;

  const R = WILD_NOTICE_PLAYER_PICKUP_RADIUS_TILES;
  const r2 = R * R;
  let best = null;
  let bestD2 = Infinity;
  for (const w of getWildPokemonEntities()) {
    if (!w || w._strengthCarryHidden) continue;
    if (w.deadState) continue;
    const wx = Number(w.visualX ?? w.x);
    const wy = Number(w.visualY ?? w.y);
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
    const d2 = (wx - px) * (wx - px) + (wy - py) * (wy - py);
    if (d2 > r2 || d2 >= bestD2) continue;
    bestD2 = d2;
    best = w;
  }
  if (!best) return;
  if (best.speechBubble?.segments?.length) return;

  const slug = lootSlugForItemKey(k) || 'star-piece';
  /** @type {import('../social/speech-bubble-types.js').SpeechBubbleSegment[]} */
  const segs = [
    { kind: 'emoji', text: '👀' },
    { kind: 'text', text: 'Nice find…' }
  ];
  if (itemKeyLooksLikeCrystal(k)) {
    segs.push({ kind: 'item', slug: 'star-piece' });
  } else {
    segs.push({ kind: 'item', slug, itemKey: k });
  }
  setWildSpeechBubble(best, segs, { durationSec: 2.35, kind: 'think' });
}
