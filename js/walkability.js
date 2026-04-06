/**
 * Caminhável = tile base resolve para um sprite de terreno classificado como
 * Layer Base ou Terrain Foliage (forragem "jogador *"), conforme docs/regras-de-tesselação.md.
 * Exclui penhascos (altura), água/lava (Borda com…), lago roxo: ver bloco em `canWalkMicroTile` (overlay vs sem overlay).
 */

import { TERRAIN_SETS } from './tessellation-data.js';
import { CHUNK_SIZE, getMicroTile } from './chunking.js';
import { getRoleForCell, isTerrainInnerCornerRole } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_TO_FOLIAGE,
  FOLIAGE_DENSITY_THRESHOLD,
  isLakeLotusFoliageTerrainSet,
  usesPoolAutotileMaskForFoliage
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
      if (set.centerId != null) s.add(set.centerId);
      for (const id of Object.values(set.roles || {})) {
        s.add(id);
      }
    } else if (name.includes('lake') || name.startsWith('Borda com ') || name.startsWith('purples ')) {
      // No caso de lagos/lava/oceanos, as bordas EXTERNAS (OUT_*) são terra, logo caminháveis.
      // CENTER (água/lava) e EDGE (beira do precipício/água) continuam bloqueados.
      for (const [role, id] of Object.entries(set.roles || {})) {
        if (role.startsWith('OUT_')) s.add(id);
      }
    } else if (name.startsWith('altura ')) {
      // Para conjuntos de altura, permitimos caminhar em TUDO (Centro e Bordas).
      // Isso desativa a colisão de "paredão" por enquanto, como solicitado.
      if (set.centerId != null) s.add(set.centerId);
      for (const id of Object.values(set.roles || {})) {
        s.add(id);
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
 * Colisão em grelha: um único tile micro por amostra.
 *
 * **Célula:** `mx = floor(x)`, `my = floor(y)` (coords em tiles micro do mundo).
 * `tryMovePlayer` chama isto com `(nx, ny)` inteiros (destino); não há hitbox contínua durante o tween.
 *
 * **Ordem de decisão (primeiro falhanço bloqueia):**
 * 1. Fora do mapa → não.
 * 2. Sprite do **terreno base** em `(mx,my)` (`getBaseTerrainSpriteId`) deve estar em `WALKABLE_SURFACE_TERRAIN_TILE_IDS`.
 * 3. **Lago/lava (overlay visível):** se `getFoliageOverlayTileId` devolver ID em `FOLIAGE_POOL_OVERLAY_UNWALKABLE_TILE_IDS` → não. Lago roxo: qualquer tile do set (CENTER, EDGE, IN, OUT).
 * 4. **Lago roxo sem overlay:** `getLakeLotusFoliageWalkRole` + `isPurpleLakePoolWalkBlockingRole` → bloqueia **CENTER** e cantos **IN_NE/NW/SE/SW**; **OUT_*** e **EDGE_*** são quina/borda seca → sim.
 * 5. Caso contrário → sim.
 *
 * @param {number} x - tile micro (pode ser fracionário; usa floor)
 * @param {number} y
 * @param {object} data
 * @param {number | null | undefined} cachedFoliageOverlayId - se já calculaste com `getFoliageOverlayTileId`, passa aqui para evitar trabalho duplicado (ex.: painel de debug).
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

  return true;
}
