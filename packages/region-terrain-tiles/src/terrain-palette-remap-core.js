/**
 * Lógica pura de remap RGBA (browser + Node). Sem DOM.
 * @param {Uint8ClampedArray | Uint8Array} data len = w*h*4
 * @param {Array<{ from: number[], to: number[] }>} pairs
 */
export function remapRgbaPixelData(data, pairs) {
  const MAGENTA_R = 255;
  const MAGENTA_G = 0;
  const MAGENTA_B = 255;

  function matchFrom(i, from, loose) {
    const dr = Math.abs(data[i] - from[0]);
    const dg = Math.abs(data[i + 1] - from[1]);
    const db = Math.abs(data[i + 2] - from[2]);
    if (loose) return dr <= 1 && dg <= 1 && db <= 1;
    return dr === 0 && dg === 0 && db === 0;
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r === MAGENTA_R && g === MAGENTA_G && b === MAGENTA_B) {
      data[i + 3] = 0;
      continue;
    }
    let matched = false;
    for (const { from, to } of pairs) {
      if (matchFrom(i, from, false)) {
        data[i] = to[0];
        data[i + 1] = to[1];
        data[i + 2] = to[2];
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (const { from, to } of pairs) {
        if (matchFrom(i, from, true)) {
          data[i] = to[0];
          data[i + 1] = to[1];
          data[i + 2] = to[2];
          break;
        }
      }
    }
  }
}
