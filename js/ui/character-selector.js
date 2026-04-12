import { player, setPlayerSpecies } from '../player.js';
import { getGen1SpeciesName, padDex3 } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { probeSpriteCollabPortraitPrefix } from '../pokemon/spritecollab-portraits.js';
import { imageCache } from '../image-cache.js';

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

  render() {
    const activeName = getGen1SpeciesName(player.dexId);
    this.container.innerHTML = `
      <div class="character-selector">
        <div class="selector-header">
          <div class="player-preview-pill player-preview-pill--no-portrait" id="player-preview-pill" title="${activeName}">
            <img class="player-preview-portrait player-preview-portrait--hidden" id="player-preview-portrait" alt="${activeName}" width="48" height="48">
          </div>
          <div class="player-info">
            <span class="player-label">Playing as</span>
            <span class="player-name" id="current-player-name">${activeName}</span>
          </div>
        </div>

        <div class="search-container">
          <span class="search-icon">🔍</span>
          <input type="text" class="selector-search" id="species-search" placeholder="Change Pokémon..." autocomplete="off">
          
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

    resultsList.innerHTML = filtered.map(s => `
      <div class="result-item ${s.id === player.dexId ? 'selected' : ''}" data-id="${s.id}">
        <span class="result-portrait-mask" aria-hidden="true">
          <img class="result-icon-portrait result-icon-portrait--pending" alt="" width="36" height="36" data-dex="${s.id}" decoding="async" />
        </span>
        <span class="result-name">${s.name}</span>
        <span class="result-id">#${padDex3(s.id)}</span>
      </div>
    `).join('');

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

    let portraitEl = pillEl.querySelector('#player-preview-portrait');
    if (!portraitEl) {
      pillEl.innerHTML = `<img class="player-preview-portrait player-preview-portrait--hidden" id="player-preview-portrait" alt="" width="48" height="48">`;
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
