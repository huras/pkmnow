import { BIOME_TO_TERRAIN } from '../biome-tiles.js';
import { imageCache } from '../image-cache.js';
import { TessellationEngine } from '../tessellation-engine.js';
import {
  paletteBaseSlugFromTerrainSetName,
  paletteBaseTransitionImageRelPath
} from '../terrain-palette-base.js';

/** Vizinho cardinal à mesma altura com outra paleta rocky-style (não grama / Dirty / cidade). */
export function firstDifferingPaletteBaseNeighborSlug(mx, my, surfaceLevel, getCachedTile, selfSlug) {
  const offsets = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0]
  ];
  for (const [dx, dy] of offsets) {
    const t = getCachedTile(mx + dx, my + dy);
    if (!t || t.heightStep !== surfaceLevel) continue;
    const nSet = BIOME_TO_TERRAIN[t.biomeId] || 'grass';
    const nSlug = paletteBaseSlugFromTerrainSetName(nSet);
    if (nSlug && nSlug !== selfSlug) return nSlug;
  }
  return null;
}

/** Mesmo role/tileId; troca só a folha se existir PNG trans/ para o par de paletas. */
export function imageForPaletteBaseTerrainDraw(biomeSetName, biomeSet, mx, my, surfaceLevel, getCachedTile) {
  const defaultPath = TessellationEngine.getImagePath(biomeSet.file);
  let img = imageCache.get(defaultPath);
  const selfSlug = paletteBaseSlugFromTerrainSetName(biomeSetName);
  if (selfSlug == null) return img;
  const otherSlug = firstDifferingPaletteBaseNeighborSlug(mx, my, surfaceLevel, getCachedTile, selfSlug);
  if (!otherSlug) return img;
  const tRel = paletteBaseTransitionImageRelPath(selfSlug, otherSlug);
  const tPath = TessellationEngine.getImagePath(tRel);
  const tImg = imageCache.get(tPath);
  if (tImg?.complete && (tImg.naturalWidth || tImg.width)) return tImg;
  return img;
}
