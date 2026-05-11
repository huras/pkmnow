import { imageCache } from 'region-terrain-tiles/image-cache.js';
import {
  PALETTE_BASE_IMAGE_PATHS,
  allPaletteBaseTransitionImagePaths
} from 'region-terrain-tiles/terrain-palette-base.js';
import { PALETTE_GRASSY_IMAGE_PATHS } from 'region-terrain-tiles/terrain-palette-grassy.js';

/**
 * Loads every tileset PNG used by the renderer into `imageCache`.
 *
 * `imageCache` is keyed by the original relative path (e.g. `tilesets/x.png`)
 * — that key shape is what `bakeChunk` and friends look up. The browser-side
 * `img.src` is what actually gets fetched, so passing `tilesetBaseUrl` lets
 * apps hosted under a sub-path (e.g. `/apps/hoenn-builder/play.html`) point
 * the network requests at a different origin/prefix without changing cache
 * keys.
 *
 * @param {(done: number, total: number) => void} [onProgress]
 * @param {string} [tilesetBaseUrl] - prefix appended to each `src` before
 *   assignment. Empty string keeps the legacy "relative to document" behavior.
 */
export async function loadTilesetImages(onProgress, tilesetBaseUrl = '') {
  const resolveSrc = (src) => {
    if (!tilesetBaseUrl) return src;
    try { return new URL(src, tilesetBaseUrl).href; } catch { return src; }
  };

  const sources = [
    'tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png',
    'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png',
    ...PALETTE_BASE_IMAGE_PATHS,
    ...PALETTE_GRASSY_IMAGE_PATHS,
    ...allPaletteBaseTransitionImagePaths(),
    'tilesets/PokemonCenter.png',
    'tilesets/further_additional_more_tiles_by_magiscarf_dc80s5g.png',
    'tilesets/magiscarf-Buildings-Tiles-w-Snow-808246734.png',
    'tilesets/tileset_ver_3__free___by_magiscarf_dbf3bkq.png',
    'tilesets/mountains__trees_and_public_decorations___fan_game_by_adalkroofs_dcj0ioc.png',
    'tilesets/gengar_walk.png',
    'tilesets/gengar_idle.png',
    'tilesets/Game Boy Advance - Pokemon Ruby _ Sapphire - Miscellaneous - Berry Trees.png',
    'tilesets/PC _ Computer - RPG Maker VX Ace - Miscellaneous - Emotions.png'
  ];

  let done = 0;
  const totalUnits = sources.length + 1;
  const bump = () => {
    done = Math.min(totalUnits, done + 1);
    try {
      onProgress?.(done, totalUnits);
    } catch {
      /* ignore */
    }
  };

  const promises = sources.map((src) => {
    if (imageCache.has(src)) {
      bump();
      return Promise.resolve(imageCache.get(src));
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        bump();
        resolve(img);
      };
      img.onerror = () => {
        if (src.startsWith('tilesets/palettes/') || src === 'tilesets/rocky-terrain.png') {
          bump();
          resolve(null);
        } else {
          reject(new Error(`Failed to load ${src}`));
        }
      };
      img.src = resolveSrc(src);
    });
  });

  promises.push(
    new Promise((resolve) => {
      const src = 'tilesets/water-tile.png';
      if (imageCache.has(src)) {
        bump();
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        bump();
        resolve();
      };
      img.onerror = () => {
        bump();
        resolve();
      };
      img.src = resolveSrc(src);
    })
  );

  await Promise.all(promises);
}
