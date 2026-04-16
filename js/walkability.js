/**
 * Caminhável = tile base resolve para um sprite de terreno classificado como
 * Layer Base ou Terrain Foliage (forragem "jogador *"), conforme docs/regras-de-tesselação.md.
 * Exclui penhascos (altura), água/lava (Borda com…), lago roxo: ver bloco em `canWalkMicroTile` (overlay vs sem overlay).
 */

import { BIOMES } from './biomes.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { MACRO_TILE_STRIDE, getMicroTile, foliageDensity } from './chunking.js';
import { getRoleForCell, isTerrainInnerCornerRole, parseShape, seededHash } from './tessellation-logic.js';
import {
  scatterSolidBaseBlocksMicroTile,
  validScatterOriginMicro,
  scatterItemKeyIsTree,
  scatterItemKeyIsSolid
} from './scatter-pass2-debug.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_VEGETATION,
  BIOME_TO_FOLIAGE,
  FOLIAGE_DENSITY_THRESHOLD,
  isLakeLotusFoliageTerrainSet,
  usesPoolAutotileMaskForFoliage,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE
} from './biome-tiles.js';
import {
  TRUNK_STRIP_WIDTH_FRAC,
  FORMAL_TRUNK_BASE_WIDTH_TILES,
  scatterSolidStemRadiusMultiplier,
  scatterStemPhysicsPivotOffsetMicroTiles
} from './scatter-collider-config.js';
import { isPlayDetailScatterOriginDestroyed, isPlayFormalTreeRootDestroyed } from './main/play-crystal-tackle.js';
import { getScatterItemKeyOverride, hasScatterItemKeyOverride } from './main/scatter-item-override.js';

/** When non-null, `canWalkMicroTile(..., ignoreTreeTrunks: true)` results are memoized for this batch (player movement probes). */
let walkProbeCache = null;
const walkProbeCacheStorage = new Map();

/**
 * Call before a tight sequence of `canWalk` / `canWalkMicroTile` with `ignoreTreeTrunks: true`
 * (e.g. bisection in `updatePlayer`). Clears any prior batch.
 */
export function beginWalkProbeCache() {
  walkProbeCacheStorage.clear();
  walkProbeCache = walkProbeCacheStorage;
}

/** Clears the walk probe memo; call after the movement batch (typically in `finally`). */
export function endWalkProbeCache() {
  walkProbeCache = null;
  walkProbeCacheStorage.clear();
}

/**
 * @param {string} name - chave em TERRAIN_SETS
 * @returns {'layer-base' | 'terrain-foliage' | null}
 */
export function getTerrainSetWalkKind(name) {
  if (name.startsWith('altura ')) return null;
  if (name.startsWith('Borda com ')) return null;
  if (name.startsWith('purples ')) return null;
  if (name.startsWith('jogador ')) return 'terrain-foliage';
  /** Solo conc-conv-a (`terrain-palette-base.js`), mesma lógica que Rocky/Dirty: base caminhável. */
  if (name.startsWith('Palette base')) return 'layer-base';
  if (name.startsWith('Palette grassy')) return 'layer-base';
  if (
    name.startsWith('Dirty ') ||
    name.startsWith('Yellow Dirty ') ||
    name.startsWith('Rocky ') ||
    name.startsWith('Red Dirty ') ||
    name === 'sandy' ||
    name === 'snowy-sandy' ||
    name.endsWith('-pavement') ||
    name.endsWith('-bridge') ||
    name.startsWith('stair-') ||
    name === 'road' ||
    name === 'cidade chao' ||
    name === 'rocky-volcano' ||
    name.startsWith('above ')
  ) {
    return 'layer-base';
  }
  return null;
}

/** Resolved autotile set name for walk rules (roads use `roadFeature`, e.g. `stair-ns`). */
function resolveTerrainSetNameForWalk(tile) {
  if (!tile) return '';
  let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
  if (tile.isRoad && tile.roadFeature) setName = tile.roadFeature;
  return setName;
}

function isStairOrBridgeTerrainSetName(setName) {
  return setName.includes('stair-') || setName.includes('-bridge');
}

function isConnectorTileForHeightStep(tile) {
  return isStairOrBridgeTerrainSetName(resolveTerrainSetNameForWalk(tile));
}

/** True if `heightStep` may differ between these two micro tiles (ramp, bridge↔stair, etc.). */
export function okHeightStepTransition(sourceTile, targetTile) {
  if (!sourceTile || !targetTile) return true;
  if (sourceTile.heightStep === targetTile.heightStep) return true;

  const step = Math.abs(targetTile.heightStep - sourceTile.heightStep);
  const srcConn = isConnectorTileForHeightStep(sourceTile);
  const tgtConn = isConnectorTileForHeightStep(targetTile);

  // e.g. wooden-bridge (h=8) next to stair-ns (h=0): large nominal gap, still one logical ramp.
  if (srcConn && tgtConn) return true;

  if (step <= 1 && (srcConn || tgtConn)) return true;

  return false;
}

/**
 * When the sprite pivot crosses a micro-tile edge, enforce the same height rules as foot-based
 * movement. Needed because PMD feet sit south of the pivot: feet can still sample the upper
 * plateau (e.g. EDGE_N at h+1) while the pivot already entered the cell to the north at height h,
 * which would incorrectly allow stepping off a cliff without a ramp/stair.
 */
export function pivotCellHeightTraversalOk(pivotX, pivotY, srcPivotX, srcPivotY, macroData) {
  if (srcPivotX === undefined || srcPivotY === undefined) return true;
  const pmx = Math.floor(pivotX);
  const pmy = Math.floor(pivotY);
  const smx0 = Math.floor(srcPivotX);
  const smy0 = Math.floor(srcPivotY);
  if (pmx === smx0 && pmy === smy0) return true;
  const pt = getMicroTile(pmx, pmy, macroData);
  const st = getMicroTile(smx0, smy0, macroData);
  if (!pt || !st) return false;
  if (pt.heightStep === st.heightStep) return true;
  return okHeightStepTransition(st, pt);
}

/**
 * Pivot-cell height delta (destination − source). Used for burrow climb rules.
 * @returns {number | null} null if either tile missing
 */
export function pivotCellHeightStepDelta(pivotX, pivotY, srcPivotX, srcPivotY, macroData) {
  if (srcPivotX === undefined || srcPivotY === undefined) return null;
  const pmx = Math.floor(pivotX);
  const pmy = Math.floor(pivotY);
  const smx0 = Math.floor(srcPivotX);
  const smy0 = Math.floor(srcPivotY);
  const pt = getMicroTile(pmx, pmy, macroData);
  const st = getMicroTile(smx0, smy0, macroData);
  if (!pt || !st) return null;
  return pt.heightStep - st.heightStep;
}

export const WALL_ROLES = new Set([
  'EDGE_S', 'EDGE_W', 'EDGE_E', 
  'IN_NW', 'IN_NE', 'IN_SW', 'IN_SE',
  'OUT_NW', 'OUT_NE', 'OUT_SW', 'OUT_SE',
  'OUT_S', 'OUT_W', 'OUT_E', 
  'CORNER_S_W', 'CORNER_S_E'
]);

export const WALKABLE_SURFACE_TERRAIN_TILE_IDS = (() => {
  const s = new Set();
  const BLOCKED_ROLES = WALL_ROLES;

  for (const [name, set] of Object.entries(TERRAIN_SETS)) {
    const walkKind = getTerrainSetWalkKind(name);
    if (walkKind) {
      const isConnector = name.includes('stair-') || name.includes('-bridge');
      
      if (set.centerId != null) s.add(set.centerId);
      for (const [role, id] of Object.entries(set.roles || {})) {
        // Connectors are walkable on all roles. 
        // Standard ground blocks on "Wall" roles (South/West/East edges).
        // Northern edges are kept walkable to allow standing at the brink.
        const isWallRole = BLOCKED_ROLES.has(role);
        if (isConnector || !isWallRole) {
          s.add(id);
        }
      }
    } else if (name.includes('lake') || name.startsWith('Borda com ') || name.startsWith('purples ')) {
      // Water borders: OUT roles are ground, CENTER/EDGE are water/wall.
      for (const [role, id] of Object.entries(set.roles || {})) {
        if (role.startsWith('OUT_')) s.add(id);
      }
    }
  }
  return s;
})();

export function getMicroTileRole(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return null;
  let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
  if (tile.isRoad && tile.roadFeature) setName = tile.roadFeature;
  const set = TERRAIN_SETS[setName];
  if (!set) return null;
  const isAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= tile.heightStep;
  return getRoleForCell(my, mx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, isAtOrAbove, set.type);
}

export function getBaseTerrainSpriteId(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return null;
  let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
  if (tile.isRoad && tile.roadFeature) setName = tile.roadFeature;
  const set = TERRAIN_SETS[setName];
  if (!set) return null;
  const role = getMicroTileRole(mx, my, data);
  return set.roles[role] ?? set.roles.CENTER ?? set.roles.SEAMLESS_CENTER ?? set.roles.SEAMLESS_TILE ?? set.centerId ?? null;
}

export function isBaseTerrainSpriteWalkable(spriteId) {
  if (spriteId == null) return false;
  return WALKABLE_SURFACE_TERRAIN_TILE_IDS.has(spriteId);
}

/** @param {number | null | undefined} spriteId @param {string} setName */
function isSpriteInTerrainSet(spriteId, setName) {
  const set = TERRAIN_SETS[setName];
  if (!set || spriteId == null) return false;
  if (set.centerId === spriteId) return true;
  for (const id of Object.values(set.roles || {})) {
    if (id === spriteId) return true;
  }
  return false;
}

/**
 * Só para lago roxo **sem** sprite de folhagem (`getFoliageOverlayTileId === null`): bloqueia CENTER e cantos IN_NE/NW/SE/SW.
 * Quinas OUT_* e bordas EDGE_* contam como margem seca → não bloqueiam aqui (overlay roxo: só CENTER/IN_* no Set abaixo).
 */
export function isPurpleLakePoolWalkBlockingRole(role) {
  if (role == null || role === '') return false;
  if (String(role) === 'CENTER') return true;
  return isTerrainInnerCornerRole(role);
}

/**
 * Resolved foliage overlay tile IDs that block walking (O(1) lookup).
 * - `lava-lake-dirt` (Vulcão): **all** roles including OUT_* corners — still lava art, not safe ground.
 * - `purples lago-de-agua-doce-rock` (Arcane): só roles de poça (`CENTER` / `IN_*`) — margem OUT_* e EDGE_* = solo seco como no lago sem overlay.
 */
export const FOLIAGE_POOL_OVERLAY_UNWALKABLE_TILE_IDS = (() => {
  const bad = new Set();
  const lava = TERRAIN_SETS['lava-lake-dirt'];
  if (lava?.roles) {
    for (const id of Object.values(lava.roles)) bad.add(id);
  }
  const purples = TERRAIN_SETS['purples lago-de-agua-doce-rock'];
  if (purples?.roles) {
    for (const [role, id] of Object.entries(purples.roles)) {
      if (isPurpleLakePoolWalkBlockingRole(role)) bad.add(id);
    }
  }
  return bad;
})();

/**
 * Same resolution as render.js terrain foliage (bakeChunk 1.2): only when density ≥ threshold
 * and the 3×3 neighborhood is flat + same biome + dense foliage; else no overlay → null.
 */
export function getFoliageOverlayTileId(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile || tile.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) return null;

  const foliageSetName = BIOME_TO_FOLIAGE[tile.biomeId];
  if (!foliageSetName) return null;

  const foliageSet = TERRAIN_SETS[foliageSetName];
  if (!foliageSet) return null;

  const level = tile.heightStep;
  const biomeId = tile.biomeId;

  const isFoliageSafeAt = (r, c) => {
    const t = getMicroTile(c, r, data);
    if (!t || t.heightStep !== level || t.biomeId !== biomeId || t.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) {
      return false;
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (getMicroTile(c + dx, r + dy, data)?.heightStep !== level) return false;
      }
    }
    return true;
  };

  if (!isFoliageSafeAt(my, mx)) return null;

  const isPoolTile = (r, c) => {
    const t = getMicroTile(c, r, data);
    return !!(t && t.heightStep === level && t.biomeId === biomeId && t.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD);
  };
  const landForRole = usesPoolAutotileMaskForFoliage(foliageSetName) ? isPoolTile : isFoliageSafeAt;

  const fRole = getRoleForCell(
    my,
    mx,
    data.height * MACRO_TILE_STRIDE,
    data.width * MACRO_TILE_STRIDE,
    landForRole,
    foliageSet.type
  );
  return foliageSet.roles[fRole] ?? foliageSet.roles.CENTER ?? foliageSet.centerId ?? null;
}

/**
 * Papel do autotile do lago doce (purples lago-de-agua-doce-*) só para colisão.
 * O render exige `foliageDensity` no centro; aqui o centro pode estar abaixo do limiar mas ainda
 * ser CENTER/EDGE ou canto IN_NE/NW/SE/SW vizinho de água — sem isso o tile ficava caminhável com base roxa “seca”.
 * @returns {string | null} papel (ex. IN_NW, OUT_SE) ou null se a regra não se aplica
 */
export function getLakeLotusFoliageWalkRole(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return null;
  const foliageSetName = BIOME_TO_FOLIAGE[tile.biomeId];
  if (!foliageSetName || !isLakeLotusFoliageTerrainSet(foliageSetName)) return null;

  const foliageSet = TERRAIN_SETS[foliageSetName];
  if (!foliageSet) return null;

  const level = tile.heightStep;
  const biomeId = tile.biomeId;

  const flatPlateauAt = (r, c) => {
    const t = getMicroTile(c, r, data);
    if (!t || t.heightStep !== level || t.biomeId !== biomeId) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (getMicroTile(c + dx, r + dy, data)?.heightStep !== level) return false;
      }
    }
    return true;
  };

  if (!flatPlateauAt(my, mx)) return null;

  const isPoolWater = (r, c) => {
    const t = getMicroTile(c, r, data);
    return !!(t && t.heightStep === level && t.biomeId === biomeId && t.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD);
  };

  const c = isPoolWater(my, mx);
  const n = isPoolWater(my - 1, mx);
  const s = isPoolWater(my + 1, mx);
  const w = isPoolWater(my, mx - 1);
  const e = isPoolWater(my, mx + 1);
  if (!c && !n && !s && !w && !e) return null;

  return getRoleForCell(
    my,
    mx,
    data.height * MACRO_TILE_STRIDE,
    data.width * MACRO_TILE_STRIDE,
    isPoolWater,
    foliageSet.type
  );
}

/**
 * When true, rocks/crystals/small-cactus etc. use the same **narrow circle** logic as scatter trees
 * (grid cells in the footprint stay walkable; `gatherTreeTrunkCirclesNearWorldPoint` + slide resolve apply).
 * Set `false` to restore full-tile blocking via `scatterSolidBaseBlocksMicroTile`.
 */
export const EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER = true;

/** Circle vs unit square [x0,x0+1]×[y0,y0+1] (micro-tile cell) for trunk overlap tests. */
function circleIntersectsUnitSquare(cx, cy, r, x0, y0) {
  const px = Math.max(x0, Math.min(cx, x0 + 1));
  const py = Math.max(y0, Math.min(cy, y0 + 1));
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy <= r * r + 1e-12;
}

/**
 * True when a formal tree trunk is spawned at (rootX, rootY) (left column of the 2×1 base).
 * Shared by collision, bake, and debug.
 */
export function didFormalTreeSpawnAtRoot(rootX, rootY, data) {
  if (isPlayFormalTreeRootDestroyed(rootX, rootY)) return false;
  const t = getMicroTile(rootX, rootY, data);
  if (!t) return false;
  const tt = getTreeType(t.biomeId, rootX, rootY, data.seed);
  if (!tt || (rootX + rootY) % 3 !== 0 || foliageDensity(rootX, rootY, data.seed + 5555, TREE_NOISE_SCALE) < TREE_DENSITY_THRESHOLD) {
    return false;
  }
  const rootTile = getMicroTile(rootX, rootY, data);
  const rightTile = getMicroTile(rootX + 1, rootY, data);
  if (!rootTile || !rightTile) return false;
  if (rootTile.heightStep < 1 || rootTile.isRoad || rootTile.isCity) return false;
  if (rootTile.heightStep !== rightTile.heightStep) return false;

  const set = TERRAIN_SETS[BIOME_TO_TERRAIN[rootTile.biomeId] || 'grass'];
  if (set) {
    const checkAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= rootTile.heightStep;
    const role = getRoleForCell(rootY, rootX, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, checkAtOrAbove, set.type);
    if (role !== 'CENTER') return false;
  }
  return true;
}

/**
 * Formal trunk as a **circle** in micro-tile space (same nominal width as the old strip: diameter ≈ 2×0.3).
 */
export function getFormalTreeTrunkCircle(rootX, my, data) {
  if (!didFormalTreeSpawnAtRoot(rootX, my, data)) return null;
  const r = (FORMAL_TRUNK_BASE_WIDTH_TILES * TRUNK_STRIP_WIDTH_FRAC) / 2;
  const cx = rootX + FORMAL_TRUNK_BASE_WIDTH_TILES / 2;
  const cy = my + 0.5;
  return { cx, cy, r };
}

/**
 * World-space (micro tile coords, float): true if point lies inside a formal trunk circle.
 */
export function formalTreeTrunkBlocksWorldPoint(wx, wy, data) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  if (wx < 0 || wy < 0 || wx >= microW || wy >= microH) return false;

  const ix = Math.floor(wx);
  const iy = Math.floor(wy);

  for (let my = iy - 1; my <= iy + 1; my++) {
    if (my < 0 || my >= microH) continue;
    for (let rootX = ix - 1; rootX <= ix; rootX++) {
      if (rootX < 0 || rootX + 1 >= microW) continue;
      const c = getFormalTreeTrunkCircle(rootX, my, data);
      if (!c) continue;
      const dx = wx - c.cx;
      const dy = wy - c.cy;
      if (dx * dx + dy * dy <= c.r * c.r) return true;
    }
  }
  return false;
}

/**
 * Horizontal span + circle params (for overlays / JSON). `left`/`right` are the circle's x-extent.
 */
export function getFormalTreeTrunkWorldXSpan(rootX, my, data) {
  const c = getFormalTreeTrunkCircle(rootX, my, data);
  if (!c) return null;
  return { left: c.cx - c.r, right: c.cx + c.r, cx: c.cx, cy: c.cy, radius: c.r };
}

/**
 * True if the narrow formal trunk intersects the micro-cell [mx, mx+1) × [my, my+1).
 * (Tile center can be clear while the strip still clips the cell — matches gameplay samples.)
 */
export function formalTreeTrunkOverlapsMicroCell(mx, my, data) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  if (mx < 0 || my < 0 || mx >= microW || my >= microH) return false;

  for (let trunkMy = Math.max(0, my - 2); trunkMy <= Math.min(microH - 1, my + 2); trunkMy++) {
    for (let rootX = mx - 1; rootX <= mx; rootX++) {
      if (rootX < 0 || rootX + 1 >= microW) continue;
      const c = getFormalTreeTrunkCircle(rootX, trunkMy, data);
      if (!c) continue;
      if (circleIntersectsUnitSquare(c.cx, c.cy, c.r, mx, my)) return true;
    }
  }
  return false;
}

/**
 * Row index (0 = north row of footprint) where the narrow trunk strip should sit, from `base` part layout.
 * Tall shapes (rows≥3) with a single base row at the top (savannah 3×3, large broadleaf) collide on that row;
 * two-row props: palm 2×2 keeps trunk on the footprint bottom (stem south); big-cactus 2×2 keeps trunk on the
 * base row north (same row as the 2 base tiles — stem with base, not one tile south).
 * @param {string | null} [itemKey] — optional OBJECT_SET key for 2×2 disambiguation (e.g. big-cactus vs palm).
 */
export function scatterTreeTrunkFootprintRowOYRel(basePart, shapeRows, cols, itemKey = null) {
  if (!basePart?.ids?.length || cols < 1 || shapeRows < 1) return Math.max(0, shapeRows - 1);
  let maxB = 0;
  let minB = Infinity;
  for (let bi = 0; bi < basePart.ids.length; bi++) {
    const oyRel = Math.floor(bi / cols);
    maxB = Math.max(maxB, oyRel);
    minB = Math.min(minB, oyRel);
  }
  if (!Number.isFinite(minB)) minB = 0;
  const baseSpanRows = maxB - minB + 1;

  if (baseSpanRows === 1 && minB === 0 && shapeRows >= 3) {
    return maxB;
  }
  if (baseSpanRows === 1 && minB === 0 && shapeRows === 2) {
    const k = itemKey ? String(itemKey).toLowerCase() : '';
    if (k.includes('big-cactus')) return maxB;
    return shapeRows - 1;
  }
  return maxB;
}

/**
 * Horizontal span of base part tiles on footprint row `trunkOyRel` (same `idx → (ox, oy)` as scatter base draw/bake).
 * When the base row is narrower than `cols` (e.g. 4×3 trees with three trunk tiles), trunk `cx` must use this span
 * or gameplay collides east of the drawn bases.
 * @returns {{ minOx: number, maxOx: number, widthTiles: number } | null}
 */
export function scatterTreeTrunkBaseRowOxSpan(basePart, cols, trunkOyRel) {
  if (!basePart?.ids?.length || cols < 1) return null;
  let minOx = Infinity;
  let maxOx = -Infinity;
  let n = 0;
  for (let bi = 0; bi < basePart.ids.length; bi++) {
    const oyRel = Math.floor(bi / cols);
    if (oyRel !== trunkOyRel) continue;
    const oxRel = bi % cols;
    minOx = Math.min(minOx, oxRel);
    maxOx = Math.max(maxOx, oxRel);
    n++;
  }
  if (n === 0 || !Number.isFinite(minOx)) return null;
  return { minOx, maxOx, widthTiles: maxOx - minOx + 1 };
}

/**
 * One scatter **origin** → at most one physics circle (tree trunk or, when experiment on, non-tree solid “stem”).
 * Deduplicates `validScatterOriginMicro` + itemKey between tree / solid paths (hot: `gatherTreeTrunkCirclesNearWorldPoint`).
 * @param {{ ignoreDestroyed?: boolean }} [opts] — When `ignoreDestroyed`, skip the “origin destroyed” check (charred-stump / harvest helpers still use the same trunk geometry as the living tree).
 * @returns {null | { left: number, right: number, trunkMy: number, cx: number, cy: number, radius: number, itemKey: string }}
 */
export function scatterPhysicsCircleAtOrigin(ox0, oy0, data, originMemo = null, getTileFn = null, opts = undefined) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const seed = data.seed;
  const getT = getTileFn || ((x, y) => getMicroTile(x, y, data));
  if (ox0 < 0 || oy0 < 0 || ox0 >= microW || oy0 >= microH) return null;
  if (!opts?.ignoreDestroyed && isPlayDetailScatterOriginDestroyed(ox0, oy0)) return null;

  const nTile = getT(ox0, oy0);
  if (!nTile) return null;
  const hasForcedItemKey = hasScatterItemKeyOverride(ox0, oy0);
  if (!hasForcedItemKey && !validScatterOriginMicro(ox0, oy0, seed, microW, microH, getT, originMemo)) return null;

  const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
  if (!itemsO.length) return null;
  const forcedItemKey = getScatterItemKeyOverride(ox0, oy0);
  const itemKey =
    forcedItemKey || itemsO[Math.floor(seededHash(ox0, oy0, seed + 222) * itemsO.length)];
  const isTree = scatterItemKeyIsTree(itemKey);
  const isSolid = scatterItemKeyIsSolid(itemKey);
  if (!isTree && !(EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER && isSolid && !isTree)) return null;

  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return null;
  const basePart = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!basePart?.ids?.length) return null;

  const { rows, cols } = parseShape(objSet.shape);
  const trunkOyRel = scatterTreeTrunkFootprintRowOYRel(basePart, rows, cols, itemKey);
  const trunkMy = oy0 + trunkOyRel;
  const rowOx = scatterTreeTrunkBaseRowOxSpan(basePart, cols, trunkOyRel);
  const kLower = String(itemKey).toLowerCase();
  let cx;
  let trunkWidthTiles;
  if (rowOx) {
    cx = ox0 + (rowOx.minOx + rowOx.maxOx + 1) * 0.5;
    trunkWidthTiles = rowOx.widthTiles;
  } else {
    cx = ox0 + cols * 0.5;
    trunkWidthTiles = cols;
  }
  if (kLower.includes('big-cactus')) trunkWidthTiles = 1;
  let cy = trunkMy + 0.5;
  let r = (trunkWidthTiles * TRUNK_STRIP_WIDTH_FRAC) / 2;
  if (!isTree) {
    r *= scatterSolidStemRadiusMultiplier(itemKey);
  }
  const pivot = scatterStemPhysicsPivotOffsetMicroTiles(itemKey);
  cx += pivot.dx;
  cy += pivot.dy;
  return {
    left: cx - r,
    right: cx + r,
    trunkMy,
    cx,
    cy,
    radius: r,
    itemKey
  };
}

/**
 * Scatter trunk as a **circle** in micro-tile space (center on trunk row center, radius = old half-strip width).
 * @returns {{ left: number, right: number, trunkMy: number, cx: number, cy: number, radius: number } | null}
 */
export function getScatterTreeTrunkWorldSpanIfOrigin(ox0, oy0, data, originMemo = null, getTileFn = null) {
  const p = scatterPhysicsCircleAtOrigin(ox0, oy0, data, originMemo, getTileFn);
  if (!p || !scatterItemKeyIsTree(p.itemKey)) return null;
  const { left, right, trunkMy, cx, cy, radius } = p;
  return { left, right, trunkMy, cx, cy, radius };
}

/**
 * Same geometry as {@link getScatterTreeTrunkWorldSpanIfOrigin}, but for **non-tree** solid scatter
 * (rocks, crystals, small cactus, …): trunk row + horizontal span on that row, circle radius from width.
 * @returns {{ left: number, right: number, trunkMy: number, cx: number, cy: number, radius: number } | null}
 */
export function getScatterNonTreeVegetationCircleWorldSpanIfOrigin(ox0, oy0, data, originMemo = null, getTileFn = null) {
  const p = scatterPhysicsCircleAtOrigin(ox0, oy0, data, originMemo, getTileFn);
  if (
    !p ||
    !EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER ||
    scatterItemKeyIsTree(p.itemKey) ||
    !scatterItemKeyIsSolid(p.itemKey)
  ) {
    return null;
  }
  const { left, right, trunkMy, cx, cy, radius } = p;
  return { left, right, trunkMy, cx, cy, radius };
}

/**
 * @param {'tree' | 'nonTreeSolid' | 'any'} which
 */
function scatterPhysicsCirclesBlockWorldPoint(wx, wy, data, which) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  if (wx < 0 || wy < 0 || wx >= microW || wy >= microH) return false;

  const ix = Math.floor(wx);
  const iy = Math.floor(wy);
  const originMemo = new Map();

  for (let oy0 = Math.max(0, iy - 5); oy0 <= Math.min(microH - 1, iy + 2); oy0++) {
    for (let ox0 = Math.max(0, ix - 8); ox0 <= Math.min(microW - 1, ix + 2); ox0++) {
      const p = scatterPhysicsCircleAtOrigin(ox0, oy0, data, originMemo);
      if (!p) continue;
      if (which === 'tree' && !scatterItemKeyIsTree(p.itemKey)) continue;
      if (
        which === 'nonTreeSolid' &&
        (!EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER ||
          scatterItemKeyIsTree(p.itemKey) ||
          !scatterItemKeyIsSolid(p.itemKey))
      ) {
        continue;
      }
      const dx = wx - p.cx;
      const dy = wy - p.cy;
      if (dx * dx + dy * dy <= p.radius * p.radius) return true;
    }
  }
  return false;
}

/**
 * World-space: true if point lies inside a scatter trunk circle (any origin near sample).
 */
export function scatterTreeTrunkBlocksWorldPoint(wx, wy, data) {
  return scatterPhysicsCirclesBlockWorldPoint(wx, wy, data, 'tree');
}

/** World-space: point inside any non-tree solid scatter “trunk” circle (same scan window as trees). */
export function scatterNonTreeSolidCircleBlocksWorldPoint(wx, wy, data) {
  return scatterPhysicsCirclesBlockWorldPoint(wx, wy, data, 'nonTreeSolid');
}

/**
 * @param {'tree' | 'nonTreeSolid' | 'any'} which
 */
function scatterPhysicsCirclesOverlapMicroCell(mx, my, data, which) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  if (mx < 0 || my < 0 || mx >= microW || my >= microH) return false;

  const originMemo = new Map();
  for (let ox0 = Math.max(0, mx - 8); ox0 <= Math.min(microW - 1, mx + 2); ox0++) {
    for (let oy0 = Math.max(0, my - 5); oy0 <= Math.min(microH - 1, my + 2); oy0++) {
      const p = scatterPhysicsCircleAtOrigin(ox0, oy0, data, originMemo);
      if (!p) continue;
      if (which === 'tree' && !scatterItemKeyIsTree(p.itemKey)) continue;
      if (
        which === 'nonTreeSolid' &&
        (!EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER ||
          scatterItemKeyIsTree(p.itemKey) ||
          !scatterItemKeyIsSolid(p.itemKey))
      ) {
        continue;
      }
      if (circleIntersectsUnitSquare(p.cx, p.cy, p.radius, mx, my)) return true;
    }
  }
  return false;
}

/**
 * True if a scatter trunk circle intersects the micro-cell [mx, mx+1) × [my, my+1).
 */
export function scatterTreeTrunkOverlapsMicroCell(mx, my, data) {
  return scatterPhysicsCirclesOverlapMicroCell(mx, my, data, 'tree');
}

/** True if a non-tree solid scatter circle intersects the micro-cell [mx, mx+1) × [my, my+1). */
export function scatterNonTreeSolidCircleOverlapsMicroCell(mx, my, data) {
  return scatterPhysicsCirclesOverlapMicroCell(mx, my, data, 'nonTreeSolid');
}

/** Single origin scan: tree trunk **or** (experiment) non-tree solid circle hits the cell. */
export function scatterPhysicsCircleOverlapsMicroCellAny(mx, my, data) {
  return scatterPhysicsCirclesOverlapMicroCell(mx, my, data, 'any');
}

/**
 * Lists formal + scatter trunk circles near (wx, wy) for physics (same scatter window as `scatterTreeTrunkBlocksWorldPoint`, smaller than old full-radius scan).
 * @returns {Array<{ cx: number, cy: number, r: number }>}
 */
export function gatherTreeTrunkCirclesNearWorldPoint(wx, wy, data) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const ix = Math.floor(wx);
  const iy = Math.floor(wy);
  const seen = new Set();
  const out = [];

  for (let trunkMy = Math.max(0, iy - 3); trunkMy <= Math.min(microH - 1, iy + 3); trunkMy++) {
    for (let rootX = Math.max(0, ix - 2); rootX <= Math.min(microW - 2, ix + 2); rootX++) {
      const c = getFormalTreeTrunkCircle(rootX, trunkMy, data);
      if (!c) continue;
      const k = `f:${rootX},${trunkMy}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ cx: c.cx, cy: c.cy, r: c.r });
    }
  }

  const originMemo = new Map();
  for (let oy0 = Math.max(0, iy - 5); oy0 <= Math.min(microH - 1, iy + 2); oy0++) {
    for (let ox0 = Math.max(0, ix - 8); ox0 <= Math.min(microW - 1, ix + 2); ox0++) {
      const p = scatterPhysicsCircleAtOrigin(ox0, oy0, data, originMemo);
      if (!p) continue;
      const k = `s:${ox0},${oy0}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ cx: p.cx, cy: p.cy, r: p.radius });
    }
  }

  return out;
}

/**
 * Detects if a tile is blocked by a "prop" (Scatter object, Building core). Formal trees use narrow world hit in `formalTreeTrunkBlocksWorldPoint`.
 * `mx,my` are micro-tile cell indices (typically `floor` of world feet from `canWalkMicroTile`).
 */
export function isPropBlocking(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return true;

  // 1. Urban Building Collision
  if (tile.urbanBuilding) {
    const { ox, oy, type } = tile.urbanBuilding;
    const dx = mx - ox;
    const dy = my - oy;
    // Basic "Core" collision for building footprints
    if (type.includes('pokecenter')) {
        if (dy >= 3 && dy <= 5) return true; // Foundation rows
    } else { // Mart or House
        if (dy >= 2 && dy <= 4) return true;
    }
  }

  // 2. Scatter solid base (rocks/crystals/small-cactus — full tile unless circle experiment).
  if (scatterSolidBaseBlocksMicroTile(mx, my, data)) {
    if (EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER) return false;
    return true;
  }

  return false;
}

/**
 * Colisão em grelha: amostra em espaço contínuo (micro-tiles). Use o mesmo ponto dos pés que o jogo:
 * `worldFeetFromPivotCell` (centro do tile em Y como pivot/sombra; X com `dx` PMD se houver) — props/vegetação/cristais/troncos usam este `x,y`.
 * @param {number} x - World micro X (ex.: pés)
 * @param {number} y - World micro Y
 * @param {object} data
 * @param {number} srcX - Source tile micro X (optional, for height context)
 * @param {number} srcY - Source tile micro Y (optional, for height context)
 * @param {number | null | undefined} cachedFoliageOverlayId - optional
 * @param {boolean} [isAirborne=false]
 * @param {boolean} [ignoreTreeTrunks=false] — when true, trunk circles are skipped here and handled by circle-vs-trunk resolution (player/wild).
 */
export function canWalkMicroTile(x, y, data, srcX, srcY, cachedFoliageOverlayId, isAirborne = false, ignoreTreeTrunks = false) {
  const mx = Math.floor(x);
  const my = Math.floor(y);

  /** @type {string | null} */
  let cacheKey = null;
  if (walkProbeCache && ignoreTreeTrunks) {
    if (mx >= 0 && mx < data.width * MACRO_TILE_STRIDE && my >= 0 && my < data.height * MACRO_TILE_STRIDE) {
      const fol = cachedFoliageOverlayId === undefined ? 'u' : String(cachedFoliageOverlayId);
      cacheKey =
        srcX !== undefined && srcY !== undefined
          ? `${mx},${my},${Math.floor(srcX)},${Math.floor(srcY)},${isAirborne ? 1 : 0},${fol}`
          : `${mx},${my},ns,${isAirborne ? 1 : 0},${fol}`;
      const cached = walkProbeCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }
  }

  const finish = (ok) => {
    if (cacheKey !== null && walkProbeCache) walkProbeCache.set(cacheKey, ok);
    return ok;
  };

  if (mx < 0 || mx >= data.width * MACRO_TILE_STRIDE || my < 0 || my >= data.height * MACRO_TILE_STRIDE) {
    return false;
  }

  const targetTile = getMicroTile(mx, my, data);
  if (!targetTile) return finish(false);

  // 1. Height Context Check
  if (srcX !== undefined && srcY !== undefined) {
    const smx = Math.floor(srcX);
    const smy = Math.floor(srcY);
    const sourceTile = getMicroTile(smx, smy, data);
    
    if (sourceTile && targetTile.heightStep !== sourceTile.heightStep) {
      if (!okHeightStepTransition(sourceTile, targetTile)) {
        return finish(false); // Physical barrier (cliff/drop)
      }
    }
  }

  // 1.5 Role-Based Wall Block
  if (!isAirborne) {
    const role = getMicroTileRole(mx, my, data);
    if (WALL_ROLES.has(role)) return finish(false);
  }

  const sid = getBaseTerrainSpriteId(mx, my, data);
  if (!isAirborne && !isBaseTerrainSpriteWalkable(sid)) return finish(false);

  const overlayId =
    cachedFoliageOverlayId === undefined ? getFoliageOverlayTileId(mx, my, data) : cachedFoliageOverlayId;
  if (!isAirborne && overlayId != null && FOLIAGE_POOL_OVERLAY_UNWALKABLE_TILE_IDS.has(overlayId)) {
    return finish(false);
  }

  const lakeWalkRole = getLakeLotusFoliageWalkRole(mx, my, data);
  if (!isAirborne && lakeWalkRole != null && isPurpleLakePoolWalkBlockingRole(lakeWalkRole)) {
    return finish(false);
  }

  // Block props (buildings / scatter non-tree solids). Formal + scatter trees: narrow trunk in world space.
  if (isPropBlocking(mx, my, data)) return finish(false);
  if (!ignoreTreeTrunks && !isAirborne && formalTreeTrunkBlocksWorldPoint(x, y, data)) return finish(false);
  if (!ignoreTreeTrunks && !isAirborne && scatterPhysicsCirclesBlockWorldPoint(x, y, data, 'any')) {
    return finish(false);
  }

  return finish(true);
}

/**
 * Specialty walkability for Wild Pokémon: allows swimming (oceano / lago raso), bloqueia penhascos,
 * paredes de autotile; **lago/lava** (overlay + poça roxa + base lava-lake) são tratados como “fluido” caminhável.
 * Props e troncos permanecem como no jogador.
 * `x,y` devem ser mundo contínuo (ex.: `worldFeetFromPivotCell`), como no jogador.
 * @param {boolean} [isAirborne=false] — durante salto, ignora degraus de altura, paredes EDGE e base/overlay “solo”.
 * @param {boolean} [ignoreTreeTrunks=false]
 */
export function canWildPokemonWalkMicroTile(x, y, data, srcX, srcY, isAirborne = false, ignoreTreeTrunks = false) {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || mx >= data.width * MACRO_TILE_STRIDE || my < 0 || my >= data.height * MACRO_TILE_STRIDE) {
    return false;
  }

  const targetTile = getMicroTile(mx, my, data);
  if (!targetTile) return false;

  // 1. Height Context Check (no ar: pode atravessar diferença de degrau num frame, como o jogador com impulso)
  if (!isAirborne && srcX !== undefined && srcY !== undefined) {
    const smx = Math.floor(srcX);
    const smy = Math.floor(srcY);
    const sourceTile = getMicroTile(smx, smy, data);

    if (sourceTile && targetTile.heightStep !== sourceTile.heightStep) {
      if (!okHeightStepTransition(sourceTile, targetTile)) {
        return false;
      }
    }
  }

  if (!isAirborne) {
    const role = getMicroTileRole(mx, my, data);
    if (WALL_ROLES.has(role)) return false;
  }

  const sid = getBaseTerrainSpriteId(mx, my, data);
  if (sid === null) return false;

  let setName = BIOME_TO_TERRAIN[targetTile.biomeId] || 'grass';
  if (targetTile.isRoad && targetTile.roadFeature) setName = targetTile.roadFeature;
  if (!isAirborne && setName.startsWith('altura ')) return false;

  const lakeWalkRole = getLakeLotusFoliageWalkRole(mx, my, data);

  if (!isAirborne && !isBaseTerrainSpriteWalkable(sid)) {
    const lavaSprite = isSpriteInTerrainSet(sid, 'lava-lake-dirt');
    const swimOk =
      targetTile.biomeId === BIOMES.OCEAN.id ||
      lakeWalkRole != null ||
      lavaSprite;
    if (!swimOk) return false;
  }

  if (isPropBlocking(mx, my, data)) return false;
  if (!ignoreTreeTrunks && !isAirborne && formalTreeTrunkBlocksWorldPoint(x, y, data)) return false;
  if (!ignoreTreeTrunks && !isAirborne && scatterPhysicsCirclesBlockWorldPoint(x, y, data, 'any')) {
    return false;
  }

  return true;
}
