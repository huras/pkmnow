import { player, setPlayerSpecies } from '../player.js';
import { getGen1SpeciesName } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { probeSpriteCollabPortraitPrefix } from '../pokemon/spritecollab-portraits.js';
import { imageCache } from '../image-cache.js';
import { getMicroTile } from '../chunking.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import {
  getPlayerMoveCooldownRemaining,
  getPlayerMoveCooldownUiMax
} from '../moves/moves-manager.js';
import {
  getCollectedDetailInventorySnapshot,
  getCrystalLootCount,
  PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE
} from '../main/play-crystal-tackle.js';
import { syncSelectedFieldSkillForDex, syncSelectedSpecialAttackForDex } from '../main/play-mouse-combat.js';
import { getPlayerInputBindings, getBindableMoveLabel } from '../main/player-input-slots.js';
import { getPokemondbItemIconPathMap } from '../social/pokemondb-item-icon-paths.js';
import { lootSlugForItemKey } from '../social/play-item-inventory-icon.js';
import {
  PLAY_ITEM_HUD_PICKUP_OPAQUE_MS,
  PLAY_ITEM_HUD_POP_MS
} from '../main/play-item-pickup-feedback.js';
import { detailScatterGridPreviewHtml } from '../main/detail-scatter-preview-html.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape } from '../tessellation-logic.js';
import { installPokemonBoxModal } from './pokemon-box-modal.js';

const SKILL_ICON_BASE = 'skill-icons';

/** One HUD row for all crystal stacks — map key so parallel non-crystal pops stay independent. */
const PLAY_ITEM_POP_CRYSTAL_SLOT = '__pkmn_crystal_shard_slot__';

/** Move id (strip `field:`) → PNG basename when it differs from the id (pack filenames). */
const SKILL_ICON_FILE_BY_MOVE_ID = Object.freeze({
  thunder: 'thunder_Shamanskill_27',
  thunderbolt: 'thunderbolt_Mageskill_07',
  thunderShock: 'thundershock_Shamanskill_23'
});

function skillIconFileForMoveId(moveId) {
  const id = String(moveId || '').replace(/^field:/, '');
  return SKILL_ICON_FILE_BY_MOVE_ID[id] ?? id;
}
const LAYOUT_STORAGE_KEY = 'pkmn_character_selector_layout';
const IMMERSIVE_CHROME_STORAGE_KEY = 'pkmn_play_immersive_chrome';
const PLAY_ITEM_HUD_COLLAPSED_STORAGE_KEY = 'pkmn_play_item_hud_collapsed';

function moveAbbrevFromLabel(label) {
  const parts = String(label || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const one = parts[0] || '?';
  return one.slice(0, 2).toUpperCase();
}

function lootLabelFromItemKey(itemKey) {
  return String(itemKey || '')
    .replace(/\s*\[[^\]]*\]\s*/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

/** Tessellation sprite grid sized to fit the play item HUD icon cell (narrow 4-col slot). */
function playItemHudScatterSpriteHtml(itemKey) {
  const key = String(itemKey || '');
  const objSet = OBJECT_SETS[key];
  if (!objSet) return '';
  const { rows, cols } = parseShape(objSet.shape || '[1x1]');
  const gridCols = Math.max(1, cols | 0);
  const gridRows = Math.max(1, rows | 0);
  const gap = 2;
  /** Fits 4-column HUD cells (~min 64px). */
  const box = 36;
  const cellByCols = Math.floor((box - gap * (gridCols - 1)) / gridCols);
  const cellByRows = Math.floor((box - gap * (gridRows - 1)) / gridRows);
  const cellPx = Math.max(6, Math.min(cellByCols, cellByRows));
  return detailScatterGridPreviewHtml(
    key,
    cellPx,
    'play-item-hud__detail-sprite',
    'vertical-align:middle;line-height:0',
    { seamless: true, gapPx: 0 }
  );
}

export class CharacterSelector {
  /**
   * @param {string} containerId
   * @param {{
   *   getCurrentData?: () => object | null,
   *   getAppMode?: () => string,
   *   defaultPlayImmersiveChrome?: boolean
   * }} [opts] — if `pkmn_play_immersive_chrome` absent, use `defaultPlayImmersiveChrome` (true on `play.html`).
   */
  constructor(containerId, opts = {}) {
    this.container = document.getElementById(containerId);
    this.getCurrentData = typeof opts.getCurrentData === 'function' ? opts.getCurrentData : () => null;
    this.getAppMode = typeof opts.getAppMode === 'function' ? opts.getAppMode : () => '';
    this.isOpen = false;
    /** @type {import('./pokemon-box-modal.js').PokemonBoxModal | null} */
    this._boxModal = null;
    this._onFieldSkillChange = (ev) => {
      const dex = Math.floor(Number(ev?.detail?.dexId) || 0);
      if (dex === (player.dexId ?? 0)) {
        this.updateFieldSkillDisplay();
        void this.refreshPlayerMovesHud();
      }
    };
    this._onInputBindingsChange = (ev) => {
      const dex = Math.floor(Number(ev?.detail?.dexId) || 0);
      if (dex === (player.dexId ?? 0)) {
        this.updateFieldSkillDisplay();
        void this.refreshPlayerMovesHud();
      }
    };
    /** @type {'full' | 'minimal'} */
    this.layoutMode =
      localStorage.getItem(LAYOUT_STORAGE_KEY) === 'minimal' ? 'minimal' : 'full';
    /** Hides shell chrome + panel extras; keeps portrait, name, types, minimap, and this toggle. */
    const immStored = localStorage.getItem(IMMERSIVE_CHROME_STORAGE_KEY);
    this.playImmersiveChrome =
      immStored === '1' ? true : immStored === '0' ? false : !!opts.defaultPlayImmersiveChrome;
    this.playItemHudCollapsed = localStorage.getItem(PLAY_ITEM_HUD_COLLAPSED_STORAGE_KEY) === '1';

    /** @type {Map<string, string> | null} */
    this._lootIconPathMap = null;
    /** Cache so the loot list DOM is not rebuilt every frame (enables HTML5 drag from rows). */
    this._lastPlayItemHudSig = '';
    /** Item HUD: dimmed to 50% unless hovered, dragging from inventory, or post-pickup highlight. */
    this._playItemHudPointerInside = false;
    this._playItemHudInventoryDragActive = false;
    /** @type {HTMLDivElement | null} */
    this._playItemHudDragGhostEl = null;
    /** @type {HTMLCanvasElement | null} */
    this._playItemHudDragTransparentCanvas = null;
    this._playItemHudPickupOpaqueUntil = 0;
    /** @type {Map<string, number>} itemKey → expiry (ms); several keys can pop in parallel. */
    this._playItemPopUntilByKey = new Map();
    /** @type {Map<string, number>} bump on each pickup so the same slot can replay while overlapping. */
    this._playItemPopGenByKey = new Map();

    /** @param {Event} ev */
    this._onPlayItemHudPickup = (ev) => {
      const k = String(/** @type {CustomEvent<{ itemKey?: string }>} */ (ev).detail?.itemKey || '');
      if (!k) return;
      const now = performance.now();
      this._playItemHudPickupOpaqueUntil = now + PLAY_ITEM_HUD_PICKUP_OPAQUE_MS;
      const popSlotKey = k.toLowerCase().includes('crystal') ? PLAY_ITEM_POP_CRYSTAL_SLOT : k;
      const until = Math.max(this._playItemPopUntilByKey.get(popSlotKey) || 0, now + PLAY_ITEM_HUD_POP_MS);
      this._playItemPopUntilByKey.set(popSlotKey, until);
      this._playItemPopGenByKey.set(popSlotKey, (this._playItemPopGenByKey.get(popSlotKey) || 0) + 1);
      this._lastPlayItemHudSig = '';
      this.updatePlayItemsHud();
      this._syncPlayItemHudOpacity();
    };
    this._onDocInventoryDragEnd = () => {
      if (!this._playItemHudInventoryDragActive) return;
      this._playItemHudInventoryDragActive = false;
      this._setPlayItemHudDragGhostVisible(false);
      this._clearPlayItemHudDragGhostContent();
      window.dispatchEvent(new CustomEvent('play-item-hud-drag-end'));
      this._syncPlayItemHudOpacity();
    };
    /** @param {DragEvent} ev */
    this._onDocInventoryDragOver = (ev) => {
      if (!this._playItemHudInventoryDragActive) return;
      this._setPlayItemHudDragGhostPosition(ev.clientX, ev.clientY);
      const itemHud = this.container?.querySelector('#play-item-hud');
      const target = ev.target;
      const hoveringHud =
        itemHud instanceof HTMLElement && target instanceof Node ? itemHud.contains(target) : false;
      this._setPlayItemHudDragGhostVisible(hoveringHud);
    };
    this._onTogglePlayItemHud = () => {
      this.setPlayItemHudCollapsed(!this.playItemHudCollapsed);
    };

    void getPokemondbItemIconPathMap().then((m) => {
      this._lootIconPathMap = m;
      const crystalPath = m.get('star-piece');
      const crystalImg = this.container?.querySelector('#play-item-crystal-icon');
      if (crystalImg && crystalPath) crystalImg.setAttribute('src', crystalPath);
      this.updatePlayItemsHud();
    });

    this.init();
  }

  setPlayItemHudCollapsed(collapsed) {
    this.playItemHudCollapsed = !!collapsed;
    localStorage.setItem(PLAY_ITEM_HUD_COLLAPSED_STORAGE_KEY, this.playItemHudCollapsed ? '1' : '0');
    const itemHud = this.container?.querySelector('#play-item-hud');
    const toggleBtn = this.container?.querySelector('#play-item-hud-toggle');
    if (itemHud instanceof HTMLElement) {
      itemHud.classList.toggle('play-item-hud--collapsed', this.playItemHudCollapsed);
    }
    if (toggleBtn instanceof HTMLButtonElement) {
      toggleBtn.setAttribute('aria-pressed', this.playItemHudCollapsed ? 'true' : 'false');
      toggleBtn.textContent = this.playItemHudCollapsed ? 'A Expand' : 'A Min';
      toggleBtn.title = this.playItemHudCollapsed
        ? 'Expand item inventory (Gamepad A)'
        : 'Minimize item inventory (Gamepad A)';
      toggleBtn.setAttribute('aria-label', toggleBtn.title);
    }
  }

  init() {
    this.render();
    this.attachEvents();
    this.applyLayoutMode();
    this.applyPlayImmersiveChrome();
    syncSelectedFieldSkillForDex(player.dexId);
    syncSelectedSpecialAttackForDex(player.dexId);
    this.updatePreview().catch(() => {});
  }

  _ensurePlayItemHudDragGhost() {
    if (this._playItemHudDragGhostEl instanceof HTMLDivElement) return this._playItemHudDragGhostEl;
    const ghost = document.createElement('div');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      transform: 'translate(-9999px,-9999px)',
      pointerEvents: 'none',
      zIndex: '999999',
      opacity: '0',
      transition: 'opacity 60ms linear',
      filter: 'drop-shadow(0 3px 9px rgba(0,0,0,0.38))'
    });
    document.body.appendChild(ghost);
    this._playItemHudDragGhostEl = ghost;
    return ghost;
  }

  _clearPlayItemHudDragGhostContent() {
    const ghost = this._playItemHudDragGhostEl;
    if (!ghost) return;
    ghost.innerHTML = '';
  }

  _setPlayItemHudDragGhostVisible(on) {
    const ghost = this._playItemHudDragGhostEl;
    if (!ghost) return;
    ghost.style.opacity = on ? '0.98' : '0';
  }

  _setPlayItemHudDragGhostPosition(clientX, clientY) {
    const ghost = this._playItemHudDragGhostEl;
    if (!ghost) return;
    const x = Math.round((Number(clientX) || 0) + 14);
    const y = Math.round((Number(clientY) || 0) + 14);
    ghost.style.transform = `translate(${x}px,${y}px)`;
  }

  _mountPlayItemHudDragGhostFromRow(row) {
    const ghost = this._ensurePlayItemHudDragGhost();
    ghost.innerHTML = '';
    const clone = row.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return;
    clone.removeAttribute('draggable');
    clone.classList.remove('play-item-hud__row--pop');
    clone.style.margin = '0';
    clone.style.width = `${Math.ceil(row.getBoundingClientRect().width)}px`;
    clone.style.pointerEvents = 'none';
    ghost.appendChild(clone);
  }

  _ensurePlayItemHudTransparentDragCanvas() {
    if (this._playItemHudDragTransparentCanvas instanceof HTMLCanvasElement) {
      return this._playItemHudDragTransparentCanvas;
    }
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    this._playItemHudDragTransparentCanvas = c;
    return c;
  }

  /** @param {'full' | 'minimal'} mode */
  setLayoutMode(mode) {
    this.layoutMode = mode === 'minimal' ? 'minimal' : 'full';
    localStorage.setItem(LAYOUT_STORAGE_KEY, this.layoutMode);
    this.applyLayoutMode();
  }

  /** Collapses map shell + character panel to portrait / name / types / minimap + one dot control. */
  setPlayImmersiveChrome(on) {
    this.playImmersiveChrome = !!on;
    localStorage.setItem(IMMERSIVE_CHROME_STORAGE_KEY, this.playImmersiveChrome ? '1' : '0');
    this.applyPlayImmersiveChrome();
  }

  applyPlayImmersiveChrome() {
    const app = this.container?.closest?.('.app') ?? this.container?.parentElement;
    if (app?.classList) app.classList.toggle('app--play-immersive', this.playImmersiveChrome);
    const btn = this.container?.querySelector('#character-selector-immersive-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', this.playImmersiveChrome ? 'true' : 'false');
      btn.title = this.playImmersiveChrome ? 'Show full UI' : 'Minimal UI (portrait + minimap)';
      btn.textContent = this.playImmersiveChrome ? '+' : '·';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  applyLayoutMode() {
    const root = this.container?.querySelector('.character-selector');
    const btn = this.container?.querySelector('#character-selector-layout-toggle');
    if (!root) return;
    const minimal = this.layoutMode === 'minimal';
    root.classList.toggle('character-selector--minimal', minimal);
    if (btn) {
      btn.setAttribute('aria-pressed', minimal ? 'true' : 'false');
      btn.setAttribute(
        'aria-label',
        minimal ? 'Show full character panel' : 'Use minimal character panel'
      );
      btn.title = minimal ? 'Show full panel (includes search)' : 'Use minimal panel (hides search)';
      btn.textContent = minimal ? 'Full' : 'Min';
    }
  }

  /** Play mode: ground = `player.z`; sea = `heightStep` + `z` (0 beach, − ocean). Both always on-screen. */
  updatePlayAltitudeHud(data) {
    const gVal =
      this.container?.querySelector('#player-alt-ground-val') ||
      document.getElementById('minimap-alt-ground-val');
    const sVal =
      this.container?.querySelector('#player-alt-sea-val') ||
      document.getElementById('minimap-alt-sea-val');
    if (!gVal || !sVal) return;

    if (!data) {
      gVal.textContent = '—';
      sVal.textContent = '—';
      return;
    }

    const mx = Math.floor(player.x);
    const my = Math.floor(player.y);
    const tile = getMicroTile(mx, my, data);
    const hs = tile?.heightStep ?? 0;
    const z = Number(player.z) || 0;

    const aboveGround = z;
    const aboveSea = hs + z;

    gVal.textContent = aboveGround.toFixed(1);
    sVal.textContent =
      aboveSea === 0 ? '0' : (aboveSea > 0 ? '+' : '') + aboveSea.toFixed(1);
  }

  updatePlayVitalsHud() {
    const fillEl = this.container?.querySelector('#player-hp-hud-fill');
    const valueEl = this.container?.querySelector('#player-hp-hud-value');
    const hudEl = this.container?.querySelector('#player-hp-hud');
    const expFillEl = this.container?.querySelector('#player-exp-hud-fill');
    const expValueEl = this.container?.querySelector('#player-exp-hud-value');
    const expLevelEl = this.container?.querySelector('#player-exp-hud-level');
    if (!fillEl || !valueEl || !hudEl || !expFillEl || !expValueEl || !expLevelEl) return;
    const maxHp = Math.max(1, Number(player.maxHp) || 100);
    const hpRaw = Number(player.hp);
    const hp = Math.max(0, Math.min(maxHp, Number.isFinite(hpRaw) ? hpRaw : maxHp));
    const hp01 = hp / maxHp;
    const level = Math.max(1, Math.floor(Number(player.level) || 1));
    const expToNext = Math.max(1, Math.floor(Number(player.expToNext) || 100));
    const exp = Math.max(0, Math.min(expToNext, Number(player.exp) || 0));
    const exp01 = exp / expToNext;
    valueEl.textContent = `${Math.round(hp)}/${Math.round(maxHp)}`;
    fillEl.style.width = `${(hp01 * 100).toFixed(1)}%`;
    hudEl.classList.toggle('player-hp-hud--warn', hp01 <= 0.52 && hp01 > 0.24);
    hudEl.classList.toggle('player-hp-hud--danger', hp01 <= 0.24);
    expLevelEl.textContent = `Lv.${level}`;
    expValueEl.textContent = `${Math.round(exp)}/${Math.round(expToNext)}`;
    expFillEl.style.width = `${(exp01 * 100).toFixed(1)}%`;
  }

  /** Clears move cooldown UI (e.g. when leaving play mode). */
  clearPlayMovesCooldownHud() {
    const movesEl = this.container?.querySelector('#current-player-moves');
    if (!movesEl) return;
    for (const slot of movesEl.querySelectorAll('.move-slot[data-move-id]')) {
      const sweep = slot.querySelector('.move-slot__sweep');
      const timer = slot.querySelector('.move-slot__timer');
      if (sweep) sweep.style.setProperty('--cd-p', '0');
      if (timer) timer.textContent = '';
      slot.classList.remove('move-slot--on-cd');
    }
  }

  /** Clears item HUD counters (e.g. when leaving play mode). */
  clearPlayItemsHud() {
    this._lastPlayItemHudSig = '';
    this._playItemHudPickupOpaqueUntil = 0;
    this._playItemPopUntilByKey.clear();
    this._playItemPopGenByKey.clear();
    this._playItemHudPointerInside = false;
    this._playItemHudInventoryDragActive = false;
    this._setPlayItemHudDragGhostVisible(false);
    this._clearPlayItemHudDragGhostContent();
    const v = this.container?.querySelector('#play-item-crystal-count');
    if (v) v.textContent = '0';
    const listEl = this.container?.querySelector('#play-item-loot-list');
    if (listEl) listEl.innerHTML = '';
    const crystalRow = this.container?.querySelector('#play-item-crystal-row');
    if (crystalRow) crystalRow.setAttribute('draggable', 'false');
  }

  /** Call after mutating inventory outside the normal HUD tick (e.g. ground drop). */
  invalidatePlayItemsHudSignature() {
    this._lastPlayItemHudSig = '';
  }

  /** Live item counters (play mode; game loop). */
  updatePlayItemsHud() {
    const v = this.container?.querySelector('#play-item-crystal-count');
    if (!v) return;
    const crystalN = Math.max(0, getCrystalLootCount() | 0);
    v.textContent = String(crystalN);
    const crystalRow = this.container?.querySelector('#play-item-crystal-row');
    if (crystalRow) crystalRow.setAttribute('draggable', crystalN > 0 ? 'true' : 'false');

    const listEl = this.container?.querySelector('#play-item-loot-list');
    if (!listEl) {
      this._syncPlayItemHudOpacity();
      return;
    }
    const rows = getCollectedDetailInventorySnapshot()
      .filter((r) => !String(r.itemKey || '').toLowerCase().includes('crystal'))
      .slice(0, 8);
    const sig = `${crystalN}|${rows.map((r) => `${r.itemKey}:${r.count | 0}`).join(';')}`;
    if (sig === this._lastPlayItemHudSig) {
      this._syncPlayItemHudOpacity();
      this._reapplyPlayItemPopIfNeeded();
      return;
    }
    this._lastPlayItemHudSig = sig;

    const m = this._lootIconPathMap;
    listEl.innerHTML = rows
      .map((r) => {
        const slug = lootSlugForItemKey(r.itemKey);
        const path = slug && m ? m.get(slug) : null;
        const spriteHtml = path ? '' : playItemHudScatterSpriteHtml(r.itemKey);
        const icon = path
          ? `<img class="play-item-hud__icon-img" src="${path}" alt="" width="36" height="36" decoding="async" />`
          : spriteHtml
            ? spriteHtml
            : '<span class="play-item-hud__icon-fallback" aria-hidden="true"></span>';
        const dragKey = encodeURIComponent(String(r.itemKey || ''));
        return `
          <div class="play-item-hud__row play-item-hud__row--draggable" draggable="true" data-inventory-drag="${dragKey}" title="Drag to the map to drop">
            <span class="play-item-hud__icon" aria-hidden="true">${icon}</span>
            <div class="play-item-hud__meta">
              <span class="play-item-hud__label">${lootLabelFromItemKey(r.itemKey)}</span>
              <span class="play-item-hud__count">${Math.max(0, r.count | 0)}</span>
            </div>
          </div>
        `;
      })
      .join('');
    this._reapplyPlayItemPopIfNeeded();
    this._syncPlayItemHudOpacity();
  }

  _syncPlayItemHudOpacity() {
    const el = this.container?.querySelector('#play-item-hud');
    if (!(el instanceof HTMLElement)) return;
    const engaged =
      this._playItemHudPointerInside ||
      this._playItemHudInventoryDragActive ||
      performance.now() < (this._playItemHudPickupOpaqueUntil || 0);
    el.classList.toggle('play-item-hud--engaged', engaged);
  }

  /** @param {string} itemKey */
  _findPlayItemHudRowForPop(itemKey) {
    const key = String(itemKey || '');
    if (key === PLAY_ITEM_POP_CRYSTAL_SLOT || key.toLowerCase().includes('crystal')) {
      return this.container?.querySelector('#play-item-crystal-row') ?? null;
    }
    return (
      this.container?.querySelector(
        `#play-item-loot-list [data-inventory-drag="${encodeURIComponent(key)}"]`
      ) ?? null
    );
  }

  _pruneExpiredPlayItemPops(now) {
    for (const [k, until] of [...this._playItemPopUntilByKey.entries()]) {
      if (now < until) continue;
      this._playItemPopUntilByKey.delete(k);
      this._playItemPopGenByKey.delete(k);
      const row = this._findPlayItemHudRowForPop(k);
      if (row instanceof HTMLElement) {
        row.classList.remove('play-item-hud__row--pop');
        delete row.dataset.popGen;
      }
    }
  }

  _reapplyPlayItemPopIfNeeded() {
    const now = performance.now();
    this._pruneExpiredPlayItemPops(now);
    for (const [key, until] of this._playItemPopUntilByKey.entries()) {
      if (now >= until) continue;
      const row = this._findPlayItemHudRowForPop(key);
      if (!(row instanceof HTMLElement)) continue;
      const gen = this._playItemPopGenByKey.get(key) || 0;
      const appliedGen = row.dataset.popGen || '';
      if (appliedGen !== String(gen)) {
        row.dataset.popGen = String(gen);
        row.classList.remove('play-item-hud__row--pop');
        void row.offsetWidth;
        row.classList.add('play-item-hud__row--pop');
      } else if (!row.classList.contains('play-item-hud__row--pop')) {
        row.classList.add('play-item-hud__row--pop');
      }
    }
  }

  /** Live cooldown sweep + timer on skill slots (play mode; game loop). */
  updatePlayMovesCooldownHud() {
    const movesEl = this.container?.querySelector('#current-player-moves');
    if (!movesEl) return;
    for (const slot of movesEl.querySelectorAll('.move-slot[data-move-id]')) {
      const id = slot.getAttribute('data-move-id');
      const sweep = slot.querySelector('.move-slot__sweep');
      const timer = slot.querySelector('.move-slot__timer');
      if (!id || !sweep || !timer) continue;
      const cd = getPlayerMoveCooldownRemaining(id);
      const max = Math.max(0.02, getPlayerMoveCooldownUiMax(id));
      if (cd <= 0.008) {
        if (sweep.style.getPropertyValue('--cd-p') !== '0') sweep.style.setProperty('--cd-p', '0');
        if (timer.textContent) timer.textContent = '';
        if (slot.classList.contains('move-slot--on-cd')) slot.classList.remove('move-slot--on-cd');
      } else {
        const p = Math.min(1, cd / max);
        const pText = String(p);
        if (sweep.style.getPropertyValue('--cd-p') !== pText) sweep.style.setProperty('--cd-p', pText);
        const timerText = cd >= 10 ? String(Math.round(cd)) : cd.toFixed(1);
        if (timer.textContent !== timerText) timer.textContent = timerText;
        if (!slot.classList.contains('move-slot--on-cd')) slot.classList.add('move-slot--on-cd');
      }
    }
  }

  render() {
    const activeName = getGen1SpeciesName(player.dexId);
    this.container.innerHTML = `
      <div class="character-selector">
        <div class="selector-header">
          <div class="player-preview-pill player-preview-pill--no-portrait" id="player-preview-pill" title="Click to open Pokémon Box" aria-label="Open Pokémon Box" role="button" tabindex="0">
            <img class="player-preview-portrait player-preview-portrait--hidden" id="player-preview-portrait" alt="${activeName}" width="40" height="40">
          </div>
          <div class="player-info">
            <span class="player-name" id="current-player-name">${activeName}</span>
            <div class="player-types" id="current-player-types"></div>
            <div class="player-hp-hud" id="player-hp-hud" aria-label="Player HP">
              <div class="player-hp-hud__row">
                <span class="player-hp-hud__label">HP</span>
                <span class="player-hp-hud__value" id="player-hp-hud-value">100/100</span>
              </div>
              <div class="player-hp-hud__bar">
                <div class="player-hp-hud__fill" id="player-hp-hud-fill"></div>
              </div>
            </div>
            <div class="player-exp-hud" id="player-exp-hud" aria-label="Player EXP">
              <div class="player-exp-hud__row">
                <span class="player-exp-hud__label" id="player-exp-hud-level">Lv.1</span>
                <span class="player-exp-hud__value" id="player-exp-hud-value">0/100</span>
              </div>
              <div class="player-exp-hud__bar">
                <div class="player-exp-hud__fill" id="player-exp-hud-fill"></div>
              </div>
            </div>
          </div>
          <div class="selector-header__actions">
            <button
              type="button"
              class="character-selector__layout-toggle"
              id="character-selector-layout-toggle"
              aria-pressed="false"
              aria-label="Use minimal character panel"
              title="Use minimal panel (hides search)"
            >Min</button>
            <button
              type="button"
              class="character-selector__immersive-toggle"
              id="character-selector-immersive-toggle"
              aria-pressed="false"
              aria-label="Minimal UI (portrait + minimap)"
              title="Minimal UI (portrait + minimap)"
            >·</button>
          </div>
        </div>

        <div class="player-moves-box" id="player-moves-box" aria-label="Current species moves">
          <div class="player-moves-title">Moves</div>
          <div class="player-field-skill-chip" id="player-field-skill-chip" title="Move bound to LMB (hold 1 to change)">
            LMB: <span id="player-field-skill-label">Tackle</span>
          </div>
          <div class="player-field-charge hidden" id="player-field-charge" aria-label="Field move charge">
            <div class="player-field-charge__bar">
              <div class="player-field-charge__segment player-field-charge__segment--1">
                <div class="player-field-charge__fill player-field-charge__fill--1" id="player-field-charge-fill-1"></div>
              </div>
              <div class="player-field-charge__segment player-field-charge__segment--2">
                <div class="player-field-charge__fill player-field-charge__fill--2" id="player-field-charge-fill-2"></div>
              </div>
              <div class="player-field-charge__segment player-field-charge__segment--3">
                <div class="player-field-charge__fill player-field-charge__fill--3" id="player-field-charge-fill-3"></div>
              </div>
              <div class="player-field-charge__segment player-field-charge__segment--4">
                <div class="player-field-charge__fill player-field-charge__fill--4" id="player-field-charge-fill-4"></div>
              </div>
            </div>
            <div class="player-field-charge__label" id="player-field-charge-label">Tackle Charge 0%</div>
          </div>
          <div class="player-moves-list" id="current-player-moves"></div>
        </div>

        <div class="play-item-hud" id="play-item-hud" aria-label="Collected items">
          <div class="play-item-hud__header">
            <div class="play-item-hud__title">Items</div>
            <button
              type="button"
              class="play-item-hud__toggle"
              id="play-item-hud-toggle"
              aria-pressed="false"
              aria-label="Minimize item inventory (Gamepad A)"
              title="Minimize item inventory (Gamepad A)"
            >A Min</button>
          </div>
          <div class="play-item-hud__grid" id="play-item-grid">
            <div
              class="play-item-hud__row play-item-hud__row--draggable"
              id="play-item-crystal-row"
              draggable="false"
              data-inventory-drag="${PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE}"
              title="Drag to the map to drop"
            >
              <span class="play-item-hud__icon" aria-hidden="true">
                <img id="play-item-crystal-icon" class="play-item-hud__icon-img" width="36" height="36" alt="" decoding="async" />
              </span>
              <div class="play-item-hud__meta">
                <span class="play-item-hud__label">Crystal Shards</span>
                <span class="play-item-hud__count" id="play-item-crystal-count">0</span>
              </div>
            </div>
            <div id="play-item-loot-list"></div>
          </div>
        </div>
      </div>
    `;
  }

  attachEvents() {
    // Pokémon Box modal — triggered by clicking the portrait pill
    this._boxModal = installPokemonBoxModal(this);
    const portraitPill = this.container.querySelector('#player-preview-pill');
    if (portraitPill) {
      portraitPill.addEventListener('click', (e) => {
        e.stopPropagation();
        this._boxModal.open(player.dexId ?? 1);
      });
      portraitPill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._boxModal.open(player.dexId ?? 1);
        }
      });
    }

    const layoutBtn = this.container.querySelector('#character-selector-layout-toggle');
    if (layoutBtn) {
      layoutBtn.addEventListener('click', () => {
        this.setLayoutMode(this.layoutMode === 'minimal' ? 'full' : 'minimal');
      });
    }

    const immersiveBtn = this.container.querySelector('#character-selector-immersive-toggle');
    if (immersiveBtn) {
      immersiveBtn.addEventListener('click', () => {
        this.setPlayImmersiveChrome(!this.playImmersiveChrome);
      });
    }
    window.addEventListener('play-field-skill-change', this._onFieldSkillChange);
    window.addEventListener('play-player-input-bindings-change', this._onInputBindingsChange);
    window.addEventListener('play-item-hud-pickup', this._onPlayItemHudPickup);
    document.addEventListener('dragend', this._onDocInventoryDragEnd);
    document.addEventListener('dragover', this._onDocInventoryDragOver);
    window.addEventListener('play-toggle-item-hud', this._onTogglePlayItemHud);

    const itemHudToggleBtn = this.container?.querySelector('#play-item-hud-toggle');
    if (itemHudToggleBtn instanceof HTMLButtonElement) {
      itemHudToggleBtn.addEventListener('click', () => {
        this.setPlayItemHudCollapsed(!this.playItemHudCollapsed);
      });
    }

    const itemHud = this.container?.querySelector('#play-item-hud');
    if (itemHud) {
      this.setPlayItemHudCollapsed(this.playItemHudCollapsed);
      itemHud.addEventListener('pointerenter', () => {
        this._playItemHudPointerInside = true;
        this._syncPlayItemHudOpacity();
      });
      itemHud.addEventListener('pointerleave', () => {
        this._playItemHudPointerInside = false;
        this._syncPlayItemHudOpacity();
      });
      itemHud.addEventListener('dragstart', (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        const row = t.closest('[data-inventory-drag]');
        if (!row || !itemHud.contains(row)) return;
        if (row.getAttribute('draggable') !== 'true') {
          e.preventDefault();
          return;
        }
        const raw = row.getAttribute('data-inventory-drag') || '';
        const token =
          raw === PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE ? raw : decodeURIComponent(raw);
        if (!token) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('text/plain', `pkmn-inventory-drop:${token}`);
        e.dataTransfer.effectAllowed = 'copyMove';
        const transparentDrag = this._ensurePlayItemHudTransparentDragCanvas();
        e.dataTransfer.setDragImage(transparentDrag, 0, 0);
        this._mountPlayItemHudDragGhostFromRow(row);
        this._setPlayItemHudDragGhostPosition(e.clientX, e.clientY);
        this._setPlayItemHudDragGhostVisible(true);
        window.dispatchEvent(new CustomEvent('play-item-hud-drag-token', { detail: { token } }));
        this._playItemHudInventoryDragActive = true;
        this._syncPlayItemHudOpacity();
      });
    }
  }

  async refreshPlayerMovesHud() {
    if (!this.container) return;
    await this.updatePreview();
  }

  updateFieldSkillDisplay() {
    const labelEl = this.container?.querySelector('#player-field-skill-label');
    if (!labelEl) return;
    const skillId = getPlayerInputBindings(player.dexId).lmb;
    labelEl.textContent = getBindableMoveLabel(skillId);
  }

  updatePlayFieldMoveChargeHud() {
    const wrap = this.container?.querySelector('#player-field-charge');
    if (wrap instanceof HTMLElement) wrap.classList.add('hidden');
  }

  async selectSpecies(id) {
    // 1. Update player data
    setPlayerSpecies(id);
    syncSelectedFieldSkillForDex(id);
    syncSelectedSpecialAttackForDex(id);
    
    // 2. Ensure assets are loading/loaded
    await ensurePokemonSheetsLoaded(imageCache, id);

    // 3. Update UI
    await this.updatePreview();
  }

  async updatePreview() {
    const nameEl = this.container.querySelector('#current-player-name');
    const pillEl = this.container.querySelector('#player-preview-pill');
    if (!nameEl || !pillEl) return;

    const displayName = getGen1SpeciesName(player.dexId);
    nameEl.textContent = displayName;
    pillEl.title = displayName;

    const typesEl = this.container.querySelector('#current-player-types');
    if (typesEl) {
      const cfg = getPokemonConfig(player.dexId);
      typesEl.innerHTML = cfg?.types.map(t => `<span class="type-icon type-${t}">${t.toUpperCase()}</span>`).join(' ') || '';
    }

    const movesEl = this.container.querySelector('#current-player-moves');
    if (movesEl) {
      const hotkeys = ['LMB', 'RMB', 'MMB', 'Wheel↑', 'Wheel↓'];
      const slotHtml = (hudMoveId, iconFile, hk, title, labelText) => {
        const label = labelText != null && String(labelText).length ? labelText : getBindableMoveLabel(String(hudMoveId).replace(/^field:/, ''));
        const abbrev = moveAbbrevFromLabel(label);
        const src = `${SKILL_ICON_BASE}/${iconFile}.png`;
        const uClass = hudMoveId === 'ultimate' ? ' move-slot--ultimate' : '';
        return `<div class="move-slot${uClass}" data-move-id="${hudMoveId}" title="${title || label}">
          <div class="move-slot__icon-wrap" data-abbrev="${abbrev}">
            <img class="move-slot__icon" src="${src}" alt="" width="40" height="40" loading="lazy" decoding="async" />
            <span class="move-slot__sweep" aria-hidden="true" style="--cd-p:0"></span>
            <span class="move-slot__timer" aria-live="polite"></span>
          </div>
          <span class="move-slot__key">${hk}</span>
          <span class="move-slot__name">${label}</span>
        </div>`;
      };
      const bind = getPlayerInputBindings(player.dexId);
      const slotDefs = [
        { moveId: bind.lmb, hk: hotkeys[0], digit: 1 },
        { moveId: bind.rmb, hk: hotkeys[1], digit: 2 },
        { moveId: bind.mmb, hk: hotkeys[2], digit: 3 },
        { moveId: bind.wheelUp, hk: hotkeys[3], digit: 4 },
        { moveId: bind.wheelDown, hk: hotkeys[4], digit: 5 }
      ];
      const slots = slotDefs.map(({ moveId, hk, digit }) => {
        const label = getBindableMoveLabel(moveId);
        return {
          hudMoveId: moveId,
          iconFile: skillIconFileForMoveId(moveId),
          hk,
          title: `${label} — slot ${hk} (segure ${digit} para trocar na roda)`,
          labelText: label
        };
      });
      const slotsHtml = slots.map((s) => slotHtml(s.hudMoveId, s.iconFile, s.hk, s.title, s.labelText)).join('');
      movesEl.classList.add('player-moves-list--slots');
      movesEl.innerHTML = slotsHtml;
      for (const img of movesEl.querySelectorAll('.move-slot__icon')) {
        img.addEventListener('error', () => {
          img.classList.add('move-slot__icon--missing');
          img.removeAttribute('src');
        });
      }
    }
    this.updateFieldSkillDisplay();
    this.updatePlayVitalsHud();

    let portraitEl = pillEl.querySelector('#player-preview-portrait');
    if (!portraitEl) {
      pillEl.innerHTML = `<img class="player-preview-portrait player-preview-portrait--hidden" id="player-preview-portrait" alt="" width="40" height="40">`;
      portraitEl = pillEl.querySelector('#player-preview-portrait');
    }

    portraitEl.alt = displayName;
    portraitEl.classList.add('player-preview-portrait--hidden');
    portraitEl.removeAttribute('src');
    pillEl.classList.add('player-preview-pill--no-portrait');

    const prefix = await probeSpriteCollabPortraitPrefix(player.dexId);
    if (portraitEl && prefix) {
      portraitEl.onload = () => {
        portraitEl.classList.remove('player-preview-portrait--hidden');
        pillEl.classList.remove('player-preview-pill--no-portrait');
      };
      portraitEl.onerror = () => {
        portraitEl.classList.add('player-preview-portrait--hidden');
        pillEl.classList.add('player-preview-pill--no-portrait');
      };
      portraitEl.src = `${prefix}Normal.png`;
    }
  }
}
