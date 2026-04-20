import { PluginRegistry } from '../core/plugin-registry.js';
import { seededHash } from '../tessellation-logic.js';
import { spawnPickableCrystalDropAt } from './play-crystal-drops.js';

/**
 * Berry Tree System
 * Manages the state and logic for berry trees.
 */

export const BERRY_TREES_TILESET = 'tilesets/Mountains-Trees-and-Public-Decorations-Fan-Game-757531020.tsx';

// Maturity stages: 0 (Sprout), 1 (Growing), 2 (Full)
// Animation stages: 0, 1

/**
 * @typedef {Object} BerryTreeState
 * @property {string} type - 'Cheri', 'Chesto', etc.
 * @property {number} maturityStage - 0, 1, 2
 * @property {number} animationStage - 0, 1
 * @property {number} lastGrowthTime - performance.now()
 * @property {boolean} harvested - if the berries were taken
 */

const berryTreeStates = new Map();

/**
 * Returns all initialized berry tree states.
 */
export function getAllBerryTreeStates() {
  return berryTreeStates;
}

export const BERRY_TYPES = [
  'Cheri', 'Chesto', 'Pecha', 'Rawst', 'Aspear', 'Leppa', 'Oran'
];

/**
 * Mapping of berry type + maturity stage + animation stage to tile IDs.
 * IDs are from 'Game Boy Advance - Pokemon Ruby _ Sapphire - Miscellaneous - Berry Trees.tsx'.
 */
export const BERRY_TREE_TILES = {
  'Cheri': {
    0: [[132, 198], [133, 199]],
    1: [[134, 200], [135, 201]],
    2: [[136, 202], [137, 203]]
  },
  'Chesto': {
    0: [[138, 204], [139, 205]],
    1: [[140, 206], [141, 207]],
    2: [[142, 208], [143, 209]]
  },
  'Pecha': {
    0: [[210], [211]],
    1: [[146, 212], [147, 213]],
    2: [[148, 214], [149, 215]]
  },
  'Rawst': {
    0: [[216], [217]],
    1: [[218], [219]],
    2: [[220], [221]]
  },
  'Aspear': {
    0: [[156, 222], [157, 223]],
    1: [[158, 224], [159, 225]],
    2: [[160, 226], [161, 227]]
  },
  'Leppa': {
    0: [[96, 162], [97, 163]],
    1: [[164, 230], [165, 231]],
    2: [[166, 232], [167, 233]]
  },
  'Oran': {
    0: [[168, 234], [169, 235]],
    1: [[170, 236], [171, 237]],
    2: [[172, 238], [173, 239]]
  },
  'Persim': {
    0: [[174, 240], [175, 241]],
    1: [[176, 242], [177, 243]],
    2: [[178, 244], [179, 245]]
  },
  'Lum': {
    0: [[180, 246], [181, 247]],
    1: [[182, 248], [183, 249]],
    2: [[184, 250], [185, 251]]
  },
  'Sitrus': {
    0: [[186, 252], [187, 253]],
    1: [[188, 254], [189, 255]],
    2: [[190, 256], [191, 257]]
  },
  'Figy': {
    0: [[192, 258], [193, 259]],
    1: [[194, 260], [195, 261]],
    2: [[196, 262], [197, 263]]
  },
  'Wiki': {
    0: [[396, 462], [397, 463]],
    1: [[398, 464], [399, 465]],
    2: [[400, 466], [401, 467]]
  },
  'Mago': {
    0: [[402, 468], [403, 469]],
    1: [[404, 470], [405, 471]],
    2: [[406, 472], [407, 473]]
  },
  'Aguav': {
    0: [[474], [475]],
    1: [[410, 476], [411, 477]],
    2: [[412, 478], [413, 479]]
  },
  'Iapapa': {
    0: [[480], [481]],
    1: [[416, 482], [417, 483]],
    2: [[418, 484], [419, 485]]
  },
  'Razz': {
    0: [[420, 486], [421, 487]],
    1: [[422, 488], [423, 489]],
    2: [[424, 490], [425, 491]]
  },
  'Bluk': {
    0: [[426, 492], [427, 493]],
    1: [[428, 494], [429, 495]],
    2: [[430, 496], [431, 497]]
  },
  'Pinap': {
    0: [[510], [511]],
    1: [[446, 512], [447, 513]],
    2: [[448, 514], [449, 515]]
  },
  'Pomeg': {
    0: [[516], [517]],
    1: [[452, 518], [453, 519]],
    2: [[454, 520], [455, 521]]
  },
  'Kelpsy': {
    0: [[456, 522], [457, 523]],
    1: [[458, 524], [459, 525]],
    2: [[460, 526], [461, 527]]
  },
  'Qualot': {
    0: [[660, 726], [661, 727]],
    1: [[662, 728], [663, 729]],
    2: [[664, 730], [665, 731]]
  },
  'Hondew': {
    0: [[666, 732], [667, 733]],
    1: [[668, 734], [669, 735]],
    2: [[670, 736], [671, 737]]
  },
  'Grepa': {
    0: [[672, 738], [673, 739]],
    1: [[674, 740], [675, 741]],
    2: [[676, 742], [677, 743]]
  },
  'Tamato': {
    0: [[678, 744], [679, 745]],
    1: [[680, 746], [681, 747]],
    2: [[682, 748], [683, 749]]
  },
  'Cornn': {
    0: [[684, 750], [685, 751]],
    1: [[686, 752], [687, 753]],
    2: [[688, 754], [689, 755]]
  },
  'Magost': {
    0: [[756], [757]],
    1: [[692, 758], [693, 759]],
    2: [[694, 760], [695, 761]]
  },
  'Rabuta': {
    0: [[696, 762], [697, 763]],
    1: [[698, 764], [699, 765]],
    2: [[700, 766], [701, 767]]
  },
  'Nomel': {
    0: [[702, 768], [703, 769]],
    1: [[704, 770], [705, 771]],
    2: [[706, 772], [707, 773]]
  },
  'Spelon': {
    0: [[774], [775]],
    1: [[710, 776], [711, 777]],
    2: [[712, 778], [713, 779]]
  },
  'Pamtre': {
    0: [[714, 780], [715, 781]],
    1: [[716, 782], [717, 783]],
    2: [[718, 784], [719, 785]]
  },
  'Watmel': {
    0: [[720, 786], [721, 787]],
    1: [[722, 788], [723, 789]],
    2: [[724, 790], [725, 791]]
  },
  'Nanab': {
    0: [[432, 498], [433, 499]],
    1: [[434, 500], [435, 501]],
    2: [[436, 502], [437, 503]]
  },
  'Wepear': {
    0: [[438, 504], [439, 505]],
    1: [[440, 506], [441, 507]],
    2: [[442, 508], [443, 509]]
  }
};

// Registry of items
BERRY_TYPES.forEach(berry => {
  PluginRegistry.registerItem(berry.toLowerCase() + '-berry', {
    name: berry + ' Berry',
    slug: berry.toLowerCase() + '-berry',
    description: `A ${berry} berry.`
  });
});

/**
 * Extracts the berry type from an item key (e.g. 'berry-tree-cheri [1x1]' -> 'Cheri').
 */
export function getBerryTypeFromKey(itemKey) {
  const parts = String(itemKey || '').toLowerCase().split('-');
  const typePart = parts.find(p => {
    const nameOnly = p.split(' ')[0].trim();
    return BERRY_TYPES.some(t => t.toLowerCase() === nameOnly);
  });
  if (typePart) {
    const nameOnly = typePart.split(' ')[0].trim();
    return BERRY_TYPES.find(t => t.toLowerCase() === nameOnly);
  }
  return BERRY_TYPES[0]; // Fallback
}

/**
 * Gets or initializes the state of a berry tree at a given location.
 */
export function getBerryTreeState(mx, my, data, itemKey) {
  const key = `${mx},${my}`;
  if (berryTreeStates.has(key)) return berryTreeStates.get(key);

  const type = getBerryTypeFromKey(itemKey);
  
  // Deterministic initial maturity stage based on position
  const maturityH = seededHash(mx, my, data.seed + 888);
  const maturityStage = Math.floor(maturityH * 3); // 0, 1, 2

  const state = {
    type,
    maturityStage,
    animationStage: 0,
    lastGrowthTime: performance.now(),
    harvested: false
  };

  berryTreeStates.set(key, state);
  return state;
}

/**
 * Harvests a berry tree, dropping 2-4 berries.
 */
export function harvestBerryTree(mx, my, player, data, itemKey) {
  const key = `${mx},${my}`;
  const state = getBerryTreeState(mx, my, data, itemKey);
  
  if (state.harvested || state.maturityStage < 2) return 0;

  const h = seededHash(mx, my, performance.now());
  const dropCount = 2 + Math.floor(h * 3); // 2, 3, or 4

  const berryItem = state.type.toLowerCase() + '-berry';
  
  for (let i = 0; i < dropCount; i++) {
    // Randomized position around the tree
    const angle = (i / dropCount) * Math.PI * 2 + (Math.random() - 0.5);
    const dist = 0.5 + Math.random() * 0.5;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    spawnPickableCrystalDropAt(mx + 0.5 + dx, my + 0.5 + dy, berryItem, 1);
  }

  state.harvested = true;
  state.maturityStage = 0; // Reset to sprout
  state.lastGrowthTime = performance.now();
  
  return dropCount;
}

/**
 * Updates animations and maturity growth for berry trees.
 */
export function updateBerryTrees(time) {
  // Simple toggle for animation stage every 500ms
  const animStage = Math.floor(time * 2) % 2;
  const now = performance.now();
  const GROWTH_INTERVAL_MS = 20000; // 20 seconds per stage for demo

  for (const state of berryTreeStates.values()) {
    state.animationStage = animStage;

    // Growth logic
    if (state.maturityStage < 2) {
      if (now - state.lastGrowthTime > GROWTH_INTERVAL_MS) {
        state.maturityStage++;
        state.lastGrowthTime = now;
        state.harvested = false;
      }
    }
  }
}

/**
 * Clears the berry tree states.
 */
export function clearBerryTreeStates() {
  berryTreeStates.clear();
}
