/**
 * Caminhável = tile base resolve para um sprite de terreno classificado como
 * Layer Base ou Terrain Foliage (forragem "jogador *"), conforme docs/regras-de-tesselação.md.
 * Exclui penhascos (altura), água/lava (Borda com…), lago roxo: ver bloco em `canWalkMicroTile` (overlay vs sem overlay).
 */

import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { CHUNK_SIZE, getMicroTile, foliageDensity } from './chunking.js';
import { getRoleForCell, isTerrainInnerCornerRole, seededHash, parseShape } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_TO_FOLIAGE,
  FOLIAGE_DENSITY_THRESHOLD,
  isLakeLotusFoliageTerrainSet,
  usesPoolAutotileMaskForFoliage,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  BIOME_VEGETATION
} from './biome-tiles.js';

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

export const WALKABLE_SURFACE_TERRAIN_TILE_IDS = (() => {
  const s = new Set();
  for (const [name, set] of Object.entries(TERRAIN_SETS)) {
    const walkKind = getTerrainSetWalkKind(name);
    if (walkKind) {
      const isConnector = name.includes('stair-') || name.includes('-bridge');
      
      if (set.centerId != null) s.add(set.centerId);
      for (const [role, id] of Object.entries(set.roles || {})) {
        // Connectors are walkable on all roles. Standard ground blocks on EDGE/IN_ roles.
        const isBlockingRole = role.startsWith('EDGE_') || role.startsWith('IN_');
        if (isConnector || !isBlockingRole) {
          s.add(id);
        }
      }
    } else if (name.includes('lake') || name.startsWith('Borda com ') || name.startsWith('purples ')) {
      // No caso de lagos/lava/oceanos, as bordas EXTERNAS (OUT_*) são terra, logo caminháveis.
      // CENTER (água/lava) e EDGE (beira do precipício/água) continuam bloqueados.
      for (const [role, id] of Object.entries(set.roles || {})) {
        if (role.startsWith('OUT_')) s.add(id);
      }
    }
  }
  return s;
})();

export function getBaseTerrainSpriteId(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
  if (tile.isRoad && tile.roadFeature) {
    setName = tile.roadFeature;
  }
  const set = TERRAIN_SETS[setName];
  if (!set) return null;
  const isAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= tile.heightStep;
  const role = getRoleForCell(
    my,
    mx,
    data.height * CHUNK_SIZE,
    data.width * CHUNK_SIZE,
    isAtOrAbove,
    set.type
  );
  return set.roles[role] ?? set.roles.CENTER ?? set.roles.SEAMLESS_CENTER ?? set.roles.SEAMLESS_TILE ?? set.centerId ?? null;
}

export function isBaseTerrainSpriteWalkable(spriteId) {
  if (spriteId == null) return false;
  return WALKABLE_SURFACE_TERRAIN_TILE_IDS.has(spriteId);
}

/**
 * Só para lago roxo **sem** sprite de folhagem (`getFoliageOverlayTileId === null`): bloqueia CENTER e cantos IN_NE/NW/SE/SW.
 * Quinas OUT_* e bordas EDGE_* contam como margem seca → não bloqueiam aqui (com overlay, usa-se o Set abaixo).
 */
export function isPurpleLakePoolWalkBlockingRole(role) {
  if (role == null || role === '') return false;
  if (String(role) === 'CENTER') return true;
  return isTerrainInnerCornerRole(role);
}

/**
 * Resolved foliage overlay tile IDs that block walking (O(1) lookup).
 * - `lava-lake-dirt` (Vulcão): **all** roles including OUT_* corners — still lava art, not safe ground.
 * - `purples lago-de-agua-doce-rock` (Arcane): **todos** os IDs do overlay — com folhagem desenhada, toda a célula é “poça” (inclui quinas OUT_*).
 */
export const FOLIAGE_POOL_OVERLAY_UNWALKABLE_TILE_IDS = (() => {
  const bad = new Set();
  const lava = TERRAIN_SETS['lava-lake-dirt'];
  if (lava?.roles) {
    for (const id of Object.values(lava.roles)) bad.add(id);
  }
  const purples = TERRAIN_SETS['purples lago-de-agua-doce-rock'];
  if (purples?.roles) {
    for (const id of Object.values(purples.roles)) {
      bad.add(id);
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
    data.height * CHUNK_SIZE,
    data.width * CHUNK_SIZE,
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
    data.height * CHUNK_SIZE,
    data.width * CHUNK_SIZE,
    isPoolWater,
    foliageSet.type
  );
}


/**
 * Detects if a tile is blocked by a "prop" (Tree, Scatter object, or Building core).
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

  // 2. Formal Tree Collision (2x1 base)
  const isFormalRoot = (tx, ty) => {
    const t = getMicroTile(tx, ty, data);
    if (!t) return false;
    const tt = getTreeType(t.biomeId, tx, ty, data.seed);
    return !!tt && (tx + ty) % 3 === 0 && foliageDensity(tx, ty, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  };
  
  // Check if this tile or its left neighbor is a tree root
  if (isFormalRoot(mx, my) || isFormalRoot(mx - 1, my)) {
     // Check if it's a flat center tile (height consistency)
     const set = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
     if (set) {
        const checkAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= tile.heightStep;
        const role = getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, checkAtOrAbove, set.type);
        if (role === 'CENTER') return true;
     }
  }

  // 3. Scatter Decoration Collision
  // Scan small area NW to see if an object root covers this tile
  for (let sy = my; sy >= my - 3; sy--) {
    for (let sx = mx; sx >= mx - 3; sx--) {
      if (sx < 0 || sy < 0) continue;
      const sTile = getMicroTile(sx, sy, data);
      if (!sTile || sTile.isRoad || sTile.isCity) continue;
      if (foliageDensity(sx, sy, data.seed + 111, 2.5) > 0.82) {
        const items = BIOME_VEGETATION[sTile.biomeId] || [];
        if (items.length === 0) continue;
        const itemKey = items[Math.floor(seededHash(sx, sy, data.seed + 222) * items.length)];
        const objSet = OBJECT_SETS[itemKey];
        if (objSet) {
           // Skip collision for aesthetic-only foliage (grass, flowers, etc.)
           const k = itemKey.toLowerCase();
           const isSolid = k.includes('tree') || k.includes('rock') || k.includes('crystal') || k.includes('cactus') || k.includes('broadleaf') || k.includes('palm');
           if (!isSolid) continue;

           const { cols, rows } = parseShape(objSet.shape);
           if (mx >= sx && mx < sx + cols && my >= sy && my < sy + rows) {
              return true;
           }
        }
      }
    }
  }

  return false;
}

/**
 * Colisão em grelha: um único tile micro por amostra.
 * @param {number} x - tile micro (pode ser fracionário; usa floor)
 * @param {number} y
 * @param {object} data
 * @param {number | null | undefined} cachedFoliageOverlayId - opcional
 */
export function canWalkMicroTile(x, y, data, cachedFoliageOverlayId) {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || mx >= data.width * CHUNK_SIZE || my < 0 || my >= data.height * CHUNK_SIZE) {
    return false;
  }
  const sid = getBaseTerrainSpriteId(mx, my, data);
  if (!isBaseTerrainSpriteWalkable(sid)) return false;

  const overlayId =
    cachedFoliageOverlayId === undefined ? getFoliageOverlayTileId(mx, my, data) : cachedFoliageOverlayId;
  if (overlayId != null && FOLIAGE_POOL_OVERLAY_UNWALKABLE_TILE_IDS.has(overlayId)) {
    return false;
  }

  const lakeWalkRole = getLakeLotusFoliageWalkRole(mx, my, data);
  if (lakeWalkRole != null && isPurpleLakePoolWalkBlockingRole(lakeWalkRole)) {
    return false;
  }

  // Block trees/props
  if (isPropBlocking(mx, my, data)) return false;

  return true;
}

/**
 * Specialty walkability for Wild Pokémon: Allows swimming but blocks props/cliffs.
 */
export function canWildPokemonWalkMicroTile(x, y, data) {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || mx >= data.width * CHUNK_SIZE || my < 0 || my >= data.height * CHUNK_SIZE) {
    return false;
  }
  
  const tile = getMicroTile(mx, my, data);
  if (!tile) return false;

  // 1. Basic Terrain / Cliff Check
  // Note: We bypass isBaseTerrainSpriteWalkable because that blocks water.
  // We only block cliffs (names starting with 'altura') or borders.
  const sid = getBaseTerrainSpriteId(mx, my, data);
  if (sid === null) return false;
  
  // Custom check for Wild: strictly allow water/lava centers, but block cliffs
  // We check the terrain set name for "altura"
  let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
  if (tile.isRoad && tile.roadFeature) setName = tile.roadFeature;
  if (setName.startsWith('altura ')) return false;

  // 2. Prop Blocking (Trees, buildings, etc)
  if (isPropBlocking(mx, my, data)) return false;

  return true;
}
