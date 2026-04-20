/**
 * Brief “Salvando…” toast with spinner (fade in/out, ≥1s visible).
 */

const MIN_VISIBLE_MS = 1000;
const FADE_MS = 260;

/** @type {HTMLElement | null} */
let boundEl = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let hideTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let fadeDoneTimer = null;

/**
 * @param {HTMLElement | null} el
 */
export function bindPlaySaveIndicator(el) {
  boundEl = el;
}

function resolveEl() {
  if (boundEl?.isConnected) return boundEl;
  boundEl = document.getElementById('play-save-indicator');
  return boundEl;
}

export function flashPlaySessionSaveIndicator() {
  const el = resolveEl();
  if (!el) return;

  clearTimeout(hideTimer);
  clearTimeout(fadeDoneTimer);

  el.setAttribute('aria-hidden', 'false');
  el.classList.remove('play-save-indicator--out');
  el.classList.add('play-save-indicator--visible');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add('play-save-indicator--in');
    });
  });

  hideTimer = setTimeout(() => {
    el.classList.remove('play-save-indicator--in');
    el.classList.add('play-save-indicator--out');
    fadeDoneTimer = setTimeout(() => {
      el.classList.remove('play-save-indicator--visible', 'play-save-indicator--in', 'play-save-indicator--out');
      el.setAttribute('aria-hidden', 'true');
    }, FADE_MS);
  }, MIN_VISIBLE_MS);
}
