/**
 * Wild Pokémon persistence — tracks fainted/dead state across save/load.
 *
 * Entity keys are deterministic (derived from slot coordinates + group member index),
 * so the same key is regenerated each time a slot spawns. Persistence stores which
 * keys correspond to fainted Pokémon, letting the spawn system recreate them in
 * the correct state on reload.
 */

/** @type {Set<string>} entity keys of fainted wild Pokémon */
const faintedKeys = new Set();

/**
 * Mark a wild Pokémon as fainted.
 * @param {string} entityKey
 */
export function markWildPokemonFainted(entityKey) {
  if (typeof entityKey === 'string' && entityKey.length > 0) {
    faintedKeys.add(entityKey);
  }
}

/**
 * Check whether a wild Pokémon is recorded as fainted.
 * @param {string} entityKey
 * @returns {boolean}
 */
export function isWildPokemonFainted(entityKey) {
  return faintedKeys.has(entityKey);
}

/**
 * Clear a single fainted record (e.g. Pokémon revived).
 * @param {string} entityKey
 */
export function clearWildPokemonFainted(entityKey) {
  faintedKeys.delete(entityKey);
}

/**
 * Snapshot for serialisation into the save payload.
 * @returns {string[]}
 */
export function getFaintedPokemonSnapshot() {
  return faintedKeys.size > 0 ? [...faintedKeys] : [];
}

/**
 * Restore from a save payload.
 * @param {unknown} keys
 */
export function restoreFaintedPokemonFromSnapshot(keys) {
  faintedKeys.clear();
  if (!Array.isArray(keys)) return;
  for (const k of keys) {
    if (typeof k === 'string' && k.length > 0) {
      faintedKeys.add(k);
    }
  }
}

/** Full reset (new game / map change). */
export function resetWildPokemonPersistence() {
  faintedKeys.clear();
}
