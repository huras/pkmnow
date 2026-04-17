import { BIOMES } from '../biomes.js';

/** Site-root-relative Suno originals (same origin as index.html). */
const SUNO_BASE = 'audio/suno-original-bgm';
/** Additional biome packs under `audio/bgm/biomes/<folder>/`. */
const BIOMES_PACK_BASE = 'audio/bgm/biomes';

/**
 * @param {string} folder
 * @param {string} filename
 * @returns {string}
 */
function sunoTrackUrl(folder, filename) {
  return `${SUNO_BASE}/${folder}/${encodeURIComponent(filename)}`;
}

/**
 * @param {string} folder
 * @param {string} filename
 * @returns {string}
 */
function packTrackUrl(folder, filename) {
  return `${BIOMES_PACK_BASE}/${folder}/${encodeURIComponent(filename)}`;
}

/**
 * @param {string} folder
 * @param {string[]} filenames
 * @returns {string[]}
 */
function sunoFolderTracks(folder, filenames) {
  return filenames.map((f) => sunoTrackUrl(folder, f));
}

/**
 * @param {string} folder
 * @param {string[]} filenames
 * @returns {string[]}
 */
function packFolderTracks(folder, filenames) {
  return filenames.map((f) => packTrackUrl(folder, f));
}

const SNOW_TUNDRA_FILES = [
  '3-17. Snowbelle City.mp3',
  'Frozen Night Over White Silence - Snowbelle City (Snow Biome Night A).mp3',
  'Frozen Night Over White Silence - Snowbelle City (Snow Biome Night B).mp3',
  'Snowfield Sunlight - Snowbelle City (Snow Biome Day A).mp3',
  'Snowfield Sunlight - Snowbelle City (Snow Biome Day B).mp3'
];

/** TUNDRA: Suno snow palette + dedicated `tundra/` pack. */
const TUNDRA_TRACKS = Object.freeze([
  ...sunoFolderTracks('snow', SNOW_TUNDRA_FILES),
  ...packFolderTracks('tundra', [
    'Blizzard Pathway.mp3',
    'Route 7 - Tundra Ridge (1).mp3',
    'Route 7 - Tundra Ridge.mp3'
  ])
]);

const BEACH_PACK = packFolderTracks('beach-caves', [
  'Tidal Steps to the Hidden Cove (1).mp3',
  'Tidal Steps to the Hidden Cove.mp3'
]);

const DESERT_PACK = packFolderTracks('desert', [
  'Sand-Edge Crossing (1).mp3',
  'Sand-Edge Crossing.mp3',
  'Subtropical Mirage Route (1).mp3',
  'Subtropical Mirage Route.mp3'
]);

const GRASSLAND_PACK = packFolderTracks('plains', [
  'Wind Through the Amber Route (1).mp3',
  'Wind Through the Amber Route.mp3'
]);

const FOREST_PACK = packFolderTracks('woods', [
  'Whispers of the Canopy (1).mp3',
  'Whispers of the Canopy.mp3'
]);

const TAIGA_PACK = packFolderTracks('taiga', [
  'Route 7 - Taiga Pass (1).mp3',
  'Route 7 - Taiga Pass.mp3'
]);

const JUNGLE_PACK = packFolderTracks('jungle', [
  'Verdant Veil Route (1).mp3',
  'Verdant Veil Route.mp3'
]);

const JUNGLE_RUINS_PACK = packFolderTracks('jungle-ruins', ['Verdant Ruins Run.mp3']);

const SAVANNA_PACK = packFolderTracks('savannah', [
  'Sanctuary in the Wastes (1).mp3',
  'Sanctuary in the Wastes.mp3'
]);

const VOLCANO_PACK = packFolderTracks('volcano', [
  'Volcanic Ridgeway (1).mp3',
  'Volcanic Ridgeway.mp3',
  'Wasteland Route - Ember Sand Path (1).mp3',
  'Wasteland Route - Ember Sand Path.mp3'
]);

const GHOST_WOODS_PACK = Object.freeze([
  ...packFolderTracks('misty-woods', [
    'Route 49 - Ridgewalk Pass (1).mp3',
    'Route 49 - Ridgewalk Pass.mp3',
    'Whispers Under the Canopy (1).mp3',
    'Whispers Under the Canopy.mp3'
  ]),
  ...packFolderTracks('dark-lands', [
    'Route - Dark Lands Approach (1).mp3',
    'Route - Dark Lands Approach.mp3'
  ])
]);

const ARCANE_PACK = packFolderTracks('vale-arcano', [
  'Route - Dreamland Ravine (1).mp3',
  'Route - Dreamland Ravine.mp3'
]);

const ICE_PACK = packFolderTracks('crystal-caves', [
  'Crystal Cavern Route (1).mp3',
  'Crystal Cavern Route.mp3'
]);

const DESERT_SUNO_FILES = [
  '1-53. Route 4 (Spring).mp3',
  'Midnight Dunes of Arahim - Pokemon B&Y Route 4 (Night A).mp3',
  'Midnight Dunes of Arahim - Pokemon B&Y Route 4 (Night B).mp3',
  'Sandlight Caravan - Pokemon B&Y Route 4 (Day A).mp3',
  'Sandlight Caravan - Pokemon B&Y Route 4 (Day B).mp3'
];

/**
 * Resolved URLs for WebAudio / HTMLAudioElement (path segments encoded).
 * @type {Readonly<Record<number, readonly string[]>>}
 */
export const BIOME_BGM_TRACK_URLS = Object.freeze({
  [BIOMES.OCEAN.id]: Object.freeze(
    sunoFolderTracks('sea', [
      'Black Water, Quiet Stars - Route 123 (Night A).mp3',
      'Black Water, Quiet Stars - Route 123 (Night B).mp3',
      'Ghosts of the Midnight Tide - Route 123 (Day A).mp3',
      'Ghosts of the Midnight Tide - Route 123 (Day B).mp3',
      'Pokemon Emerald version-Route 123 Soundtrack.mp3'
    ])
  ),
  [BIOMES.BEACH.id]: Object.freeze([
    ...sunoFolderTracks('beach', [
      'Midnight Tides Of The Forgotten Shore - Undella Town (Night A).mp3',
      'Midnight Tides Of The Forgotten Shore - Undella Town (Night B).mp3',
      'Tide of First Light - Undella Town (Day A).mp3',
      'Tide of First Light - Undella Town (Day B).mp3',
      'Undella Town (Autumn-Spring)[Pokémon_ Black & White].mp3'
    ]),
    ...BEACH_PACK
  ]),
  [BIOMES.DESERT.id]: Object.freeze([...sunoFolderTracks('desert', DESERT_SUNO_FILES), ...DESERT_PACK]),
  [BIOMES.GRASSLAND.id]: Object.freeze([
    ...sunoFolderTracks('grassland', ['010 - Route 101.mp3', '1-57. Unwavering Emotions.mp3']),
    ...GRASSLAND_PACK
  ]),
  [BIOMES.FOREST.id]: Object.freeze([
    ...sunoFolderTracks('forest', [
      '56. Eterna Forest.mp3',
      'Forest of Quiet Paths - Eterna Forest (Day A).mp3',
      'Forest of Quiet Paths - Eterna Forest (Day B).mp3',
      'Whisper Map Under Pines - Eterna Forest (Night A).mp3',
      'Whispers in the Canopy - Eterna Forest (Night B).mp3'
    ]),
    ...FOREST_PACK
  ]),
  [BIOMES.TAIGA.id]: Object.freeze([
    ...sunoFolderTracks('taiga', [
      '76. Route 216 (Day).mp3',
      'Midnight Taiga Veil - Route 216 (Night A).mp3',
      'Midnight Taiga Veil - Route 216 (Night B).mp3',
      'Taiga Daylight Drifts - Route 216 (Day A).mp3',
      'Taiga Daylight Drifts - Route 216 (Day B).mp3'
    ]),
    ...TAIGA_PACK
  ]),
  [BIOMES.TUNDRA.id]: Object.freeze([...TUNDRA_TRACKS]),
  [BIOMES.SNOW.id]: Object.freeze([...sunoFolderTracks('snow', SNOW_TUNDRA_FILES)]),
  [BIOMES.ICE.id]: Object.freeze([
    ...sunoFolderTracks('ice', [
      '077 - Cave of Origin.mp3',
      'Fractured Daylight - Cave of Origin (Ice Biome Day A).mp3',
      'Fractured Daylight - Cave of Origin (Ice Biome Day B).mp3'
    ]),
    ...ICE_PACK
  ]),
  [BIOMES.SAVANNA.id]: Object.freeze([
    ...sunoFolderTracks('savannah', [
      '1-53. Route 8.mp3',
      'Savanna Nocturne - Route 6 (Savanna Biome Night A).mp3',
      'Savanna Nocturne - Route 6 (Savanna Biome Night B).mp3',
      'Savanna Skybound - Route 6 (Savanna Biome Day A).mp3',
      'Savanna Skybound - Route 6 (Savanna Biome Day B).mp3'
    ]),
    ...SAVANNA_PACK
  ]),
  [BIOMES.JUNGLE.id]: Object.freeze([
    ...sunoFolderTracks('jungle', [
      '053 - Route 119.mp3',
      'Veil of the Canopy - Route 119 (Jungle Biome Night A).mp3',
      'Veil of the Canopy - Route 119 (Jungle Biome Night B).mp3',
      'Vines of the Suntrail - Route 119 (Jungle Biome Day A).mp3',
      'Vines of the Suntrail - Route 119 (Jungle Biome Day B).mp3'
    ]),
    ...JUNGLE_PACK,
    ...JUNGLE_RUINS_PACK
  ]),
  [BIOMES.MOUNTAIN.id]: Object.freeze(
    sunoFolderTracks('mountain', [
      '81. Mt. Coronet.mp3',
      'Night Ascent of the Hidden Path - Mt. Coronet (Mountain Biome Night A).mp3',
      'Night Ascent of the Hidden Path - Mt. Coronet (Mountain Biome Night B).mp3',
      'Senderos de Media Montaña - Mt. Coronet (Mountain Biome Day B).mp3',
      'Sunsteps on the High Trail - Mt. Coronet (Mountain Biome Day A).mp3'
    ])
  ),
  [BIOMES.PEAK.id]: Object.freeze(
    sunoFolderTracks('peak', [
      '82. Spear Pillar.mp3',
      'A Crown of Silent Peaks - Spear Pillar (Peak Biome Night A).mp3',
      'A Crown of Silent Peaks - Spear Pillar (Peak Biome Night B).mp3',
      'Above the White Peaks - Spear Pillar (Peak Biome Day A).mp3',
      'Above the White Peaks - Spear Pillar (Peak Biome Day B).mp3'
    ])
  ),
  [BIOMES.VOLCANO.id]: Object.freeze([
    ...sunoFolderTracks('volcano', [
      '066 - Mt. Pyre.mp3',
      'Ashfall Riddles - Mt. Pyre (Day B).mp3',
      'Crater Map - Mt. Pyre (Day A).mp3',
      'Sunforge Summit - Mt. Pyre (Day A).mp3',
      'Sunforge Summit - Mt. Pyre (Day B).mp3',
      'Volcano Veil - Mt. Pyre (Night A).mp3',
      'Volcano Veil - Mt. Pyre (Night B).mp3'
    ]),
    ...VOLCANO_PACK
  ]),
  [BIOMES.GHOST_WOODS.id]: Object.freeze([
    ...sunoFolderTracks('ghost-woods', ['120. Old Chateau.mp3', '2-33. Scary House.mp3']),
    ...GHOST_WOODS_PACK
  ]),
  [BIOMES.ARCANE.id]: Object.freeze([
    ...sunoFolderTracks('arcane', ['3-01. Anistar City.mp3', '1-36. Castelia City Gym.mp3']),
    ...ARCANE_PACK
  ]),
  [BIOMES.CITY.id]: Object.freeze(sunoFolderTracks('city', ['1-37. Lumiose City.mp3'])),
  [BIOMES.CITY_STREET.id]: Object.freeze(sunoFolderTracks('city-streets', ['1-36. Castelia City Gym.mp3'])),
  [BIOMES.TOWN.id]: Object.freeze(sunoFolderTracks('town', ['004 - Littleroot Town.mp3'])),
  [BIOMES.TOWN_STREET.id]: Object.freeze(sunoFolderTracks('town-streets', ['1-05. Vaniville Town.mp3']))
});

/**
 * @param {number} biomeId
 * @returns {readonly string[] | undefined}
 */
export function getBiomeBgmUrlsForBiome(biomeId) {
  return BIOME_BGM_TRACK_URLS[biomeId];
}
