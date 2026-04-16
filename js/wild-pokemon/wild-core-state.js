import { MACRO_TILE_STRIDE } from '../chunking.js';

/** @type {Map<string, object>} */
export const entitiesByKey = new Map();

export function resetWildPokemonManager() {
  entitiesByKey.clear();
}

export function getWildPokemonEntities() {
  return Array.from(entitiesByKey.values());
}

export function getWildPokemonEntityByKey(key) {
  const k = String(key || '');
  if (!k) return null;
  return entitiesByKey.get(k) || null;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function wildSubdivN(raw) {
  const n = Math.max(1, Math.floor(Number(raw)) || 1);
  return Math.min(16, n);
}

export function wildSlotKey(mx, my, sx, sy) {
  return `${mx},${my},${sx},${sy}`;
}

function wildSlotCenterSqDist(mx, my, sx, sy, px, py, cellW) {
  const cx = mx * MACRO_TILE_STRIDE + (sx + 0.5) * cellW;
  const cy = my * MACRO_TILE_STRIDE + (sy + 0.5) * cellW;
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy;
}

export function buildWildNeededSlotKeys(w, h, pmx, pmy, subN, cellW, playerMicroX, playerMicroY, budgetRaw) {
  const budget = Math.max(8, Math.floor(Number(budgetRaw)) || 64);
  const R = 2;
  /** @type {{ mx: number, my: number, sx: number, sy: number, d2: number }[]} */
  const slots = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const mx = pmx + dx;
      const my = pmy + dy;
      if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
      for (let sy = 0; sy < subN; sy++) {
        for (let sx = 0; sx < subN; sx++) {
          const d2 = wildSlotCenterSqDist(mx, my, sx, sy, playerMicroX, playerMicroY, cellW);
          slots.push({ mx, my, sx, sy, d2 });
        }
      }
    }
  }
  if (slots.length <= budget) {
    const needed = new Set();
    for (const s of slots) needed.add(wildSlotKey(s.mx, s.my, s.sx, s.sy));
    return needed;
  }
  slots.sort((a, b) => {
    if (a.d2 !== b.d2) return a.d2 - b.d2;
    if (a.mx !== b.mx) return a.mx - b.mx;
    if (a.my !== b.my) return a.my - b.my;
    if (a.sx !== b.sx) return a.sx - b.sx;
    return a.sy - b.sy;
  });
  const needed = new Set();
  for (let i = 0; i < budget; i++) {
    const s = slots[i];
    needed.add(wildSlotKey(s.mx, s.my, s.sx, s.sy));
  }
  return needed;
}

