import { PLAYER_BINDABLE_MOVE_IDS, getInputSlotId, getPlayerInputBindings, slotIndexToUiHotkey } from '../main/player-input-slots.js';
import { getMoveLabel } from '../moves/pokemon-moveset-config.js';

/**
 * Maps Move IDs to Pokemon Types for categorization.
 * @param {string} moveId 
 */
function getMoveType(moveId) {
  switch (moveId) {
    case 'ember':
    case 'fireBlast':
    case 'fireSpin':
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
 * Attack Wheel UI Component
 * Handles rendering and interaction for the radial move selection menu.
 */
export class AttackWheel {
  constructor() {
    this.root = null;
    this.isOpen = false;
    this.slotIdx = -1;
    this.hoverIndex = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    
    // Grouped moves by type
    this.groups = this._groupMoves();
    this.flatMoves = this._flattenGroups(this.groups);
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

  _flattenGroups(groups) {
    const flat = [];
    // Define a fixed order for types to keep the wheel stable
    const typeOrder = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'psychic', 'poison', 'bug', 'flying', 'ghost', 'dragon'];
    for (const type of typeOrder) {
      if (groups[type]) {
        for (const moveId of groups[type]) {
          flat.push({ id: moveId, type });
        }
      }
    }
    // Add any types not in the order
    for (const type in groups) {
      if (!typeOrder.includes(type)) {
        for (const moveId of groups[type]) {
          flat.push({ id: moveId, type });
        }
      }
    }
    return flat;
  }

  ensureDom() {
    if (this.root) return this.root;

    const root = document.createElement('div');
    root.id = 'play-move-bind-wheel';
    root.className = 'play-field-skill-wheel hidden';
    
    const count = this.flatMoves.length;
    const ringRadius = 230;
    
    let buttonsHtml = '';
    let sectorsHtml = '';
    
    // Calculate sectors and dividers
    const totalSectors = Object.keys(this.groups).length;
    let angleCursor = -90; // Start from top
    
    const moveButtons = this.flatMoves.map((move, i) => {
      const angle = (i / count) * 360 - 90;
      const rad = angle * (Math.PI / 180);
      const left = 50 + Math.cos(rad) * 44; // Percentage
      const top = 50 + Math.sin(rad) * 44;
      
      return `<button type="button" 
                class="play-field-skill-wheel__item type-${move.type}" 
                data-move="${move.id}" 
                data-index="${i}"
                style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%">
                ${getMoveLabel(move.id)}
              </button>`;
    }).join('');

    root.innerHTML = `
      <div class="play-field-skill-wheel__ring">
        <div class="play-field-skill-wheel__slice" id="play-wheel-slice"></div>
        <div class="play-field-skill-wheel__center">
          <div class="play-field-skill-wheel__center-name" id="play-wheel-move-name">Pick Move</div>
          <div class="play-field-skill-wheel__center-type" id="play-wheel-move-type">---</div>
          <div class="play-field-skill-wheel__center-hint" id="play-wheel-hint">Hold 1-5</div>
        </div>
        ${moveButtons}
      </div>
    `;

    document.body.appendChild(root);
    this.root = root;
    return root;
  }

  open(slotIdx, playerDexId) {
    this.slotIdx = slotIdx;
    this.isOpen = true;
    this.ensureDom();
    this.root.classList.remove('hidden');
    
    const bindings = getPlayerInputBindings(playerDexId);
    const slotId = getInputSlotId(slotIdx);
    const currentMove = bindings[slotId];
    
    this.hoverIndex = this.flatMoves.findIndex(m => m.id === currentMove);
    if (this.hoverIndex === -1) this.hoverIndex = 0;
    
    this.sync(playerDexId);
  }

  close() {
    this.isOpen = false;
    if (this.root) this.root.classList.add('hidden');
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
    
    if (Math.hypot(dx, dy) < 20) return; // Deadzone
    
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = (angle + 360) % 360;
    
    // Convert angle to index
    // Index 0 is at -90deg (Top). We add a half-step offset (180 / count) 
    // so the button is in the middle of its selection sector.
    const count = this.flatMoves.length;
    let normalizedAngle = (angle + 90 + (180 / count)) % 360;
    const index = Math.floor((normalizedAngle / 360) * count);
    
    if (index !== this.hoverIndex) {
      this.hoverIndex = index;
      this.sync();
    }
  }

  sync(playerDexId) {
    if (!this.root) return;
    
    const move = this.flatMoves[this.hoverIndex];
    if (!move) return;

    // Update center
    const nameEl = this.root.querySelector('#play-wheel-move-name');
    const typeEl = this.root.querySelector('#play-wheel-move-type');
    const hintEl = this.root.querySelector('#play-wheel-hint');
    const sliceEl = this.root.querySelector('#play-wheel-slice');

    nameEl.textContent = getMoveLabel(move.id);
    typeEl.textContent = move.type;
    typeEl.className = `play-field-skill-wheel__center-type type-${move.type}`;
    hintEl.textContent = `Release for ${slotIndexToUiHotkey(this.slotIdx)}`;

    // Update slice orientation
    const angle = (this.hoverIndex / this.flatMoves.length) * 360;
    sliceEl.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

    // Update items
    const items = this.root.querySelectorAll('.play-field-skill-wheel__item');
    items.forEach((item, i) => {
      item.classList.toggle('is-hover', i === this.hoverIndex);
    });
  }

  getSelectedMove() {
    return this.flatMoves[this.hoverIndex]?.id || 'tackle';
  }
}

export const attackWheel = new AttackWheel();
