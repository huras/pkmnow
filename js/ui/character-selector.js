import { player, setPlayerSpecies } from '../player.js';
import { summonDebugWildPokemon } from '../wild-pokemon/index.js';
import { getGen1SpeciesName, padDex3 } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { probeSpriteCollabPortraitPrefix } from '../pokemon/spritecollab-portraits.js';
import { imageCache } from '../image-cache.js';
import { getMicroTile } from '../chunking.js';
import { getPlayPointerMode, setPlayPointerMode } from '../main/play-pointer-mode.js';
import { playInputState } from '../main/play-input-state.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import {
  getPlayerMoveCooldownRemaining,
  getPlayerMoveCooldownUiMax
} from '../moves/moves-manager.js';
import { getCollectedDetailInventorySnapshot, getCrystalLootCount } from '../main/play-crystal-tackle.js';
import { syncSelectedFieldSkillForDex, syncSelectedSpecialAttackForDex } from '../main/play-mouse-combat.js';
import { getPlayerInputBindings, getBindableMoveLabel } from '../main/player-input-slots.js';
import { getChargeBarProgresses, getChargeLevel } from '../main/play-charge-levels.js';
import { getPokemondbItemIconPathMap } from '../social/pokemondb-item-icon-paths.js';

const SKILL_ICON_BASE = 'skill-icons';
const LAYOUT_STORAGE_KEY = 'pkmn_character_selector_layout';
const IMMERSIVE_CHROME_STORAGE_KEY = 'pkmn_play_immersive_chrome';

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

/** @param {string} itemKey */
function lootSlugForItemKey(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  if (k.includes('crystal')) return 'star-piece';
  const firstTok = (k.split(/\s+/)[0] || '').toLowerCase();
  if (/^[a-z][a-z0-9-]*$/i.test(firstTok)) return firstTok;
  return null;
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
    this.allSpecies = [];
    this.isOpen = false;
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

    /** @type {Map<string, string> | null} */
    this._lootIconPathMap = null;
    void getPokemondbItemIconPathMap().then((m) => {
      this._lootIconPathMap = m;
      const crystalPath = m.get('star-piece');
      const crystalImg = this.container?.querySelector('#play-item-crystal-icon');
      if (crystalImg && crystalPath) crystalImg.setAttribute('src', crystalPath);
      this.updatePlayItemsHud();
    });

    for (let i = 1; i <= 151; i++) {
      this.allSpecies.push({
        id: i,
        name: getGen1SpeciesName(i)
      });
    }

    this.init();
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
      btn.title = minimal
        ? 'Show search and right-click mode bar'
        : 'Hide search and right-click mode bar';
      btn.textContent = minimal ? 'Full' : 'Min';
    }
  }

  /** Play mode: ground = `player.z`; sea = `heightStep` + `z` (0 beach, − ocean). Both always on-screen. */
  updatePlayAltitudeHud(data) {
    const gVal = this.container?.querySelector('#player-alt-ground-val');
    const sVal = this.container?.querySelector('#player-alt-sea-val');
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
    const v = this.container?.querySelector('#play-item-crystal-count');
    if (v) v.textContent = '0';
    const listEl = this.container?.querySelector('#play-item-loot-list');
    if (listEl) listEl.innerHTML = '';
  }

  /** Live item counters (play mode; game loop). */
  updatePlayItemsHud() {
    const v = this.container?.querySelector('#play-item-crystal-count');
    if (!v) return;
    v.textContent = String(Math.max(0, getCrystalLootCount() | 0));
    const listEl = this.container?.querySelector('#play-item-loot-list');
    if (!listEl) return;
    const rows = getCollectedDetailInventorySnapshot()
      .filter((r) => !String(r.itemKey || '').toLowerCase().includes('crystal'))
      .slice(0, 4);
    const m = this._lootIconPathMap;
    listEl.innerHTML = rows
      .map((r) => {
        const slug = lootSlugForItemKey(r.itemKey);
        const path = slug && m ? m.get(slug) : null;
        const icon = path
          ? `<img class="play-item-hud__icon-img" src="${path}" alt="" width="20" height="20" decoding="async" />`
          : '<span class="play-item-hud__icon-fallback" aria-hidden="true"></span>';
        return `
          <div class="play-item-hud__row">
            <span class="play-item-hud__icon" aria-hidden="true">${icon}</span>
            <span class="play-item-hud__label">${lootLabelFromItemKey(r.itemKey)}</span>
            <span class="play-item-hud__count">${Math.max(0, r.count | 0)}</span>
          </div>
        `;
      })
      .join('');
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
        sweep.style.setProperty('--cd-p', '0');
        timer.textContent = '';
        slot.classList.remove('move-slot--on-cd');
      } else {
        const p = Math.min(1, cd / max);
        sweep.style.setProperty('--cd-p', String(p));
        timer.textContent = cd >= 10 ? String(Math.round(cd)) : cd.toFixed(1);
        slot.classList.add('move-slot--on-cd');
      }
    }
  }

  render() {
    const activeName = getGen1SpeciesName(player.dexId);
    this.container.innerHTML = `
      <div class="character-selector">
        <div class="selector-header">
          <div class="player-preview-pill player-preview-pill--no-portrait" id="player-preview-pill" title="${activeName}">
            <img class="player-preview-portrait player-preview-portrait--hidden" id="player-preview-portrait" alt="${activeName}" width="40" height="40">
          </div>
          <div class="player-info">
            <span class="player-name" id="current-player-name">${activeName}</span>
            <div class="player-types" id="current-player-types"></div>
          </div>
          <div class="selector-header__actions">
            <button
              type="button"
              class="character-selector__layout-toggle"
              id="character-selector-layout-toggle"
              aria-pressed="false"
              aria-label="Use minimal character panel"
              title="Hide search and right-click mode bar"
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

        <div
          class="player-alt-compact"
          role="status"
          aria-live="polite"
          aria-label="Ground height above tile underfoot, and sea level in tiles (beach is zero, negative is ocean)"
        >
          <span class="player-alt-compact__item">
            <span class="player-alt-compact__label">Ground</span>
            <span class="player-alt-compact__v" id="player-alt-ground-val">—</span>
          </span>
          <span class="player-alt-compact__dot" aria-hidden="true"></span>
          <span class="player-alt-compact__item player-alt-compact__item--sea">
            <span class="player-alt-compact__label player-alt-compact__label--sea">Sea</span>
            <span class="player-alt-compact__v player-alt-compact__v--sea" id="player-alt-sea-val">—</span>
          </span>
        </div>

        <div
          id="play-pointer-mode-bar"
          class="play-pointer-mode-bar"
          role="group"
          aria-label="Right-click: game move vs debug menu"
        >
          <span class="play-pointer-mode-bar__label">Right-click</span>
          <label class="play-pointer-mode-bar__opt"
            ><input type="radio" name="playPointerMode" value="game" /> Game</label
          >
          <label class="play-pointer-mode-bar__opt"
            ><input type="radio" name="playPointerMode" value="debug" /> Debug</label
          >
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
            </div>
            <div class="player-field-charge__label" id="player-field-charge-label">Tackle Charge 0%</div>
          </div>
          <div class="player-moves-list" id="current-player-moves"></div>
        </div>

        <div
          id="character-social-numpad"
          class="play-social-overlay play-social-overlay--panel social-numpad-box"
          aria-label="Social interactions via numpad"
        ></div>

        <div class="search-container">
          <span class="search-icon">🔍</span>
          <input type="text" class="selector-search" id="species-search" placeholder="Search…" autocomplete="off" spellcheck="false">
          <div class="results-list" id="search-results">
            <!-- Results injected here -->
          </div>
        </div>

        <div class="play-item-hud" id="play-item-hud" aria-label="Collected items">
          <div class="play-item-hud__title">Items</div>
          <div class="play-item-hud__row">
            <span class="play-item-hud__icon" aria-hidden="true">
              <img id="play-item-crystal-icon" class="play-item-hud__icon-img" width="20" height="20" alt="" decoding="async" />
            </span>
            <span class="play-item-hud__label">Crystal Shards</span>
            <span class="play-item-hud__count" id="play-item-crystal-count">0</span>
          </div>
          <div id="play-item-loot-list"></div>
        </div>
      </div>
    `;
  }

  attachEvents() {
    const searchInput = this.container.querySelector('#species-search');
    const resultsList = this.container.querySelector('#search-results');
    const pointerBar = this.container.querySelector('#play-pointer-mode-bar');

    if (pointerBar) {
      this.syncPlayPointerModeRadios();
      for (const el of pointerBar.querySelectorAll('input[name="playPointerMode"]')) {
        el.addEventListener('change', () => {
          if (!(el instanceof HTMLInputElement) || !el.checked) return;
          if (el.value === 'game' || el.value === 'debug') setPlayPointerMode(el.value);
        });
      }
    }

    searchInput.addEventListener('focus', () => {
      void this.showResults('');
      resultsList.classList.add('active');
    });

    searchInput.addEventListener('input', (e) => {
      void this.showResults(e.target.value);
    });

    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        resultsList.classList.remove('active');
      }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        resultsList.classList.remove('active');
        searchInput.blur();
      }
    });

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
    const fill1 = this.container?.querySelector('#player-field-charge-fill-1');
    const fill2 = this.container?.querySelector('#player-field-charge-fill-2');
    const fill3 = this.container?.querySelector('#player-field-charge-fill-3');
    const label = this.container?.querySelector('#player-field-charge-label');
    if (
      !(wrap instanceof HTMLElement) ||
      !(fill1 instanceof HTMLElement) ||
      !(fill2 instanceof HTMLElement) ||
      !(fill3 instanceof HTMLElement) ||
      !(label instanceof HTMLElement)
    ) return;
    const skillId = getPlayerInputBindings(player.dexId).lmb;
    const p = Math.max(0, Math.min(1, Number(playInputState.chargeLeft01) || 0));
    const [p1, p2, p3] = getChargeBarProgresses(p);
    const lvl = getChargeLevel(p);
    const canChargeFieldSkill = skillId === 'tackle' || skillId === 'cut';
    const shouldShow = canChargeFieldSkill && p > 0.005;
    const moveLabel = skillId === 'cut' ? 'Cut' : 'Tackle';
    wrap.classList.toggle('hidden', !shouldShow);
    fill1.style.width = `${Math.round(p1 * 100)}%`;
    fill2.style.width = `${Math.round(p2 * 100)}%`;
    fill3.style.width = `${Math.round(p3 * 100)}%`;
    label.textContent = `${moveLabel} Charge L${lvl} ${Math.round(p * 100)}%`;
  }

  syncPlayPointerModeRadios() {
    const pointerBar = this.container?.querySelector('#play-pointer-mode-bar');
    if (!pointerBar) return;
    const mode = getPlayPointerMode();
    for (const el of pointerBar.querySelectorAll('input[name="playPointerMode"]')) {
      if (el instanceof HTMLInputElement) el.checked = el.value === mode;
    }
  }

  getSocialOverlayElement() {
    return this.container?.querySelector('#character-social-numpad') || null;
  }

  async showResults(query) {
    const resultsList = this.container.querySelector('#search-results');
    const filtered = this.allSpecies.filter(s => 
      s.name.toLowerCase().includes(query.toLowerCase()) || 
      String(s.id).includes(query)
    ).slice(0, 10); // Limit to 10 for performance

    if (filtered.length === 0) {
      resultsList.innerHTML = `<div class="result-item" style="opacity: 0.5; pointer-events: none;">No species found</div>`;
      return;
    }

    resultsList.innerHTML = filtered.map(s => {
      const cfg = getPokemonConfig(s.id);
      const typesHtml = cfg?.types.map(t => `<span class="type-icon type-${t}">${t.toUpperCase()}</span>`).join(' ') || '';
      return `
      <div class="result-item ${s.id === player.dexId ? 'selected' : ''}" data-id="${s.id}">
        <span class="result-portrait-mask" aria-hidden="true">
          <img class="result-icon-portrait result-icon-portrait--pending" alt="" width="30" height="30" data-dex="${s.id}" decoding="async" />
        </span>
        <div class="result-details">
          <span class="result-name">${s.name}</span>
          <div class="result-types">${typesHtml}</div>
        </div>
        <span class="result-id">#${padDex3(s.id)}</span>
      </div>
    `}).join('');

    await Promise.all(
      [...resultsList.querySelectorAll('img.result-icon-portrait[data-dex]')].map(async (img) => {
        const id = parseInt(img.dataset.dex, 10);
        const prefix = await probeSpriteCollabPortraitPrefix(id);
        if (prefix) {
          img.onload = () => img.classList.remove('result-icon-portrait--pending');
          img.onerror = () => {
            img.classList.remove('result-icon-portrait--pending');
            img.classList.add('result-icon-portrait--missing');
          };
          img.src = `${prefix}Normal.png`;
        } else {
          img.classList.remove('result-icon-portrait--pending');
          img.classList.add('result-icon-portrait--missing');
        }
      })
    );

    resultsList.querySelectorAll('.result-item').forEach((item) => {
      item.addEventListener('click', (ev) => {
        const id = parseInt(item.dataset.id, 10);
        const data = this.getCurrentData?.() ?? null;
        const inPlay = this.getAppMode?.() === 'play';
        if ((ev.ctrlKey || ev.metaKey) && inPlay && data) {
          summonDebugWildPokemon(id, data, player.x, player.y);
        } else {
          void this.selectSpecies(id);
        }
        resultsList.classList.remove('active');
        const si = this.container.querySelector('#species-search');
        if (si) si.value = '';
      });
    });
  }

  async selectSpecies(id) {
    // 1. Update player data
    setPlayerSpecies(id);
    syncSelectedFieldSkillForDex(id);
    syncSelectedSpecialAttackForDex(id);
    
    // 2. Clear focus/search
    this.container.querySelector('#species-search')?.blur();

    // 3. Ensure assets are loading/loaded
    await ensurePokemonSheetsLoaded(imageCache, id);

    // 4. Update UI
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
          iconFile: moveId,
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
