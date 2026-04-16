/**
 * Play-mode scatter decoration itemKey override per micro origin `(ox,oy)`.
 * Used when Strength relocates a rock/crystal: renderer + walkability read the carried key
 * instead of the biome RNG pick for that cell.
 */
const scatterItemKeyOverrideByOrigin = new Map();

export function getScatterItemKeyOverride(ox, oy) {
  return scatterItemKeyOverrideByOrigin.get(`${ox | 0},${oy | 0}`) || null;
}

export function setScatterItemKeyOverride(ox, oy, itemKey) {
  const k = `${ox | 0},${oy | 0}`;
  if (itemKey == null || itemKey === '') scatterItemKeyOverrideByOrigin.delete(k);
  else scatterItemKeyOverrideByOrigin.set(k, String(itemKey));
}

export function clearScatterItemKeyOverrides() {
  scatterItemKeyOverrideByOrigin.clear();
}
