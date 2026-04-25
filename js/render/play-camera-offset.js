const LS_KEY = 'pkmn_play_camera_offset_preset';
const LS_KEY_STRENGTH = 'pkmn_play_camera_offset_strength';
const OFFSET_STRENGTH_MIN = 0.30;
const OFFSET_STRENGTH_MAX = 2.0;
const OFFSET_STRENGTH_DEFAULT = 0.30;

const PRESETS = ['off', 'right', 'left', 'down', 'up'];

/** @type {'off'|'right'|'left'|'down'|'up'} */
let preset = 'off';
let offsetStrength = OFFSET_STRENGTH_DEFAULT;

try {
  const saved = String(localStorage.getItem(LS_KEY) || '');
  if (PRESETS.includes(saved)) preset = /** @type {typeof preset} */ (saved);
  const savedStrength = Number(localStorage.getItem(LS_KEY_STRENGTH));
  if (Number.isFinite(savedStrength)) {
    offsetStrength = Math.max(OFFSET_STRENGTH_MIN, Math.min(OFFSET_STRENGTH_MAX, savedStrength));
  }
} catch {
  // Ignore localStorage failures.
}

function persistPreset() {
  try {
    localStorage.setItem(LS_KEY, preset);
  } catch {
    // Ignore localStorage failures.
  }
}

function persistStrength() {
  try {
    localStorage.setItem(LS_KEY_STRENGTH, String(offsetStrength));
  } catch {
    // Ignore localStorage failures.
  }
}

export function getPlayCameraOffsetPreset() {
  return preset;
}

export function cyclePlayCameraOffsetPreset() {
  const idx = PRESETS.indexOf(preset);
  const next = PRESETS[(idx + 1) % PRESETS.length] || 'off';
  preset = /** @type {typeof preset} */ (next);
  persistPreset();
  return preset;
}

export function getPlayCameraOffsetStrength() {
  return offsetStrength;
}

export function setPlayCameraOffsetStrength(next) {
  const n = Number(next);
  if (!Number.isFinite(n)) return offsetStrength;
  offsetStrength = Math.max(OFFSET_STRENGTH_MIN, Math.min(OFFSET_STRENGTH_MAX, n));
  persistStrength();
  return offsetStrength;
}

export function getPlayCameraOffsetPx(cw, ch) {
  const dx = Math.round((Number(cw) || 0) * offsetStrength);
  const dy = Math.round((Number(ch) || 0) * offsetStrength);
  switch (preset) {
    case 'right': return { x: dx, y: 0 };
    case 'left': return { x: -dx, y: 0 };
    case 'down': return { x: 0, y: dy };
    case 'up': return { x: 0, y: -dy };
    default: return { x: 0, y: 0 };
  }
}
