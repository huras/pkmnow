const LS_BGM = 'pkmn_mix_bgm_01';
/** Persisted 0–1 mix for minimap “SFX” slider (all spatial short SFX + cries). */
const LS_CRIES = 'pkmn_mix_cries_01';
const LS_AUDIO_MUTE = 'pkmn_mix_mute_01';
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

/** @returns {number} linear 0–1 (minimap SFX slider) */
export function getCriesMix01() {
  return clamp01(localStorage.getItem(LS_CRIES) ?? '1');
}

/** @param {number} v linear 0–1 */
export function setCriesMix01(v) {
  localStorage.setItem(LS_CRIES, String(clamp01(v)));
}

/** Global mute toggle for play audio UI (BGM + cries). */
export function isAudioMuted() {
  return localStorage.getItem(LS_AUDIO_MUTE) === '1';
}

/** @param {boolean} muted */
export function setAudioMuted(muted) {
  localStorage.setItem(LS_AUDIO_MUTE, muted ? '1' : '0');
}

/** @returns {number} effective BGM gain after mute */
export function getEffectiveBgmMix01() {
  return isAudioMuted() ? 0 : getBgmMix01();
}

/** @returns {number} effective SFX / cries mix after mute */
export function getEffectiveCriesMix01() {
  return isAudioMuted() ? 0 : getCriesMix01();
}

/** When true, immersive play mode skips the floating toast when the BGM track changes. */
export function isBgmTrackChangeToastSuppressed() {
  return localStorage.getItem(LS_BGM_TRACK_TOAST_SUPPRESS) === '1';
}

/** @param {boolean} suppress */
export function setBgmTrackChangeToastSuppressed(suppress) {
  localStorage.setItem(LS_BGM_TRACK_TOAST_SUPPRESS, suppress ? '1' : '0');
}
