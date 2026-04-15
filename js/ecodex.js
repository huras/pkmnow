export const WILD_POKEMON = {
  0: ["Tentacool", "Magikarp", "Staryu", "Horsea", "Shellder", "Krabby", "Slowpoke"], // OCEAN
  1: ["Krabby", "Slowpoke", "Shellder", "Psyduck", "Tentacool", "Horsea", "Staryu"], // BEACH
  2: ["Sandshrew", "Diglett", "Cubone", "Ekans", "Rhyhorn", "Machop", "Geodude"], // DESERT
  3: ["Pidgey", "Rattata", "Nidoran", "Oddish", "Tauros", "Spearow", "Paras", "Venonat", "Bellsprout"], // GRASSLAND
  4: ["Caterpie", "Weedle", "Pikachu", "Bulbasaur", "Pinsir", "Oddish", "Paras", "Exeggcute", "Zubat"], // FOREST
  5: ["Bellsprout", "Venonat", "Meowth", "Exeggcute", "Oddish", "Pidgey", "Zubat", "Ekans"], // TAIGA
  6: ["Seel", "Drowzee", "Machop", "Magnemite", "Shellder", "Jynx", "Psyduck"], // TUNDRA
  7: ["Seel", "Jynx", "Shellder", "Dewgong", "Slowpoke", "Magikarp"], // SNOW
  8: ["Lapras", "Dewgong", "Cloyster", "Jynx", "Seel", "Shellder"], // ICE
  9: ["Doduo", "Rhyhorn", "Mankey", "Spearow", "Tauros", "Ekans", "Sandshrew", "Growlithe"], // SAVANNA
  10: ["Tangela", "Scyther", "Mankey", "Venonat", "Paras", "Bellsprout", "Meowth", "Ekans"], // JUNGLE
  11: ["Geodude", "Zubat", "Machop", "Onix", "Clefairy", "Sandshrew", "Rhyhorn", "Mankey", "Diglett"], // MOUNTAIN
  12: ["Articuno", "Aerodactyl", "Zapdos", "Moltres", "Dragonite", "Dewgong"], // PEAK
  13: ["Magmar", "Ponyta", "Charmander", "Growlithe", "Geodude", "Mankey", "Vulpix"], // VOLCANO
  14: ["Gastly", "Haunter", "Zubat", "Grimer", "Cubone", "Drowzee"], // GHOST_WOODS
  15: ["Abra", "Porygon", "Mew", "Drowzee", "Slowpoke", "Mr. Mime", "Kadabra"], // ARCANE
};

export function getEncounters(biomeId) {
  return WILD_POKEMON[biomeId] || ["MissingNo"];
}
