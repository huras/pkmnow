import { BIOMES } from "./biomes.js";

/**
 * Define allowed landmarks per biome.
 */
const LANDMARK_RULES = {
  [BIOMES.MOUNTAIN.id]: [{ type: "CAVE", name: "Caverna Misteriosa", prob: 0.1 }],
  [BIOMES.VOLCANO.id]: [{ type: "CRATER", name: "Cratera de Lava", prob: 0.3 }],
  [BIOMES.BEACH.id]: [{ type: "LIGHTHOUSE", name: "Farol Antigo", prob: 0.05 }],
  [BIOMES.GHOST_WOODS.id]: [{ type: "SHRINE", name: "Santuário Sombrio", prob: 0.15 }],
  [BIOMES.DESERT.id]: [{ type: "RUINS", name: "Ruínas do Deserto", prob: 0.05 }],
  [BIOMES.JUNGLE.id]: [{ type: "TEMPLE", name: "Templo Escondido", prob: 0.05 }],
  [BIOMES.ARCANE.id]: [{ type: "MONOLITH", name: "Monolito Arcano", prob: 0.2 }],
  [BIOMES.FLOWER_FIELDS.id]: [{ type: "GARDEN", name: "Campo de flores silvestres", prob: 0.14 }],
};

/**
 * Places landmarks based on biomes and anomaly levels.
 */
export function placeLandmarks(rng, width, height, biomes, anomaly, graph) {
  const landmarks = [];
  
  // Create a quick lookup for city positions to avoid placing landmarks ON cities.
  const citySet = new Set(graph.nodes.map(n => `${n.x},${n.y}`));

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (citySet.has(`${x},${y}`)) continue;

      const idx = y * width + x;
      const bId = biomes[idx];
      const rules = LANDMARK_RULES[bId];
      
      if (rules) {
        for (const rule of rules) {
          if (rng() < rule.prob) {
            landmarks.push({
              x, 
              y,
              type: rule.type,
              name: rule.name
            });
            break; // Only one landmark per cell max
          }
        }
      }
    }
  }

  // To prevent overcrowding, keep only a subset.
  return landmarks.sort(() => rng() - 0.5).slice(0, 10);
}
