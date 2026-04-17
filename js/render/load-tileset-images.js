import { imageCache } from '../image-cache.js';
import {
  PALETTE_BASE_IMAGE_PATHS,
  allPaletteBaseTransitionImagePaths
} from '../terrain-palette-base.js';
import { PALETTE_GRASSY_IMAGE_PATHS } from '../terrain-palette-grassy.js';

export async function loadTilesetImages() {
  const sources = [
    'tilesets/flurmimons_tileset___caves_by_flurmimon_dafqtdm.png',
    'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png',
    ...PALETTE_BASE_IMAGE_PATHS,
    ...PALETTE_GRASSY_IMAGE_PATHS,
    ...allPaletteBaseTransitionImagePaths(),
    'tilesets/PokemonCenter.png',
    'tilesets/gengar_walk.png',
    'tilesets/gengar_idle.png',
    'tilesets/PC _ Computer - RPG Maker VX Ace - Miscellaneous - Emotions.png',
    'vfx/ETF_Texture_Glow_01.png'
  ];

  const promises = sources.map((src) => {
    if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = () => {
        if (src.startsWith('tilesets/palettes/') || src === 'tilesets/rocky-terrain.png') {
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
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src;
    })
  );

  await Promise.all(promises);
}
