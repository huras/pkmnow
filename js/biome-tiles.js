import { BIOMES } from './biomes.js';

/**
 * Mapeamento entre nossos IDs de Bioma e as chaves do TERRAIN_SETS no tessellation-data.js.
 */
export const BIOME_TO_TERRAIN = {
  [BIOMES.OCEAN.id]: "Borda com grama lago-de-agua-doce-grass",
  [BIOMES.BEACH.id]: "Dirty sandy",
  [BIOMES.DESERT.id]: "Yellow Dirty sandy",
  [BIOMES.GRASSLAND.id]: "Dirty grassy",
  [BIOMES.FOREST.id]: "Dirty light-grass",
  [BIOMES.TAIGA.id]: "jogador light grass",
  [BIOMES.TUNDRA.id]: "Dirty snowy",
  [BIOMES.SNOW.id]: "Dirty snowy",
  [BIOMES.ICE.id]: "jogador frozen-rocky",
  [BIOMES.SAVANNA.id]: "jogador orange-grass",
  [BIOMES.JUNGLE.id]: "Dirty super-healthy-light-grass",
  [BIOMES.MOUNTAIN.id]: "Rocky rock",
  [BIOMES.PEAK.id]: "Rocky snowy",
  [BIOMES.VOLCANO.id]: "Borda com dirt/terra lava-lake-dirt",
  [BIOMES.GHOST_WOODS.id]: "above dense-bushes",
  [BIOMES.ARCANE.id]: "purples lago-de-agua-doce-rock",
  [BIOMES.CITY.id]: "detailed-small-bricks-pavement",
};

/**
 * Configuração de vegetação (Scatter) por bioma.
 * Cada entrada é um OBJECT_SET name do tessellation-data.js.
 */
export const BIOME_VEGETATION = {
  [BIOMES.FOREST.id]: ['green-broadleaf-1 [3x2]', 'grass [1x1]', 'red-flower [1x1]'],
  [BIOMES.JUNGLE.id]: ['palm-tree [2x2]', 'vine [1x1]', 'fern [1x1]'],
  [BIOMES.GRASSLAND.id]: ['small-grass [1x1]', 'yellow-lily [1x1]', 'red-daisy [1x1]'],
  [BIOMES.SNOW.id]: ['baby-pine-tree-full-snow [1x1]', 'snow-grass [1x1]'],
  [BIOMES.MOUNTAIN.id]: ['small-dirt-rocks-a [1x1]', 'dirt-rock [1x1]'],
  [BIOMES.OCEAN.id]: ['pointy-sea-shell [1x1]'],
  [BIOMES.DESERT.id]: ['small-cactus [1x1]'],
  [BIOMES.SAVANNA.id]: ['savannah-tree [3x3]', 'small-cactus [1x1]'],
  [BIOMES.CITY.id]: [],
};

/**
 * Scatter com pedra/cristal não deve balançar com "vento" no render.
 * Chaves são nomes de OBJECT_SETS (ex.: "small-dirt-rocks-a [1x1]").
 */
export function scatterHasWindSway(itemKey) {
  const k = String(itemKey).toLowerCase();
  if (k.includes('crystal')) return false;
  if (k.includes('dirt-rock') || k.includes('dirt-rocks')) return false;
  return true;
}

// ==== FOLIAGE TILE IDS (Diretamente do Tileset Nature) ====
// Estes são tile IDs locais no tileset flurmimons_nature (57 colunas, 16px)

/** Grass overlay tile IDs per biome variant */
export const GRASS_TILES = {
  default:  { original: 117, small: 60, grass2: 3 },
  ice:      { original: 118, small: 61, grass2: 4 },
  desert:   { original: 1884, cactusBase: 1997, cactusTop: 1940 },
  dirt:     { original: 65, originalTop: 8, small: 60, mushroom: 119, dryGrass: 65 },
};

/** Tree overlay: 2×3 tiles (2 cols, 3 rows: 2 top + 1 base row) */
export const TREE_TILES = {
  broadleaf:    { base: [285, 286],   top: [228, 229, 171, 172] },
  broadleaf2:   { base: [297, 298],   top: [240, 241, 183, 184] },
  pine:         { base: [311, 312],   top: [254, 255, 197, 198] },
  palm:         { base: [322, 323],   top: [265, 266, 208, 209] },
};

/** Biomes que NÃO recebem grama */
export const NO_GRASS_BIOMES = new Set([
  BIOMES.OCEAN.id, BIOMES.MOUNTAIN.id, BIOMES.PEAK.id,
  BIOMES.ICE.id, BIOMES.VOLCANO.id, BIOMES.CITY.id
]);

/** Biomes que NÃO recebem árvores */
export const NO_TREE_BIOMES = new Set([
  BIOMES.OCEAN.id, BIOMES.BEACH.id, BIOMES.DESERT.id,
  BIOMES.MOUNTAIN.id, BIOMES.PEAK.id, BIOMES.ICE.id,
  BIOMES.VOLCANO.id, BIOMES.TUNDRA.id, BIOMES.ARCANE.id,
  BIOMES.SAVANNA.id, BIOMES.CITY.id
]);

/**
 * Mapeamento de "Terrain Foliage" (Forragem/Skin superior).
 * Usa os sets "jogador X" do tessellation-data.js.
 */
export const BIOME_TO_FOLIAGE = {
  [BIOMES.GRASSLAND.id]: "jogador light-grass",
  [BIOMES.FOREST.id]: "jogador light-grass",
  [BIOMES.JUNGLE.id]: "jogador super-healthy-light-grass",
  [BIOMES.MOUNTAIN.id]: "jogador rocky",
  [BIOMES.PEAK.id]: "jogador rocky",
  [BIOMES.SNOW.id]: "jogador light grass",
  [BIOMES.ICE.id]: "jogador frozen-rocky",
  [BIOMES.DESERT.id]: "jogador sandy",
  [BIOMES.BEACH.id]: "jogador sandy",
  [BIOMES.SAVANNA.id]: "jogador orange-grass",
  [BIOMES.ARCANE.id]: "purples lago-de-agua-doce-rock", // Fallback para variação roxa
};

/**
 * Retorna o variant de grama para um biome ID.
 */
export function getGrassVariant(biomeId) {
  if (NO_GRASS_BIOMES.has(biomeId)) return null;
  if (biomeId === BIOMES.SNOW.id || biomeId === BIOMES.TUNDRA.id) return 'ice';
  if (biomeId === BIOMES.DESERT.id || biomeId === BIOMES.SAVANNA.id) return 'desert';
  if (biomeId === BIOMES.BEACH.id) return 'dirt';
  return 'default';
}

/**
 * Retorna o tipo de árvore para um biome ID.
 */
export function getTreeType(biomeId) {
  if (NO_TREE_BIOMES.has(biomeId)) return null;
  if (biomeId === BIOMES.SNOW.id || biomeId === BIOMES.TAIGA.id) return 'pine';
  if (biomeId === BIOMES.GHOST_WOODS.id) return 'broadleaf2';
  return 'broadleaf'; // Forest, Grassland, Jungle
}

// Constantes de densiades
export const GRASS_DENSITY_THRESHOLD = 0.40;  // 60% de cobertura (nos blobs)
export const TREE_DENSITY_THRESHOLD = 0.55;   // 45% de cobertura (nos blobs)
export const FOLIAGE_DENSITY_THRESHOLD = 0.45; // Threshold para a Forragem

export const GRASS_NOISE_SCALE = 0.2;         // Blobs de ~5 tiles
export const TREE_NOISE_SCALE = 0.1;          // Blobs de ~10 tiles
export const FOLIAGE_NOISE_SCALE = 0.25;       // Blobs de ~4 tiles


