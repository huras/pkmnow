/**
 * Terreno solo grama conc-conv-a: master `tilesets/grassy-terrain.png` (5×3 × 16px).
 * O bake só lê esse ficheiro; saídas em `tilesets/palettes/grassy-*.png` (nunca sobrescreve o master).
 * Bordas = mesmas 7 cores canónicas que rocky (`CANONICAL_ROCKY_RGB` em terrain-palette-base.js).
 * Grama = 4 tons em CANONICAL_GRASS_RGB.
 */

import { CANONICAL_ROCKY_RGB, pairsFromTargets, makePaletteConcASet } from './terrain-palette-base.js';

/** Tons de grama no desenho do master (RGB exatos). */
export const CANONICAL_GRASS_RGB = {
  g1: [70, 155, 57],
  g2: [94, 190, 80],
  g3: [137, 207, 126],
  g4: [163, 218, 154]
};

function pairsFromGrassTargets(targets) {
  const g = CANONICAL_GRASS_RGB;
  return [
    { from: g.g1, to: targets.g1 },
    { from: g.g2, to: targets.g2 },
    { from: g.g3, to: targets.g3 },
    { from: g.g4, to: targets.g4 }
  ];
}

/** Bordas iguais ao master; só a grama muda entre variantes. */
function grassyPairs(borderTargets, grassTargets) {
  return [...pairsFromTargets(borderTargets), ...pairsFromGrassTargets(grassTargets)];
}

const IDENTITY_BORDER = {
  main1: CANONICAL_ROCKY_RGB.main1,
  main2: CANONICAL_ROCKY_RGB.main2,
  mainPrimary: CANONICAL_ROCKY_RGB.mainPrimary,
  main3: CANONICAL_ROCKY_RGB.main3,
  shadow1: CANONICAL_ROCKY_RGB.shadow1,
  shadow2: CANONICAL_ROCKY_RGB.shadow2,
  line: CANONICAL_ROCKY_RGB.line
};

const IDENTITY_GRASS = {
  g1: CANONICAL_GRASS_RGB.g1,
  g2: CANONICAL_GRASS_RGB.g2,
  g3: CANONICAL_GRASS_RGB.g3,
  g4: CANONICAL_GRASS_RGB.g4
};

/** Floresta / taiga: grama um pouco mais clara e amarelada. */
const GRASS_LIGHT = {
  g1: [82, 172, 70],
  g2: [108, 202, 92],
  g3: [152, 218, 138],
  g4: [182, 228, 172]
};

/** Selva / bosque fantasma: verde mais saturado e profundo. */
const GRASS_LUSH = {
  g1: [48, 138, 44],
  g2: [68, 175, 58],
  g3: [115, 198, 102],
  g4: [145, 215, 128]
};

export function getGrassyPaletteBakeJobs() {
  return [
    { outFile: 'tilesets/palettes/grassy-field.png', pairs: grassyPairs(IDENTITY_BORDER, IDENTITY_GRASS) },
    { outFile: 'tilesets/palettes/grassy-light.png', pairs: grassyPairs(IDENTITY_BORDER, GRASS_LIGHT) },
    { outFile: 'tilesets/palettes/grassy-lush.png', pairs: grassyPairs(IDENTITY_BORDER, GRASS_LUSH) }
  ];
}

export const PALETTE_GRASSY_TERRAIN_SETS = {
  'Palette grassy — field': makePaletteConcASet('tilesets/palettes/grassy-field.png'),
  'Palette grassy — light': makePaletteConcASet('tilesets/palettes/grassy-light.png'),
  'Palette grassy — lush': makePaletteConcASet('tilesets/palettes/grassy-lush.png')
};

export const PALETTE_GRASSY_IMAGE_PATHS = Object.values(PALETTE_GRASSY_TERRAIN_SETS).map((s) => s.file);
