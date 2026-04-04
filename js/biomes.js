/**
 * Biomes definitions and lookup logic based on Whittaker model.
 */

export const BIOMES = {
  OCEAN: { id: 0, name: "Oceano", color: "#3060a0" },
  BEACH: { id: 1, name: "Praia", color: "#e0c090" },
  DESERT: { id: 2, name: "Deserto", color: "#d2b48c" },
  GRASSLAND: { id: 3, name: "Campo", color: "#80a040" },
  FOREST: { id: 4, name: "Floresta", color: "#407030" },
  TAIGA: { id: 5, name: "Taiga", color: "#506040" },
  TUNDRA: { id: 6, name: "Tundra", color: "#708070" },
  SNOW: { id: 7, name: "Neve", color: "#f0f0f0" },
  ICE: { id: 8, name: "Gelo", color: "#c0e0f0" },
  SAVANNA: { id: 9, name: "Savana", color: "#a0a040" },
  JUNGLE: { id: 10, name: "Selva", color: "#205020" },
  MOUNTAIN: { id: 11, name: "Montanha", color: "#706050" },
  PEAK: { id: 12, name: "Pico Nevado", color: "#ffffff" },
  VOLCANO: { id: 13, name: "Vulcão", color: "#303030" }, // Cinza escuro/obsidiana
  GHOST_WOODS: { id: 14, name: "Misty Woods", color: "#403050" }, // Roxo sombrio
  ARCANE: { id: 15, name: "Vale Arcano", color: "#602080" }, // Magenta
  CITY: { id: 16, name: "Cidade", color: "#808080" },
  CITY_STREET: { id: 17, name: "Rua de Cidade", color: "#606060" },
  TOWN: { id: 18, name: "Vila Rural", color: "#b09070" },
  TOWN_STREET: { id: 19, name: "Rua de Vila", color: "#907050" },
};

/**
 * lookup biome based on elevation (e), temperature (t), and moisture (m).
 * all inputs normalized 0-1.
 * @param {number} e - elevation
 * @param {number} t - temperature
 * @param {number} m - moisture
 * @param {Object} config - (optional) config with thresholds
 */
export function getBiome(e, t, m, config = {}) {
  const waterLevel = config.waterLevel !== undefined ? config.waterLevel : 0.38;
  const desertMoisture = config.desertMoisture !== undefined ? config.desertMoisture : 0.33;
  const forestMoisture = config.forestMoisture !== undefined ? config.forestMoisture : 0.66;

  // Água
  if (e < waterLevel) return BIOMES.OCEAN;
  
  // Praia (margem estreita acima da água)
  if (e < waterLevel + 0.05) return BIOMES.BEACH;
  
  // Montanhas Altas
  if (e > 0.8) return BIOMES.PEAK;
  if (e > 0.7) return BIOMES.MOUNTAIN;
  
  // Tabela de Whittaker Simplificada
  if (t < 0.3) {
    if (m < desertMoisture) return BIOMES.TUNDRA;
    if (m < forestMoisture) return BIOMES.TAIGA;
    return BIOMES.SNOW;
  }
  
  if (t < 0.6) {
    if (m < desertMoisture) return BIOMES.GRASSLAND;
    if (m < forestMoisture) return BIOMES.FOREST;
    return BIOMES.JUNGLE;
  }
  
  // Quente
  if (m < desertMoisture) return BIOMES.DESERT;
  if (m < forestMoisture) return BIOMES.SAVANNA;
  return BIOMES.JUNGLE;
}

