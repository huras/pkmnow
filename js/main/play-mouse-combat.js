import { playInputState } from './play-input-state.js';
import { setPlayerFacingFromWorldAimDelta, triggerPlayerLmbAttack } from '../player.js';
import {
  castMoveById,
  castMoveChargedById,
  castUltimate,
  spawnFieldSlashArcFx,
  tryCastPlayerFlamethrowerStreamPuff,
  tryCastPlayerPrismaticStreamPuff,
  tryReleasePlayerPsybeam
} from '../moves/moves-manager.js';
import { getPokemonMoveset } from '../moves/pokemon-moveset-config.js';
import { tryBreakCrystalOnPlayerTackle, tryBreakDetailsAlongSegment } from './play-crystal-tackle.js';
import { tryPlayerCutHitWildCircle, tryPlayerTackleHitWild } from '../wild-pokemon/wild-pokemon-manager.js';
import { cutGrassInCircle } from '../play-grass-cut.js';
import { speciesHasType } from '../pokemon/pokemon-type-helpers.js';
import { worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import { imageCache } from '../image-cache.js';

const TAP_MS = 220;
const CHARGE_MAX_SEC = 1.12;
const FIELD_SKILL_WHEEL_HOLD_MS = 170;
const FIELD_SKILL_CUT_RADIUS = 1.5;
const FIELD_SKILL_CUT_CENTER_OFFSET = 1.1;
const FIELD_SKILL_STRENGTH_RADIUS = 1.9;
const PLAYER_PHYSICS_COLLIDER_RADIUS_TILES = 0.32;
const FIELD_SKILLS = ['tackle', 'cut', 'strength'];

function applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty) {
  setPlayerFacingFromWorldAimDelta(player, tx - sx, ty - sy);
}

let leftHeld = false;
let rightHeld = false;
let rightDownAt = 0;
/** Left Ctrl held when primary/secondary button went down (locks “no charge build” for that press). */
let leftShiftAtDown = false;
let rightShiftAtDown = false;
/** True after at least one flamethrower puff this RMB press (hold-stream). */
let rightFlameStreamedThisPress = false;
/** True after at least one prismatic laser stream puff this RMB press. */
let rightPrismaticStreamedThisPress = false;
let selectedFieldSkillId = 'tackle';
let fieldSkillWheelHoldStartMs = 0;
let fieldSkillWheelArmed = false;
let fieldSkillWheelOpen = false;
let fieldSkillWheelHoverIndex = 0;
/** @type {HTMLDivElement | null} */
let fieldSkillWheelRoot = null;

function fieldSkillLabelById(skillId) {
  if (skillId === 'cut') return 'Cut';
  if (skillId === 'strength') return 'Strength';
  return 'Tackle';
}

function ensureFieldSkillWheelDom() {
  if (fieldSkillWheelRoot) return fieldSkillWheelRoot;
  const root = document.createElement('div');
  root.id = 'play-field-skill-wheel';
  root.className = 'play-field-skill-wheel hidden';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="play-field-skill-wheel__ring">
      <div class="play-field-skill-wheel__hint">Hold 1 · release to cast</div>
      <button type="button" class="play-field-skill-wheel__item" data-skill="tackle">Tackle</button>
      <button type="button" class="play-field-skill-wheel__item" data-skill="cut">Cut</button>
      <button type="button" class="play-field-skill-wheel__item" data-skill="strength">Strength</button>
    </div>
  `;
  document.body.appendChild(root);
  fieldSkillWheelRoot = root;
  syncFieldSkillWheelDom();
  return root;
}

function syncFieldSkillWheelDom() {
  if (!fieldSkillWheelRoot) return;
  fieldSkillWheelRoot.classList.toggle('hidden', !fieldSkillWheelOpen);
  fieldSkillWheelRoot.setAttribute('aria-hidden', fieldSkillWheelOpen ? 'false' : 'true');
  const hoverSkill = FIELD_SKILLS[fieldSkillWheelHoverIndex] || selectedFieldSkillId;
  for (const el of fieldSkillWheelRoot.querySelectorAll('.play-field-skill-wheel__item')) {
    const skillId = String(el.getAttribute('data-skill') || '');
    el.classList.toggle('is-hover', fieldSkillWheelOpen && skillId === hoverSkill);
    el.classList.toggle('is-selected', skillId === selectedFieldSkillId);
  }
}

function openFieldSkillWheel() {
  fieldSkillWheelOpen = true;
  ensureFieldSkillWheelDom();
  syncFieldSkillWheelDom();
}

function closeFieldSkillWheel() {
  fieldSkillWheelOpen = false;
  syncFieldSkillWheelDom();
}

function resolveCutStyleForDex(dexId) {
  if (speciesHasType(dexId, 'grass')) return 'vine';
  if (speciesHasType(dexId, 'psychic')) return 'psychic';
  return 'slash';
}

function resolveCutProfile(styleId) {
  if (styleId === 'vine') {
    return { radius: FIELD_SKILL_CUT_RADIUS + 0.24, damage: 8, knockback: 2.9 };
  }
  if (styleId === 'psychic') {
    return { radius: FIELD_SKILL_CUT_RADIUS + 0.35, damage: 10, knockback: 3.4 };
  }
  return { radius: FIELD_SKILL_CUT_RADIUS, damage: 9, knockback: 3.1 };
}

function castPlayerCut(player, data) {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const styleId = resolveCutStyleForDex(player.dexId ?? 1);
  const profile = resolveCutProfile(styleId);
  const centerX = (player.x ?? sx) + nx * FIELD_SKILL_CUT_CENTER_OFFSET;
  const centerY = (player.y ?? sy) + ny * FIELD_SKILL_CUT_CENTER_OFFSET;
  const feet = worldFeetFromPivotCell(
    Number(player.x ?? sx - 0.5),
    Number(player.y ?? sy - 0.5),
    imageCache,
    player.dexId ?? 1,
    Math.hypot(player?.inputX || 0, player?.inputY || 0) > 1e-4
  );
  // Anchor slash arc to the bottom of the physics collider (feet line + collider radius).
  const arcOriginX = feet.x + nx * FIELD_SKILL_CUT_CENTER_OFFSET;
  const arcOriginY = feet.y + PLAYER_PHYSICS_COLLIDER_RADIUS_TILES + ny * FIELD_SKILL_CUT_CENTER_OFFSET;
  spawnFieldSlashArcFx(arcOriginX, arcOriginY, nx, ny, {
    variant: styleId,
    radius: profile.radius * 0.86,
    spanRad: styleId === 'psychic' ? Math.PI * 1.08 : Math.PI * 0.9,
    z: Number(player.z) || 0
  });
  tryPlayerCutHitWildCircle(player, data, centerX, centerY, profile.radius, {
    damage: profile.damage,
    knockback: profile.knockback
  });
  const worldHitOnceSet = new Set();
  const spawnedHitOnceSet = new Set();
  const rays = styleId === 'psychic' ? 12 : 9;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const ex = centerX + Math.cos(ang) * profile.radius;
    const ey = centerY + Math.sin(ang) * profile.radius;
    tryBreakDetailsAlongSegment(centerX, centerY, ex, ey, data, { worldHitOnceSet, spawnedHitOnceSet });
  }
  cutGrassInCircle(centerX, centerY, profile.radius, data);
}

function castPlayerStrengthPlaceholder(player, data) {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const centerX = (player.x ?? sx) + nx * 1.25;
  const centerY = (player.y ?? sy) + ny * 1.25;
  // Placeholder until dedicated Strength move exists.
  tryPlayerCutHitWildCircle(player, data, centerX, centerY, FIELD_SKILL_STRENGTH_RADIUS, {
    damage: 14,
    knockback: 4.9
  });
  const worldHitOnceSet = new Set();
  const spawnedHitOnceSet = new Set();
  const rays = 14;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const ex = centerX + Math.cos(ang) * FIELD_SKILL_STRENGTH_RADIUS;
    const ey = centerY + Math.sin(ang) * FIELD_SKILL_STRENGTH_RADIUS;
    tryBreakDetailsAlongSegment(centerX, centerY, ex, ey, data, { worldHitOnceSet, spawnedHitOnceSet });
  }
}

function castSelectedFieldSkill(player, data) {
  if (!player) return;
  if (selectedFieldSkillId === 'cut') {
    castPlayerCut(player, data);
    return;
  }
  if (selectedFieldSkillId === 'strength') {
    castPlayerStrengthPlaceholder(player, data);
    return;
  }
  const { sx, sy, tx, ty } = aimAtCursor(player);
  const hasMoveInput = Math.hypot(player?.inputX || 0, player?.inputY || 0) > 1e-4;
  if (hasMoveInput) {
    triggerPlayerLmbAttack(player);
  } else {
    triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  }
  tryPlayerTackleHitWild(player, data);
  tryBreakCrystalOnPlayerTackle(player, data);
}

function updateFieldSkillWheelHover(player) {
  if (!fieldSkillWheelOpen || !player || !playInputState.mouseValid) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.hypot(dx, dy) < 0.08) return;
  const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
  const sectorSize = (Math.PI * 2) / FIELD_SKILLS.length;
  const idx = Math.floor((angle + sectorSize * 0.5) / sectorSize) % FIELD_SKILLS.length;
  if (idx !== fieldSkillWheelHoverIndex) {
    fieldSkillWheelHoverIndex = idx;
    syncFieldSkillWheelDom();
  }
}

export function handleFieldSkillHotkeyDown(code) {
  if (code !== 'Digit1') return false;
  if (!fieldSkillWheelArmed) {
    fieldSkillWheelArmed = true;
    fieldSkillWheelOpen = false;
    fieldSkillWheelHoldStartMs = performance.now();
    fieldSkillWheelHoverIndex = Math.max(0, FIELD_SKILLS.indexOf(selectedFieldSkillId));
    syncFieldSkillWheelDom();
  }
  return true;
}

export function handleFieldSkillHotkeyUp(code, player, data) {
  if (code !== 'Digit1') return false;
  if (!fieldSkillWheelArmed && !fieldSkillWheelOpen) return false;
  if (fieldSkillWheelOpen) {
    selectedFieldSkillId = FIELD_SKILLS[fieldSkillWheelHoverIndex] || selectedFieldSkillId;
  }
  castSelectedFieldSkill(player, data ?? null);
  fieldSkillWheelArmed = false;
  closeFieldSkillWheel();
  return true;
}

export function getSelectedFieldSkillId() {
  return selectedFieldSkillId;
}

export function getSelectedFieldSkillLabel() {
  return fieldSkillLabelById(selectedFieldSkillId);
}

function isHoldStreamMoveId(moveId) {
  return moveId === 'flamethrower' || moveId === 'prismaticLaser';
}

function combatModifierHeld() {
  return !!playInputState.ctrlLeftHeld;
}

/** World aim for LMB/RMB / hotkeys / debug — continuous sub-tile coords (matches screen→world). */
export function aimAtCursor(player) {
  const px = player.visualX ?? player.x;
  const py = player.visualY ?? player.y;
  /** Same horizontal/vertical anchor as the play sprite (`vx+0.5`, `vy+0.5` in `render.js`). */
  const sx = px + 0.5;
  const sy = py + 0.5;
  if (!playInputState.mouseValid) {
    return { tx: sx + 1, ty: sy, sx, sy };
  }
  const wx = playInputState.mouseX;
  const wy = playInputState.mouseY;
  return { tx: wx, ty: wy, sx, sy };
}

/** @type {Record<string, string>} */
const HOTKEY_TO_MOVE_ID = {
  Digit2: 'flamethrower',
  Digit3: 'confusion',
  Digit4: 'bubble',
  Digit5: 'waterGun',
  Digit6: 'psybeam',
  Digit7: 'prismaticLaser',
  Digit8: 'poisonSting',
  Digit9: 'poisonPowder',
  Digit0: 'incinerate',
  Minus: 'silkShoot'
};

/**
 * Keyboard quick-cast for all Zelda-ported moves.
 * Digit 1 is reserved for field-skill wheel (Tackle/Cut/Strength).
 * 2 Flamethrower, 3 Confusion, 4 Bubble, 5 Water Gun,
 * 6 Psybeam, 7 Prismatic Laser, 8 Poison Sting, 9 Poison Powder,
 * 0 Incinerate, - Silk Shoot.
 * @returns {boolean} true when a hotkey was consumed.
 */
export function castMappedMoveByHotkey(code, player) {
  const moveId = HOTKEY_TO_MOVE_ID[code];
  if (!moveId || !player) return false;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  if (moveId === 'flamethrower' || moveId === 'prismaticLaser' || moveId === 'psybeam') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
  }
  castMoveById(moveId, sx, sy, tx, ty, player);
  return true;
}

function resolveSlots(player) {
  const moves = getPokemonMoveset(player?.dexId || 1);
  return {
    leftTap: moves[0],
    rightTap: moves[1],
    leftShift: moves[2],
    rightShift: moves[3]
  };
}

/**
 * @param {number} dt
 * @param {import('../player.js').player} player
 * @param {object | null | undefined} data
 */
export function updatePlayPointerCombat(dt, player, data) {
  if (!player) return;
  void data;
  if (fieldSkillWheelArmed && !fieldSkillWheelOpen) {
    if (performance.now() - fieldSkillWheelHoldStartMs >= FIELD_SKILL_WHEEL_HOLD_MS) {
      openFieldSkillWheel();
    }
  }
  updateFieldSkillWheelHover(player);
  const slots = resolveSlots(player);
  const mod = combatModifierHeld();
  if (rightHeld && !mod && !isHoldStreamMoveId(slots.rightTap) && slots.rightTap !== 'psybeam') {
    playInputState.chargeRight01 = Math.min(1, (playInputState.chargeRight01 || 0) + dt / CHARGE_MAX_SEC);
  }
  if (rightHeld && !mod && slots.rightTap === 'psybeam') {
    if (!playInputState.psybeamRightHold) playInputState.psybeamRightHold = { pulse: 0 };
    playInputState.psybeamRightHold.pulse += dt * 7.2;
  } else {
    playInputState.psybeamRightHold = null;
  }
  const { sx, sy, tx, ty } = aimAtCursor(player);
  if (rightHeld && !mod && slots.rightTap === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) rightFlameStreamedThisPress = true;
  }
  if (rightHeld && !mod && slots.rightTap === 'prismaticLaser') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) rightPrismaticStreamedThisPress = true;
  }
}

/**
 * @param {{ canvas: HTMLCanvasElement, getAppMode: () => string, getPlayer: () => import('../player.js').player, getCurrentData?: () => object | null }} deps
 */
export function installPlayPointerCombat(deps) {
  const { canvas, getAppMode, getPlayer, getCurrentData } = deps;

  canvas.addEventListener('contextmenu', (e) => {
    if (getAppMode() === 'play' && !e.ctrlKey) e.preventDefault();
  });

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (getAppMode() !== 'play') return;
      if (e.target !== canvas) return;
      const player = getPlayer();
      const sh = combatModifierHeld();

      if (e.button === 0) {
        e.preventDefault();
        leftHeld = true;
        leftShiftAtDown = sh;
        playInputState.chargeLeft01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 2) {
        e.preventDefault();
        rightHeld = true;
        rightDownAt = performance.now();
        rightShiftAtDown = sh;
        rightFlameStreamedThisPress = false;
        rightPrismaticStreamedThisPress = false;
        playInputState.chargeRight01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 1) {
        e.preventDefault();
        const { sx, sy, tx, ty } = aimAtCursor(player);
        castUltimate(sx, sy, tx, ty, player);
      }
    },
    { passive: false }
  );

  const onPointerUp = (e) => {
    if (getAppMode() !== 'play') return;
    const player = getPlayer();
    const now = performance.now();
    const shUp = combatModifierHeld();

    if (e.button === 0 && leftHeld) {
      leftHeld = false;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      const slots = resolveSlots(player);
      if (leftShiftAtDown || shUp) {
        castMoveById(slots.leftShift, sx, sy, tx, ty, player);
      } else {
        const hasMoveInput = Math.hypot(player?.inputX || 0, player?.inputY || 0) > 1e-4;
        if (hasMoveInput) {
          // Movement input: keep tackle aligned with current facing.
          triggerPlayerLmbAttack(player);
        } else {
          // Idle: mouse-guided tackle, free vector (not 8-way quantized).
          triggerPlayerLmbAttack(player, tx - sx, ty - sy);
        }
        tryPlayerTackleHitWild(player, getCurrentData?.() ?? null);
        tryBreakCrystalOnPlayerTackle(player, getCurrentData?.() ?? null);
      }
      playInputState.chargeLeft01 = 0;
    }
    if (e.button === 2 && rightHeld) {
      rightHeld = false;
      const heldMs = now - rightDownAt;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      const slots = resolveSlots(player);
      if (rightShiftAtDown || shUp) {
        castMoveById(slots.rightShift, sx, sy, tx, ty, player);
      } else if (slots.rightTap === 'flamethrower') {
        if (!rightFlameStreamedThisPress) {
          applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
          tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player);
        }
      } else if (slots.rightTap === 'prismaticLaser') {
        if (!rightPrismaticStreamedThisPress) {
          applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
          tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player);
        }
      } else if (slots.rightTap === 'psybeam') {
        applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
        tryReleasePlayerPsybeam(sx, sy, tx, ty, player);
      } else if (heldMs < TAP_MS) {
        castMoveById(slots.rightTap, sx, sy, tx, ty, player);
      } else {
        castMoveChargedById(slots.rightTap, sx, sy, tx, ty, player, playInputState.chargeRight01 || 0);
      }
      playInputState.chargeRight01 = 0;
    }
  };

  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  canvas.addEventListener('pointerleave', () => {
    if (getAppMode() !== 'play') return;
    leftHeld = false;
    rightHeld = false;
    fieldSkillWheelArmed = false;
    closeFieldSkillWheel();
    playInputState.chargeLeft01 = 0;
    playInputState.chargeRight01 = 0;
    playInputState.psybeamLeftHold = null;
    playInputState.psybeamRightHold = null;
    playInputState.mouseValid = false;
  });
}
