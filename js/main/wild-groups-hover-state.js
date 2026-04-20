let hoveredWildGroupEntityKey = null;

/**
 * @param {string | null | undefined} key
 */
export function setHoveredWildGroupEntityKey(key) {
  const normalized = key == null ? null : String(key);
  hoveredWildGroupEntityKey = normalized && normalized.length ? normalized : null;
}

/**
 * @returns {string | null}
 */
export function getHoveredWildGroupEntityKey() {
  return hoveredWildGroupEntityKey;
}

export function clearHoveredWildGroupEntityKey() {
  hoveredWildGroupEntityKey = null;
}
