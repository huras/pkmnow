const LS_BGM = 'pkmn_mix_bgm_01';
const LS_CRIES = 'pkmn_mix_cries_01';
const LS_BGM_TRACK_TOAST_SUPPRESS = 'pkmn_bgm_track_toast_suppress';

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

/** @returns {number} linear 0–1 */
export function getBgmMix01() {
  return clamp01(localStorage.getItem(LS_BGM) ?? '1');
}

/** @param {number} v linear 0–1 */
export function setBgmMix01(v) {
  localStorage.setItem(LS_BGM, String(clamp01(v)));
}

/** @returns {number} linear 0–1 */
export function getCriesMix01() {
  return clamp01(localStorage.getItem(LS_CRIES) ?? '1');
}

/** @param {number} v linear 0–1 */
export function setCriesMix01(v) {
  localStorage.setItem(LS_CRIES, String(clamp01(v)));
}

/** When true, immersive play mode skips the floating toast when the BGM track changes. */
export function isBgmTrackChangeToastSuppressed() {
  return localStorage.getItem(LS_BGM_TRACK_TOAST_SUPPRESS) === '1';
}

/** @param {boolean} suppress */
export function setBgmTrackChangeToastSuppressed(suppress) {
  localStorage.setItem(LS_BGM_TRACK_TOAST_SUPPRESS, suppress ? '1' : '0');
}
