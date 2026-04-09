/**
 * Terreno "solo" conc-conv-a: folha 5 col × 3 linhas × 16px (igual a rocky-terrain.png).
 * Cores canónicas no master `tilesets/rocky-terrain.png` — ver CANONICAL_ROCKY_RGB.
 * Variantes em `tilesets/palettes/*.png`: gerar com `npm run build:palettes` (scripts/bake-terrain-palettes.mjs).
 */

/** Cores de referência no desenho (todas as cópias em /palettes/ devem usar estes RGB exatos). */
export const CANONICAL_ROCKY_RGB = {
  main1: [205, 179, 143],
  main2: [194, 163, 120],
  /** Tom principal mais presente no tile. */
  mainPrimary: [184, 147, 97],
  main3: [169, 132, 95],
  shadow1: [146, 112, 78],
  shadow2: [115, 87, 60],
  line: [69, 52, 39]
};

/** Remap das 7 cores de borda/solo (master rocky ou grassy). */
export function pairsFromTargets(targets) {
  const c = CANONICAL_ROCKY_RGB;
  return [
    { from: c.main1, to: targets.main1 },
    { from: c.main2, to: targets.main2 },
    { from: c.mainPrimary, to: targets.mainPrimary },
    { from: c.main3, to: targets.main3 },
    { from: c.shadow1, to: targets.shadow1 },
    { from: c.shadow2, to: targets.shadow2 },
    { from: c.line, to: targets.line }
  ];
}

/** Alvos por variante (ajusta à vontade). Rock = identidade (sem remap). */
const VARIANT_TARGETS = {
  sand: {
    main1: [232, 210, 165],
    main2: [220, 195, 140],
    mainPrimary: [210, 183, 128],
    main3: [200, 170, 115],
    shadow1: [180, 145, 95],
    shadow2: [155, 120, 75],
    line: [110, 85, 55]
  },
  snow: {
    main1: [235, 240, 248],
    main2: [210, 222, 238],
    mainPrimary: [198, 214, 233],
    main3: [185, 205, 228],
    shadow1: [140, 165, 198],
    shadow2: [110, 135, 172],
    line: [75, 92, 118]
  },
  volcano: {
    main1: [92, 72, 68],
    main2: [76, 58, 55],
    mainPrimary: [69, 52, 50],
    main3: [62, 46, 44],
    shadow1: [48, 36, 36],
    shadow2: [38, 28, 30],
    line: [28, 20, 22]
  },
  arcane: {
    main1: [182, 148, 208],
    main2: [152, 118, 178],
    mainPrimary: [137, 103, 163],
    main3: [122, 88, 148],
    shadow1: [92, 64, 118],
    shadow2: [72, 48, 98],
    line: [48, 32, 78]
  },
  lakeShore: {
    main1: [176, 198, 162],
    main2: [152, 178, 138],
    mainPrimary: [140, 165, 126],
    main3: [128, 152, 114],
    shadow1: [96, 122, 88],
    shadow2: [74, 96, 70],
    line: [52, 68, 46]
  },
  ice: {
    main1: [218, 242, 250],
    main2: [188, 232, 244],
    mainPrimary: [173, 225, 241],
    main3: [158, 218, 238],
    shadow1: [118, 188, 218],
    shadow2: [88, 168, 202],
    line: [52, 118, 148]
  }
};

/** Saídas do bake Node (`npm run build:palettes`), todas a partir de rocky-terrain.png. */
export function getTerrainPaletteBakeJobs() {
  return [
    { outFile: 'tilesets/palettes/base-sand.png', pairs: pairsFromTargets(VARIANT_TARGETS.sand) },
    { outFile: 'tilesets/palettes/base-snow.png', pairs: pairsFromTargets(VARIANT_TARGETS.snow) },
    { outFile: 'tilesets/palettes/base-volcano.png', pairs: pairsFromTargets(VARIANT_TARGETS.volcano) },
    { outFile: 'tilesets/palettes/base-arcane.png', pairs: pairsFromTargets(VARIANT_TARGETS.arcane) },
    { outFile: 'tilesets/palettes/base-lake-shore.png', pairs: pairsFromTargets(VARIANT_TARGETS.lakeShore) },
    { outFile: 'tilesets/palettes/base-ice.png', pairs: pairsFromTargets(VARIANT_TARGETS.ice) }
  ];
}

export const PALETTE_CONC_A_ROLES = {
  OUT_NW: 0,
  EDGE_N: 1,
  OUT_NE: 2,
  EDGE_W: 5,
  CENTER: 6,
  EDGE_E: 7,
  IN_SE: 8,
  IN_SW: 9,
  OUT_SW: 10,
  EDGE_S: 11,
  OUT_SE: 12,
  IN_NE: 13,
  IN_NW: 14
};

export function makePaletteConcASet(imagePath) {
  return {
    type: 'conc-conv-a',
    sheetCols: 5,
    centerId: 6,
    file: imagePath,
    roles: { ...PALETTE_CONC_A_ROLES }
  };
}

export const PALETTE_BASE_TERRAIN_SETS = {
  'Palette base — rock': makePaletteConcASet('tilesets/rocky-terrain.png'),
  'Palette base — sand': makePaletteConcASet('tilesets/palettes/base-sand.png'),
  'Palette base — snow': makePaletteConcASet('tilesets/palettes/base-snow.png'),
  'Palette base — volcano': makePaletteConcASet('tilesets/palettes/base-volcano.png'),
  'Palette base — arcane': makePaletteConcASet('tilesets/palettes/base-arcane.png'),
  'Palette base — lake shore': makePaletteConcASet('tilesets/palettes/base-lake-shore.png'),
  'Palette base — ice': makePaletteConcASet('tilesets/palettes/base-ice.png')
};

export const PALETTE_BASE_IMAGE_PATHS = Object.values(PALETTE_BASE_TERRAIN_SETS).map((s) => s.file);

const PALETTE_BASE_NAME_TO_SLUG = new Map();
for (const [name, def] of Object.entries(PALETTE_BASE_TERRAIN_SETS)) {
  const f = def.file;
  if (f.includes('rocky-terrain')) PALETTE_BASE_NAME_TO_SLUG.set(name, 'rock');
  else {
    const m = f.match(/\/base-([\w-]+)\.png$/);
    if (m) PALETTE_BASE_NAME_TO_SLUG.set(name, m[1]);
  }
}

/** Slug rocky-style (null para grama, Dirty *, cidade, etc.). */
export function paletteBaseSlugFromTerrainSetName(setName) {
  return PALETTE_BASE_NAME_TO_SLUG.get(setName) ?? null;
}

/** Par ordenado → ficheiro em `tilesets/palettes/trans/` (média RGBA bake-time). */
export function paletteBaseTransitionImageRelPath(slugA, slugB) {
  const [a, b] = slugA < slugB ? [slugA, slugB] : [slugB, slugA];
  return `tilesets/palettes/trans/base-${a}--${b}.png`;
}

function sourceRelPathForPaletteBaseSlug(slug) {
  for (const def of Object.values(PALETTE_BASE_TERRAIN_SETS)) {
    const f = def.file;
    if (slug === 'rock' && f.includes('rocky-terrain')) return f;
    const m = f.match(/\/base-([\w-]+)\.png$/);
    if (m && m[1] === slug) return f;
  }
  throw new Error(`Unknown palette base slug: ${slug}`);
}

/** Lista para preload; gerar com `npm run build:palettes`. */
export function allPaletteBaseTransitionImagePaths() {
  const slugs = [...new Set(PALETTE_BASE_NAME_TO_SLUG.values())].sort();
  const out = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      out.push(paletteBaseTransitionImageRelPath(slugs[i], slugs[j]));
    }
  }
  return out;
}

/** Jobs para o bake Node (lê PNGs já assados, escreve trans/). */
export function getPaletteBaseTransitionBakeJobs() {
  const slugs = [...new Set(PALETTE_BASE_NAME_TO_SLUG.values())].sort();
  const jobs = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = slugs[i];
      const b = slugs[j];
      jobs.push({
        pathA: sourceRelPathForPaletteBaseSlug(a),
        pathB: sourceRelPathForPaletteBaseSlug(b),
        outFile: paletteBaseTransitionImageRelPath(a, b)
      });
    }
  }
  return jobs;
}
