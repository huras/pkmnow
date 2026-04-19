import {
  PLAYER_BINDABLE_MOVE_IDS,
  getInputSlotId,
  getPlayerInputBindings,
  slotIndexToUiHotkey
} from '../main/player-input-slots.js';
import { getMoveLabel } from '../moves/pokemon-moveset-config.js';
import { playInputState } from '../main/play-input-state.js';
import { getMoveType, TYPE_ORDER, TYPE_LABELS } from './attack-wheel.js';

/** PS-style prompts for each binding slot (maps to LMB/RMB/MMB/wheel). */
const SLOT_GAMEPAD_LABEL = ['□', 'R2', 'L2', 'L1+□', 'L1+△'];

/**
 * @param {number} dx
 * @param {number} dy
 * @param {number} count
 */
function analogToRingIndex(dx, dy, count) {
  if (count < 1) return null;
  const m = Math.hypot(dx, dy);
  if (m < 0.12) return null;
  const nx = dx / m;
  const ny = dy / m;
  let angle = Math.atan2(ny, nx) * (180 / Math.PI);
  angle = (angle + 360) % 360;
  const normalizedAngle = (angle + 90 + 180 / count) % 360;
  return Math.floor((normalizedAngle / 360) * count);
}

export class DualBindWheel {
  constructor() {
    this.root = null;
    this.isOpen = false;
    /** @type {number} */
    this.slotIdx = -1;
    this.bindingsDexId = 1;
    /** @type {string[]} */
    this._typeList = [];
    /** @type {Record<string, string[]>} */
    this._groups = this._buildGroups();
    /** @type {string[]} */
    this._leftRingIds = [];
    /** @type {string[]} */
    this._rightRingIds = [];
    this._leftHover = 0;
    this._rightHover = 0;
    this._shellBound = false;
  }

  _buildGroups() {
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
      if (this._groups[t]?.length) out.push(t);
    }
    for (const t of Object.keys(this._groups)) {
      if (!TYPE_ORDER.includes(t) && this._groups[t]?.length) out.push(t);
    }
    return out;
  }

  _movesForType(typeId) {
    const list = this._groups[typeId];
    return list ? [...list] : [];
  }

  ensureDom() {
    if (this.root) return this.root;
    const root = document.createElement('div');
    root.id = 'play-dual-bind-wheel';
    root.className = 'play-dual-bind-wheel hidden';
    root.innerHTML = `
      <div class="play-dual-bind-wheel__backdrop" data-dual-wheel-dismiss="1"></div>
      <div class="play-dual-bind-wheel__layout">
        <div class="play-dual-bind-wheel__panel">
          <div class="play-dual-bind-wheel__title" id="dual-slot-title">Bind</div>
          <div class="play-dual-bind-wheel__subtitle" id="dual-slot-prompt"></div>
          <div class="play-dual-bind-wheel__ring" id="dual-left-ring">
            <div class="play-dual-bind-wheel__slice" id="dual-left-slice"></div>
            <div class="play-dual-bind-wheel__center">
              <div class="play-dual-bind-wheel__center-name" id="dual-left-name">—</div>
              <div class="play-dual-bind-wheel__center-type" id="dual-left-type"></div>
            </div>
          </div>
          <div class="play-dual-bind-wheel__hint">Analógico esquerdo · tipos</div>
        </div>
        <div class="play-dual-bind-wheel__panel">
          <div class="play-dual-bind-wheel__title">Golpe</div>
          <div class="play-dual-bind-wheel__subtitle" id="dual-right-sub">—</div>
          <div class="play-dual-bind-wheel__ring" id="dual-right-ring">
            <div class="play-dual-bind-wheel__slice" id="dual-right-slice"></div>
            <div class="play-dual-bind-wheel__center">
              <div class="play-dual-bind-wheel__center-name" id="dual-right-name">—</div>
              <div class="play-dual-bind-wheel__center-type" id="dual-right-type"></div>
            </div>
          </div>
          <div class="play-dual-bind-wheel__hint">Analógico direito · ○ confirma · △ ou ✕ cancela</div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this._bindShellOnce();
    return root;
  }

  _bindShellOnce() {
    if (this._shellBound || !this.root) return;
    this._shellBound = true;
    this.root.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.dataset?.dualWheelDismiss === '1') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('attack-wheel-dismiss'));
      }
    });
  }

  _clearRing(container) {
    if (!container) return;
    for (const el of container.querySelectorAll('.play-dual-bind-wheel__item')) {
      el.remove();
    }
  }

  /**
   * @param {'left'|'right'} side
   * @param {string[]} ids
   * @param {'type'|'move'} kind
   */
  _rebuildRing(side, ids, kind) {
    this.ensureDom();
    const ringId = side === 'left' ? 'dual-left-ring' : 'dual-right-ring';
    const ring = this.root.querySelector(`#${ringId}`);
    if (!ring) return;
    this._clearRing(ring);
    const count = Math.max(1, ids.length);
    const radiusPct = 40;
    for (let i = 0; i < count; i++) {
      const id = ids[i];
      const angle = (i / count) * 360 - 90;
      const rad = angle * (Math.PI / 180);
      const left = 50 + Math.cos(rad) * radiusPct;
      const top = 50 + Math.sin(rad) * radiusPct;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'play-dual-bind-wheel__item';
      btn.dataset.index = String(i);
      if (kind === 'type') {
        btn.dataset.typeId = id;
        btn.textContent = TYPE_LABELS[id] || id;
        btn.classList.add(`type-${id}`);
      } else {
        const t = getMoveType(id);
        btn.dataset.move = id;
        btn.textContent = getMoveLabel(id);
        btn.classList.add(`type-${t}`);
      }
      btn.style.left = `${left.toFixed(2)}%`;
      btn.style.top = `${top.toFixed(2)}%`;
      ring.appendChild(btn);
    }
  }

  _leftTypeId() {
    return this._leftRingIds[this._leftHover] || this._leftRingIds[0];
  }

  _syncLeft() {
    if (!this.root) return;
    const tid = this._leftTypeId();
    const nameEl = this.root.querySelector('#dual-left-name');
    const typeEl = this.root.querySelector('#dual-left-type');
    const slice = this.root.querySelector('#dual-left-slice');
    const count = Math.max(1, this._leftRingIds.length);
    if (nameEl) nameEl.textContent = TYPE_LABELS[tid] || tid;
    if (typeEl) {
      typeEl.textContent = `${this._groups[tid]?.length || 0} golpes`;
      typeEl.className = `play-dual-bind-wheel__center-type type-${tid}`;
    }
    if (slice) slice.style.transform = `translate(-50%, -50%) rotate(${(this._leftHover / count) * 360}deg)`;
    this.root.querySelectorAll('#dual-left-ring .play-dual-bind-wheel__item').forEach((el, i) => {
      el.classList.toggle('is-hover', i === this._leftHover);
    });
  }

  _syncRight() {
    if (!this.root) return;
    const moveId = this._rightRingIds[this._rightHover] || this._rightRingIds[0];
    const t = getMoveType(moveId);
    const tid = this._leftTypeId();
    const nameEl = this.root.querySelector('#dual-right-name');
    const typeEl = this.root.querySelector('#dual-right-type');
    const sub = this.root.querySelector('#dual-right-sub');
    const slice = this.root.querySelector('#dual-right-slice');
    const count = Math.max(1, this._rightRingIds.length);
    if (nameEl) nameEl.textContent = getMoveLabel(moveId);
    if (typeEl) {
      typeEl.textContent = TYPE_LABELS[tid] || tid;
      typeEl.className = `play-dual-bind-wheel__center-type type-${tid}`;
    }
    if (sub) sub.textContent = `Tipo: ${TYPE_LABELS[tid] || tid}`;
    if (slice) slice.style.transform = `translate(-50%, -50%) rotate(${(this._rightHover / count) * 360}deg)`;
    this.root.querySelectorAll('#dual-right-ring .play-dual-bind-wheel__item').forEach((el, i) => {
      el.classList.toggle('is-hover', i === this._rightHover);
    });
  }

  /**
   * Rebuilds the move ring for the active left type.
   * @param {{ snapRightToSlotBinding?: boolean }} [opts] If `snapRightToSlotBinding`, highlight the move
   *   currently bound to this slot (only used when the UI opens). Otherwise keep the player's last
   *   pick when the move still exists in the new list, else index 0 — avoids snapping back to the saved
   *   bind when the left stick drifts or the user releases the analog.
   */
  _rebuildRightFromLeftType(opts = {}) {
    const snapRightToSlotBinding = opts.snapRightToSlotBinding === true;
    const tid = this._leftTypeId();
    const prevMoveId =
      !snapRightToSlotBinding && this._rightRingIds.length
        ? this._rightRingIds[this._rightHover]
        : null;
    this._rightRingIds = this._movesForType(tid);
    this._rebuildRing('right', this._rightRingIds, 'move');
    let mi = 0;
    if (snapRightToSlotBinding) {
      const bindings = getPlayerInputBindings(this.bindingsDexId);
      const slotId = getInputSlotId(this.slotIdx);
      const cur = bindings[slotId];
      mi = this._rightRingIds.indexOf(cur);
      if (getMoveType(cur) !== tid || mi < 0) mi = 0;
    } else if (prevMoveId) {
      const ix = this._rightRingIds.indexOf(prevMoveId);
      mi = ix >= 0 ? ix : 0;
    }
    this._rightHover = mi;
    this._syncRight();
  }

  /**
   * @param {number} slotIdx 0..4
   * @param {number} playerDexId
   */
  open(slotIdx, playerDexId) {
    this.slotIdx = Math.max(0, Math.min(4, Math.floor(Number(slotIdx) || 0)));
    this.bindingsDexId = Math.max(1, Math.floor(Number(playerDexId) || 1));
    this.isOpen = true;
    playInputState.dualBindWheelSlowMo = true;
    this.ensureDom();
    this.root.classList.remove('hidden');

    const title = this.root.querySelector('#dual-slot-title');
    const prompt = this.root.querySelector('#dual-slot-prompt');
    if (title) title.textContent = `Atalho ${this.slotIdx + 1}`;
    if (prompt) {
      const g = SLOT_GAMEPAD_LABEL[this.slotIdx] || '—';
      const pc = slotIndexToUiHotkey(this.slotIdx);
      prompt.textContent = `${g} · ${pc}`;
    }

    this._typeList = this._buildTypeList();
    this._leftRingIds = [...this._typeList];
    const bindings = getPlayerInputBindings(this.bindingsDexId);
    const slotId = getInputSlotId(this.slotIdx);
    const currentMove = bindings[slotId];
    const curType = getMoveType(currentMove);
    let ti = this._leftRingIds.indexOf(curType);
    if (ti < 0) ti = 0;
    this._leftHover = ti;

    this._rebuildRing('left', this._leftRingIds, 'type');
    this._syncLeft();
    this._rebuildRightFromLeftType({ snapRightToSlotBinding: true });
  }

  dismissWithoutSaving() {
    this.isOpen = false;
    this.slotIdx = -1;
    this._leftRingIds = [];
    this._rightRingIds = [];
    playInputState.dualBindWheelSlowMo = false;
    if (this.root) this.root.classList.add('hidden');
  }

  getPendingSlotIdx() {
    return this.slotIdx;
  }

  getSelectedMoveId() {
    return this._rightRingIds[this._rightHover] || this._rightRingIds[0] || 'tackle';
  }

  /**
   * @param {number} dx
   * @param {number} dy
   */
  updateLeftAnalog(dx, dy) {
    if (!this.isOpen) return;
    const idx = analogToRingIndex(dx, dy, this._leftRingIds.length);
    if (idx == null || idx === this._leftHover) return;
    this._leftHover = idx;
    this._syncLeft();
    this._rebuildRightFromLeftType();
  }

  /**
   * @param {number} dx
   * @param {number} dy
   */
  updateRightAnalog(dx, dy) {
    if (!this.isOpen) return;
    const idx = analogToRingIndex(dx, dy, this._rightRingIds.length);
    if (idx == null || idx === this._rightHover) return;
    this._rightHover = idx;
    this._syncRight();
  }

  confirmFromGamepadCircle() {
    if (!this.isOpen) return;
    const moveId = this.getSelectedMoveId();
    window.dispatchEvent(
      new CustomEvent('attack-wheel-confirm-bind', {
        detail: { moveId, fromDualWheel: true, slotIdx: this.slotIdx }
      })
    );
  }
}

export const dualBindWheel = new DualBindWheel();
