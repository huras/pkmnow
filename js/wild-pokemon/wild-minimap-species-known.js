/**
 * Minimap portrait uses a generic silhouette until the species is "known":
 * the wild has been drawn in the play view, damaged, field-moved, or had a social reaction.
 * @param {object | null | undefined} entity
 */
export function markWildMinimapSpeciesKnown(entity) {
  if (!entity) return;
  entity.minimapSpeciesKnown = true;
}
