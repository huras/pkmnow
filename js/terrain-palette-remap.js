/**
 * Remap em canvas (só se precisares de preview dinâmico no browser).
 * O jogo usa PNGs já cozidos — ver `npm run build:palettes`.
 */
import { remapRgbaPixelData } from './terrain-palette-remap-core.js';

/**
 * @param {ImageBitmapSource} img
 * @param {Array<{ from: number[], to: number[] }>} pairs
 * @returns {HTMLCanvasElement}
 */
export function remapImagePalette(img, pairs) {
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (w < 1 || h < 1) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  remapRgbaPixelData(imageData.data, pairs);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
