export const WILD_POKEMON = {
  0: ['Tentacool', 'Magikarp', 'Staryu', 'Horsea', 'Shellder', 'Krabby', 'Slowpoke', 'Chinchou', 'Wooper', 'Remoraid'], // OCEAN
  1: ['Krabby', 'Slowpoke', 'Shellder', 'Psyduck', 'Tentacool', 'Horsea', 'Staryu', 'Marill', 'Wooper', 'Corsola'], // BEACH
  2: ['Sandshrew', 'Diglett', 'Cubone', 'Ekans', 'Rhyhorn', 'Machop', 'Geodude', 'Phanpy', 'Gligar', 'Swinub'], // DESERT
  3: [
    'Pidgey',
    'Rattata',
    'Nidoran',
    'Oddish',
    'Tauros',
    'Spearow',
    'Paras',
    'Venonat',
    'Bellsprout',
    'Sentret',
    'Hoppip',
    'Mareep'
  ], // GRASSLAND
  4: [
    'Caterpie',
    'Weedle',
    'Pikachu',
    'Bulbasaur',
    'Pinsir',
    'Oddish',
    'Paras',
    'Exeggcute',
    'Zubat',
    'Chikorita',
    'Spinarak',
    'Ledyba'
  ], // FOREST
  5: ['Bellsprout', 'Venonat', 'Meowth', 'Exeggcute', 'Oddish', 'Pidgey', 'Zubat', 'Ekans', 'Snubbull', 'Hoothoot'], // TAIGA
  6: ['Seel', 'Drowzee', 'Machop', 'Magnemite', 'Shellder', 'Jynx', 'Psyduck', 'Swinub', 'Sneasel', 'Delibird'], // TUNDRA
  7: ['Seel', 'Jynx', 'Shellder', 'Dewgong', 'Slowpoke', 'Magikarp', 'Swinub', 'Piloswine', 'Smoochum'], // SNOW
  8: ['Lapras', 'Dewgong', 'Cloyster', 'Jynx', 'Seel', 'Shellder', 'Delibird', 'Swinub', 'Corsola'], // ICE
  9: [
    'Doduo',
    'Rhyhorn',
    'Mankey',
    'Spearow',
    'Tauros',
    'Ekans',
    'Sandshrew',
    'Growlithe',
    'Phanpy',
    'Mareep',
    'Girafarig'
  ], // SAVANNA
  10: [
    'Tangela',
    'Scyther',
    'Mankey',
    'Venonat',
    'Paras',
    'Bellsprout',
    'Meowth',
    'Ekans',
    'Aipom',
    'Heracross',
    'Yanma'
  ], // JUNGLE
  11: [
    'Geodude',
    'Zubat',
    'Machop',
    'Onix',
    'Clefairy',
    'Sandshrew',
    'Rhyhorn',
    'Mankey',
    'Diglett',
    'Sudowoodo',
    'Shuckle',
    'Phanpy'
  ], // MOUNTAIN
  12: ['Articuno', 'Aerodactyl', 'Zapdos', 'Moltres', 'Dragonite', 'Dewgong', 'Skarmory', 'Noctowl', 'Xatu'], // PEAK
  13: ['Magmar', 'Ponyta', 'Charmander', 'Growlithe', 'Geodude', 'Mankey', 'Vulpix', 'Cyndaquil', 'Slugma', 'Houndour'], // VOLCANO
  14: ['Gastly', 'Haunter', 'Zubat', 'Grimer', 'Cubone', 'Drowzee', 'Murkrow', 'Misdreavus', 'Houndour'], // GHOST_WOODS
  15: ['Abra', 'Porygon', 'Mew', 'Drowzee', 'Slowpoke', 'Mr. Mime', 'Kadabra', 'Natu', 'Unown', 'Celebi'] // ARCANE
};

export function getEncounters(biomeId) {
  return WILD_POKEMON[biomeId] || ['MissingNo'];
}
