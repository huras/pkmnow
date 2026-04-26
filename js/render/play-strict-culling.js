const LS_KEY = 'pkmn_play_strict_culling';

let strictCullingEnabled = false;

try {
  strictCullingEnabled = localStorage.getItem(LS_KEY) === '1';
} catch {
  strictCullingEnabled = false;
}

export function isPlayStrictCullingEnabled() {
  return strictCullingEnabled;
}

export function setPlayStrictCullingEnabled(on) {
  strictCullingEnabled = !!on;
  try {
    localStorage.setItem(LS_KEY, strictCullingEnabled ? '1' : '0');
  } catch {
    // Ignore localStorage failures.
  }
}

export function togglePlayStrictCulling() {
  setPlayStrictCullingEnabled(!strictCullingEnabled);
  return strictCullingEnabled;
}
