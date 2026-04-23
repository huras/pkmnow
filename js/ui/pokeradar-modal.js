import { NATIONAL_DEX_MAX, getNationalSpeciesName, padDex3 } from '../pokemon/national-dex-registry.js';
import { getCryIdentifiedDexIdsSnapshot } from '../wild-pokemon/cry-identification-progress.js';
import {
  FAR_CRY_IDENTIFICATION_CRIES_REQUIRED,
  getCryIdentificationHearCountsSnapshot
} from '../main/far-cry-identification-challenge.js';

const SORT_DEX_ASC = 'dex-asc';
const SORT_CRY_DESC = 'cries-desc';

export class PokeradarModal {
  /**
   * @param {{ onOpenChange?: (isOpen: boolean) => void }} [opts]
   */
  constructor(opts = {}) {
    this._onOpenChange = typeof opts.onOpenChange === 'function' ? opts.onOpenChange : null;
    this._isOpen = false;
    this._sortMode = SORT_DEX_ASC;
    this._showIdentified = true;
    this._showUnidentified = true;
    this._el = null;
    this._listEl = null;
    this._summaryEl = null;
    this._sortEl = null;
    this._showIdentifiedEl = null;
    this._showUnidentifiedEl = null;
    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  _build() {
    if (this._el) return;
    const root = document.createElement('div');
    root.className = 'pokeradar-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Pokeradar');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="pokeradar-modal__card">
        <header class="pokeradar-modal__header">
          <div class="pokeradar-modal__header-icon" aria-hidden="true">📡</div>
          <h2 class="pokeradar-modal__title">Pokeradar</h2>
          <button type="button" class="pokeradar-modal__close" id="pokeradar-close" aria-label="Close Pokeradar">×</button>
        </header>
        <div class="pokeradar-modal__controls">
          <label class="pokeradar-modal__control">
            <span>Sort</span>
            <select id="pokeradar-sort" class="pokeradar-modal__select">
              <option value="${SORT_DEX_ASC}">Dex Number</option>
              <option value="${SORT_CRY_DESC}">Cries Heard</option>
            </select>
          </label>
          <label class="pokeradar-modal__checkbox">
            <input type="checkbox" id="pokeradar-show-identified" checked />
            <span>Show identified</span>
          </label>
          <label class="pokeradar-modal__checkbox">
            <input type="checkbox" id="pokeradar-show-unidentified" checked />
            <span>Show not identified</span>
          </label>
          <span id="pokeradar-summary" class="pokeradar-modal__summary"></span>
        </div>
        <div class="pokeradar-modal__body">
          <div id="pokeradar-list" class="pokeradar-modal__list" role="list" aria-label="Pokeradar species list"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    this._el = root;
    this._listEl = root.querySelector('#pokeradar-list');
    this._summaryEl = root.querySelector('#pokeradar-summary');
    this._sortEl = /** @type {HTMLSelectElement | null} */ (root.querySelector('#pokeradar-sort'));
    this._showIdentifiedEl = /** @type {HTMLInputElement | null} */ (root.querySelector('#pokeradar-show-identified'));
    this._showUnidentifiedEl = /** @type {HTMLInputElement | null} */ (root.querySelector('#pokeradar-show-unidentified'));

    root.querySelector('#pokeradar-close')?.addEventListener('click', () => this.close());
    root.addEventListener('click', (ev) => {
      if (ev.target === root) this.close();
    });
    this._sortEl?.addEventListener('change', () => {
      this._sortMode = this._sortEl?.value === SORT_CRY_DESC ? SORT_CRY_DESC : SORT_DEX_ASC;
      this._render();
    });
    this._showIdentifiedEl?.addEventListener('change', () => {
      this._showIdentified = !!this._showIdentifiedEl?.checked;
      if (!this._showIdentified && !this._showUnidentified) {
        this._showUnidentified = true;
        if (this._showUnidentifiedEl) this._showUnidentifiedEl.checked = true;
      }
      this._render();
    });
    this._showUnidentifiedEl?.addEventListener('change', () => {
      this._showUnidentified = !!this._showUnidentifiedEl?.checked;
      if (!this._showIdentified && !this._showUnidentified) {
        this._showIdentified = true;
        if (this._showIdentifiedEl) this._showIdentifiedEl.checked = true;
      }
      this._render();
    });
  }

  _readRows() {
    const identified = new Set(getCryIdentifiedDexIdsSnapshot());
    const heardCounts = new Map();
    for (const row of getCryIdentificationHearCountsSnapshot()) {
      const d = Math.floor(Number(row?.dexId) || 0);
      const n = Math.max(0, Math.floor(Number(row?.criesHeard) || 0));
      if (d < 1 || n <= 0) continue;
      heardCounts.set(d, n);
    }
    const req = Math.max(1, Math.floor(Number(FAR_CRY_IDENTIFICATION_CRIES_REQUIRED) || 1));
    const out = [];
    for (let dexId = 1; dexId <= NATIONAL_DEX_MAX; dexId++) {
      const isIdentified = identified.has(dexId);
      const heard = heardCounts.get(dexId) || 0;
      out.push({
        dexId,
        name: getNationalSpeciesName(dexId),
        identified: isIdentified,
        criesHeard: isIdentified ? Math.max(req, heard) : Math.min(req, heard)
      });
    }
    return out;
  }

  _render() {
    if (!this._listEl) return;
    const req = Math.max(1, Math.floor(Number(FAR_CRY_IDENTIFICATION_CRIES_REQUIRED) || 1));
    let rows = this._readRows();

    rows = rows.filter((r) => (r.identified ? this._showIdentified : this._showUnidentified));
    if (this._sortMode === SORT_CRY_DESC) {
      rows.sort((a, b) => {
        if (b.criesHeard !== a.criesHeard) return b.criesHeard - a.criesHeard;
        return a.dexId - b.dexId;
      });
    } else {
      rows.sort((a, b) => a.dexId - b.dexId);
    }

    const identifiedVisible = rows.reduce((n, r) => n + (r.identified ? 1 : 0), 0);
    if (this._summaryEl) {
      this._summaryEl.textContent = `${rows.length} shown • ${identifiedVisible} identified`;
    }

    if (rows.length === 0) {
      this._listEl.innerHTML = '<div class="pokeradar-modal__empty">No Pokémon match the current filters.</div>';
      return;
    }

    this._listEl.innerHTML = rows
      .map((r) => {
        const status = r.identified ? 'Identified' : 'Unknown';
        const cls = r.identified ? 'pokeradar-row pokeradar-row--identified' : 'pokeradar-row pokeradar-row--unknown';
        return `
          <div class="${cls}" role="listitem">
            <div class="pokeradar-row__head">
              <span class="pokeradar-row__dex">#${padDex3(r.dexId)}</span>
              <span class="pokeradar-row__name">${r.name}</span>
            </div>
            <div class="pokeradar-row__meta">
              <span class="pokeradar-row__cries">${r.criesHeard}/${req} cries</span>
              <span class="pokeradar-row__status">${status}</span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  open() {
    this._build();
    if (!this._el) return;
    this._render();
    this._el.setAttribute('aria-hidden', 'false');
    void this._el.offsetWidth;
    this._el.classList.add('pokeradar-modal--open');
    this._isOpen = true;
    this._onOpenChange?.(true);
    document.addEventListener('keydown', this._onKeyDown);
    requestAnimationFrame(() => {
      this._sortEl?.focus();
    });
  }

  close() {
    if (!this._el || !this._isOpen) return;
    this._el.classList.remove('pokeradar-modal--open');
    this._el.setAttribute('aria-hidden', 'true');
    this._isOpen = false;
    this._onOpenChange?.(false);
    document.removeEventListener('keydown', this._onKeyDown);
  }

  isOpen() {
    return !!this._isOpen;
  }

  _handleKeyDown(ev) {
    if (!this._isOpen) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  }
}

/**
 * @param {{ onOpenChange?: (isOpen: boolean) => void }} [opts]
 */
export function installPokeradarModal(opts = {}) {
  return new PokeradarModal(opts);
}
