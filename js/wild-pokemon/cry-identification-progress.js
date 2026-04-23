/** Per-national-dex “cry ID” progress for Far Cry minimap portraits (persisted in play session save). */

/** @type {Set<number>} */
const cryIdentifiedDexIds = new Set();

/**
 * @param {number} dexId
 * @returns {boolean}
 */
export function isDexCryIdentified(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  if (d < 1) return false;
  return cryIdentifiedDexIds.has(d);
}

/**
 * @param {number} dexId
 */
export function markDexCryIdentified(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  if (d < 1) return;
  cryIdentifiedDexIds.add(d);
}

export function resetCryIdentificationProgress() {
  cryIdentifiedDexIds.clear();
}

/**
 * Rebuilds in-memory progress from a play-session snapshot for the current map fingerprint.
 * @param {unknown} saved — `peekPlaySessionSaveForMap` result or null
 */
export function syncCryIdentificationFromPeekSave(saved) {
  resetCryIdentificationProgress();
  if (!saved || typeof saved !== 'object') return;
  const arr = /** @type {{ cryIdentifiedDexIds?: unknown }} */ (saved).cryIdentifiedDexIds;
  if (!Array.isArray(arr)) return;
  for (const v of arr) {
    const d = Math.floor(Number(v) || 0);
    if (d >= 1 && d <= 9999) cryIdentifiedDexIds.add(d);
  }
}

/**
 * Sorted unique list for JSON saves.
 * @returns {number[]}
 */
export function getCryIdentifiedDexIdsSnapshot() {
  return Array.from(cryIdentifiedDexIds).sort((a, b) => a - b);
}
