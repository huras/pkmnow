/**
 * Export vegetation (grass / tree OBJECT_SETS) and terrain center tiles (TERRAIN_SETS)
 * using the same tessellation grouping as TessellationEngine.getObjectGrid (bounding box
 * in atlas space). Writes PNGs + manifest for cross-reference to tessellation-data.js.
 *
 *   npm run export:vegetation-terrain-sprites
 *
 * Output: exported/sprites-vegetation-terrain/ (gitignored recommended)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { TERRAIN_SETS, OBJECT_SETS } from '../js/tessellation-data.js';
import { TessellationEngine } from '../js/tessellation-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const OUT_ROOT = join(root, 'exported', 'sprites-vegetation-terrain');
const TILE = 16;

const TREE_RE =
  /\b(tree|palm|cactus|broadleaf|barodleaf|pine|mangrove|savannah-tree|japanese-green)\b/i;
const GRASS_RE =
  /\b(grass|lily|daisy|coreopsis|vine|leaves-on-ground|cattail)\b/i;

/** Match render-utils-internal / play-chunk-bake column counts. */
function getObjectSheetCols(objSet) {
  const f = String(objSet?.file || '');
  if (f.includes('caves')) return 50;
  if (f.includes('magiscarf') || f.includes('further_additional')) return 54;
  if (f.includes('Berry Trees')) return 66;
  return 57;
}

function getTerrainCenterTileId(set) {
  if (set?.centerId != null) return set.centerId;
  const r = set?.roles || {};
  return r.CENTER ?? r.SEAMLESS_CENTER ?? r.SEAMLESS_TILE ?? null;
}

function collectObjectIds(objSet) {
  const ids = [];
  for (const p of objSet.parts || []) {
    for (const id of p.ids || []) ids.push(id);
  }
  return ids;
}

/**
 * Same layout as TessellationEngine.getObjectGrid: place each tile id at its atlas (x,y)
 * inside the minimal bounding rectangle; holes stay transparent.
 */
function buildObjectCompositeGrid(objSet) {
  const cols = getObjectSheetCols(objSet);
  const allIds = collectObjectIds(objSet);
  if (!allIds.length) return null;

  const tiles = allIds.map((id) => ({
    id,
    x: id % cols,
    y: Math.floor(id / cols)
  }));
  const minX = Math.min(...tiles.map((t) => t.x));
  const minY = Math.min(...tiles.map((t) => t.y));
  const maxX = Math.max(...tiles.map((t) => t.x));
  const maxY = Math.max(...tiles.map((t) => t.y));
  const gw = maxX - minX + 1;
  const gh = maxY - minY + 1;
  const grid = Array.from({ length: gh }, () => Array(gw).fill(null));
  for (const t of tiles) {
    grid[t.y - minY][t.x - minX] = t.id;
  }
  return { grid, gw, gh, cols, allIds };
}

function loadPngCached(cache, relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const full = join(root, relPath);
  if (!existsSync(full)) {
    console.warn('[skip atlas] missing file:', relPath);
    cache.set(relPath, null);
    return null;
  }
  const png = PNG.sync.read(readFileSync(full));
  cache.set(relPath, png);
  return png;
}

function blitTile16(src, srcCols, tileId, dst, dx, dy) {
  if (tileId == null || tileId < 0) return;
  const sx = (tileId % srcCols) * TILE;
  const sy = Math.floor(tileId / srcCols) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const si = ((sy + y) * src.width + (sx + x)) * 4;
      const di = ((dy + y) * dst.width + (dx + x)) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

function slugifyObjectFilename(key) {
  const base = key.replace(/\s*\[[0-9]+x[0-9]+\]\s*$/, '').trim();
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function slugifyTerrainName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function atlasBasenameFromPath(rel) {
  const b = basename(rel, '.png');
  return b.replace(/[^a-z0-9_-]+/gi, '_');
}

function classifyVegetation(key) {
  const base = key.replace(/\s*\[[0-9]+x[0-9]+\]\s*$/, '').toLowerCase();
  if (TREE_RE.test(base)) return 'trees';
  if (GRASS_RE.test(base)) return 'grasses';
  return null;
}

function writePng(path, width, height, data) {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width, height });
  png.data = data;
  writeFileSync(path, PNG.sync.write(png));
}

function main() {
  const pngCache = new Map();
  mkdirSync(join(OUT_ROOT, 'grasses'), { recursive: true });
  mkdirSync(join(OUT_ROOT, 'trees'), { recursive: true });
  mkdirSync(join(OUT_ROOT, 'terrain-centers', 'individual'), { recursive: true });

  const manifest = {
    generatedBy: 'scripts/extract-grass-tree-terrain-sprites.mjs',
    grasses: [],
    trees: [],
    terrainCenters: []
  };

  for (const [key, objSet] of Object.entries(OBJECT_SETS)) {
    const cat = classifyVegetation(key);
    if (!cat) continue;

    const layout = buildObjectCompositeGrid(objSet);
    if (!layout) continue;

    const relAtlas = TessellationEngine.getImagePath(objSet.file);
    const src = loadPngCached(pngCache, relAtlas);
    if (!src) continue;

    const { grid, gw, gh } = layout;
    const outW = gw * TILE;
    const outH = gh * TILE;
    const buf = Buffer.alloc(outW * outH * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i + 3] = 0;
    }
    const dst = { width: outW, height: outH, data: buf };

    const srcCols = getObjectSheetCols(objSet);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const tid = grid[gy][gx];
        if (tid != null) blitTile16(src, srcCols, tid, dst, gx * TILE, gy * TILE);
      }
    }

    const shape = objSet.shape || `${gw}x${gh}`;
    const slug = slugifyObjectFilename(key);
    const atlasTag = atlasBasenameFromPath(relAtlas);
    const fname = `${slug}__shape-${shape}__tiles-${layout.allIds.join('_')}__${atlasTag}.png`;
    const outPath = join(OUT_ROOT, cat, fname);

    writePng(outPath, outW, outH, buf);

    const entry = {
      objectSetKey: key,
      category: cat,
      shape: String(shape),
      tileIds: layout.allIds,
      atlasRelativePath: relAtlas,
      gridSizeTiles: { w: gw, h: gh },
      outputRelativePath: `exported/sprites-vegetation-terrain/${cat}/${fname}`
    };
    manifest[cat === 'trees' ? 'trees' : 'grasses'].push(entry);
  }

  const terrainEntries = [];
  const terrainNames = Object.keys(TERRAIN_SETS).sort((a, b) => a.localeCompare(b));
  const sheetCols = Math.ceil(Math.sqrt(terrainNames.length));
  const sheetRows = Math.ceil(terrainNames.length / sheetCols);
  const sheetW = sheetCols * TILE;
  const sheetH = sheetRows * TILE;
  const sheetBuf = Buffer.alloc(sheetW * sheetH * 4);
  for (let i = 0; i < sheetBuf.length; i += 4) sheetBuf[i + 3] = 0;
  const sheetPng = { width: sheetW, height: sheetH, data: sheetBuf };

  let sheetIdx = 0;
  for (const name of terrainNames) {
    const set = TERRAIN_SETS[name];
    const centerId = getTerrainCenterTileId(set);
    if (centerId == null || centerId < 0) {
      console.warn('[terrain] no center tile for', name);
      continue;
    }

    const relAtlas = TessellationEngine.getImagePath(set.file);
    const src = loadPngCached(pngCache, relAtlas);
    if (!src) continue;

    const tCols = TessellationEngine.getTerrainSheetCols(set);
    const slug = slugifyTerrainName(name);
    const atlasTag = atlasBasenameFromPath(relAtlas);
    const indName = `${slug}__center-${centerId}__${atlasTag}.png`;
    const indPath = join(OUT_ROOT, 'terrain-centers', 'individual', indName);
    const one = Buffer.alloc(TILE * TILE * 4);
    for (let i = 0; i < one.length; i += 4) one[i + 3] = 0;
    const onePng = { width: TILE, height: TILE, data: one };
    blitTile16(src, tCols, centerId, onePng, 0, 0);
    writePng(indPath, TILE, TILE, one);

    const cx = sheetIdx % sheetCols;
    const cy = Math.floor(sheetIdx / sheetCols);
    blitTile16(src, tCols, centerId, sheetPng, cx * TILE, cy * TILE);

    const tEntry = {
      terrainSetName: name,
      terrainType: set.type,
      centerTileId: centerId,
      atlasRelativePath: relAtlas,
      sheetCols: tCols,
      individualRelativePath: `exported/sprites-vegetation-terrain/terrain-centers/individual/${indName}`,
      atlasSheetCell: { x: cx, y: cy }
    };
    terrainEntries.push(tEntry);
    sheetIdx++;
  }

  writePng(join(OUT_ROOT, 'terrain-centers', 'terrain-centers-atlas.png'), sheetW, sheetH, sheetBuf);

  manifest.terrainCenters = terrainEntries;
  manifest.terrainCentersAtlas = {
    path: 'exported/sprites-vegetation-terrain/terrain-centers/terrain-centers-atlas.png',
    columns: sheetCols,
    rows: sheetRows,
    tilePx: TILE,
    cellOrder: 'row-major of sorted terrainSetName'
  };

  writeFileSync(join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(
    'Done.',
    manifest.grasses.length,
    'grasses,',
    manifest.trees.length,
    'trees,',
    manifest.terrainCenters.length,
    'terrain centers →',
    OUT_ROOT
  );
}

main();
