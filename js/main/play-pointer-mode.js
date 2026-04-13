const LS_KEY = 'pkmn_play_pointer_mode';

/** @typedef {'game' | 'debug'} PlayPointerMode */

/** @returns {PlayPointerMode} */
export function getPlayPointerMode() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'game' || v === 'debug') return v;
  } catch {
    /* ignore */
  }
  return 'game';
}

/** @param {PlayPointerMode} mode */
export function setPlayPointerMode(mode) {
  try {
    localStorage.setItem(LS_KEY, mode);
  } catch {
    /* ignore */
  }
}
