/**
 * Minimap portrait uses a generic silhouette until the species is "known":
 * the wild has been drawn in the play view, damaged, field-moved, or had a social reaction.
 * @param {object | null | undefined} entity
 */
export function markWildMinimapSpeciesKnown(entity) {
  if (!entity) return;
  entity.minimapSpeciesKnown = true;
}

/**
 * After a Far Cry from this wild, the minimap may show its "?" (unknown species) marker —
 * until then unknown wilds stay off the minimap to avoid clutter (see `render-minimap.js`).
 * @param {object | null | undefined} entity
 */
export function markWildFarCryMinimapIntroduced(entity) {
  if (!entity) return;
  entity.minimapFarCryIntroduced = true;
}
