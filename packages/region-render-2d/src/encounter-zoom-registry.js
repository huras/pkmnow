/**
 * @fileoverview Tiny registry to let gameplay (encounter cinematic) inject a
 * zoom multiplier into the play camera without `play-view-camera.js`
 * importing gameplay code. Default = 1 (no zoom). Apps without an encounter
 * cinematic system don't need to register anything.
 */

let zoomMulProvider = () => 1;

export function getEncounterZoomMul() {
  return zoomMulProvider();
}

/**
 * @param {() => number} provider - returns a positive multiplier; 1 = no zoom.
 */
export function setEncounterZoomMulProvider(provider) {
  if (typeof provider === 'function') zoomMulProvider = provider;
}

export function resetEncounterZoomMulProvider() {
  zoomMulProvider = () => 1;
}
