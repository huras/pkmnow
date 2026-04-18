import { BIOMES } from './biomes.js';
import { seededHash, getRoleForCell } from './tessellation-logic.js';
import { TERRAIN_SETS } from './tessellation-data.js';

/**
 * Mapeamento entre nossos IDs de Bioma e as chaves do TERRAIN_SETS no tessellation-data.js.
 */
/**
 * Base do terreno por bioma.
 * Biomas com grama: base solo `grassy-terrain.png` + paletas (terrain-palette-grassy.js); folhagem jogador em cima.
 * Resto: folhas solo conc-conv-a 5×3 — `terrain-palette-base.js` (uma PNG por paleta).
 */
export const BIOME_TO_TERRAIN = {
  [BIOMES.OCEAN.id]: "Palette base — lake shore",
  [BIOMES.BEACH.id]: "Palette base — sand",
  [BIOMES.DESERT.id]: "Palette base — sand",
  [BIOMES.GRASSLAND.id]: "Palette grassy — field",
  [BIOMES.FOREST.id]: "Palette grassy — light",
  [BIOMES.TAIGA.id]: "Palette grassy — light",
  [BIOMES.TUNDRA.id]: "Dirty snowy",
  [BIOMES.SNOW.id]: "Dirty snowy",
  [BIOMES.ICE.id]: "Palette base — ice",
  [BIOMES.SAVANNA.id]: "Palette base — sand",
  [BIOMES.JUNGLE.id]: "Palette grassy — lush",
  [BIOMES.MOUNTAIN.id]: "Palette base — rock",
  [BIOMES.PEAK.id]: "Palette base — snow",
  [BIOMES.VOLCANO.id]: "Palette base — volcano",
  [BIOMES.GHOST_WOODS.id]: "Palette grassy — lush",
  [BIOMES.ARCANE.id]: "Palette base — arcane",
  [BIOMES.CITY.id]: "detailed-small-bricks-pavement",
  [BIOMES.CITY_STREET.id]: "road",
  [BIOMES.TOWN.id]: "Palette grassy — field",
  [BIOMES.TOWN_STREET.id]: "Palette base — sand",
};

/**
 * Configuração de vegetação (Scatter) por bioma.
 * Cada entrada é um OBJECT_SET name do tessellation-data.js.
 */
export const BIOME_VEGETATION = {
  [BIOMES.FOREST.id]: ['large-green-broadleaf-1 [4x3]', 'green-broadleaf-1 [3x2]', 'grass [1x1]', 'red-flower [1x1]'],
  [BIOMES.JUNGLE.id]: ['fat-palm [4x3]', 'large-palm-with-coconuts [4x3]', 'large-palm-with-bananas [3x3]', 'palm-tree [2x2]', 'vine [1x1]', 'fern [1x1]'],
  [BIOMES.GRASSLAND.id]: ['small-grass [1x1]', 'yellow-lily [1x1]', 'red-daisy [1x1]'],
  [BIOMES.SNOW.id]: ['large-light-blue-crystal [2x2]', 'baby-pine-tree-full-snow [1x1]', 'snow-grass [1x1]'],
  [BIOMES.MOUNTAIN.id]: ['large-purple-crystal [2x2]', 'large-pink-crystal [2x2]', 'small-dirt-rocks-a [1x1]', 'dirt-rock [1x1]'],
  [BIOMES.OCEAN.id]: ['pointy-sea-shell [1x1]'],
  /** Tufts / cascos / areia — o que era overlay “dirt” + costa; sem folhagem de terreno `jogador sandy`. */
  [BIOMES.BEACH.id]: [
    'beach-dirt-turf [1x1]',
    'small-grass [1x1]',
    'mushroom-1 [1x1]',
    'sand-grass [1x1]',
    'pointy-sea-shell [1x1]',
    'fold-sea-shell [1x1]'
  ],
  [BIOMES.DESERT.id]: ['big-cactus-1 [2x2]', 'small-cactus [1x1]'],
  [BIOMES.SAVANNA.id]: ['savannah-tree [3x3]', 'small-cactus [1x1]'],
  [BIOMES.CITY.id]: ['white-daisy [1x1]', 'blue-daisy [1x1]', 'pink-daisy [1x1]', 'small-grass [1x1]'],
  [BIOMES.CITY_STREET.id]: [],
  [BIOMES.TOWN.id]: ['yellow-lily [1x1]', 'red-daisy [1x1]', 'dirt-rock [1x1]', 'fern [1x1]'],
  [BIOMES.TOWN_STREET.id]: [],
  [BIOMES.ARCANE.id]: ['large-purple-crystal [2x2]', 'small-purple-crystal [1x1]', 'large-light-blue-crystal [2x2]', 'small-light-blue-crystal [1x1]'],
  [BIOMES.GHOST_WOODS.id]: [
    'large-red-broadleaf-1 [4x3]', 'large-orange-broadleaf-1 [4x3]', 'large-yellow-broadleaf-1 [4x3]',
    'red-broadleaf-1 [3x2]', 'orange-broadleaf-1 [3x2]', 'yellow-broadleaf-1 [3x2]',
    'red-broadleaf-2 [3x2]', 'orange-broadleaf-2 [3x2]', 'yellow-broadleaf-2 [3x2]',
    'fern [1x1]', 'mushroom-1 [1x1]'
  ],
  [BIOMES.TUNDRA.id]: [
    'blue-lily [1x1]', 'purple-lily [1x1]', 'blue-daisy [1x1]', 
    'blue-coreopsis [1x1]', 'purple-coreopsis [1x1]', 
    'small-blue-crystal [1x1]', 'small-purple-crystal [1x1]', 
    'snow-grass [1x1]', 'baby-pine-tree-full-snow [1x1]'
  ],
};

/**
 * Onde bake/render permitem scatter (e gates alinhados): terra firme (heightStep ≥ 1) ou **praia** no degrau 0
 * (faixa litoral em `elevationToStep`; oceano fica com heightStep negativo).
 */
export function tileSurfaceAllowsScatterVegetation(tile) {
  if (!tile || tile.isRoad || tile.isCity) return false;
  if (tile.heightStep >= 1) return true;
  return tile.biomeId === BIOMES.BEACH.id && tile.heightStep === 0;
}

/**
 * Scatter com pedra/cristal não deve balançar com "vento" no render.
 * Chaves são nomes de OBJECT_SETS (ex.: "small-dirt-rocks-a [1x1]").
 */
export function scatterHasWindSway(itemKey) {
  const k = String(itemKey).toLowerCase();
  if (k.includes('crystal')) return false;
  if (k.includes('dirt-rock') || k.includes('dirt-rocks')) return false;
  if (k.includes('big-cactus')) return false;
  if (k.includes('shell')) return false;
  return true;
}

/**
 * Scatter com pedra/cristal deve ter sorting no eixo Y com o player.
 */
export function isSortableScatter(itemKey) {
  const k = String(itemKey).toLowerCase();
  return (
    k.includes('crystal') ||
    k.includes('rock') ||
    k.includes('cactus') ||
    k.includes('broadleaf') ||
    k.includes('palm') ||
    k.includes('pine') ||
    k.includes('savannah-tree')
  );
}

// ==== FOLIAGE TILE IDS (Diretamente do Tileset Nature) ====
// Estes são tile IDs locais no tileset flurmimons_nature (57 colunas, 16px)

/** Grass overlay tile IDs per biome variant */
export const GRASS_TILES = {
  default: { original: 117, small: 60, grass2: 3 },
  ice: { original: 118, small: 61, grass2: 4 },
  /** Desert short-grass overlay only (sand tufts). Small cactus is scatter-only — see `small-cactus [1x1]`, like baby pine. */
  desert: { original: 1884 },
  dirt: { original: 65, originalTop: 8, small: 60, mushroom: 119, dryGrass: 65 },
  /** Freshwater lake foliage (`purples lago-de-agua-doce-*`): OBJECT_SETS lotus / lotus-with-flowers tile IDs on nature sheet */
  lotus: { original: 86, grass2: 85 },
};

/** Tree overlay: 2×3 tiles (2 cols, 3 rows: 2 top + 1 base row) */
export const TREE_TILES = {
  broadleaf: { base: [285, 286], top: [228, 229, 171, 172] },
  broadleaf_red: { base: [287, 288], top: [230, 231, 173, 174] },
  broadleaf_orange: { base: [289, 290], top: [232, 233, 175, 176] },
  broadleaf_yellow: { base: [291, 292], top: [234, 235, 177, 178] },
  broadleaf_half_snow: { base: [293, 294], top: [236, 237, 179, 180] },
  broadleaf_full_snow: { base: [295, 296], top: [238, 239, 181, 182] },
  
  broadleaf2: { base: [297, 298], top: [240, 241, 183, 184] },
  
  pine: { base: [311, 312], top: [254, 255, 197, 198] },
  pine_half_snow: { base: [313, 314], top: [256, 257, 199, 200] },
  
  palm: { base: [322, 323], top: [265, 266, 208, 209] },
};

/** Biomes que NÃO recebem grama */
export const NO_GRASS_BIOMES = new Set([
  BIOMES.OCEAN.id, BIOMES.BEACH.id, BIOMES.MOUNTAIN.id, BIOMES.PEAK.id,
  BIOMES.ICE.id, BIOMES.VOLCANO.id, BIOMES.CITY.id,
  BIOMES.CITY_STREET.id, BIOMES.TOWN.id, BIOMES.TOWN_STREET.id
]);

/** Biomes que NÃO recebem árvores */
export const NO_TREE_BIOMES = new Set([
  BIOMES.OCEAN.id, BIOMES.BEACH.id, BIOMES.DESERT.id,
  BIOMES.MOUNTAIN.id, BIOMES.PEAK.id, BIOMES.ICE.id,
  BIOMES.VOLCANO.id, BIOMES.TUNDRA.id, BIOMES.ARCANE.id,
  BIOMES.SAVANNA.id, BIOMES.CITY.id,
  BIOMES.CITY_STREET.id, BIOMES.TOWN.id, BIOMES.TOWN_STREET.id
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
  [BIOMES.TUNDRA.id]: "jogador light grass",
  [BIOMES.TAIGA.id]: "jogador light grass",
  [BIOMES.ICE.id]: "jogador frozen-rocky",
  [BIOMES.DESERT.id]: "jogador sandy",
  /** Detalhe de solo arenoso vem do scatter (`BIOME_VEGETATION`), não de folhagem de terreno. */
  [BIOMES.BEACH.id]: null,
  [BIOMES.SAVANNA.id]: "jogador orange-grass",
  [BIOMES.VOLCANO.id]: "lava-lake-dirt",
  [BIOMES.GHOST_WOODS.id]: "above dense-bushes",
  [BIOMES.ARCANE.id]: "purples lago-de-agua-doce-rock",
  [BIOMES.CITY.id]: null,
  [BIOMES.CITY_STREET.id]: "cemented-pavement",
  [BIOMES.TOWN.id]: "jogador sandy",
  [BIOMES.TOWN_STREET.id]: "jogador sandy",
};

/**
 * Retorna o variant de grama para um biome ID.
 */
export function getGrassVariant(biomeId) {
  if (NO_GRASS_BIOMES.has(biomeId)) return null;
  if (isLakeLotusFoliageTerrainSet(BIOME_TO_FOLIAGE[biomeId])) return 'lotus';
  if (biomeId === BIOMES.SNOW.id || biomeId === BIOMES.TUNDRA.id || biomeId === BIOMES.TAIGA.id) return 'ice';
  if (biomeId === BIOMES.DESERT.id || biomeId === BIOMES.SAVANNA.id) return 'desert';
  return 'default';
}

/**
 * Retorna o tipo de árvore para um biome ID.
 */
export function getTreeType(biomeId, mx = 0, my = 0, seed = 0) {
  if (NO_TREE_BIOMES.has(biomeId)) return null;
  
  // Deterministic variety within the same biome
  const h = seededHash(mx, my, seed);

  if (biomeId === BIOMES.SNOW.id) {
    return h > 0.4 ? 'pine_half_snow' : 'pine';
  }
  
  if (biomeId === BIOMES.ICE.id) {
    return 'pine_half_snow';
  }

  if (biomeId === BIOMES.TAIGA.id) {
    if (h > 0.7) return 'broadleaf_half_snow';
    if (h > 0.3) return 'pine';
    return 'pine_half_snow';
  }

  if (biomeId === BIOMES.GHOST_WOODS.id) {
    if (h > 0.8) return 'broadleaf_red';
    if (h > 0.6) return 'broadleaf_orange';
    if (h > 0.4) return 'broadleaf_yellow';
    if (h > 0.2) return 'broadleaf2';
    return 'broadleaf';
  }

  // Temperate Forest / Grassland variety
  if (biomeId === BIOMES.FOREST.id || biomeId === BIOMES.GRASSLAND.id) {
     if (h > 0.95) return 'broadleaf_orange';
     if (h > 0.90) return 'broadleaf_yellow';
     if (h > 0.85) return 'broadleaf_red';
     return 'broadleaf';
  }

  if (biomeId === BIOMES.SAVANNA.id) {
     return h > 0.6 ? 'broadleaf_orange' : 'broadleaf_yellow';
  }

  if (biomeId === BIOMES.JUNGLE.id) {
     return 'palm';
  }

  return 'broadleaf';
}

// Configurações dinâmicas de "grama/folhagem curta" por bioma
export function getGrassParams(biomeId) {
  // Padrão (Grasslands, etc.)
  let scale = 0.2;
  let threshold = 0.40;

  // Overrides específicos
  if (biomeId === BIOMES.SAVANNA.id) {
    scale = 0.1;      // Manchas mais pontuais
    threshold = 0.90;  // Bem mais ralo (10% de densidade)
  } else if (biomeId === BIOMES.DESERT.id) {
    scale = 0.15;    // Frequência menor no deserto (campos de cacto maiores)
    threshold = 0.35;
  } else if (biomeId === BIOMES.TUNDRA.id) {
    scale = 0.25;     // Menos itens, mas bem distribuídos
    threshold = 0.55;  // Densidade moderada para as flores/detalhes
  }

  return { scale, threshold };
}

export const TREE_DENSITY_THRESHOLD = 0.55;   // 45% de cobertura (nos blobs)
export const FOLIAGE_DENSITY_THRESHOLD = 0.45; // Threshold para a Forragem

/** Skins de lagoa doce (roxa): grama animada = lótus; só no CENTER do pool, não nas bordas (mesma lógica que folhagem 1.2). */
export function isLakeLotusFoliageTerrainSet(name) {
  return typeof name === 'string' && name.startsWith('purples ') && name.includes('lago-de-agua-doce');
}

/**
 * Folhagem desenhada como “poça” (lava / lago roxo): o autotile deve usar vizinhos com densidade ≥ limiar
 * como “land”, não o mesmo predicado estrito do planalto 3×3 — senão bordas do pool ficam com EDGE/OUT errados.
 * O desenho continua gated por planalto 3×3 em `render.js` / `getFoliageOverlayTileId`.
 */
export function usesPoolAutotileMaskForFoliage(foliageSetName) {
  if (foliageSetName === 'lava-lake-dirt') return true;
  return isLakeLotusFoliageTerrainSet(foliageSetName);
}

/**
 * @param {(col: number, row: number) => object | null | undefined} getTile - mesmo contrato que getMicroTile(mx, my): (col, row)
 * @returns {null | boolean} null = bioma não usa regra de lago; usar gate de altura; true/false = interior CENTER do lago
 */
export function lakeLotusGrassInteriorAllowed(mx, my, tile, microRows, microCols, getTile) {
  const foliageSetName = BIOME_TO_FOLIAGE[tile.biomeId];
  if (!isLakeLotusFoliageTerrainSet(foliageSetName)) return null;
  if (tile.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) return false;
  const foliageSet = TERRAIN_SETS[foliageSetName];
  if (!foliageSet) return false;
  const level = tile.heightStep;
  const biomeId = tile.biomeId;
  const isFoliageSafeAt = (r, c) => {
    const t = getTile(c, r);
    if (!t || t.heightStep !== level || t.biomeId !== biomeId || t.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (getTile(c + dx, r + dy)?.heightStep !== level) return false;
      }
    }
    return true;
  };
  if (!isFoliageSafeAt(my, mx)) return false;
  const isPoolTile = (r, c) => {
    const t = getTile(c, r);
    return !!(t && t.heightStep === level && t.biomeId === biomeId && t.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD);
  };
  const fRole = getRoleForCell(my, mx, microRows, microCols, isPoolTile, foliageSet.type);
  return fRole === 'CENTER';
}

export const GRASS_NOISE_SCALE = 0.2;         // Fallback legacy
export const GRASS_DENSITY_THRESHOLD = 0.40;  // Fallback legacy
export const TREE_NOISE_SCALE = 0.1;          // Blobs de ~10 tiles
export const FOLIAGE_NOISE_SCALE = 0.25;       // Blobs de ~4 tiles


