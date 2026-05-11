/**
 * @fileoverview Registry that lets gameplay code (e.g. tackle/cut systems) plug
 * "is this scatter origin destroyed?" / "is this formal tree root destroyed?"
 * queries into walkability without walkability importing gameplay modules.
 *
 * Default handlers return `false` (nothing destroyed), which is the correct
 * answer for any consumer that has no destruction system (e.g. the painter app).
 * Gameplay modules call {@link setDestroyedObjectsHandlers} on load.
 */

const noopFalse = () => false;
const noopOne = () => 1;

let detailQuery = noopFalse;
let formalQuery = noopFalse;
let formalRegrowQuery = noopOne;

export function isDetailScatterOriginDestroyed(ox, oy) {
  return detailQuery(ox, oy);
}

export function isFormalTreeRootDestroyed(rootX, my) {
  return formalQuery(rootX, my);
}

/** 0..1 alpha for a regrowing formal tree; 1 = fully grown (default). */
export function getFormalTreeRegrowVisualAlpha01(rootX, my) {
  return formalRegrowQuery(rootX, my);
}

/**
 * Wire the gameplay handlers in. Pass `null`/omit a handler to keep the no-op default.
 * Idempotent: calling again replaces the previous handlers.
 *
 * @param {{
 *   isDetailScatterOriginDestroyed?: (ox: number, oy: number) => boolean,
 *   isFormalTreeRootDestroyed?: (rootX: number, my: number) => boolean,
 *   getFormalTreeRegrowVisualAlpha01?: (rootX: number, my: number) => number
 * }} handlers
 */
export function setDestroyedObjectsHandlers(handlers = {}) {
  if (typeof handlers.isDetailScatterOriginDestroyed === 'function') {
    detailQuery = handlers.isDetailScatterOriginDestroyed;
  }
  if (typeof handlers.isFormalTreeRootDestroyed === 'function') {
    formalQuery = handlers.isFormalTreeRootDestroyed;
  }
  if (typeof handlers.getFormalTreeRegrowVisualAlpha01 === 'function') {
    formalRegrowQuery = handlers.getFormalTreeRegrowVisualAlpha01;
  }
}

export function resetDestroyedObjectsHandlers() {
  detailQuery = noopFalse;
  formalQuery = noopFalse;
  formalRegrowQuery = noopOne;
}
