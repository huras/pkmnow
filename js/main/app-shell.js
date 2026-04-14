/** @typedef {'debug-play' | 'play' | 'marketing'} AppShell */

/**
 * Which HTML shell is hosting the app (`data-app-shell` on `<html>`).
 * Defaults to `debug-play` for backwards compatibility.
 * @returns {AppShell}
 */
export function getAppShell() {
  const raw = document.documentElement?.dataset?.appShell || '';
  if (raw === 'play' || raw === 'marketing' || raw === 'debug-play') return raw;
  return 'debug-play';
}

export function isPlayShell() {
  return getAppShell() === 'play';
}

export function isDebugPlayShell() {
  return getAppShell() === 'debug-play';
}

export function isMarketingShell() {
  return getAppShell() === 'marketing';
}
