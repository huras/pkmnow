import { BIOMES } from '../biomes.js';

/** Site-root-relative base (same origin as index.html). */
const BASE = 'audio/suno-original-bgm';

/**
 * @param {string} folder
 * @param {string} filename
 * @returns {string}
 */
function trackUrl(folder, filename) {
  return `${BASE}/${folder}/${encodeURIComponent(filename)}`;
}

/**
 * @param {string} folder
 * @param {string[]} filenames
 * @returns {string[]}
 */
function folderTracks(folder, filenames) {
  return filenames.map((f) => trackUrl(folder, f));
}

const SNOW_TUNDRA_FILES = ['3-17. Snowbelle City.mp3'];

/** TUNDRA: no `tundra/` folder under suno — reuse `snow` until a dedicated pack exists. */
const TUNDRA_TRACKS = folderTracks('snow', SNOW_TUNDRA_FILES);

/**
 * Resolved URLs for WebAudio / HTMLAudioElement (path segments encoded).
 * @type {Readonly<Record<number, readonly string[]>>}
 */
export const BIOME_BGM_TRACK_URLS = Object.freeze({
  [BIOMES.OCEAN.id]: Object.freeze(
    folderTracks('sea', [
      'Black Water, Quiet Stars - Route 123 (Night A).mp3',
      'Black Water, Quiet Stars - Route 123 (Night B).mp3',
      'Ghosts of the Midnight Tide - Route 123 (Day A).mp3',
      'Ghosts of the Midnight Tide - Route 123 (Day B).mp3',
      'Pokemon Emerald version-Route 123 Soundtrack.mp3'
    ])
  ),
  [BIOMES.BEACH.id]: Object.freeze(
    folderTracks('beach', [
      'Midnight Tides Of The Forgotten Shore - Undella Town (Night A).mp3',
      'Midnight Tides Of The Forgotten Shore - Undella Town (Night B).mp3',
      'Tide of First Light - Undella Town (Day A).mp3',
      'Tide of First Light - Undella Town (Day B).mp3',
      'Undella Town (Autumn-Spring)[Pokémon_ Black & White].mp3'
    ])
  ),
  [BIOMES.DESERT.id]: Object.freeze(
    folderTracks('desert', [
      '1-53. Route 4 (Spring).mp3',
      'Midnight Dunes of Arahim - Pokemon B&Y Route 4 (Night A).mp3',
      'Midnight Dunes of Arahim - Pokemon B&Y Route 4 (Night B).mp3',
      'Sandlight Caravan - Pokemon B&Y Route 4 (Day A).mp3',
      'Sandlight Caravan - Pokemon B&Y Route 4 (Day B).mp3'
    ])
  ),
  [BIOMES.GRASSLAND.id]: Object.freeze(folderTracks('grassland', ['010 - Route 101.mp3'])),
  [BIOMES.FOREST.id]: Object.freeze(
    folderTracks('forest', [
      '56. Eterna Forest.mp3',
      'Forest of Quiet Paths - Eterna Forest (Day A).mp3',
      'Forest of Quiet Paths - Eterna Forest (Day B).mp3',
      'Whisper Map Under Pines - Eterna Forest (Night A).mp3',
      'Whispers in the Canopy - Eterna Forest (Night B).mp3'
    ])
  ),
  [BIOMES.TAIGA.id]: Object.freeze(folderTracks('taiga', ['76. Route 216 (Day).mp3'])),
  [BIOMES.TUNDRA.id]: Object.freeze([...TUNDRA_TRACKS]),
  [BIOMES.SNOW.id]: Object.freeze([...folderTracks('snow', SNOW_TUNDRA_FILES)]),
  [BIOMES.ICE.id]: Object.freeze(folderTracks('ice', ['077 - Cave of Origin.mp3'])),
  [BIOMES.SAVANNA.id]: Object.freeze(folderTracks('savannah', ['1-53. Route 8.mp3'])),
  [BIOMES.JUNGLE.id]: Object.freeze(folderTracks('jungle', ['053 - Route 119.mp3'])),
  [BIOMES.MOUNTAIN.id]: Object.freeze(folderTracks('mountain', ['81. Mt. Coronet.mp3'])),
  [BIOMES.PEAK.id]: Object.freeze(folderTracks('peak', ['82. Spear Pillar.mp3'])),
  [BIOMES.VOLCANO.id]: Object.freeze(folderTracks('volcano', ['066 - Mt. Pyre.mp3'])),
  [BIOMES.GHOST_WOODS.id]: Object.freeze(folderTracks('ghost-woods', ['120. Old Chateau.mp3'])),
  [BIOMES.ARCANE.id]: Object.freeze(
    folderTracks('arcane', ['1-57. Unwavering Emotions.mp3', '3-01. Anistar City.mp3'])
  ),
  [BIOMES.CITY.id]: Object.freeze(folderTracks('city', ['1-37. Lumiose City.mp3'])),
  [BIOMES.CITY_STREET.id]: Object.freeze(folderTracks('city-streets', ['1-36. Castelia City Gym.mp3'])),
  [BIOMES.TOWN.id]: Object.freeze(folderTracks('town', ['004 - Littleroot Town.mp3'])),
  [BIOMES.TOWN_STREET.id]: Object.freeze(folderTracks('town-streets', ['1-05. Vaniville Town.mp3']))
});

/**
 * @param {number} biomeId
 * @returns {readonly string[] | undefined}
 */
export function getBiomeBgmUrlsForBiome(biomeId) {
  return BIOME_BGM_TRACK_URLS[biomeId];
}
