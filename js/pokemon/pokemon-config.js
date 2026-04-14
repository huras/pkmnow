/**
 * Gen 1 (#1–151) species data for gameplay tuning (height, motion, type logic).
 * Regenerate: `node scripts/build-pokemon-config.mjs` (needs network).
 *
 * @typedef {'bug'|'dark'|'dragon'|'electric'|'fairy'|'fighting'|'fire'|'flying'|'ghost'|'grass'|'ground'|'ice'|'normal'|'poison'|'psychic'|'rock'|'steel'|'water'} PokemonTypeSlug
 *
 * @typedef {Object} PokemonBehaviorTuning
 * @property {number} [walkSpeedMul] — multiply walk tick scale (1 = default)
 * @property {number} [scatterWeight] — encounter / prop scatter preference weight
 * @property {number} [turnBias] — −1..1 AI turn randomness bias (reserved)
 *
 * @typedef {Object} PokemonSpeciesConfig
 * @property {string} name — matches `gen1-name-to-dex.js` encounter strings where possible
 * @property {PokemonTypeSlug[]} types — slot order primary → secondary; Gen 1 chart overrides baked in (see script)
 * @property {number} heightTiles — visual / collider height in tile units (from former `pokemon-heights.js`)
 * @property {number} baseSpeed — main-series base Speed (for motion / turn order tuning)
 * @property {PokemonBehaviorTuning} [behavior] — optional per-species behavior overrides
 */

/** @type {Record<number, PokemonSpeciesConfig>} */
export const POKEMON_CONFIG = {
  1: { name: 'Bulbasaur', types: ['grass', 'poison'], heightTiles: 2.1, baseSpeed: 45 },
  2: { name: 'Ivysaur', types: ['grass', 'poison'], heightTiles: 2.2, baseSpeed: 60 },
  3: { name: 'Venusaur', types: ['grass', 'poison'], heightTiles: 2.5, baseSpeed: 80 },
  4: { name: 'Charmander', types: ['fire'], heightTiles: 2.5, baseSpeed: 65 },
  5: { name: 'Charmeleon', types: ['fire'], heightTiles: 3.5, baseSpeed: 80 },
  6: { name: 'Charizard', types: ['fire', 'flying'], heightTiles: 3.5, baseSpeed: 100 },
  7: { name: 'Squirtle', types: ['water'], heightTiles: 1.5, baseSpeed: 43 },
  8: { name: 'Wartortle', types: ['water'], heightTiles: 2.5, baseSpeed: 58 },
  9: { name: 'Blastoise', types: ['water'], heightTiles: 3.1, baseSpeed: 78 },
  10: { name: 'Caterpie', types: ['bug'], heightTiles: 2, baseSpeed: 45 },
  11: { name: 'Metapod', types: ['bug'], heightTiles: 2.1, baseSpeed: 30 },
  12: { name: 'Butterfree', types: ['bug', 'flying'], heightTiles: 3.3, baseSpeed: 70 },
  13: { name: 'Weedle', types: ['bug', 'poison'], heightTiles: 2.5, baseSpeed: 50 },
  14: { name: 'Kakuna', types: ['bug', 'poison'], heightTiles: 2.5, baseSpeed: 35 },
  15: { name: 'Beedrill', types: ['bug', 'poison'], heightTiles: 3, baseSpeed: 75 },
  16: { name: 'Pidgey', types: ['normal', 'flying'], heightTiles: 2, baseSpeed: 56 },
  17: { name: 'Pidgeotto', types: ['normal', 'flying'], heightTiles: 3.2, baseSpeed: 71 },
  18: { name: 'Pidgeot', types: ['normal', 'flying'], heightTiles: 3.7, baseSpeed: 101 },
  19: { name: 'Rattata', types: ['normal'], heightTiles: 1.6, baseSpeed: 72 },
  20: { name: 'Raticate', types: ['normal'], heightTiles: 3.5, baseSpeed: 97 },
  21: { name: 'Spearow', types: ['normal', 'flying'], heightTiles: 2.5, baseSpeed: 70 },
  22: { name: 'Fearow', types: ['normal', 'flying'], heightTiles: 5.2, baseSpeed: 100 },
  23: { name: 'Ekans', types: ['poison'], heightTiles: 2.5, baseSpeed: 55 },
  24: { name: 'Arbok', types: ['poison'], heightTiles: 3.5, baseSpeed: 80 },
  25: { name: 'Pikachu', types: ['electric'], heightTiles: 2.9, baseSpeed: 90 },
  26: { name: 'Raichu', types: ['electric'], heightTiles: 3.5, baseSpeed: 110 },
  27: { name: 'Sandshrew', types: ['ground'], heightTiles: 2.5, baseSpeed: 40 },
  28: { name: 'Sandslash', types: ['ground'], heightTiles: 3, baseSpeed: 65 },
  29: { name: 'Nidoran♀', types: ['poison'], heightTiles: 2.5, baseSpeed: 41 },
  30: { name: 'Nidorina', types: ['poison'], heightTiles: 3.5, baseSpeed: 56 },
  31: { name: 'Nidoqueen', types: ['poison', 'ground'], heightTiles: 3.5, baseSpeed: 76 },
  32: { name: 'Nidoran♂', types: ['poison'], heightTiles: 2.5, baseSpeed: 50 },
  33: { name: 'Nidorino', types: ['poison'], heightTiles: 2.9, baseSpeed: 65 },
  34: { name: 'Nidoking', types: ['poison', 'ground'], heightTiles: 3.6, baseSpeed: 85 },
  35: { name: 'Clefairy', types: ['normal'], heightTiles: 2.5, baseSpeed: 35 },
  36: { name: 'Clefable', types: ['normal'], heightTiles: 3.5, baseSpeed: 60 },
  37: { name: 'Vulpix', types: ['fire'], heightTiles: 1.7, baseSpeed: 65 },
  38: { name: 'Ninetales', types: ['fire'], heightTiles: 3.1, baseSpeed: 100 },
  39: { name: 'Jigglypuff', types: ['normal'], heightTiles: 2.1, baseSpeed: 20 },
  40: { name: 'Wigglytuff', types: ['normal'], heightTiles: 3.5, baseSpeed: 45 },
  41: { name: 'Zubat', types: ['poison', 'flying'], heightTiles: 2.7, baseSpeed: 55 },
  42: { name: 'Golbat', types: ['poison', 'flying'], heightTiles: 4.1, baseSpeed: 90 },
  43: { name: 'Oddish', types: ['grass', 'poison'], heightTiles: 2, baseSpeed: 30 },
  44: { name: 'Gloom', types: ['grass', 'poison'], heightTiles: 2.1, baseSpeed: 40 },
  45: { name: 'Vileplume', types: ['grass', 'poison'], heightTiles: 3.5, baseSpeed: 50 },
  46: { name: 'Paras', types: ['bug', 'grass'], heightTiles: 1.5, baseSpeed: 25 },
  47: { name: 'Parasect', types: ['bug', 'grass'], heightTiles: 3.5, baseSpeed: 30 },
  48: { name: 'Venonat', types: ['bug', 'poison'], heightTiles: 2.5, baseSpeed: 45 },
  49: { name: 'Venomoth', types: ['bug', 'poison'], heightTiles: 4.1, baseSpeed: 90 },
  50: { name: 'Diglett', types: ['ground'], heightTiles: 1.2, baseSpeed: 95 },
  51: { name: 'Dugtrio', types: ['ground'], heightTiles: 1.8, baseSpeed: 120 },
  52: { name: 'Meowth', types: ['normal'], heightTiles: 2, baseSpeed: 90 },
  53: { name: 'Persian', types: ['normal'], heightTiles: 3.8, baseSpeed: 115 },
  54: { name: 'Psyduck', types: ['water'], heightTiles: 2.5, baseSpeed: 55 },
  55: { name: 'Golduck', types: ['water'], heightTiles: 2.7, baseSpeed: 85 },
  56: { name: 'Mankey', types: ['fighting'], heightTiles: 3.2, baseSpeed: 70 },
  57: { name: 'Primeape', types: ['fighting'], heightTiles: 4.7, baseSpeed: 95 },
  58: { name: 'Growlithe', types: ['fire'], heightTiles: 2.5, baseSpeed: 60 },
  59: { name: 'Arcanine', types: ['fire'], heightTiles: 3.5, baseSpeed: 95 },
  60: { name: 'Poliwag', types: ['water'], heightTiles: 2.5, baseSpeed: 90 },
  61: { name: 'Poliwhirl', types: ['water'], heightTiles: 3.5, baseSpeed: 90 },
  62: { name: 'Poliwrath', types: ['water', 'fighting'], heightTiles: 4.1, baseSpeed: 70 },
  63: { name: 'Abra', types: ['psychic'], heightTiles: 2.5, baseSpeed: 90 },
  64: { name: 'Kadabra', types: ['psychic'], heightTiles: 3.5, baseSpeed: 105 },
  65: { name: 'Alakazam', types: ['psychic'], heightTiles: 4, baseSpeed: 120 },
  66: { name: 'Machop', types: ['fighting'], heightTiles: 2.2, baseSpeed: 35 },
  67: { name: 'Machoke', types: ['fighting'], heightTiles: 3.5, baseSpeed: 45 },
  68: { name: 'Machamp', types: ['fighting'], heightTiles: 3.5, baseSpeed: 55 },
  69: { name: 'Bellsprout', types: ['grass', 'poison'], heightTiles: 2.15, baseSpeed: 40 },
  70: { name: 'Weepinbell', types: ['grass', 'poison'], heightTiles: 3.1, baseSpeed: 55 },
  71: { name: 'Victreebel', types: ['grass', 'poison'], heightTiles: 5.7, baseSpeed: 70 },
  72: { name: 'Tentacool', types: ['water', 'poison'], heightTiles: 2.5, baseSpeed: 70 },
  73: { name: 'Tentacruel', types: ['water', 'poison'], heightTiles: 7.9, baseSpeed: 100 },
  74: { name: 'Geodude', types: ['rock', 'ground'], heightTiles: 1.3, baseSpeed: 20 },
  75: { name: 'Graveler', types: ['rock', 'ground'], heightTiles: 3.1, baseSpeed: 35 },
  76: { name: 'Golem', types: ['rock', 'ground'], heightTiles: 3.2, baseSpeed: 45 },
  77: { name: 'Ponyta', types: ['fire'], heightTiles: 2.6, baseSpeed: 90 },
  78: { name: 'Rapidash', types: ['fire'], heightTiles: 3.9, baseSpeed: 105 },
  79: { name: 'Slowpoke', types: ['water', 'psychic'], heightTiles: 2.5, baseSpeed: 15 },
  80: { name: 'Slowbro', types: ['water', 'psychic'], heightTiles: 3.5, baseSpeed: 30 },
  81: { name: 'Magnemite', types: ['electric'], heightTiles: 2.4, baseSpeed: 45 },
  82: { name: 'Magneton', types: ['electric'], heightTiles: 3.1, baseSpeed: 70 },
  83: { name: 'Farfetch\'d', types: ['normal', 'flying'], heightTiles: 2.1, baseSpeed: 60 },
  84: { name: 'Doduo', types: ['normal', 'flying'], heightTiles: 2.5, baseSpeed: 75 },
  85: { name: 'Dodrio', types: ['normal', 'flying'], heightTiles: 4.2, baseSpeed: 110 },
  86: { name: 'Seel', types: ['water'], heightTiles: 2, baseSpeed: 45 },
  87: { name: 'Dewgong', types: ['water', 'ice'], heightTiles: 3.1, baseSpeed: 70 },
  88: { name: 'Grimer', types: ['poison'], heightTiles: 2.5, baseSpeed: 25 },
  89: { name: 'Muk', types: ['poison'], heightTiles: 4.8, baseSpeed: 50 },
  90: { name: 'Shellder', types: ['water'], heightTiles: 2.2, baseSpeed: 40 },
  91: { name: 'Cloyster', types: ['water', 'ice'], heightTiles: 4.3, baseSpeed: 70 },
  92: { name: 'Gastly', types: ['ghost', 'poison'], heightTiles: 2.5, baseSpeed: 80 },
  93: { name: 'Haunter', types: ['ghost', 'poison'], heightTiles: 3.5, baseSpeed: 95 },
  94: { name: 'Gengar', types: ['ghost', 'poison'], heightTiles: 3.1, baseSpeed: 110 },
  95: { name: 'Onix', types: ['rock', 'ground'], heightTiles: 9, baseSpeed: 70 },
  96: { name: 'Drowzee', types: ['psychic'], heightTiles: 2.7, baseSpeed: 42 },
  97: { name: 'Hypno', types: ['psychic'], heightTiles: 3.8, baseSpeed: 67 },
  98: { name: 'Krabby', types: ['water'], heightTiles: 2.5, baseSpeed: 50 },
  99: { name: 'Kingler', types: ['water'], heightTiles: 4.9, baseSpeed: 75 },
  100: { name: 'Voltorb', types: ['electric'], heightTiles: 2.5, baseSpeed: 100 },
  101: { name: 'Electrode', types: ['electric'], heightTiles: 3.5, baseSpeed: 150 },
  102: { name: 'Exeggcute', types: ['grass', 'psychic'], heightTiles: 2.5, baseSpeed: 40 },
  103: { name: 'Exeggutor', types: ['grass', 'psychic'], heightTiles: 4.2, baseSpeed: 55 },
  104: { name: 'Cubone', types: ['ground'], heightTiles: 2.5, baseSpeed: 35 },
  105: { name: 'Marowak', types: ['ground'], heightTiles: 3.5, baseSpeed: 45 },
  106: { name: 'Hitmonlee', types: ['fighting'], heightTiles: 3.2, baseSpeed: 87 },
  107: { name: 'Hitmonchan', types: ['fighting'], heightTiles: 4.3, baseSpeed: 76 },
  108: { name: 'Lickitung', types: ['normal'], heightTiles: 3.5, baseSpeed: 30 },
  109: { name: 'Koffing', types: ['poison'], heightTiles: 3.2, baseSpeed: 35 },
  110: { name: 'Weezing', types: ['poison'], heightTiles: 4.2, baseSpeed: 60 },
  111: { name: 'Rhyhorn', types: ['ground', 'rock'], heightTiles: 2.5, baseSpeed: 25 },
  112: { name: 'Rhydon', types: ['ground', 'rock'], heightTiles: 3.9, baseSpeed: 40 },
  113: { name: 'Chansey', types: ['normal'], heightTiles: 3.5, baseSpeed: 50 },
  114: { name: 'Tangela', types: ['grass'], heightTiles: 2.6, baseSpeed: 60 },
  115: { name: 'Kangaskhan', types: ['normal'], heightTiles: 4.7, baseSpeed: 90 },
  116: { name: 'Horsea', types: ['water'], heightTiles: 3.2, baseSpeed: 60 },
  117: { name: 'Seadra', types: ['water'], heightTiles: 4.5, baseSpeed: 85 },
  118: { name: 'Goldeen', types: ['water'], heightTiles: 2.5, baseSpeed: 63 },
  119: { name: 'Seaking', types: ['water'], heightTiles: 3.5, baseSpeed: 68 },
  120: { name: 'Staryu', types: ['water'], heightTiles: 1.9, baseSpeed: 85 },
  121: { name: 'Starmie', types: ['water', 'psychic'], heightTiles: 3.5, baseSpeed: 115 },
  122: { name: 'Mr. Mime', types: ['psychic'], heightTiles: 3.5, baseSpeed: 90 },
  123: { name: 'Scyther', types: ['bug', 'flying'], heightTiles: 3.5, baseSpeed: 105 },
  124: { name: 'Jynx', types: ['ice', 'psychic'], heightTiles: 2.3, baseSpeed: 95 },
  125: { name: 'Electabuzz', types: ['electric'], heightTiles: 3.5, baseSpeed: 105 },
  126: { name: 'Magmar', types: ['fire'], heightTiles: 3.5, baseSpeed: 93 },
  127: { name: 'Pinsir', types: ['bug'], heightTiles: 3.1, baseSpeed: 85 },
  128: { name: 'Tauros', types: ['normal'], heightTiles: 3.4, baseSpeed: 110 },
  129: { name: 'Magikarp', types: ['water'], heightTiles: 1.5, baseSpeed: 80 },
  130: { name: 'Gyarados', types: ['water', 'flying'], heightTiles: 8, baseSpeed: 81 },
  131: { name: 'Lapras', types: ['water', 'ice'], heightTiles: 3.5, baseSpeed: 60 },
  132: { name: 'Ditto', types: ['normal'], heightTiles: 2, baseSpeed: 48 },
  133: { name: 'Eevee', types: ['normal'], heightTiles: 1.9, baseSpeed: 55 },
  134: { name: 'Vaporeon', types: ['water'], heightTiles: 3, baseSpeed: 65 },
  135: { name: 'Jolteon', types: ['electric'], heightTiles: 3, baseSpeed: 130 },
  136: { name: 'Flareon', types: ['fire'], heightTiles: 2.5, baseSpeed: 65 },
  137: { name: 'Porygon', types: ['normal'], heightTiles: 2.5, baseSpeed: 40 },
  138: { name: 'Omanyte', types: ['rock', 'water'], heightTiles: 2.1, baseSpeed: 35 },
  139: { name: 'Omastar', types: ['rock', 'water'], heightTiles: 3, baseSpeed: 55 },
  140: { name: 'Kabuto', types: ['rock', 'water'], heightTiles: 1.5, baseSpeed: 55 },
  141: { name: 'Kabutops', types: ['rock', 'water'], heightTiles: 3.5, baseSpeed: 80 },
  142: { name: 'Aerodactyl', types: ['rock', 'flying'], heightTiles: 4.5, baseSpeed: 130 },
  143: { name: 'Snorlax', types: ['normal'], heightTiles: 6.2, baseSpeed: 30 },
  144: { name: 'Articuno', types: ['ice', 'flying'], heightTiles: 7, baseSpeed: 85 },
  145: { name: 'Zapdos', types: ['electric', 'flying'], heightTiles: 7, baseSpeed: 100 },
  146: { name: 'Moltres', types: ['fire', 'flying'], heightTiles: 7, baseSpeed: 90 },
  147: { name: 'Dratini', types: ['dragon'], heightTiles: 2, baseSpeed: 50 },
  148: { name: 'Dragonair', types: ['dragon'], heightTiles: 3, baseSpeed: 70 },
  149: { name: 'Dragonite', types: ['dragon', 'flying'], heightTiles: 4.4, baseSpeed: 80 },
  150: { name: 'Mewtwo', types: ['psychic'], heightTiles: 4.1, baseSpeed: 130 },
  151: { name: 'Mew', types: ['psychic'], heightTiles: 3.5, baseSpeed: 100 },
};

const _heightEntries = Object.entries(POKEMON_CONFIG).map(([dex, c]) => [
  Number(dex),
  c.heightTiles
]);

/** @type {Record<number, number>} — dex → tile height (same keys as legacy `pokemon-heights.js`) */
export const POKEMON_HEIGHTS = Object.fromEntries(_heightEntries);

/**
 * @param {number} dexId
 * @returns {PokemonSpeciesConfig & { dexId: number, behavior: PokemonBehaviorTuning } | null}
 */
export function getPokemonConfig(dexId) {
  const n = Number(dexId);
  if (!Number.isFinite(n)) return null;
  const dex = Math.floor(n);
  if (dex < 1 || dex > 151) return null;
  const row = POKEMON_CONFIG[dex];
  if (!row) return null;
  const behavior = {
    walkSpeedMul: 1,
    scatterWeight: 1,
    turnBias: 0,
    ...(row.behavior || {})
  };
  return { dexId: dex, ...row, behavior };
}

