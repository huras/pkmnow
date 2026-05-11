const PREFIXES = {
  0: ["Sea", "Wave", "Aqua", "Coral", "Tide", "Port"], // OCEAN
  1: ["Sand", "Shell", "Sun", "Palm", "Coast"], // BEACH
  2: ["Dust", "Dune", "Dry", "Oasis", "Sun"], // DESERT
  3: ["Green", "Plain", "Bloom", "Meadow", "Spring"], // GRASSLAND
  4: ["Wood", "Leaf", "Oak", "Pine", "Timber"], // FOREST
  5: ["Cold", "Pine", "Needle", "Frost", "Log"], // TAIGA
  6: ["Chill", "Tundra", "Bleak", "Frost"], // TUNDRA
  7: ["Snow", "Ice", "Winter", "White", "Frost", "Cold"], // SNOW
  8: ["Glacier", "Cryo", "Ice", "Crystal"], // ICE
  9: ["Dust", "Lion", "Savanna", "Dry", "Sun"], // SAVANNA
  10: ["Vine", "Fern", "Rain", "Moss", "Wild"], // JUNGLE
  11: ["Rock", "Stone", "Crag", "Mount", "Iron", "Ore"], // MOUNTAIN
  12: ["Peak", "Summit", "Cloud", "Sky", "High"], // PEAK
  13: ["Ash", "Magma", "Lava", "Fire", "Ember", "Cinder"], // VOLCANO
  14: ["Mist", "Gloom", "Dark", "Ghost", "Shadow", "Murk"], // GHOST_WOODS
  15: ["Mystic", "Rune", "Star", "Void", "Crystal", "Magic"], // ARCANE
};

const SUFFIXES = [
  "town", "burg", "ville", "city", "vale", "wood", "port", "gate", "ridge", "point"
];

function getRandomElement(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Gera um nome para uma cidade baseado no seu bioma.
 */
export function generateCityName(biomeId, rngFunction = Math.random) {
  const prefixes = PREFIXES[biomeId] || ["New", "Old", "Big", "Little", "Toad"];
  const prefix = getRandomElement(prefixes, rngFunction);
  const suffix = getRandomElement(SUFFIXES, rngFunction);
  return prefix + suffix;
}

/**
 * Dá nomes simples para rotas. Pode ser expandido depois.
 */
export function generateRouteName(index) {
  return `Rota ${100 + index}`;
}
