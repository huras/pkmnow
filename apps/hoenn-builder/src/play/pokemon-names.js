/**
 * @fileoverview Mini lookup of national-dex names for the play-mode HUD and
 * species picker. Intentionally small — only the most recognizable mons so
 * the picker stays short. Full registry lives in
 * `js/pokemon/national-dex-registry.js` if we ever need the whole 493 list.
 */

/** @type {Record<number, string>} */
export const POKEMON_NAMES = {
  1: 'Bulbasaur',
  4: 'Charmander',
  7: 'Squirtle',
  19: 'Rattata',
  25: 'Pikachu',
  35: 'Clefairy',
  39: 'Jigglypuff',
  54: 'Psyduck',
  58: 'Growlithe',
  63: 'Abra',
  74: 'Geodude',
  92: 'Gastly',
  94: 'Gengar',
  104: 'Cubone',
  131: 'Lapras',
  133: 'Eevee',
  143: 'Snorlax',
  150: 'Mewtwo',
  151: 'Mew',
  155: 'Cyndaquil',
  158: 'Totodile',
  172: 'Pichu',
  196: 'Espeon',
  197: 'Umbreon',
  252: 'Treecko',
  255: 'Torchic',
  258: 'Mudkip',
  302: 'Sableye',
  390: 'Chimchar',
};

/** Default dex used when nothing else is picked (matches main game). */
export const DEFAULT_PLAYER_DEX_ID = 4; // Charmander

/** Featured picks shown in the species select; sorted by dex. */
export const FEATURED_DEX_IDS = Object.keys(POKEMON_NAMES)
  .map((n) => Number(n))
  .sort((a, b) => a - b);

/** Display name for `dexId`, falls back to `"#NNN"`. */
export function getPokemonName(dexId) {
  const d = Math.max(1, Math.floor(Number(dexId) || 0));
  return POKEMON_NAMES[d] || `#${String(d).padStart(3, '0')}`;
}
