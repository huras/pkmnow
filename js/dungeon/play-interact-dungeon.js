/** @type {null | (() => boolean)} */
let _tryEnterDungeonFromInteractKey = null;

/**
 * Main wires this once: return true if dungeon enter was triggered (consumes the interact key).
 * @param {null | (() => boolean)} fn
 */
export function setTryEnterDungeonFromInteractKey(fn) {
  _tryEnterDungeonFromInteractKey = typeof fn === 'function' ? fn : null;
}

/** @returns {boolean} */
export function tryEnterDungeonFromInteractKey() {
  return _tryEnterDungeonFromInteractKey ? !!_tryEnterDungeonFromInteractKey() : false;
}
