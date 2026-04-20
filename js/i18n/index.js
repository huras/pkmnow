import { DEFAULT_LOCALE, HELP_ARTICLES, MESSAGES, SUPPORTED_LOCALES } from './messages.js';

const STORAGE_KEY = 'pkmn.locale';
const LOCALE_EVENT = 'app:locale-changed';

let activeLocale = DEFAULT_LOCALE;

function resolvePath(obj, path) {
  if (!obj) return undefined;
  const parts = String(path || '').split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function normalizeLocale(localeLike) {
  const raw = String(localeLike || '').trim();
  if (!raw) return DEFAULT_LOCALE;
  const lower = raw.toLowerCase();
  if (lower.startsWith('ja')) return 'ja-JP';
  if (lower.startsWith('en')) return 'en-US';
  if (lower.startsWith('pt')) return 'pt-BR';
  return SUPPORTED_LOCALES.includes(raw) ? raw : DEFAULT_LOCALE;
}

function interpolate(text, vars) {
  if (!vars || typeof vars !== 'object') return text;
  return String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
}

function messageFor(locale, key) {
  const dict = MESSAGES[locale] || {};
  return resolvePath(dict, key);
}

export function getLocale() {
  return activeLocale;
}

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

export function readStoredLocale() {
  try {
    return normalizeLocale(localStorage.getItem(STORAGE_KEY) || '');
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function t(key, vars) {
  const fromActive = messageFor(activeLocale, key);
  const fromDefault = messageFor(DEFAULT_LOCALE, key);
  const fromEn = messageFor('en-US', key);
  const msg = fromActive ?? fromDefault ?? fromEn ?? key;
  return interpolate(msg, vars);
}

export function getBiomeNameById(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return '—';
  return t(`biome.${String(Math.floor(n))}`);
}

export function getPlayHelpArticles() {
  const list = HELP_ARTICLES[activeLocale] || HELP_ARTICLES[DEFAULT_LOCALE] || [];
  return list.map((x) => ({ ...x }));
}

export function applyI18nDom(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (!k) return;
    el.textContent = t(k);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const k = el.getAttribute('data-i18n-title');
    if (!k) return;
    el.setAttribute('title', t(k));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const k = el.getAttribute('data-i18n-aria-label');
    if (!k) return;
    el.setAttribute('aria-label', t(k));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const k = el.getAttribute('data-i18n-placeholder');
    if (!k) return;
    el.setAttribute('placeholder', t(k));
  });
}

function syncDocumentLangAndTitle() {
  if (document?.documentElement) {
    document.documentElement.lang = activeLocale;
  }
  const shell = document?.documentElement?.dataset?.appShell;
  if (shell === 'play') {
    document.title = t('play.docTitle');
  } else if (shell === 'marketing') {
    // untouched for this rollout
  } else {
    document.title = t('splash.docTitle');
  }
}

export function setLocale(nextLocale, options = {}) {
  const persist = options.persist !== false;
  const locale = normalizeLocale(nextLocale);
  if (locale === activeLocale) return activeLocale;
  activeLocale = locale;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore storage failure */
    }
  }
  syncDocumentLangAndTitle();
  applyI18nDom(document);
  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: { locale } }));
  return locale;
}

export function initI18n() {
  const stored = readStoredLocale();
  activeLocale = normalizeLocale(stored || DEFAULT_LOCALE);
  syncDocumentLangAndTitle();
  applyI18nDom(document);
  return activeLocale;
}

export function onLocaleChanged(handler) {
  if (typeof handler !== 'function') return () => {};
  const wrapped = (ev) => handler(ev?.detail?.locale || activeLocale);
  window.addEventListener(LOCALE_EVENT, wrapped);
  return () => window.removeEventListener(LOCALE_EVENT, wrapped);
}

export function formatNumber(value, opts = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(activeLocale, opts).format(n);
}
