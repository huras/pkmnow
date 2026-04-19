import { PLAYER_BINDABLE_MOVE_IDS, getInputSlotId, getPlayerInputBindings } from '../main/player-input-slots.js';
import { getMoveLabel } from '../moves/pokemon-moveset-config.js';

/** Stable order for type wedges on the wheel. */
export const TYPE_ORDER = /** @type {const string[]} */ ([
  'normal',
  'fire',
  'water',
  'grass',
  'electric',
  'ground',
  'ice',
  'steel',
  'psychic',
  'poison',
  'bug',
  'flying',
  'ghost',
  'dragon'
]);

export const TYPE_LABELS = /** @type {Record<string, string>} */ ({
  normal: 'Normal',
  fire: 'Fire',
  water: 'Water',
  grass: 'Grass',
  electric: 'Electric',
  ground: 'Ground',
  ice: 'Ice',
  steel: 'Steel',
  psychic: 'Psychic',
  poison: 'Poison',
  bug: 'Bug',
  flying: 'Flying',
  ghost: 'Ghost',
  dragon: 'Dragon'
});

/**
 * Maps Move IDs to Pokemon Types for categorization.
 * @param {string} moveId
 */
export function getMoveType(moveId) {
  switch (moveId) {
    case 'ember':
    case 'fireBlast':
    case 'fireSpin':
    case 'flameCharge':
    case 'flamethrower':
    case 'incinerate':
    case 'sunnyDay':
      return 'fire';
    case 'absorb':
    case 'megaDrain':
    case 'petalDance':
    case 'solarBeam':
      return 'grass';
    case 'bubble':
    case 'waterBurst':
    case 'waterGun':
    case 'bubbleBeam':
    case 'hydroPump':
    case 'waterCannon':
    case 'surf':
    case 'rainDance':
      return 'water';
    case 'acid':
    case 'sludge':
    case 'smog':
    case 'poisonSting':
    case 'poisonPowder':
      return 'poison';
    case 'auroraBeam':
    case 'blizzard':
    case 'iceBeam':
      return 'ice';
    case 'thunder':
    case 'thunderShock':
    case 'thunderbolt':
      return 'electric';
    case 'earthquake':
      return 'ground';
    case 'steelBeam':
      return 'steel';
    case 'confusion':
    case 'psychic':
    case 'psywave':
    case 'psybeam':
    case 'prismaticLaser':
    case 'dreamEater':
      return 'psychic';
    case 'dragonRage':
      return 'dragon';
    case 'nightShade':
      return 'ghost';
    case 'gust':
      return 'flying';
    case 'silkShoot':
      return 'bug';
    case 'razorWind':
    case 'sonicBoom':
    case 'swift':
    case 'hyperBeam':
    case 'triAttack':
    case 'ultimate':
    case 'tackle':
      return 'normal';
    case 'cut':
      return 'grass';
    default:
      return 'normal';
  }
}

/**
 * Attack wheel: tecla 1–5 abre; clique escolhe tipo → golpe; X / Cancelar / fora do painel fecham.
 */
export class AttackWheel {
  constructor() {
    this.root = null;
    this.isOpen = false;
    /** @type {'type'|'move'} */
    this.phase = 'type';
    this.slotIdx = -1;
    this.bindingsDexId = 1;
    this.hoverIndex = 0;
    /** @type {string | null} */
    this.selectedType = null;
    /** @type {string[]} */
    this.typeList = [];
    /** @type {Record<string, string[]>} */
    this.groups = this._groupMoves();
    /** @type {string[]} */
    this.ringIds = [];
    this._shellHandlersBound = false;
  }

  _groupMoves() {
    const groups = {};
    for (const moveId of PLAYER_BINDABLE_MOVE_IDS) {
      const type = getMoveType(moveId);
      if (!groups[type]) groups[type] = [];
      groups[type].push(moveId);
    }
    return groups;
  }

  _buildTypeList() {
    const out = [];
    for (const t of TYPE_ORDER) {
      if (this.groups[t]?.length) out.push(t);
    }
    for (const t of Object.keys(this.groups)) {
      if (!TYPE_ORDER.includes(t) && this.groups[t]?.length) out.push(t);
    }
    return out;
  }

  _ringCount() {
    return Math.max(1, this.ringIds.length);
  }

  _bindShellHandlersOnce() {
    if (this._shellHandlersBound || !this.root) return;
    this._shellHandlersBound = true;

    const dismiss = () => window.dispatchEvent(new CustomEvent('attack-wheel-dismiss'));

    this.root.addEventListener('pointerdown', (e) => {
      if (!this.isOpen) return;
      if (e.target === this.root) {
        e.preventDefault();
        dismiss();
      }
    });

    const closeX = this.root.querySelector('#play-wheel-close-x');
    if (closeX) {
      closeX.addEventListener('pointerdown', (e) => {
        if (!this.isOpen) return;
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      });
    }

    const cancelBtn = this.root.querySelector('#play-wheel-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('pointerdown', (e) => {
        if (!this.isOpen) return;
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      });
    }

    const backBtn = this.root.querySelector('#play-wheel-back');
    if (backBtn) {
      backBtn.addEventListener('pointerdown', (e) => {
        if (!this.isOpen || this.phase !== 'move') return;
        e.preventDefault();
        e.stopPropagation();
        this.backToTypePhase();
      });
    }
  }

  ensureDom() {
    if (this.root) return this.root;

    const root = document.createElement('div');
    root.id = 'play-move-bind-wheel';
    root.className = 'play-field-skill-wheel play-field-skill-wheel--modal hidden';

    root.innerHTML = `
      <div class="play-field-skill-wheel__frame">
        <button type="button" class="play-field-skill-wheel__close-x" id="play-wheel-close-x" aria-label="Fechar">×</button>
        <div class="play-field-skill-wheel__ring">
          <div class="play-field-skill-wheel__slice" id="play-wheel-slice"></div>
          <div class="play-field-skill-wheel__center" id="play-wheel-center" tabindex="-1">
            <div class="play-field-skill-wheel__center-name" id="play-wheel-move-name">Tipo</div>
            <div class="play-field-skill-wheel__center-type" id="play-wheel-move-type"></div>
            <div class="play-field-skill-wheel__center-hint" id="play-wheel-hint"></div>
            <button type="button" class="play-field-skill-wheel__cancel" id="play-wheel-cancel">Cancelar</button>
            <button type="button" class="play-field-skill-wheel__back hidden" id="play-wheel-back" aria-label="Voltar aos tipos">← Tipos</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    this.root = root;
    this._bindShellHandlersOnce();
    return root;
  }

  /** @param {string} typeId */
  _movesForType(typeId) {
    const list = this.groups[typeId];
    return list ? [...list] : [];
  }

  _wireRingItemClick(btn) {
    btn.addEventListener('click', (e) => {
      if (!this.isOpen) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.phase === 'type') {
        const typeId = btn.dataset.typeId;
        if (typeId) this.enterMovePhaseForType(typeId);
      } else {
        const moveId = btn.dataset.move;
        if (moveId) {
          window.dispatchEvent(new CustomEvent('attack-wheel-confirm-bind', { detail: { moveId } }));
        }
      }
    });
  }

  rebuildRingItems() {
    this.ensureDom();
    const ring = this.root.querySelector('.play-field-skill-wheel__ring');
    if (!ring) return;

    for (const el of ring.querySelectorAll('.play-field-skill-wheel__item')) {
      el.remove();
    }

    const count = this._ringCount();
    const radiusPct = this.phase === 'type' ? 40 : 44;

    for (let i = 0; i < count; i++) {
      const id = this.ringIds[i];
      const angle = (i / count) * 360 - 90;
      const rad = angle * (Math.PI / 180);
      const left = 50 + Math.cos(rad) * radiusPct;
      const top = 50 + Math.sin(rad) * radiusPct;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'play-field-skill-wheel__item';
      btn.dataset.index = String(i);

      if (this.phase === 'type') {
        btn.classList.add(`type-${id}`);
        btn.dataset.wheelKind = 'type';
        btn.dataset.typeId = id;
        btn.textContent = TYPE_LABELS[id] || id;
      } else {
        const t = getMoveType(id);
        btn.classList.add(`type-${t}`);
        btn.dataset.wheelKind = 'move';
        btn.dataset.move = id;
        btn.textContent = getMoveLabel(id);
      }

      btn.style.left = `${left.toFixed(2)}%`;
      btn.style.top = `${top.toFixed(2)}%`;
      this._wireRingItemClick(btn);
      ring.appendChild(btn);
    }
  }

  getPhase() {
    return this.phase;
  }

  getPendingSlotIdx() {
    return this.slotIdx;
  }

  _slotDigitChar() {
    const n = Math.floor(Number(this.slotIdx) || 0) + 1;
    return String(Math.min(5, Math.max(1, n)));
  }

  open(slotIdx, playerDexId) {
    this.slotIdx = slotIdx;
    this.bindingsDexId = Math.max(1, Math.floor(Number(playerDexId) || 1));
    this.isOpen = true;
    this.phase = 'type';
    this.selectedType = null;
    this.ensureDom();
    this.root.classList.remove('hidden');

    this.typeList = this._buildTypeList();
    this.ringIds = [...this.typeList];

    const bindings = getPlayerInputBindings(this.bindingsDexId);
    const slotId = getInputSlotId(slotIdx);
    const currentMove = bindings[slotId];
    const curType = getMoveType(currentMove);
    let ti = this.typeList.indexOf(curType);
    if (ti < 0) ti = 0;
    this.hoverIndex = ti;

    this.rebuildRingItems();
    this.sync();
  }

  close() {
    this.isOpen = false;
    this.phase = 'type';
    this.selectedType = null;
    this.ringIds = [];
    if (this.root) this.root.classList.add('hidden');
  }

  dismissWithoutSaving() {
    this.close();
  }

  backToTypePhase() {
    if (!this.isOpen) return;
    this.phase = 'type';
    this.selectedType = null;
    this.typeList = this._buildTypeList();
    this.ringIds = [...this.typeList];
    this.rebuildRingItems();
    this.sync();
  }

  /**
   * @param {string} typeId
   */
  enterMovePhaseForType(typeId) {
    if (!this.isOpen || this.phase !== 'type') return;
    if (!this.groups[typeId]?.length) return;
    this.selectedType = typeId;
    this.phase = 'move';
    this.ringIds = this._movesForType(typeId);

    const bindings = getPlayerInputBindings(this.bindingsDexId);
    const slotId = getInputSlotId(this.slotIdx);
    const currentMove = bindings[slotId];
    let mi = this.ringIds.indexOf(currentMove);
    if (getMoveType(currentMove) !== typeId || mi < 0) mi = 0;
    this.hoverIndex = mi;

    this.rebuildRingItems();
    this.sync();
  }

  /**
   * Aim the wheel slice from a normalized vector (e.g. right analog).
   * Uses the same wedge math as {@link updateMouse} without DOM coordinates.
   * @param {number} dx
   * @param {number} dy
   */
  updateAnalogAim(dx, dy) {
    if (!this.isOpen) return;
    const m = Math.hypot(dx, dy);
    if (m < 0.12) return;
    const nx = dx / m;
    const ny = dy / m;
    let angle = Math.atan2(ny, nx) * (180 / Math.PI);
    angle = (angle + 360) % 360;
    const count = this._ringCount();
    let normalizedAngle = (angle + 90 + 180 / count) % 360;
    const index = Math.floor((normalizedAngle / 360) * count);
    if (index !== this.hoverIndex) {
      this.hoverIndex = index;
      this.sync();
    }
  }

  updateMouse(x, y) {
    if (!this.isOpen || !this.root) return;
    this.mouseX = x;
    this.mouseY = y;

    const ring = this.root.querySelector('.play-field-skill-wheel__ring');
    const rect = ring.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = x - cx;
    const dy = y - cy;

    if (Math.hypot(dx, dy) < 20) return;

    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = (angle + 360) % 360;

    const count = this._ringCount();
    let normalizedAngle = (angle + 90 + 180 / count) % 360;
    const index = Math.floor((normalizedAngle / 360) * count);

    if (index !== this.hoverIndex) {
      this.hoverIndex = index;
      this.sync();
    }
  }

  /**
   * PlayStation-style Circle (standard button 1): confirm type or bind move.
   */
  confirmFromGamepadCircle() {
    if (!this.isOpen) return;
    if (this.phase === 'type') {
      const tid = this.ringIds[this.hoverIndex];
      if (tid) this.enterMovePhaseForType(tid);
    } else {
      const moveId = this.getSelectedMove();
      if (moveId) {
        window.dispatchEvent(new CustomEvent('attack-wheel-confirm-bind', { detail: { moveId } }));
      }
    }
  }

  sync() {
    if (!this.root) return;

    const nameEl = this.root.querySelector('#play-wheel-move-name');
    const typeEl = this.root.querySelector('#play-wheel-move-type');
    const hintEl = this.root.querySelector('#play-wheel-hint');
    const sliceEl = this.root.querySelector('#play-wheel-slice');
    const backBtn = this.root.querySelector('#play-wheel-back');

    const count = this._ringCount();
    const d = this._slotDigitChar();

    if (this.phase === 'type') {
      const tid = this.ringIds[this.hoverIndex] || this.typeList[0];
      nameEl.textContent = TYPE_LABELS[tid] || tid;
      typeEl.textContent = `${this.groups[tid]?.length || 0} golpes`;
      typeEl.className = `play-field-skill-wheel__center-type type-${tid}`;
      hintEl.textContent = `Clique num tipo · tecla ${d} fecha o menu`;
      if (backBtn) backBtn.classList.add('hidden');
    } else {
      const moveId = this.ringIds[this.hoverIndex] || this.ringIds[0];
      const t = getMoveType(moveId);
      nameEl.textContent = getMoveLabel(moveId);
      typeEl.textContent = TYPE_LABELS[this.selectedType || t] || this.selectedType || t;
      typeEl.className = `play-field-skill-wheel__center-type type-${this.selectedType || t}`;
      hintEl.textContent = `Clique num golpe · tecla ${d} fecha`;
      if (backBtn) backBtn.classList.remove('hidden');
    }

    const angle = (this.hoverIndex / count) * 360;
    sliceEl.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

    const items = this.root.querySelectorAll('.play-field-skill-wheel__item');
    items.forEach((item, i) => {
      item.classList.toggle('is-hover', i === this.hoverIndex);
    });
  }

  /**
   * @returns {string | null}
   */
  getSelectedMove() {
    if (this.phase !== 'move') return null;
    return this.ringIds[this.hoverIndex] || this.ringIds[0] || 'tackle';
  }
}

export const attackWheel = new AttackWheel();
