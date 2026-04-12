import { OBJECT_SETS } from '../tessellation-data.js';

const OBJECT_TILE_FLAGS_BY_ID = (() => {
  const m = new Map();
  for (const objSet of Object.values(OBJECT_SETS)) {
    for (const part of objSet.parts || []) {
      if (typeof part.walkable !== 'boolean' || typeof part.abovePlayer !== 'boolean') continue;
      for (const id of part.ids || []) {
        m.set(id, { walkable: part.walkable, abovePlayer: part.abovePlayer });
      }
    }
  }
  return m;
})();

export function getObjectTileFlags(tileId) {
  if (tileId == null) return null;
  return OBJECT_TILE_FLAGS_BY_ID.get(tileId) ?? null;
}
