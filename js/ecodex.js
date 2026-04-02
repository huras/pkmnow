export const WILD_POKEMON = {
  0: ["Tentacool", "Magikarp", "Staryu", "Horsea"], // OCEAN
  1: ["Krabby", "Slowpoke", "Shellder", "Psyduck"], // BEACH
  2: ["Sandshrew", "Diglett", "Cubone", "Ekans"], // DESERT
  3: ["Pidgey", "Rattata", "Nidoran", "Oddish", "Tauros"], // GRASSLAND
  4: ["Caterpie", "Weedle", "Pikachu", "Bulbasaur", "Pinsir"], // FOREST
  5: ["Bellsprout", "Venonat", "Meowth", "Exeggcute"], // TAIGA
  6: ["Seel", "Drowzee", "Machop", "Magnemite"], // TUNDRA
  7: ["Seel", "Jynx", "Shellder"], // SNOW
  8: ["Lapras", "Dewgong", "Cloyster"], // ICE
  9: ["Doduo", "Rhyhorn", "Mankey", "Spearow"], // SAVANNA
  10: ["Tangela", "Scyther", "Mankey", "Venonat"], // JUNGLE
  11: ["Geodude", "Zubat", "Machop", "Onix", "Clefairy"], // MOUNTAIN
  12: ["Articuno", "Aerodactyl"], // PEAK
  13: ["Magmar", "Ponyta", "Charmander", "Growlithe"], // VOLCANO
  14: ["Gastly", "Haunter", "Zubat", "Grimer"], // GHOST_WOODS
  15: ["Abra", "Porygon", "Mew"], // ARCANE
};

export function getEncounters(biomeId) {
  return WILD_POKEMON[biomeId] || ["MissingNo"];
}
