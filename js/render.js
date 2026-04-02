/**
 * Apenas desenha dados já gerados — não conhece RNG nem algoritmos de mundo.
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, cells: Float32Array } | null} data
 */
export function render(canvas, data) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data) return;

  const { width, height, cells } = data;
  const cw = canvas.width;
  const ch = canvas.height;
  const tileW = cw / width;
  const tileH = ch / height;

  ctx.fillStyle = '#1a1a1e';
  ctx.fillRect(0, 0, cw, ch);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = cells[y * width + x];
      const g = Math.floor(v * 255);
      ctx.fillStyle = `rgb(${g},${g},${Math.min(255, g + 24)})`;
      ctx.fillRect(
        Math.floor(x * tileW),
        Math.floor(y * tileH),
        Math.ceil(tileW),
        Math.ceil(tileH),
      );
    }
  }
}
