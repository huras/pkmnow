import { DEFAULT_LOCALE, HELP_ARTICLES, MESSAGES, SUPPORTED_LOCALES } from './messages.js';
import { PluginRegistry } from '../core/plugin-registry.js';
import { BIOMES } from '../biomes.js';
import {
  BIOME_TO_FOLIAGE,
  BIOME_TO_TERRAIN,
  BIOME_VEGETATION,
  FOLIAGE_NOISE_SCALE,
  TREE_NOISE_SCALE,
  getGrassParams,
  getGrassVariant,
  getTreeType
} from '../biome-tiles.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';

const STORAGE_KEY = 'pkmn.locale';
const LOCALE_EVENT = 'app:locale-changed';

let activeLocale = DEFAULT_LOCALE;

const HELP_BIOMES_TEXT = Object.freeze({
  'pt-BR': {
    title: 'Biomas',
    heading: 'Biomas',
    intro:
      'Referência rápida dos biomas com terreno, skin, conteúdos, parâmetros de geração e Pokémon encontrados.',
    colBiome: 'Bioma',
    colTerrain: 'Terreno',
    colSkin: 'Skin',
    colContent: 'Conteúdo',
    colParams: 'Parâmetros',
    colPokemon: 'Pokémon',
    none: 'Nenhum',
    noSkin: 'Sem skin',
    grassVariant: 'Grama',
    grassScale: 'Escala',
    grassThreshold: 'Threshold',
    treeNoise: 'Tree noise',
    foliageNoise: 'Foliage noise',
    treeTypes: 'Árvores',
    vegetation: 'Objetos/vegetação',
    category: 'Categoria',
    categoryWater: 'Água',
    categoryClimate: 'Clima',
    categoryColdMountain: 'Frio / montanha',
    categorySpecial: 'Especiais',
    categoryCivilization: 'Civilização',
    metricObjects: 'objetos',
    metricTrees: 'árvores',
    metricPokemon: 'pokémon',
    metricParams: 'parâmetros'
  },
  'en-US': {
    title: 'Biomes',
    heading: 'Biomes',
    intro:
      'Quick reference of biomes with terrain, skin, content, generation parameters, and encounterable Pokemon.',
    colBiome: 'Biome',
    colTerrain: 'Terrain',
    colSkin: 'Skin',
    colContent: 'Content',
    colParams: 'Parameters',
    colPokemon: 'Pokemon',
    none: 'None',
    noSkin: 'No skin',
    grassVariant: 'Grass',
    grassScale: 'Scale',
    grassThreshold: 'Threshold',
    treeNoise: 'Tree noise',
    foliageNoise: 'Foliage noise',
    treeTypes: 'Trees',
    vegetation: 'Vegetation',
    category: 'Category',
    categoryWater: 'Water',
    categoryClimate: 'Climate',
    categoryColdMountain: 'Cold / mountain',
    categorySpecial: 'Special',
    categoryCivilization: 'Civilization',
    metricObjects: 'objects',
    metricTrees: 'trees',
    metricPokemon: 'pokemon',
    metricParams: 'params'
  },
  'ja-JP': {
    title: 'バイオーム',
    heading: 'バイオーム',
    intro:
      '地形・スキン・内容・生成パラメータ・出現ポケモンをまとめたバイオーム一覧です。',
    colBiome: 'バイオーム',
    colTerrain: '地形',
    colSkin: 'スキン',
    colContent: '内容',
    colParams: 'パラメータ',
    colPokemon: 'ポケモン',
    none: 'なし',
    noSkin: 'スキンなし',
    grassVariant: '草',
    grassScale: 'スケール',
    grassThreshold: 'しきい値',
    treeNoise: 'Tree noise',
    foliageNoise: 'Foliage noise',
    treeTypes: '木',
    vegetation: '植生',
    category: 'カテゴリ',
    categoryWater: '水系',
    categoryClimate: '気候',
    categoryColdMountain: '寒冷 / 山岳',
    categorySpecial: '特殊',
    categoryCivilization: '文明',
    metricObjects: 'オブジェクト',
    metricTrees: '木',
    metricPokemon: 'ポケモン',
    metricParams: 'パラメータ'
  }
});

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toChipList(items, { noneLabel, chipClass = '', maxItems = 999 } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<span class="play-help-biomes__chip play-help-biomes__chip--empty">${escapeHtml(noneLabel || '—')}</span>`;
  }
  const limited = items.slice(0, Math.max(0, maxItems));
  const hiddenCount = Math.max(0, items.length - limited.length);
  const cls = chipClass ? ` play-help-biomes__chip--${chipClass}` : '';
  const chips = limited
    .map((x) => `<span class="play-help-biomes__chip${cls}">${escapeHtml(String(x))}</span>`)
    .join('');
  if (!hiddenCount) return chips;
  return `${chips}<span class="play-help-biomes__chip play-help-biomes__chip--more">+${hiddenCount}</span>`;
}

function toPokemonFaceList(speciesNames, { noneLabel } = {}) {
  if (!Array.isArray(speciesNames) || speciesNames.length === 0) {
    return `<span class="play-help-biomes__chip play-help-biomes__chip--empty">${escapeHtml(noneLabel || '—')}</span>`;
  }
  return speciesNames
    .map((name) => {
      const species = String(name || '').trim();
      if (!species) return '';
      const dex = Number(encounterNameToDex(species));
      const dexAttr = Number.isFinite(dex) && dex > 0 ? ` data-dex="${Math.floor(dex)}"` : '';
      return `<span class="play-help-biomes__chip play-help-biomes__chip--pokemon play-help-biomes__chip--pokemon-face" title="${escapeHtml(
        species
      )}" aria-label="${escapeHtml(species)}">
        <img class="play-help-biomes__pokemon-face"${dexAttr} data-portrait-slug="Normal" src="map-icons/unknown-pokemon.png" alt="${escapeHtml(
          species
        )}" loading="lazy" decoding="async">
      </span>`;
    })
    .filter(Boolean)
    .join('');
}

function toVegetationSpriteList(itemKeys, { noneLabel } = {}) {
  if (!Array.isArray(itemKeys) || itemKeys.length === 0) {
    return `<span class="play-help-biomes__chip play-help-biomes__chip--empty">${escapeHtml(noneLabel || '—')}</span>`;
  }
  return itemKeys
    .map((itemKey) => {
      const key = String(itemKey || '').trim();
      if (!key) return '';
      return `<span class="play-help-biomes__chip play-help-biomes__chip--object-sprite" title="${escapeHtml(
        key
      )}" aria-label="${escapeHtml(key)}">
        <canvas class="play-help-biomes__object-sprite" data-object-key="${escapeHtml(key)}" width="32" height="32"></canvas>
      </span>`;
    })
    .filter(Boolean)
    .join('');
}

function sanitizeBiomeColor(color) {
  const raw = String(color || '').trim();
  if (!raw) return '#6b7a99';
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return raw;
  return '#6b7a99';
}

function listUniqueTreeTypesForBiome(biomeId) {
  const points = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
  const out = new Set();
  for (const p of points) {
    const type = getTreeType(biomeId, p * 1000, (1 - p) * 1000, 12345);
    if (type) out.add(type);
  }
  return [...out];
}

function getBiomeListForHelp() {
  /** @type {Map<number, { id: number, name: string, color?: string }>} */
  const byId = new Map();
  for (const value of Object.values(BIOMES)) {
    if (!value || typeof value !== 'object') continue;
    const id = Number(value.id);
    if (!Number.isFinite(id)) continue;
    byId.set(id, { id, name: String(value.name || `Biome ${id}`), color: value.color });
  }
  for (const [, value] of PluginRegistry.getBiomes()) {
    if (!value || typeof value !== 'object') continue;
    const id = Number(value.id);
    if (!Number.isFinite(id)) continue;
    byId.set(id, { id, name: String(value.name || `Biome ${id}`), color: value.color });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function getBiomeCategoryName(copy, biomeId) {
  const id = Number(biomeId);
  if (id === 0 || id === 1) return copy.categoryWater;
  if (id === 16 || id === 17 || id === 18 || id === 19) return copy.categoryCivilization;
  if (id === 5 || id === 6 || id === 7 || id === 8 || id === 11 || id === 12) return copy.categoryColdMountain;
  if (id === 13 || id === 14 || id === 15 || id === 20 || id === 99) return copy.categorySpecial;
  return copy.categoryClimate;
}

function buildBiomesHelpArticle(locale) {
  const copy = HELP_BIOMES_TEXT[locale] || HELP_BIOMES_TEXT[DEFAULT_LOCALE] || HELP_BIOMES_TEXT['en-US'];
  const fmt2 = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cards = getBiomeListForHelp()
    .map((biome) => {
      const biomeLabel = getBiomeNameById(biome.id);
      const biomeColor = sanitizeBiomeColor(biome.color);
      const terrain = BIOME_TO_TERRAIN[biome.id] || copy.none;
      const skin = BIOME_TO_FOLIAGE[biome.id] || copy.noSkin;
      const vegetation = BIOME_VEGETATION[biome.id] || [];
      const grassParams = getGrassParams(biome.id);
      const grassVariant = getGrassVariant(biome.id) || copy.none;
      const treeTypes = listUniqueTreeTypesForBiome(biome.id);
      const encounters = getEncounters(biome.id) || [];
      const category = getBiomeCategoryName(copy, biome.id);

      const paramChips = [
        `${copy.grassVariant}: ${grassVariant}`,
        `${copy.grassScale}: ${fmt2.format(grassParams.scale)}`,
        `${copy.grassThreshold}: ${fmt2.format(grassParams.threshold)}`,
        `${copy.treeNoise}: ${fmt2.format(TREE_NOISE_SCALE)}`,
        `${copy.foliageNoise}: ${fmt2.format(FOLIAGE_NOISE_SCALE)}`
      ];

      return `<article class="play-help-biomes__card">
        <header class="play-help-biomes__card-header">
          <span class="play-help-biomes__swatch" style="--biome-color:${escapeHtml(biomeColor)}"></span>
          <div class="play-help-biomes__title-wrap">
            <h3 class="play-help-biomes__name">${escapeHtml(biomeLabel)}</h3>
            <span class="play-help-biomes__id">#${biome.id}</span>
            <span class="play-help-biomes__category">${escapeHtml(category)}</span>
          </div>
        </header>
        <div class="play-help-biomes__metrics">
          <span class="play-help-biomes__metric"><strong>${vegetation.length}</strong> ${escapeHtml(copy.metricObjects)}</span>
          <span class="play-help-biomes__metric"><strong>${treeTypes.length}</strong> ${escapeHtml(copy.metricTrees)}</span>
          <span class="play-help-biomes__metric"><strong>${encounters.length}</strong> ${escapeHtml(copy.metricPokemon)}</span>
          <span class="play-help-biomes__metric"><strong>${paramChips.length}</strong> ${escapeHtml(copy.metricParams)}</span>
        </div>
        <div class="play-help-biomes__terrain-preview-row">
          <div class="play-help-biomes__terrain-preview-box">
            <div class="play-help-biomes__terrain-preview-label">${escapeHtml(copy.colTerrain)}</div>
            <canvas
              class="play-help-biomes__terrain-preview-canvas"
              data-terrain-set="${escapeHtml(String(terrain))}"
              width="112"
              height="112"
            ></canvas>
            <div class="play-help-biomes__terrain-preview-footer">${escapeHtml(terrain)}</div>
          </div>
          <div class="play-help-biomes__terrain-preview-box">
            <div class="play-help-biomes__terrain-preview-label">${escapeHtml(copy.colSkin)}</div>
            ${
              skin !== copy.noSkin
                ? `<canvas
                    class="play-help-biomes__terrain-preview-canvas"
                    data-terrain-set="${escapeHtml(String(skin))}"
                    width="112"
                    height="112"
                  ></canvas>`
                : `<div class="play-help-biomes__terrain-preview-empty">${escapeHtml(copy.noSkin)}</div>`
            }
            <div class="play-help-biomes__terrain-preview-footer">${escapeHtml(skin)}</div>
          </div>
        </div>
        <div class="play-help-biomes__facts">
          <div class="play-help-biomes__fact"><span class="play-help-biomes__fact-label">${escapeHtml(
            copy.colTerrain
          )}</span><span class="play-help-biomes__fact-value">${escapeHtml(terrain)}</span></div>
          <div class="play-help-biomes__fact"><span class="play-help-biomes__fact-label">${escapeHtml(
            copy.colSkin
          )}</span><span class="play-help-biomes__fact-value">${escapeHtml(skin)}</span></div>
        </div>
        <section class="play-help-biomes__group">
          <h4 class="play-help-biomes__group-title">${escapeHtml(copy.vegetation)}</h4>
          <div class="play-help-biomes__chips play-help-biomes__chips--object-sprites">${toVegetationSpriteList(
            vegetation,
            {
              noneLabel: copy.none
            }
          )}</div>
        </section>
        <section class="play-help-biomes__group">
          <h4 class="play-help-biomes__group-title">${escapeHtml(copy.treeTypes)}</h4>
          <div class="play-help-biomes__chips">${toChipList(treeTypes, {
            noneLabel: copy.none,
            chipClass: 'tree',
            maxItems: 8
          })}</div>
        </section>
        <section class="play-help-biomes__group">
          <h4 class="play-help-biomes__group-title">${escapeHtml(copy.colParams)}</h4>
          <div class="play-help-biomes__chips">${toChipList(paramChips, {
            noneLabel: copy.none,
            chipClass: 'param',
            maxItems: 8
          })}</div>
        </section>
        <section class="play-help-biomes__group">
          <h4 class="play-help-biomes__group-title">${escapeHtml(copy.colPokemon)}</h4>
          <div class="play-help-biomes__chips play-help-biomes__chips--pokemon-faces">${toPokemonFaceList(encounters, {
            noneLabel: copy.none
          })}</div>
        </section>
      </article>`;
    })
    .join('');

  return {
    id: 'biomes',
    title: copy.title,
    html: `<h2 class="play-help-wiki__h2">${escapeHtml(copy.heading)}</h2><p class="play-help-wiki__p">${escapeHtml(
      copy.intro
    )}</p><div class="play-help-biomes__grid">${cards}</div>`
  };
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
  const path = `biome.${String(Math.floor(n))}`;
  const fromT = t(path);
  if (fromT !== path) return fromT;
  const mod = PluginRegistry.getBiomeById(n);
  if (mod && typeof mod.name === 'string' && mod.name.trim()) return mod.name.trim();
  return fromT;
}

export function getPlayHelpArticles() {
  const list = HELP_ARTICLES[activeLocale] || HELP_ARTICLES[DEFAULT_LOCALE] || [];
  const out = list.map((x) => ({ ...x }));
  const biomeArticle = buildBiomesHelpArticle(activeLocale);
  const i = out.findIndex((x) => x.id === biomeArticle.id);
  if (i >= 0) out[i] = biomeArticle;
  else out.push(biomeArticle);
  return out;
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
