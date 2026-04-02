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
};

/**
 * lookup biome based on elevation (e), temperature (t), and moisture (m).
 * all inputs normalized 0-1.
 */
export function getBiome(e, t, m) {
  // Água
  if (e < 0.1) return BIOMES.OCEAN;
  if (e < 0.3) return BIOMES.OCEAN; // Ajustado para bater com 0.3 anterior
  
  // Praia
  if (e < 0.35) return BIOMES.BEACH;
  
  // Montanhas Altas
  if (e > 0.8) return BIOMES.PEAK;
  if (e > 0.7) return BIOMES.MOUNTAIN;
  
  // Tabela de Whittaker Simplificada
  if (t < 0.3) {
    if (m < 0.33) return BIOMES.TUNDRA;
    if (m < 0.66) return BIOMES.TAIGA;
    return BIOMES.SNOW;
  }
  
  if (t < 0.6) {
    if (m < 0.33) return BIOMES.GRASSLAND;
    if (m < 0.66) return BIOMES.FOREST;
    return BIOMES.JUNGLE;
  }
  
  // Quente
  if (m < 0.33) return BIOMES.DESERT;
  if (m < 0.66) return BIOMES.SAVANNA;
  return BIOMES.JUNGLE;
}
