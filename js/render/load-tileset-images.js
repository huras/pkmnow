import { imageCache } from '../image-cache.js';
import {
  PALETTE_BASE_IMAGE_PATHS,
  allPaletteBaseTransitionImagePaths
} from '../terrain-palette-base.js';
import { PALETTE_GRASSY_IMAGE_PATHS } from '../terrain-palette-grassy.js';

/**
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function loadTilesetImages(onProgress) {
  const sources = [
    'tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png',
    'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png',
    ...PALETTE_BASE_IMAGE_PATHS,
    ...PALETTE_GRASSY_IMAGE_PATHS,
    ...allPaletteBaseTransitionImagePaths(),
    'tilesets/PokemonCenter.png',
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
      img.src = src;
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
      img.src = src;
    })
  );

  await Promise.all(promises);
}
