/**
 * Caminhável = tile base resolve para um sprite de terreno classificado como
 * Layer Base ou Terrain Foliage (forragem "jogador *"), conforme docs/regras-de-tesselação.md.
 * Exclui penhascos (altura), água/lava (Borda com…), rocha arcana úmida (purples …).
 */

import { TERRAIN_SETS } from './tessellation-data.js';
import { CHUNK_SIZE, getMicroTile } from './chunking.js';
import { getRoleForCell } from './tessellation-logic.js';
import { BIOME_TO_TERRAIN, BIOME_TO_FOLIAGE } from './biome-tiles.js';

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
 * @param {number} x - tile micro (pode ser fracionário; usa floor)
 * @param {number} y
 */
export function canWalkMicroTile(x, y, data) {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || mx >= data.width * CHUNK_SIZE || my < 0 || my >= data.height * CHUNK_SIZE) {
    return false;
  }
  const sid = getBaseTerrainSpriteId(mx, my, data);
  if (!isBaseTerrainSpriteWalkable(sid)) return false;

  // 2. Foliage Layer Check (Hazardous skins like Lava or Water Pools)
  const tile = getMicroTile(mx, my, data);
  const FOLIAGE_DENSITY_THRESHOLD = 0.45; // Match render.js
  if (tile.foliageDensity >= FOLIAGE_DENSITY_THRESHOLD) {
    const foliageSetName = BIOME_TO_FOLIAGE[tile.biomeId];
    if (foliageSetName && (foliageSetName.includes('lake') || foliageSetName.includes('lava') || foliageSetName.includes('purples'))) {
      return false;
    }
  }

  return true;
}
