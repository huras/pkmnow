import { playInputState } from './play-input-state.js';
import { setPlayerFacingFromWorldAimDelta, triggerPlayerLmbAttack } from '../player.js';
import {
  castMoveById,
  castMoveChargedById,
  castUltimate,
  spawnFieldCutPsychicSlashFx,
  spawnFieldCutSlashFx,
  spawnFieldSpinAttackFx,
  spawnFieldCutVineSlashFx,
  tryCastPlayerFlamethrowerStreamPuff,
  tryCastPlayerPrismaticStreamPuff,
  tryReleasePlayerPsybeam
} from '../moves/moves-manager.js';
import { getPokemonMoveset, getMoveLabel } from '../moves/pokemon-moveset-config.js';
import { tryBreakCrystalOnPlayerTackle, tryBreakDetailsAlongSegment } from './play-crystal-tackle.js';
import { tryStrengthFieldSkillPress } from './play-strength-carry.js';
import { tryPlayerCutHitWildCircle, tryPlayerTackleHitWild } from '../wild-pokemon/wild-pokemon-manager.js';
import { cutGrassInCircle } from '../play-grass-cut.js';
import { speciesHasType } from '../pokemon/pokemon-type-helpers.js';

const TAP_MS = 220;
const CHARGE_MAX_SEC = 1.12;
const FIELD_LMB_CHARGE_MAX_SEC_DEFAULT = 1.05;
const FIELD_LMB_CHARGE_MIN_HOLD_MS = 180;
const FIELD_CUT_COMBO_RESET_SEC = 1.15;
const FIELD_TACKLE_CHARGE_MAX_SEC = 2.0;
const FIELD_TACKLE_CHARGE_MAX_REACH_TILES = 8.0;
const FIELD_SKILL_WHEEL_HOLD_MS = 170;
const FIELD_SKILL_CUT_RADIUS = 1.5;
const FIELD_SKILL_CUT_CENTER_OFFSET = 1.1;
const FIELD_SKILL_CUT_ADVANCE_TILES = 0.5;
const FIELD_SKILLS = ['tackle', 'cut', 'strength'];
const FIELD_SKILL_STORAGE_KEY = 'pkmn_field_skill_by_dex';
const FIELD_SKILL_LABEL = {
  tackle: 'Tackle',
  cut: 'Cut',
  strength: 'Strength'
};

/** Hold `2` (Digit2) to pick which move RMB executes (special attack wheel). */
const SPECIAL_ATTACK_WHEEL_HOLD_MS = 170;
const SPECIAL_ATTACK_STORAGE_KEY = 'pkmn_special_attack_by_dex';
/** @typedef {import('../moves/pokemon-moveset-config.js').MoveId} MoveId */
const SPECIAL_ATTACK_MOVE_IDS = /** @type {const} */ ([
  'ember',
  'flamethrower',
  'confusion',
  'bubble',
  'waterBurst',
  'waterGun',
  'psybeam',
  'prismaticLaser',
  'poisonSting',
  'poisonPowder',
  'incinerate',
  'silkShoot'
]);

function applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty) {
  setPlayerFacingFromWorldAimDelta(player, tx - sx, ty - sy);
}

let leftHeld = false;
let leftDownAt = 0;
let rightHeld = false;
let rightDownAt = 0;
/** Left Ctrl held when primary button went down (locks “no charge build” for that press). */
let leftShiftAtDown = false;
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
/** @type {Record<string, 'tackle' | 'cut' | 'strength'>} */
let fieldSkillByDex = loadStoredFieldSkillByDex();
let fieldCutComboStep = 0;
let fieldCutComboTimerSec = 0;
let lastComboDexId = 0;
let fieldWheelMouseClientX = 0;
let fieldWheelMouseClientY = 0;

let selectedSpecialMoveId = /** @type {MoveId} */ ('ember');
let specialAttackWheelHoldStartMs = 0;
let specialAttackWheelArmed = false;
let specialAttackWheelOpen = false;
let specialAttackWheelHoverIndex = 0;
/** @type {HTMLDivElement | null} */
let specialAttackWheelRoot = null;
/** @type {Record<string, MoveId>} */
let specialAttackByDex = loadStoredSpecialAttackByDex();

function normalizeFieldSkillId(skillId) {
  return FIELD_SKILLS.includes(String(skillId)) ? String(skillId) : 'tackle';
}

function loadStoredFieldSkillByDex() {
  try {
    const raw = localStorage.getItem(FIELD_SKILL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    /** @type {Record<string, 'tackle' | 'cut' | 'strength'>} */
    const out = {};
    for (const [dexKey, skillId] of Object.entries(parsed)) {
      const dex = Math.floor(Number(dexKey) || 0);
      if (dex < 1 || dex > 151) continue;
      const norm = normalizeFieldSkillId(skillId);
      out[String(dex)] = /** @type {'tackle' | 'cut' | 'strength'} */ (norm);
    }
    return out;
  } catch {
    return {};
  }
}

function saveStoredFieldSkillByDex() {
  try {
    localStorage.setItem(FIELD_SKILL_STORAGE_KEY, JSON.stringify(fieldSkillByDex));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function dispatchFieldSkillChange(dexId, skillId) {
  window.dispatchEvent(
    new CustomEvent('play-field-skill-change', {
      detail: {
        dexId: Math.floor(Number(dexId) || 0),
        skillId: normalizeFieldSkillId(skillId)
      }
    })
  );
}

function persistSelectedFieldSkillForDex(dexId) {
  const dex = Math.floor(Number(dexId) || 0);
  if (dex < 1 || dex > 151) return;
  fieldSkillByDex[String(dex)] = /** @type {'tackle' | 'cut' | 'strength'} */ (normalizeFieldSkillId(selectedFieldSkillId));
  saveStoredFieldSkillByDex();
}

function setSelectedFieldSkill(skillId, dexId, persist = false) {
  selectedFieldSkillId = normalizeFieldSkillId(skillId);
  fieldSkillWheelHoverIndex = Math.max(0, FIELD_SKILLS.indexOf(selectedFieldSkillId));
  if (persist) persistSelectedFieldSkillForDex(dexId);
  syncFieldSkillWheelDom();
  if (Number.isFinite(Number(dexId))) {
    dispatchFieldSkillChange(dexId, selectedFieldSkillId);
  }
}

export function getFieldSkillLabel(skillId) {
  const norm = normalizeFieldSkillId(skillId);
  return FIELD_SKILL_LABEL[norm] || 'Tackle';
}

export function getSelectedFieldSkillForDex(dexId) {
  const dex = Math.floor(Number(dexId) || 0);
  if (dex < 1 || dex > 151) return 'tackle';
  return normalizeFieldSkillId(fieldSkillByDex[String(dex)] || 'tackle');
}

export function syncSelectedFieldSkillForDex(dexId) {
  const dex = Math.floor(Number(dexId) || 0);
  setSelectedFieldSkill(getSelectedFieldSkillForDex(dex), dex, false);
  return selectedFieldSkillId;
}

function normalizeSpecialMoveId(moveId) {
  const m = String(moveId || '');
  return SPECIAL_ATTACK_MOVE_IDS.includes(/** @type {any} */ (m)) ? /** @type {MoveId} */ (m) : 'ember';
}

function loadStoredSpecialAttackByDex() {
  try {
    const raw = localStorage.getItem(SPECIAL_ATTACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    /** @type {Record<string, MoveId>} */
    const out = {};
    for (const [dexKey, moveId] of Object.entries(parsed)) {
      const dex = Math.floor(Number(dexKey) || 0);
      if (dex < 1 || dex > 151) continue;
      out[String(dex)] = normalizeSpecialMoveId(moveId);
    }
    return out;
  } catch {
    return {};
  }
}

function saveStoredSpecialAttackByDex() {
  try {
    localStorage.setItem(SPECIAL_ATTACK_STORAGE_KEY, JSON.stringify(specialAttackByDex));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function dispatchSpecialAttackChange(dexId, moveId) {
  window.dispatchEvent(
    new CustomEvent('play-special-attack-change', {
      detail: {
        dexId: Math.floor(Number(dexId) || 0),
        moveId: normalizeSpecialMoveId(moveId)
      }
    })
  );
}

function persistSelectedSpecialAttackForDex(dexId) {
  const dex = Math.floor(Number(dexId) || 0);
  if (dex < 1 || dex > 151) return;
  specialAttackByDex[String(dex)] = normalizeSpecialMoveId(selectedSpecialMoveId);
  saveStoredSpecialAttackByDex();
}

function setSelectedSpecialMove(moveId, dexId, persist = false) {
  selectedSpecialMoveId = normalizeSpecialMoveId(moveId);
  specialAttackWheelHoverIndex = Math.max(0, SPECIAL_ATTACK_MOVE_IDS.indexOf(selectedSpecialMoveId));
  if (persist) persistSelectedSpecialAttackForDex(dexId);
  syncSpecialAttackWheelDom();
  if (Number.isFinite(Number(dexId))) {
    dispatchSpecialAttackChange(dexId, selectedSpecialMoveId);
  }
}

export function getSelectedSpecialAttackMoveForDex(dexId) {
  const dex = Math.floor(Number(dexId) || 0);
  if (dex < 1 || dex > 151) return /** @type {MoveId} */ ('ember');
  return normalizeSpecialMoveId(specialAttackByDex[String(dex)] || 'ember');
}

export function syncSelectedSpecialAttackForDex(dexId) {
  const dex = Math.floor(Number(dexId) || 0);
  setSelectedSpecialMove(getSelectedSpecialAttackMoveForDex(dex), dex, false);
  return selectedSpecialMoveId;
}

function ensureFieldSkillWheelDom() {
  if (fieldSkillWheelRoot) return fieldSkillWheelRoot;
  const root = document.createElement('div');
  root.id = 'play-field-skill-wheel';
  root.className = 'play-field-skill-wheel hidden';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="play-field-skill-wheel__ring">
      <div class="play-field-skill-wheel__hint">Hold 1 · release to select</div>
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

function normalizeAngleSigned(rad) {
  let a = Number(rad) || 0;
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function resolveFieldWheelHoverFromScreenAngle() {
  if (!fieldSkillWheelRoot) return fieldSkillWheelHoverIndex;
  const ring = fieldSkillWheelRoot.querySelector('.play-field-skill-wheel__ring');
  if (!(ring instanceof HTMLElement)) return fieldSkillWheelHoverIndex;
  const ringRect = ring.getBoundingClientRect();
  const cx = ringRect.left + ringRect.width * 0.5;
  const cy = ringRect.top + ringRect.height * 0.5;
  const dx = fieldWheelMouseClientX - cx;
  const dy = fieldWheelMouseClientY - cy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 14) {
    return fieldSkillWheelHoverIndex;
  }
  const mouseAngle = Math.atan2(dy, dx);
  let bestIdx = fieldSkillWheelHoverIndex;
  let bestDelta = Infinity;
  for (let i = 0; i < FIELD_SKILLS.length; i++) {
    const skillId = FIELD_SKILLS[i];
    const item = fieldSkillWheelRoot.querySelector(`.play-field-skill-wheel__item[data-skill="${skillId}"]`);
    if (!(item instanceof HTMLElement)) continue;
    const ir = item.getBoundingClientRect();
    const ix = ir.left + ir.width * 0.5;
    const iy = ir.top + ir.height * 0.5;
    const itemAngle = Math.atan2(iy - cy, ix - cx);
    const d = Math.abs(normalizeAngleSigned(mouseAngle - itemAngle));
    if (d < bestDelta) {
      bestDelta = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function ensureSpecialAttackWheelDom() {
  if (specialAttackWheelRoot) return specialAttackWheelRoot;
  const root = document.createElement('div');
  root.id = 'play-special-attack-wheel';
  root.className = 'play-field-skill-wheel hidden';
  root.setAttribute('aria-hidden', 'true');
  const buttons = SPECIAL_ATTACK_MOVE_IDS.map(
    (id) =>
      `<button type="button" class="play-field-skill-wheel__item" data-move="${id}">${getMoveLabel(id)}</button>`
  ).join('');
  root.innerHTML = `
    <div class="play-field-skill-wheel__ring">
      <div class="play-field-skill-wheel__hint">Hold 2 · release to select (RMB)</div>
      ${buttons}
    </div>
  `;
  document.body.appendChild(root);
  specialAttackWheelRoot = root;
  syncSpecialAttackWheelDom();
  return root;
}

function syncSpecialAttackWheelDom() {
  if (!specialAttackWheelRoot) return;
  specialAttackWheelRoot.classList.toggle('hidden', !specialAttackWheelOpen);
  specialAttackWheelRoot.setAttribute('aria-hidden', specialAttackWheelOpen ? 'false' : 'true');
  const hoverMove = SPECIAL_ATTACK_MOVE_IDS[specialAttackWheelHoverIndex] || selectedSpecialMoveId;
  for (const el of specialAttackWheelRoot.querySelectorAll('.play-field-skill-wheel__item')) {
    const moveId = String(el.getAttribute('data-move') || '');
    el.classList.toggle('is-hover', specialAttackWheelOpen && moveId === hoverMove);
    el.classList.toggle('is-selected', moveId === selectedSpecialMoveId);
  }
}

function openSpecialAttackWheel() {
  specialAttackWheelOpen = true;
  ensureSpecialAttackWheelDom();
  syncSpecialAttackWheelDom();
}

function closeSpecialAttackWheel() {
  specialAttackWheelOpen = false;
  syncSpecialAttackWheelDom();
}

function resolveSpecialAttackWheelHoverFromScreenAngle() {
  if (!specialAttackWheelRoot) return specialAttackWheelHoverIndex;
  const ring = specialAttackWheelRoot.querySelector('.play-field-skill-wheel__ring');
  if (!(ring instanceof HTMLElement)) return specialAttackWheelHoverIndex;
  const ringRect = ring.getBoundingClientRect();
  const cx = ringRect.left + ringRect.width * 0.5;
  const cy = ringRect.top + ringRect.height * 0.5;
  const dx = fieldWheelMouseClientX - cx;
  const dy = fieldWheelMouseClientY - cy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 14) {
    return specialAttackWheelHoverIndex;
  }
  const mouseAngle = Math.atan2(dy, dx);
  let bestIdx = specialAttackWheelHoverIndex;
  let bestDelta = Infinity;
  for (let i = 0; i < SPECIAL_ATTACK_MOVE_IDS.length; i++) {
    const moveId = SPECIAL_ATTACK_MOVE_IDS[i];
    const item = specialAttackWheelRoot.querySelector(`.play-field-skill-wheel__item[data-move="${moveId}"]`);
    if (!(item instanceof HTMLElement)) continue;
    const ir = item.getBoundingClientRect();
    const ix = ir.left + ir.width * 0.5;
    const iy = ir.top + ir.height * 0.5;
    const itemAngle = Math.atan2(iy - cy, ix - cx);
    const d = Math.abs(normalizeAngleSigned(mouseAngle - itemAngle));
    if (d < bestDelta) {
      bestDelta = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function updateSpecialAttackWheelHover(player) {
  void player;
  if (!specialAttackWheelOpen) return;
  const idx = resolveSpecialAttackWheelHoverFromScreenAngle();
  if (idx !== specialAttackWheelHoverIndex) {
    specialAttackWheelHoverIndex = idx;
    syncSpecialAttackWheelDom();
  }
}

export function handleSpecialAttackHotkeyDown(code) {
  if (code !== 'Digit2') return false;
  fieldSkillWheelArmed = false;
  closeFieldSkillWheel();
  if (!specialAttackWheelArmed) {
    specialAttackWheelArmed = true;
    specialAttackWheelOpen = false;
    specialAttackWheelHoldStartMs = performance.now();
    specialAttackWheelHoverIndex = Math.max(0, SPECIAL_ATTACK_MOVE_IDS.indexOf(selectedSpecialMoveId));
    syncSpecialAttackWheelDom();
  }
  return true;
}

export function handleSpecialAttackHotkeyUp(code, player) {
  if (code !== 'Digit2') return false;
  if (!specialAttackWheelArmed && !specialAttackWheelOpen) return false;
  fieldSkillWheelArmed = false;
  closeFieldSkillWheel();
  const dex = Math.floor(Number(player?.dexId) || 0);
  if (specialAttackWheelOpen) {
    setSelectedSpecialMove(SPECIAL_ATTACK_MOVE_IDS[specialAttackWheelHoverIndex] || selectedSpecialMoveId, dex, true);
  } else if (dex >= 1) {
    setSelectedSpecialMove(selectedSpecialMoveId, dex, true);
  }
  specialAttackWheelArmed = false;
  closeSpecialAttackWheel();
  return true;
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

function resolveFieldLmbChargeMaxSec() {
  if (selectedFieldSkillId === 'tackle') return FIELD_TACKLE_CHARGE_MAX_SEC;
  return FIELD_LMB_CHARGE_MAX_SEC_DEFAULT;
}

function resolveCutComboVariant(styleId, comboStep, charged) {
  if (charged) {
    if (styleId === 'vine') {
      return {
        radiusMul: 1.36,
        damageAdd: 6,
        knockbackAdd: 1.5,
        headingOffsetDeg: 0,
        centerOffsetMul: 1.22,
        arcDeg: 136,
        lifeSec: 0.46
      };
    }
    if (styleId === 'psychic') {
      return {
        radiusMul: 1.42,
        damageAdd: 7,
        knockbackAdd: 1.7,
        headingOffsetDeg: 0,
        centerOffsetMul: 1.26,
        arcDeg: 142,
        lifeSec: 0.45
      };
    }
    return {
      radiusMul: 1.34,
      damageAdd: 6,
      knockbackAdd: 1.45,
      headingOffsetDeg: 0,
      centerOffsetMul: 1.2,
      arcDeg: 132,
      lifeSec: 0.42
    };
  }
  if (comboStep === 1) {
    return {
      radiusMul: 0.95,
      damageAdd: 0,
      knockbackAdd: 0,
      headingOffsetDeg: 0,
      centerOffsetMul: 1.0,
      arcDeg: 106,
      lifeSec: 0.28
    };
  }
  if (comboStep === 2) {
    return {
      radiusMul: 1.05,
      damageAdd: 2,
      knockbackAdd: 0.2,
      headingOffsetDeg: 28,
      centerOffsetMul: 0.96,
      arcDeg: 116,
      lifeSec: 0.32
    };
  }
  return {
    radiusMul: 1.18,
    damageAdd: 3,
    knockbackAdd: 0.4,
    headingOffsetDeg: -24,
    centerOffsetMul: 1.08,
    arcDeg: 126,
    lifeSec: 0.36
  };
}

function resolveCutComboStep(player, charged) {
  const dex = Math.floor(Number(player?.dexId) || 0);
  if (dex !== lastComboDexId) {
    fieldCutComboStep = 0;
    fieldCutComboTimerSec = 0;
    lastComboDexId = dex;
  }
  if (charged) {
    fieldCutComboStep = 0;
    fieldCutComboTimerSec = 0;
    return 3;
  }
  if (fieldCutComboTimerSec <= 0) fieldCutComboStep = 0;
  fieldCutComboStep = (fieldCutComboStep % 3) + 1;
  fieldCutComboTimerSec = FIELD_CUT_COMBO_RESET_SEC;
  return fieldCutComboStep;
}

function castPlayerCut(player, data, charged = false) {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  player._tackleReachTiles = FIELD_SKILL_CUT_ADVANCE_TILES;
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const styleId = resolveCutStyleForDex(player.dexId ?? 1);
  const profile = resolveCutProfile(styleId);
  const comboStep = resolveCutComboStep(player, charged);
  const variant = resolveCutComboVariant(styleId, comboStep, charged);
  const baseHeadingRad = Math.atan2(ny, nx || 1e-6);
  const headingRad = baseHeadingRad + ((variant.headingOffsetDeg || 0) * Math.PI) / 180;
  const useRadius = profile.radius * Math.max(0.4, variant.radiusMul || 1);
  const useDamage = profile.damage + Math.max(0, variant.damageAdd || 0);
  const useKnockback = profile.knockback + Math.max(0, variant.knockbackAdd || 0);
  const centerOffset = FIELD_SKILL_CUT_CENTER_OFFSET * Math.max(0.35, variant.centerOffsetMul || 1);
  const centerX = (player.x ?? sx) + Math.cos(headingRad) * centerOffset;
  const centerY = (player.y ?? sy) + Math.sin(headingRad) * centerOffset;
  if (styleId === 'vine') {
    spawnFieldCutVineSlashFx(centerX, centerY, headingRad, {
      radiusTiles: useRadius,
      arcDeg: variant.arcDeg,
      lifeSec: variant.lifeSec
    });
  } else if (styleId === 'psychic') {
    spawnFieldCutPsychicSlashFx(centerX, centerY, headingRad, {
      radiusTiles: useRadius,
      arcDeg: variant.arcDeg,
      lifeSec: variant.lifeSec
    });
  } else {
    spawnFieldCutSlashFx(centerX, centerY, headingRad, {
      radiusTiles: useRadius,
      arcDeg: variant.arcDeg,
      lifeSec: variant.lifeSec
    });
  }
  tryPlayerCutHitWildCircle(player, data, centerX, centerY, useRadius, {
    damage: useDamage,
    knockback: useKnockback
  });
  const worldHitOnceSet = new Set();
  const spawnedHitOnceSet = new Set();
  const rays = charged ? (styleId === 'psychic' ? 16 : 14) : styleId === 'psychic' ? 12 : 9;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const ex = centerX + Math.cos(ang) * useRadius;
    const ey = centerY + Math.sin(ang) * useRadius;
    tryBreakDetailsAlongSegment(centerX, centerY, ex, ey, data, {
      worldHitOnceSet,
      spawnedHitOnceSet,
      hitSource: 'cut'
    });
  }
  cutGrassInCircle(centerX, centerY, useRadius, data);
}

function castPlayerStrengthPlaceholder(player, data, charged = false) {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  tryStrengthFieldSkillPress(player, data, charged);
}

function castChargedFieldSpinAttack(player, data) {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  player._tackleReachTiles = FIELD_SKILL_CUT_ADVANCE_TILES;
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const headingRad = Math.atan2(ny, nx || 1e-6);
  const centerX = Number(player.x ?? sx);
  const centerY = Number(player.y ?? sy);
  let radius = 2.05;
  let damage = 16;
  let knockback = 5;
  let styleId = 'slash';
  if (selectedFieldSkillId === 'cut') {
    const cutStyle = resolveCutStyleForDex(player.dexId ?? 1);
    const profile = resolveCutProfile(cutStyle);
    styleId = cutStyle;
    radius = Math.max(2.1, profile.radius * 1.52);
    damage = profile.damage + 8;
    knockback = profile.knockback + 1.8;
    fieldCutComboStep = 0;
    fieldCutComboTimerSec = 0;
  } else if (selectedFieldSkillId === 'strength') {
    styleId = 'strength';
    radius = 2.45;
    damage = 22;
    knockback = 6.4;
  }
  spawnFieldSpinAttackFx(centerX, centerY, headingRad, {
    radiusTiles: radius,
    styleId,
    lifeSec: 0.44
  });
  tryPlayerCutHitWildCircle(player, data, centerX, centerY, radius, { damage, knockback });
  const worldHitOnceSet = new Set();
  const spawnedHitOnceSet = new Set();
  const rays = 24;
  const spinHitSource = selectedFieldSkillId === 'cut' ? 'cut' : 'tackle';
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const ex = centerX + Math.cos(ang) * radius;
    const ey = centerY + Math.sin(ang) * radius;
    tryBreakDetailsAlongSegment(centerX, centerY, ex, ey, data, {
      worldHitOnceSet,
      spawnedHitOnceSet,
      hitSource: spinHitSource
    });
  }
  if (selectedFieldSkillId === 'cut') {
    cutGrassInCircle(centerX, centerY, radius, data);
  }
}

function castSelectedFieldSkill(player, data, charged = false, charge01 = 0) {
  if (!player) return;
  if (charged && selectedFieldSkillId === 'cut') {
    castChargedFieldSpinAttack(player, data);
    return;
  }
  if (selectedFieldSkillId === 'cut') {
    castPlayerCut(player, data, false);
    return;
  }
  if (selectedFieldSkillId === 'strength') {
    castPlayerStrengthPlaceholder(player, data, charged);
    return;
  }
  fieldCutComboStep = 0;
  fieldCutComboTimerSec = 0;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  const hasMoveInput = Math.hypot(player?.inputX || 0, player?.inputY || 0) > 1e-4;
  if (hasMoveInput) {
    triggerPlayerLmbAttack(player);
  } else {
    triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  }
  if (selectedFieldSkillId === 'tackle') {
    const u = Math.max(0, Math.min(1, Number(charge01) || 0));
    const chargedReach = 2 + (FIELD_TACKLE_CHARGE_MAX_REACH_TILES - 2) * u;
    player._tackleReachTiles = Math.max(2, chargedReach);
  }
  tryPlayerTackleHitWild(player, data);
  tryBreakCrystalOnPlayerTackle(player, data);
}

function updateFieldSkillWheelHover(player) {
  void player;
  if (!fieldSkillWheelOpen) return;
  const idx = resolveFieldWheelHoverFromScreenAngle();
  if (idx !== fieldSkillWheelHoverIndex) {
    fieldSkillWheelHoverIndex = idx;
    syncFieldSkillWheelDom();
  }
}

export function handleFieldSkillHotkeyDown(code) {
  if (code !== 'Digit1') return false;
  specialAttackWheelArmed = false;
  closeSpecialAttackWheel();
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
  void data;
  if (code !== 'Digit1') return false;
  if (!fieldSkillWheelArmed && !fieldSkillWheelOpen) return false;
  specialAttackWheelArmed = false;
  closeSpecialAttackWheel();
  const dex = Math.floor(Number(player?.dexId) || 0);
  if (fieldSkillWheelOpen) {
    setSelectedFieldSkill(FIELD_SKILLS[fieldSkillWheelHoverIndex] || selectedFieldSkillId, dex, true);
  } else if (dex >= 1) {
    setSelectedFieldSkill(selectedFieldSkillId, dex, true);
  }
  fieldSkillWheelArmed = false;
  closeFieldSkillWheel();
  return true;
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

/**
 * Legacy digit hotkeys were removed: play combat is now 3-slot (LMB field skill, RMB special via wheel on `2`, MMB ultimate).
 * @returns {boolean}
 */
export function castMappedMoveByHotkey(_code, _player) {
  return false;
}

function resolveSlots(player) {
  const dex = Math.floor(Number(player?.dexId) || 0);
  const moves = getPokemonMoveset(player?.dexId || 1);
  const rightTap = dex >= 1 ? getSelectedSpecialAttackMoveForDex(dex) : /** @type {MoveId} */ ('ember');
  return {
    leftTap: moves[0],
    rightTap
  };
}

/**
 * @param {number} dt
 * @param {import('../player.js').player} player
 * @param {object | null | undefined} data
 */
export function updatePlayPointerCombat(dt, player, data) {
  if (!player) return;
  const dex = Math.floor(Number(player?.dexId) || 0);
  if (dex !== lastComboDexId) {
    fieldCutComboStep = 0;
    fieldCutComboTimerSec = 0;
    lastComboDexId = dex;
    syncSelectedSpecialAttackForDex(dex);
  }
  if (fieldCutComboTimerSec > 0) {
    fieldCutComboTimerSec = Math.max(0, fieldCutComboTimerSec - dt);
    if (fieldCutComboTimerSec <= 0) fieldCutComboStep = 0;
  }
  if (fieldSkillWheelArmed && !fieldSkillWheelOpen) {
    if (performance.now() - fieldSkillWheelHoldStartMs >= FIELD_SKILL_WHEEL_HOLD_MS) {
      openFieldSkillWheel();
    }
  }
  if (specialAttackWheelArmed && !specialAttackWheelOpen) {
    if (performance.now() - specialAttackWheelHoldStartMs >= SPECIAL_ATTACK_WHEEL_HOLD_MS) {
      openSpecialAttackWheel();
    }
  }
  updateFieldSkillWheelHover(player);
  updateSpecialAttackWheelHover(player);
  if (leftHeld && !combatModifierHeld()) {
    const maxSec = Math.max(0.2, resolveFieldLmbChargeMaxSec());
    playInputState.chargeLeft01 = Math.min(1, (playInputState.chargeLeft01 || 0) + dt / maxSec);
  } else {
    playInputState.chargeLeft01 = 0;
  }
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
  fieldWheelMouseClientX = window.innerWidth * 0.5;
  fieldWheelMouseClientY = window.innerHeight * 0.5;
  syncSelectedSpecialAttackForDex(Math.floor(Number(getPlayer()?.dexId) || 0));

  window.addEventListener(
    'pointermove',
    (e) => {
      fieldWheelMouseClientX = Number(e.clientX) || 0;
      fieldWheelMouseClientY = Number(e.clientY) || 0;
      const p = getPlayer();
      if (fieldSkillWheelOpen) updateFieldSkillWheelHover(p);
      if (specialAttackWheelOpen) updateSpecialAttackWheelHover(p);
    },
    true
  );

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
        fieldWheelMouseClientX = Number(e.clientX) || fieldWheelMouseClientX;
        fieldWheelMouseClientY = Number(e.clientY) || fieldWheelMouseClientY;
        leftHeld = true;
        leftDownAt = performance.now();
        leftShiftAtDown = sh;
        playInputState.chargeLeft01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 2) {
        e.preventDefault();
        rightHeld = true;
        rightDownAt = performance.now();
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
      if (!(leftShiftAtDown || shUp)) {
        const { sx, sy, tx, ty } = aimAtCursor(player);
        const heldMs = now - leftDownAt;
        const charge01 = Math.max(0, Math.min(1, Number(playInputState.chargeLeft01) || 0));
        const charged = heldMs >= FIELD_LMB_CHARGE_MIN_HOLD_MS && charge01 >= 0.16;
        castSelectedFieldSkill(player, getCurrentData?.() ?? null, charged, charge01);
      }
      playInputState.chargeLeft01 = 0;
    }
    if (e.button === 2 && rightHeld) {
      rightHeld = false;
      const heldMs = now - rightDownAt;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      const slots = resolveSlots(player);
      if (slots.rightTap === 'flamethrower') {
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
    specialAttackWheelArmed = false;
    closeSpecialAttackWheel();
    playInputState.chargeLeft01 = 0;
    playInputState.chargeRight01 = 0;
    playInputState.psybeamLeftHold = null;
    playInputState.psybeamRightHold = null;
    playInputState.mouseValid = false;
  });
}
