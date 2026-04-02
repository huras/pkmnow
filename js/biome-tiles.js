import { BIOMES } from './biomes.js';

/**
 * Mapeamento entre nossos IDs de Bioma e as chaves do TERRAIN_SETS no tessellation-data.js.
 */
export const BIOME_TO_TERRAIN = {
  [BIOMES.OCEAN.id]: "Borda com grama lago-de-agua-doce-grass", // Usará o 'CENTER' ou transição
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
  [BIOMES.GHOST_WOODS.id]: "above dense-bushes", // Usando o set de arbustos como terreno
  [BIOMES.ARCANE.id]: "purples lago-de-agua-doce-rock",
};

/**
 * Configuração de vegetação (Scatter) por bioma.
 */
export const BIOME_VEGETATION = {
  [BIOMES.FOREST.id]: ['green-broadleaf-1 [3x2]', 'grass [1x1]', 'red-flower [1x1]'],
  [BIOMES.JUNGLE.id]: ['palm-tree [3x2]', 'vine [2x1]', 'fern [1x1]'],
  [BIOMES.GRASSLAND.id]: ['small-grass [1x1]', 'yellow-lily [1x1]', 'red-daisy [1x1]'],
  [BIOMES.SNOW.id]: ['baby-pine-tree-full-snow [2x1]', 'snow-grass [1x1]'],
  [BIOMES.MOUNTAIN.id]: ['small-dirt-rocks-a [1x1]', 'dirt-rock [1x1]'],
  [BIOMES.OCEAN.id]: ['pointy-sea-shell [1x1]'], // Nas praias na verdade
};
