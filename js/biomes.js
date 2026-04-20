import { PluginRegistry } from './core/plugin-registry.js';

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
  /** Anomaly on dry temperate plains (Campo): high-lineament pockets of wild blooms. */
  FLOWER_FIELDS: { id: 20, name: "Flower Fields", color: "#c86aa8" },
};

/** Faixa de elevação (0–1) acima de `waterLevel` tratada como praia em `getBiome` — alinhar com `elevationToStep` em `chunking.js`. */
export const BEACH_ELEVATION_BAND = 0.05;

/** Fallback when `config.waterLevel` is missing — must match `DEFAULT_CONFIG` in `generator.js`. */
export const DEFAULT_WATER_LEVEL = 0.21;

/**
 * Nível do mar efetivo (0–1) a partir do `config` do mundo; fallback alinhado ao gerador/UI.
 * @param {object} [config]
 * @returns {number}
 */
export function resolveWaterLevel(config = {}) {
  const w = config.waterLevel;
  if (w !== undefined && w !== null && Number.isFinite(Number(w))) {
    return Math.max(1e-4, Math.min(0.98, Number(w)));
  }
  return DEFAULT_WATER_LEVEL;
}

/**
 * lookup biome based on elevation (e), temperature (t), and moisture (m).
 * all inputs normalized 0-1.
 * @param {number} e - elevation
 * @param {number} t - temperature
 * @param {number} m - moisture
 * @param {Object} config - (optional) config with thresholds
 */
export function getBiome(e, t, m, config = {}) {
  const waterLevel = resolveWaterLevel(config);
  const desertMoisture = config.desertMoisture !== undefined ? config.desertMoisture : 0.33;
  const forestMoisture = config.forestMoisture !== undefined ? config.forestMoisture : 0.66;

  // Água
  if (e < waterLevel) return BIOMES.OCEAN;
  
  // Praia (margem estreita acima da água)
  if (e < waterLevel + BEACH_ELEVATION_BAND) return BIOMES.BEACH;
  
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

/**
 * Versão estendida do getBiome que inclui as regras de anomalia (biomas místicos/raros).
 */
export function getBiomeWithAnomalies(e, t, m, a, config = {}) {
    let biomeObj = getBiome(e, t, m, config);

    // Regras de Anomalia (Biomas Místicos)
    if (a > 0.6) {
        const waterLevel = resolveWaterLevel(config);
        const isLand = e >= waterLevel;
        if (isLand) {
            if (e > 0.7 && t > 0.6) {
                biomeObj = BIOMES.VOLCANO;
            } else if (m > 0.6 && t < 0.5) {
                biomeObj = BIOMES.GHOST_WOODS;
            } else if (
                biomeObj === BIOMES.GRASSLAND &&
                a >= 0.54 &&
                a < 0.78 &&
                e >= waterLevel + BEACH_ELEVATION_BAND &&
                e < 0.64
            ) {
                // Campo + moderate anomaly ribbon: pastel meadow (not Arcane's a>0.8 / lowland).
                biomeObj = BIOMES.FLOWER_FIELDS;
            } else if (a > 0.8 && e < 0.5) {
                biomeObj = BIOMES.ARCANE;
            }
            
            // Allow mods to override anomalies
            const modBiomes = PluginRegistry.getBiomes();
            for (const [key, modConfig] of modBiomes) {
              if (modConfig.anomalyCheck && modConfig.anomalyCheck(e, t, m, a, isLand)) {
                biomeObj = modConfig;
              }
            }
        }
    }
    return biomeObj;
}

/**
 * Sincroniza biomas registrados no PluginRegistry para o objeto estático BIOMES.
 * Útil para que a UI e Minimapa encontrem biomas de mods pelo ID.
 */
export function syncModBiomesToStaticObject() {
  const modBiomes = PluginRegistry.getBiomes();
  for (const [key, config] of modBiomes) {
    if (!BIOMES[key]) {
      BIOMES[key] = config;
    }
  }
}

