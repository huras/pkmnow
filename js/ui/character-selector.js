import { player, setPlayerSpecies } from '../player.js';
import { getGen1SpeciesName, padDex3 } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
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
    this.updatePreview();
  }

  render() {
    const activeName = getGen1SpeciesName(player.dexId);
    this.container.innerHTML = `
      <div class="character-selector">
        <div class="selector-header">
          <div class="player-preview-pill" id="player-preview-pill">
            <img src="tilesets/pokemon/${padDex3(player.dexId)}_idle.png" onerror="this.src='tilesets/gengar_idle.png'">
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
      this.showResults('');
      resultsList.classList.add('active');
    });

    searchInput.addEventListener('input', (e) => {
      this.showResults(e.target.value);
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

  showResults(query) {
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
        <img class="result-icon" src="tilesets/pokemon/${padDex3(s.id)}_idle.png" onerror="this.src='tilesets/gengar_idle.png'">
        <span class="result-name">${s.name}</span>
        <span class="result-id">#${padDex3(s.id)}</span>
      </div>
    `).join('');

    // Attach click events to items
    resultsList.querySelectorAll('.result-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id);
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
    this.updatePreview();
  }

  updatePreview() {
    const nameEl = this.container.querySelector('#current-player-name');
    const pillEl = this.container.querySelector('#player-preview-pill');
    
    nameEl.textContent = getGen1SpeciesName(player.dexId);
    pillEl.innerHTML = `<img src="tilesets/pokemon/${padDex3(player.dexId)}_idle.png" onerror="this.src='tilesets/gengar_idle.png'">`;
  }
}
