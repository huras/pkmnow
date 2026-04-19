/**
 * Pokémon Box Modal
 * -----------------
 * GBA PC-Box inspired paginated species browser.
 * Opens when the player clicks their portrait pill in the character selector.
 *
 * Layout: 5 columns × 6 rows = 30 slots per page.
 * All 251 Gen 1+2 species → 9 pages.
 *
 * Usage:
 *   const modal = new PokemonBoxModal({ onSelect: (dexId) => ... });
 *   modal.open(currentDexId);
 */

import { NATIONAL_DEX_MAX, getNationalSpeciesName, padDex3 } from '../pokemon/national-dex-registry.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { probeSpriteCollabPortraitPrefix } from '../pokemon/spritecollab-portraits.js';

const SLOTS_PER_PAGE = 30; // 5 cols × 6 rows
const COLS = 5;
const TOTAL_PAGES = Math.ceil(NATIONAL_DEX_MAX / SLOTS_PER_PAGE); // 9

/** All species cache for searching */
const ALL_SPECIES = [];
for (let i = 1; i <= NATIONAL_DEX_MAX; i++) {
  ALL_SPECIES.push({ id: i, name: getNationalSpeciesName(i) });
}

/** @type {Map<number, string | null>} dexId → resolved portrait URL prefix */
const _prefixCache = new Map();

/**
 * Asynchronously resolves the portrait prefix for a dex id, caching the result.
 * @param {number} dexId
 * @returns {Promise<string | null>}
 */
async function resolvePrefix(dexId) {
  if (_prefixCache.has(dexId)) return _prefixCache.get(dexId) ?? null;
  const prefix = await probeSpriteCollabPortraitPrefix(dexId);
  _prefixCache.set(dexId, prefix ?? null);
  return prefix ?? null;
}

export class PokemonBoxModal {
  /**
   * @param {{
   *   onSelect: (dexId: number) => void | Promise<void>
   * }} opts
   */
  constructor(opts) {
    this._onSelect = opts.onSelect;
    this._currentPage = 0; // 0-indexed
    this._activeDexId = 1;
    this._isOpen = false;
    this._el = null;
    this._gridEl = null;
    this._pageLabel = null;
    this._dotsEl = null;
    this._prevBtn = null;
    this._nextBtn = null;
    this._searchInp = null;
    this._footer = null;
    this._searchQuery = '';
    /** @type {AbortController | null} */
    this._portraitAbort = null;
    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  // ------------------------------------------------------------------ Build DOM

  _build() {
    if (this._el) return;

    const el = document.createElement('div');
    el.className = 'pkmn-box-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Pokémon Box — choose a species');
    el.setAttribute('aria-hidden', 'true');

    el.innerHTML = `
      <div class="pkmn-box-modal__card">
        <header class="pkmn-box-modal__header">
          <div class="pkmn-box-modal__header-icon" aria-hidden="true"></div>
          <h2 class="pkmn-box-modal__title">Pokémon Box</h2>
          <div class="pkmn-box-modal__search-wrap">
            <span class="pkmn-box-modal__search-icon" aria-hidden="true">🔍</span>
            <input type="text" class="pkmn-box-modal__search" id="pkmn-box-search" placeholder="Search..." autocomplete="off" spellcheck="false" />
          </div>
          <span class="pkmn-box-modal__box-label" id="pkmn-box-page-label">Box 1 / ${TOTAL_PAGES}</span>
          <button type="button" class="pkmn-box-modal__close" id="pkmn-box-close" aria-label="Close Pokémon Box">×</button>
        </header>

        <div class="pkmn-box-modal__body">
          <div class="pkmn-box-modal__grid" id="pkmn-box-grid" role="list" aria-label="Pokémon species grid"></div>
        </div>

        <footer class="pkmn-box-modal__footer">
          <button type="button" class="pkmn-box-modal__page-btn" id="pkmn-box-prev" aria-label="Previous box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Prev
          </button>
          <div class="pkmn-box-modal__page-info">
            <span class="pkmn-box-modal__page-label" id="pkmn-box-page-footer-label">Box 1 / ${TOTAL_PAGES}</span>
            <div class="pkmn-box-modal__page-dots" id="pkmn-box-dots" role="tablist" aria-label="Page indicator"></div>
          </div>
          <button type="button" class="pkmn-box-modal__page-btn" id="pkmn-box-next" aria-label="Next box">
            Next
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </footer>
      </div>
    `;

    document.body.appendChild(el);
    this._el = el;
    this._gridEl = el.querySelector('#pkmn-box-grid');
    this._pageLabel = el.querySelector('#pkmn-box-page-label');
    this._footerLabel = el.querySelector('#pkmn-box-page-footer-label');
    this._dotsEl = el.querySelector('#pkmn-box-dots');
    this._prevBtn = el.querySelector('#pkmn-box-prev');
    this._nextBtn = el.querySelector('#pkmn-box-next');
    this._searchInp = el.querySelector('#pkmn-box-search');
    this._footer = el.querySelector('.pkmn-box-modal__footer');

    // Build page dots
    this._buildDots();

    // Events
    el.querySelector('#pkmn-box-close').addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => {
      // Close on backdrop click
      if (e.target === el) this.close();
    });
    this._prevBtn.addEventListener('click', () => this._goPage(this._currentPage - 1));
    this._nextBtn.addEventListener('click', () => this._goPage(this._currentPage + 1));
    this._searchInp.addEventListener('input', (e) => {
      this._searchQuery = e.target.value.trim().toLowerCase();
      this._render();
    });
  }

  _buildDots() {
    if (!this._dotsEl) return;
    this._dotsEl.innerHTML = '';
    for (let i = 0; i < TOTAL_PAGES; i++) {
      const dot = document.createElement('div');
      dot.className = 'pkmn-box-modal__page-dot';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Box ${i + 1}`);
      dot.setAttribute('aria-selected', i === this._currentPage ? 'true' : 'false');
      dot.dataset.page = String(i);
      dot.addEventListener('click', () => this._goPage(i));
      dot.style.cursor = 'pointer';
      this._dotsEl.appendChild(dot);
    }
  }

  // ------------------------------------------------------------------ Render

  _render() {
    if (this._searchQuery) {
      this._renderSearch();
    } else {
      this._renderPage();
    }
  }

  _renderPage() {
    if (!this._gridEl) return;

    const page = this._currentPage;
    const startDex = page * SLOTS_PER_PAGE + 1;
    const endDex = Math.min(startDex + SLOTS_PER_PAGE - 1, NATIONAL_DEX_MAX);

    // Cancel previous portrait loading batch
    if (this._portraitAbort) this._portraitAbort.abort();
    this._portraitAbort = new AbortController();
    const signal = this._portraitAbort.signal;

    // Build grid HTML (30 slots; last page may have empty ones)
    const slots = [];
    const buildSlotHtml = (dex, isReal) => {
      if (!isReal) {
        return `<div class="pkmn-box-slot pkmn-box-slot--empty" aria-hidden="true">
          <div class="pkmn-box-slot__portrait-wrap"></div>
          <span class="pkmn-box-slot__dex">&nbsp;</span>
          <span class="pkmn-box-slot__name">&nbsp;</span>
          <div class="pkmn-box-slot__types">&nbsp;</div>
        </div>`;
      }
      const name = getNationalSpeciesName(dex);
      const cfg = getPokemonConfig(dex);
      const typesHtml = cfg
        ? cfg.types
            .map(t => `<span class="pkmn-box-slot__type-badge type-${t}">${t.toUpperCase()}</span>`)
            .join('')
        : '';
      const selected = dex === this._activeDexId ? ' pkmn-box-slot--selected' : '';
      return `
        <div class="pkmn-box-slot${selected}" role="listitem" data-dex="${dex}" title="${name} #${padDex3(dex)}" tabindex="0" aria-label="${name}">
          <div class="pkmn-box-slot__portrait-wrap">
            <span class="pkmn-box-slot__no-portrait" aria-hidden="true">◉</span>
            <img
              class="pkmn-box-slot__portrait pkmn-box-slot__portrait--loading"
              alt="${name}"
              width="56"
              height="56"
              loading="lazy"
              decoding="async"
              data-dex="${dex}"
            />
          </div>
          <span class="pkmn-box-slot__dex">#${padDex3(dex)}</span>
          <span class="pkmn-box-slot__name">${name}</span>
          <div class="pkmn-box-slot__types">${typesHtml}</div>
        </div>
      `;
    };

    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const dex = startDex + i;
      slots.push(buildSlotHtml(dex, dex <= NATIONAL_DEX_MAX));
    }
    this._gridEl.innerHTML = slots.join('');
    this._footer.style.display = 'flex';
    this._pageLabel.style.visibility = 'visible';

    // Attach click + keyboard events
    for (const slotEl of this._gridEl.querySelectorAll('.pkmn-box-slot:not(.pkmn-box-slot--empty)')) {
      slotEl.addEventListener('click', () => {
        const dex = parseInt(slotEl.dataset.dex, 10);
        this._select(dex);
      });
      slotEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const dex = parseInt(slotEl.dataset.dex, 10);
          this._select(dex);
        }
      });
    }

    // Update pagination controls
    this._updatePaginationUI();

    // Load portraits lazily (fire-and-forget with abort)
    this._loadPortraitsForPage(signal);
  }

  _renderSearch() {
    if (!this._gridEl) return;
    const query = this._searchQuery;
    const results = ALL_SPECIES.filter(s => 
      s.name.toLowerCase().includes(query) || 
      String(s.id).includes(query) ||
      padDex3(s.id).includes(query)
    ).slice(0, 100); // Max 100 results for safety

    if (this._portraitAbort) this._portraitAbort.abort();
    this._portraitAbort = new AbortController();
    const signal = this._portraitAbort.signal;

    if (results.length === 0) {
      this._gridEl.innerHTML = `<div class="pkmn-box-modal__no-results">No results found for "${query}"</div>`;
      this._footer.style.display = 'none';
      this._pageLabel.style.visibility = 'hidden';
      return;
    }

    const buildSlotHtml = (dex) => {
      const name = getNationalSpeciesName(dex);
      const cfg = getPokemonConfig(dex);
      const typesHtml = cfg
        ? cfg.types
            .map(t => `<span class="pkmn-box-slot__type-badge type-${t}">${t.toUpperCase()}</span>`)
            .join('')
        : '';
      const selected = dex === this._activeDexId ? ' pkmn-box-slot--selected' : '';
      return `
        <div class="pkmn-box-slot${selected}" role="listitem" data-dex="${dex}" title="${name} #${padDex3(dex)}" tabindex="0" aria-label="${name}">
          <div class="pkmn-box-slot__portrait-wrap">
            <span class="pkmn-box-slot__no-portrait" aria-hidden="true">◉</span>
            <img
              class="pkmn-box-slot__portrait pkmn-box-slot__portrait--loading"
              alt="${name}"
              width="56"
              height="56"
              loading="lazy"
              decoding="async"
              data-dex="${dex}"
            />
          </div>
          <span class="pkmn-box-slot__dex">#${padDex3(dex)}</span>
          <span class="pkmn-box-slot__name">${name}</span>
          <div class="pkmn-box-slot__types">${typesHtml}</div>
        </div>
      `;
    };

    this._gridEl.innerHTML = results.map(r => buildSlotHtml(r.id)).join('');
    this._footer.style.display = 'none';
    this._pageLabel.style.visibility = 'hidden';

    // Attach events
    for (const slotEl of this._gridEl.querySelectorAll('.pkmn-box-slot')) {
      slotEl.addEventListener('click', () => {
        const dex = parseInt(slotEl.dataset.dex, 10);
        this._select(dex);
      });
    }

    this._loadPortraitsForPage(signal);
  }

  async _loadPortraitsForPage(signal) {
    const imgs = Array.from(
      this._gridEl?.querySelectorAll('img.pkmn-box-slot__portrait[data-dex]') ?? []
    );

    await Promise.all(
      imgs.map(async (img) => {
        if (signal.aborted) return;
        const dex = parseInt(img.dataset.dex, 10);
        try {
          const prefix = await resolvePrefix(dex);
          if (signal.aborted) return;
          const noPortrait = img.parentElement?.querySelector('.pkmn-box-slot__no-portrait');
          if (prefix) {
            img.onload = () => {
              img.classList.remove('pkmn-box-slot__portrait--loading');
              if (noPortrait) noPortrait.style.display = 'none';
            };
            img.onerror = () => {
              img.classList.remove('pkmn-box-slot__portrait--loading');
            };
            img.src = `${prefix}Normal.png`;
          } else {
            img.classList.remove('pkmn-box-slot__portrait--loading');
          }
        } catch (_) {
          // ignore
        }
      })
    );
  }

  _updatePaginationUI() {
    const label = `Box ${this._currentPage + 1} / ${TOTAL_PAGES}`;
    if (this._pageLabel) this._pageLabel.textContent = label;
    if (this._footerLabel) this._footerLabel.textContent = label;
    if (this._prevBtn) this._prevBtn.disabled = this._currentPage === 0;
    if (this._nextBtn) this._nextBtn.disabled = this._currentPage === TOTAL_PAGES - 1;

    // Update dots
    if (this._dotsEl) {
      for (const dot of this._dotsEl.querySelectorAll('.pkmn-box-modal__page-dot')) {
        const pg = parseInt(dot.dataset.page, 10);
        dot.classList.toggle('pkmn-box-modal__page-dot--active', pg === this._currentPage);
        dot.setAttribute('aria-selected', pg === this._currentPage ? 'true' : 'false');
      }
    }
  }

  // ------------------------------------------------------------------ Navigation

  _goPage(page) {
    const clamped = Math.max(0, Math.min(TOTAL_PAGES - 1, page));
    if (clamped === this._currentPage) return;
    this._currentPage = clamped;
    this._renderPage();
  }

  /** Jump to the page that contains the given dex id */
  _jumpToDexPage(dexId) {
    const page = Math.floor((dexId - 1) / SLOTS_PER_PAGE);
    this._currentPage = Math.max(0, Math.min(TOTAL_PAGES - 1, page));
  }

  // ------------------------------------------------------------------ Select

  _select(dexId) {
    this._activeDexId = dexId;
    this.close();
    void this._onSelect(dexId);
  }

  // ------------------------------------------------------------------ Open / Close

  /**
   * @param {number} currentDexId — currently selected species (to highlight + jump to page)
   */
  open(currentDexId = 1) {
    this._build();
    this._activeDexId = Math.max(1, Math.min(NATIONAL_DEX_MAX, currentDexId));
    this._searchQuery = '';
    if (this._searchInp) this._searchInp.value = '';
    this._jumpToDexPage(this._activeDexId);
    this._render();

    this._el.setAttribute('aria-hidden', 'false');
    // Force a layout flush so the transition plays
    void this._el.offsetWidth;
    this._el.classList.add('pkmn-box-modal--open');
    this._isOpen = true;

    document.addEventListener('keydown', this._onKeyDown);

    // Focus the close button for accessibility
    requestAnimationFrame(() => {
      this._el?.querySelector('#pkmn-box-close')?.focus();
    });
  }

  close() {
    if (!this._el || !this._isOpen) return;
    this._el.classList.remove('pkmn-box-modal--open');
    this._el.setAttribute('aria-hidden', 'true');
    this._isOpen = false;
    document.removeEventListener('keydown', this._onKeyDown);

    // Cancel portrait loading
    if (this._portraitAbort) {
      this._portraitAbort.abort();
      this._portraitAbort = null;
    }
  }

  _handleKeyDown(e) {
    if (!this._isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this._goPage(this._currentPage - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this._goPage(this._currentPage + 1);
    }
  }
}

/**
 * Factory — wires the modal to the CharacterSelector's portrait pill.
 * @param {import('./character-selector.js').CharacterSelector} charSelector
 * @returns {PokemonBoxModal}
 */
export function installPokemonBoxModal(charSelector) {
  const modal = new PokemonBoxModal({
    onSelect: async (dexId) => {
      await charSelector.selectSpecies(dexId);
    }
  });
  return modal;
}
