import { PluginRegistry } from './core/plugin-registry.js';

export const WILD_POKEMON = {
  0: ['Tentacool', 'Magikarp', 'Staryu', 'Horsea', 'Shellder', 'Wingull', 'Corphish', 'Wailmer', 'Chinchou', 'Remoraid', 'Buizel', 'Finneon'], // OCEAN
  1: ['Krabby', 'Slowpoke', 'Shellder', 'Psyduck', 'Tentacool', 'Horsea', 'Barboach', 'Marill', 'Corphish', 'Corsola', 'Buizel', 'Shellos'], // BEACH
  2: ['Sandshrew', 'Diglett', 'Cubone', 'Ekans', 'Rhyhorn', 'Trapinch', 'Numel', 'Cacnea', 'Phanpy', 'Swinub'], // DESERT
  3: [
    'Pidgey',
    'Rattata',
    'Nidoran',
    'Oddish',
    'Tauros',
    'Spearow',
    'Paras',
    'Venonat',
    'Zigzagoon',
    'Sentret',
    'Hoppip',
    'Mareep',
    'Lotad',
    'Electrike',
    'Starly',
    'Bidoof',
    'Shinx'
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
    'Ledyba',
    'Shroomish',
    'Seedot',
    'Taillow',
    'Kricketot',
    'Cherubi'
  ], // FOREST
  5: ['Bellsprout', 'Venonat', 'Meowth', 'Exeggcute', 'Oddish', 'Pidgey', 'Zubat', 'Ekans', 'Snubbull', 'Hoothoot', 'Seedot', 'Slakoth', 'Snover', 'Bidoof'], // TAIGA
  6: ['Seel', 'Drowzee', 'Machop', 'Magnemite', 'Shellder', 'Jynx', 'Psyduck', 'Swinub', 'Sneasel', 'Delibird', 'Snorunt', 'Spheal', 'Snover'], // TUNDRA
  7: ['Seel', 'Jynx', 'Shellder', 'Dewgong', 'Slowpoke', 'Magikarp', 'Swinub', 'Piloswine', 'Smoochum', 'Snorunt', 'Spheal', 'Snover'], // SNOW
  8: ['Lapras', 'Dewgong', 'Cloyster', 'Jynx', 'Seel', 'Shellder', 'Delibird', 'Swinub', 'Corsola', 'Spheal', 'Sealeo', 'Snover'], // ICE
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
    'Girafarig',
    'Torchic',
    'Electrike',
    'Zigzagoon',
    'Bidoof',
    'Croagunk'
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
    'Yanma',
    'Treecko',
    'Shroomish',
    'Lotad',
    'Carnivine',
    'Budew'
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
    'Phanpy',
    'Aron',
    'Nosepass',
    'Makuhita',
    'Cranidos',
    'Shieldon',
    'Bronzor'
  ], // MOUNTAIN
  12: ['Articuno', 'Aerodactyl', 'Zapdos', 'Moltres', 'Dragonite', 'Dewgong', 'Skarmory', 'Noctowl', 'Xatu', 'Swablu', 'Altaria', 'Staravia', 'Drifloon'], // PEAK
  13: ['Magmar', 'Ponyta', 'Charmander', 'Growlithe', 'Geodude', 'Mankey', 'Vulpix', 'Cyndaquil', 'Slugma', 'Houndour', 'Torchic', 'Numel', 'Torkoal'], // VOLCANO
  14: ['Gastly', 'Haunter', 'Zubat', 'Grimer', 'Cubone', 'Drowzee', 'Murkrow', 'Misdreavus', 'Houndour', 'Shuppet', 'Duskull', 'Sableye', 'Spiritomb', 'Drifloon'], // GHOST_WOODS
  15: ['Abra', 'Porygon', 'Mew', 'Drowzee', 'Slowpoke', 'Mr. Mime', 'Kadabra', 'Natu', 'Unown', 'Celebi', 'Ralts', 'Beldum', 'Baltoy', 'Mime Jr.', 'Chingling', 'Bronzor'], // ARCANE
  20: [
    'Oddish',
    'Gloom',
    'Paras',
    'Venonat',
    'Butterfree',
    'Beedrill',
    'Bulbasaur',
    'Chikorita',
    'Hoppip',
    'Skiploom',
    'Sunkern',
    'Bellossom',
    'Flabebe',
    'Combee',
    'Beautifly',
    'Ledian',
    'Ledyba',
    'Spinarak',
    'Bellsprout',
    'Roselia'
  ] // FLOWER_FIELDS (Campo anomaly)
};

export function getEncounters(biomeId) {
  const mod = PluginRegistry.getBiomeById(biomeId);
  if (mod?.encounters) return mod.encounters;
  return WILD_POKEMON[biomeId] || ['MissingNo'];
}
