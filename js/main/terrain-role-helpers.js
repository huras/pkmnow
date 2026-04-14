import { BIOME_TO_TERRAIN } from '../biome-tiles.js';
import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import { TERRAIN_SETS } from '../tessellation-data.js';
import { getRoleForCell } from '../tessellation-logic.js';
import { TessellationEngine } from '../tessellation-engine.js';

/** Ordem igual a GlobeTileDetailDebug (tile-detail-app): NW→SE + centro. */
export const TILE_DEBUG_DIRS_3X3 = [
  { dx: -1, dy: -1, label: 'NW' },
  { dx: 0, dy: -1, label: 'N' },
  { dx: 1, dy: -1, label: 'NE' },
  { dx: -1, dy: 0, label: 'W' },
  { dx: 0, dy: 0, label: 'C' },
  { dx: 1, dy: 0, label: 'E' },
  { dx: -1, dy: 1, label: 'SW' },
  { dx: 0, dy: 1, label: 'S' },
  { dx: 1, dy: 1, label: 'SE' }
];

export function terrainSetNameForMicroTile(tile) {
  if (!tile) return 'grass';
  let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
  if (tile.isRoad && tile.roadFeature) setName = tile.roadFeature;
  return setName;
}

/** Papel + sprite local do terreno base na altura de superfície `surfaceLevel` (mesma regra que render/walk). */
export function computeTerrainRoleAndSprite(mx, my, data, surfaceLevel) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return { setName: null, set: null, role: null, spriteId: null };
  const setName = terrainSetNameForMicroTile(tile);
  const set = TERRAIN_SETS[setName];
  if (!set) return { setName, set: null, role: null, spriteId: null };
  const H = data.height * MACRO_TILE_STRIDE;
  const W = data.width * MACRO_TILE_STRIDE;
  const isAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= surfaceLevel;
  const role = getRoleForCell(my, mx, H, W, isAtOrAbove, set.type);
  const spriteId =
    set.roles[role] ??
    set.roles.CENTER ??
    set.roles.SEAMLESS_CENTER ??
    set.roles.SEAMLESS_TILE ??
    set.centerId ??
    null;
  return { setName, set, role, spriteId };
}

export function roleNameForSpriteIdInSet(set, tileId) {
  if (!set?.roles || tileId == null) return '—';
  for (const [k, v] of Object.entries(set.roles)) {
    if (v === tileId) return k;
  }
  return '—';
}

/** Ícone 16×16 a partir do TERRAIN_SET (inclui paletas rocky/grassy). */
export function terrainSheetSpriteIconHtml(set, tileId) {
  if (tileId == null || !set) return '';
  const path = TessellationEngine.getImagePath(set.file);
  const cols = TessellationEngine.getTerrainSheetCols(set);
  const sx = (tileId % cols) * 16;
  const sy = Math.floor(tileId / cols) * 16;
  return `<div class="sprite-icon" style="background-image:url('${path}');background-position:-${sx}px -${sy}px"></div>`;
}

export function natureSpriteIconHtml(tileId) {
  if (tileId == null) return '';
  const path = 'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png';
  const cols = 57;
  const sx = (tileId % cols) * 16;
  const sy = Math.floor(tileId / cols) * 16;
  return `<div class="sprite-icon" style="background-image:url('${path}');background-position:-${sx}px -${sy}px"></div>`;
}
