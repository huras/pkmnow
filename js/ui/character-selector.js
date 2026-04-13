import { player, setPlayerSpecies } from '../player.js';
import { getGen1SpeciesName, padDex3 } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { probeSpriteCollabPortraitPrefix } from '../pokemon/spritecollab-portraits.js';
import { imageCache } from '../image-cache.js';
import { getMicroTile } from '../chunking.js';
import { getPlayPointerMode, setPlayPointerMode } from '../main/play-pointer-mode.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { getPokemonMoveset, getMoveLabel } from '../moves/pokemon-moveset-config.js';

export class CharacterSelector {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.allSpecies = [];
    this.isOpen = false;
    
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
    this.updatePreview().catch(() => {});
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
          <div class="player-moves-list" id="current-player-moves"></div>
          <div class="player-moves-help">LMB/RMB = 1st/2nd · Left Ctrl + click = 3rd/4th</div>
        </div>

        <div class="search-container">
          <span class="search-icon">🔍</span>
          <input type="text" class="selector-search" id="species-search" placeholder="Search…" autocomplete="off" spellcheck="false">
          
          <div class="results-list" id="search-results">
            <!-- Results injected here -->
          </div>
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
  }

  syncPlayPointerModeRadios() {
    const pointerBar = this.container?.querySelector('#play-pointer-mode-bar');
    if (!pointerBar) return;
    const mode = getPlayPointerMode();
    for (const el of pointerBar.querySelectorAll('input[name="playPointerMode"]')) {
      if (el instanceof HTMLInputElement) el.checked = el.value === mode;
    }
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
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id, 10);
        this.selectSpecies(id);
        resultsList.classList.remove('active');
        this.container.querySelector('#species-search').value = '';
      });
    });
  }

  async selectSpecies(id) {
    // 1. Update player data
    setPlayerSpecies(id);
    
    // 2. Clear focus/search
    this.container.querySelector('#species-search').blur();

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
      const moves = getPokemonMoveset(player.dexId);
      const hotkeys = ['LMB', 'RMB', 'LCtrl+LMB', 'LCtrl+RMB'];
      movesEl.innerHTML = moves
        .map((m, i) => `<span class="move-chip" title="${getMoveLabel(m)}"><b>${hotkeys[i] || '—'}</b> ${getMoveLabel(m)}</span>`)
        .join('');
    }

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
