import { OBJECT_SETS } from '../tessellation-data.js';
import { ensurePokemondbItemIconInCache, getPokemondbItemIconPathMap } from './pokemondb-item-icon-paths.js';

/**
 * Same slug rule as the play item HUD (`character-selector` loot list + crystal row).
 * @param {string} itemKey OBJECT_SETS key or inventory row key
 * @returns {string | null}
 */
export function lootSlugForItemKey(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  const firstTok = (k.split(/\s+/)[0] || '').toLowerCase();
  if (/^[a-z][a-z0-9-]*$/i.test(firstTok)) return firstTok;
  return null;
}

/**
 * Resolves inventory-style icon for a speech bubble `item` segment: Pokémondb PNG when the
 * slug maps in the manifest, otherwise tessellation scatter preview (same fallback as HUD).
 * Mutates `seg` with `_iconPath` and/or `_scatterItemKey` for the renderer.
 *
 * @param {{ kind: 'item', slug: string, itemKey?: string, _iconPath?: string, _scatterItemKey?: string }} seg
 */
export async function ensureInventoryStyleItemIconOnSpeechSegment(seg) {
  delete seg._iconPath;
  delete seg._scatterItemKey;

  const itemKeyFull = seg.itemKey ? String(seg.itemKey).trim() : '';
  const slugFromKey = itemKeyFull ? lootSlugForItemKey(itemKeyFull) : null;
  const slugRaw = String(seg.slug || '').trim().toLowerCase();
  const slug = slugFromKey || slugRaw;

  const m = await getPokemondbItemIconPathMap();
  if (slug && m.get(slug)) {
    const r = await ensurePokemondbItemIconInCache(slug);
    if (r?.path) {
      seg._iconPath = r.path;
      return;
    }
  }

  if (itemKeyFull && OBJECT_SETS[itemKeyFull]) {
    seg._scatterItemKey = itemKeyFull;
    return;
  }

  if (slugRaw && OBJECT_SETS[slugRaw]) {
    seg._scatterItemKey = slugRaw;
  }
}
