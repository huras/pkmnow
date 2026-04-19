import { playInputState } from './play-input-state.js';
import { invalidatePlayPointerHover } from './play-pointer-world.js';
import { setPlayerFacingFromWorldAimDelta, triggerPlayerLmbAttack, player } from '../player.js';
import {
  castMoveById,
  castMoveChargedById,
  castUltimate,
  spawnFieldCutPsychicSlashFx,
  spawnFieldCutSlashFx,
  spawnFieldSpinAttackFx,
  spawnFieldCutVineSlashFx,
  tryCastPlayerFlamethrowerStreamPuff,
  tryCastPlayerWaterGunStreamPuff,
  tryCastPlayerBubbleBeamStreamPuff,
  tryCastPlayerPrismaticStreamPuff,
  updatePlayerPrismaticMergedBeamVisual,
  tryCastPlayerThundershockStreamPuff,
  tryReleasePlayerPsybeam,
  castFireSpinMove,
  castFireSpinCharged,
  castEarthquakeMove,
  castEarthquakeCharged,
  pushParticle
} from '../moves/moves-manager.js';
import { tickFireSpinHold } from '../moves/fire-spin-move.js';
import {
  digitToBindingSlotIndex,
  getBindableMoveLabel,
  getPlayerInputBindings,
  setPlayerInputBinding,
  dispatchPlayerInputBindingsChanged,
  getInputSlotId,
  slotIndexToUiHotkey
} from './player-input-slots.js';
import {
  publishThunderChargePreview,
  withdrawThunderChargePreview
} from '../moves/thunder-move.js';
import { tryBreakCrystalOnPlayerTackle, tryBreakDetailsAlongSegment } from './play-crystal-tackle.js';
import { beginStrengthThrowFromPointer } from './thrown-map-detail-entities.js';
import { tryPlayerCutHitWildCircle, tryPlayerTackleHitWild } from '../wild-pokemon/index.js';
import { cutGrassInCircle } from '../play-grass-cut.js';
import { speciesHasType } from '../pokemon/pokemon-type-helpers.js';
import { playHomeRunBatHitSfx } from '../audio/home-run-bat-hit-sfx.js';
import { playCutComboSwordSwishSfx } from '../audio/cut-sword-swish-sfx.js';
import {
  getChargeLevel,
  getChargeRange01,
  getChargeDamage01,
  isChargeStrongAttackEligible,
  getWeakPartialChargeT,
  CHARGE_FIELD_RELEASE_MIN_01
} from './play-charge-levels.js';
import { playLinkSuperSwordSfx } from '../audio/link-super-sword-sfx.js';
import { attackWheel } from '../ui/attack-wheel.js';

const TAP_MS = 220;
const CHARGE_TIME_MULT = 3;
const CHARGE_MAX_SEC = 1.12 * CHARGE_TIME_MULT;
const FIELD_LMB_CHARGE_MAX_SEC_DEFAULT = 1.05 * CHARGE_TIME_MULT;
const FIELD_LMB_CHARGE_MIN_HOLD_MS = 180;
const FIELD_CUT_COMBO_RESET_SEC = 1.15;
const FIELD_TACKLE_CHARGE_MAX_SEC = 2.0 * CHARGE_TIME_MULT;
const FIELD_TACKLE_CHARGE_MAX_REACH_TILES = 8.0;
const FIELD_SKILL_CUT_RADIUS = 1.5;
const FIELD_CUT_CHARGE_MAX_RADIUS_MUL = 3.0;
const FIELD_SKILL_CUT_CENTER_OFFSET = 1.1;
/** Tap Cut hits 1–2: small step forward along aim. */
const FIELD_CUT_HIT_ADVANCE_TILES = 0.25;
/** Tap Cut third hit: stronger step. */
const FIELD_CUT_THIRD_HIT_ADVANCE_TILES = 0.5;
/** After third Cut combo hit: no movement (punishment). */
const FIELD_CUT_THIRD_HIT_LOCKOUT_SEC = 0.45;
/** Charged spin Cut / tackle lunge tile scale (unchanged). */
const FIELD_SKILL_SPIN_OR_TACKLE_CUT_ADVANCE_TILES = 0.5;
const FIELD_SKILL_LABEL = {
  tackle: 'Tackle',
  cut: 'Cut'
};

/** Hold digit 1–5 briefly to open the bind wheel for LMB / RMB / MMB / wheel↑ / wheel↓. */
/** @typedef {import('../moves/pokemon-moveset-config.js').MoveId} MoveId */

function getMoveTypeClass(moveId) {
  switch (moveId) {
    case 'ember':
    case 'fireBlast':
    case 'fireSpin':
    case 'flameCharge':
    case 'flamethrower':
    case 'incinerate':
    case 'sunnyDay':
      return 'type-fire';
    case 'earthquake':
      return 'type-ground';
    case 'absorb':
    case 'megaDrain':
    case 'petalDance':
    case 'solarBeam':
      return 'type-grass';
    case 'bubble':
    case 'waterBurst':
    case 'waterGun':
    case 'bubbleBeam':
    case 'hydroPump':
    case 'surf':
    case 'rainDance':
      return 'type-water';
    case 'acid':
    case 'sludge':
    case 'smog':
    case 'poisonSting':
    case 'poisonPowder':
      return 'type-poison';
    case 'auroraBeam':
    case 'blizzard':
    case 'iceBeam':
      return 'type-ice';
    case 'thunder':
    case 'thunderShock':
    case 'thunderbolt':
      return 'type-electric';
    case 'confusion':
    case 'psychic':
    case 'psywave':
    case 'psybeam':
    case 'prismaticLaser':
      return 'type-psychic';
    case 'dragonRage':
      return 'type-dragon';
    case 'nightShade':
      return 'type-ghost';
    case 'gust':
      return 'type-flying';
    case 'razorWind':
    case 'sonicBoom':
    case 'swift':
    case 'hyperBeam':
    case 'triAttack':
      return 'type-normal';
    case 'dreamEater':
      return 'type-psychic';
    case 'silkShoot':
      return 'type-bug';
    case 'ultimate':
      return 'type-normal';
    case 'tackle':
      return 'type-normal';
    case 'cut':
      return 'type-grass';
    default:
      return 'type-normal';
  }
}

function applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty) {
  setPlayerFacingFromWorldAimDelta(player, tx - sx, ty - sy);
}

let leftHeld = false;
let leftDownAt = 0;
let rightHeld = false;
let rightDownAt = 0;
/** Modifier state captured on LMB down (currently informational only). */
let leftShiftAtDown = false;
/** True after at least one flamethrower puff this RMB press (hold-stream). */
let rightFlameStreamedThisPress = false;
let rightWaterStreamedThisPress = false;
let rightBubbleBeamStreamedThisPress = false;
/** True after at least one prismatic laser stream puff this RMB press. */
let rightPrismaticStreamedThisPress = false;
let rightThundershockStreamedThisPress = false;
let leftFlameStreamedThisPress = false;
let leftWaterStreamedThisPress = false;
let leftBubbleBeamStreamedThisPress = false;
let leftPrismaticStreamedThisPress = false;
let leftThundershockStreamedThisPress = false;
let middleHeld = false;
let middleDownAt = 0;
let middleFlameStreamedThisPress = false;
let middleWaterStreamedThisPress = false;
let middleBubbleBeamStreamedThisPress = false;
let middlePrismaticStreamedThisPress = false;
let middleThundershockStreamedThisPress = false;
let fieldCutComboStep = 0;
let fieldCutComboTimerSec = 0;
let lastComboDexId = 0;
let fieldWheelMouseClientX = 0;
let fieldWheelMouseClientY = 0;
/** Last wheel step time (play canvas) to avoid scroll spam. */
let lastScrollBindCastMs = 0;

/** 0..4 = Digit1..Digit5 slot being edited, or -1. */
let bindingWheelSlotIdx = -1;
let bindingWheelArmed = false;

/** @type {HTMLDivElement | null} */
let bindingWheelRoot = null;

export function getFieldSkillLabel(skillId) {
  const s = String(skillId || '');
  if (s === 'strength') return FIELD_SKILL_LABEL.tackle;
  if (FIELD_SKILL_LABEL[s]) return FIELD_SKILL_LABEL[s];
  return getBindableMoveLabel(s);
}

/** @deprecated Use `getPlayerInputBindings(dex).lmb` — kept for older call sites (LMB melee chip). */
export function getSelectedFieldSkillForDex(dexId) {
  const l = getPlayerInputBindings(dexId).lmb;
  return l === 'cut' || l === 'tackle' ? l : 'tackle';
}

export function syncSelectedFieldSkillForDex(dexId) {
  void dexId;
  return getSelectedFieldSkillForDex(dexId);
}

export function getSelectedSpecialAttackMoveForDex(dexId) {
  return /** @type {MoveId} */ (getPlayerInputBindings(dexId).rmb);
}

export function syncSelectedSpecialAttackForDex(dexId) {
  void dexId;
  return getSelectedSpecialAttackMoveForDex(dexId);
}

function ensureBindWheelDom() {
  return attackWheel.ensureDom();
}

function syncBindWheelDom() {
  // Logic moved to AttackWheel component
}

function openBindWheel() {
  const dex = Math.floor(Number(player?.dexId) || 0);
  attackWheel.open(bindingWheelSlotIdx, dex >= 1 ? dex : 1);
}

function closeBindWheel() {
  attackWheel.close();
}

function updateBindWheelHover(p) {
  void p;
  if (!attackWheel.isOpen) return;
  attackWheel.updateMouse(fieldWheelMouseClientX, fieldWheelMouseClientY);
}

export function handleBindSlotHotkeyDown(code) {
  const idx = digitToBindingSlotIndex(code);
  if (idx < 0) return false;
  if (attackWheel.isOpen && attackWheel.getPendingSlotIdx() === idx) {
    closeBindWheel();
    bindingWheelSlotIdx = -1;
    bindingWheelArmed = false;
    return true;
  }
  bindingWheelSlotIdx = idx;
  bindingWheelArmed = true;
  openBindWheel();
  return true;
}

/**
 * @param {import('../player.js').player | null | undefined} pl
 * @param {string} [forcedMoveId]
 */
function applyAttackWheelMoveBind(pl, forcedMoveId) {
  if (!attackWheel.isOpen || attackWheel.getPhase() !== 'move') return;
  const pick = forcedMoveId || attackWheel.getSelectedMove();
  if (!pick) return;
  const dex = Math.floor(Number(pl?.dexId) || 0);
  const slotIdx = attackWheel.getPendingSlotIdx();
  if (dex < 1 || slotIdx < 0) {
    attackWheel.dismissWithoutSaving();
    bindingWheelSlotIdx = -1;
    bindingWheelArmed = false;
    return;
  }
  setPlayerInputBinding(dex, slotIdx, pick);
  dispatchPlayerInputBindingsChanged(dex);
  window.dispatchEvent(
    new CustomEvent('play-field-skill-change', {
      detail: { dexId: dex, skillId: getSelectedFieldSkillForDex(dex) }
    })
  );
  closeBindWheel();
  bindingWheelSlotIdx = -1;
  bindingWheelArmed = false;
}

/** @returns {boolean} true if a wheel session was dismissed */
export function dismissAttackWheelIfOpen() {
  if (!attackWheel.isOpen) return false;
  attackWheel.dismissWithoutSaving();
  bindingWheelArmed = false;
  bindingWheelSlotIdx = -1;
  return true;
}

export function handleBindSlotHotkeyUp(code, pl) {
  void code;
  void pl;
  return false;
}

export function handleFieldSkillHotkeyDown(code) {
  return handleBindSlotHotkeyDown(code);
}

export function handleFieldSkillHotkeyUp(code, pl, data) {
  void data;
  return handleBindSlotHotkeyUp(code, pl);
}

export function handleSpecialAttackHotkeyDown(code) {
  return handleBindSlotHotkeyDown(code);
}

export function handleSpecialAttackHotkeyUp(code, pl) {
  return handleBindSlotHotkeyUp(code, pl);
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

function resolveFieldLmbChargeMaxSec(meleeId) {
  if (meleeId === 'tackle') return FIELD_TACKLE_CHARGE_MAX_SEC;
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
  const styleId = resolveCutStyleForDex(player.dexId ?? 1);
  const profile = resolveCutProfile(styleId);
  const comboStep = resolveCutComboStep(player, charged);
  player._tackleReachTiles = comboStep >= 3 ? FIELD_CUT_THIRD_HIT_ADVANCE_TILES : FIELD_CUT_HIT_ADVANCE_TILES;
  playCutComboSwordSwishSfx(player, comboStep);
  if (comboStep === 3) {
    player.cutThirdHitLockoutSec = FIELD_CUT_THIRD_HIT_LOCKOUT_SEC;
  }
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
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
    knockback: useKnockback,
    cutWildHitSound: true
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
      hitSource: 'cut',
      pz: player.z ?? 0
    });
  }
  cutGrassInCircle(centerX, centerY, useRadius, data, player.z ?? 0);
}

/** Charged Cut release before the first bar is full: one slash, slightly stronger than tap 1. */
function castWeakPartialChargedCut(player, data, charge01) {
  if (!player || !data) return;
  const weakT = getWeakPartialChargeT(charge01);
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  player._tackleReachTiles = FIELD_CUT_HIT_ADVANCE_TILES;
  playCutComboSwordSwishSfx(player, 1);
  const styleId = resolveCutStyleForDex(player.dexId ?? 1);
  const profile = resolveCutProfile(styleId);
  const variant = resolveCutComboVariant(styleId, 1, false);
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const baseHeadingRad = Math.atan2(ny, nx || 1e-6);
  const headingRad = baseHeadingRad + ((variant.headingOffsetDeg || 0) * Math.PI) / 180;
  const radMul = Math.max(0.4, (variant.radiusMul || 1) + 0.05 + 0.1 * weakT);
  const useRadius = profile.radius * radMul;
  const useDamage = Math.round(profile.damage + (variant.damageAdd || 0) + 1 + 4 * weakT);
  const useKnockback = profile.knockback + (variant.knockbackAdd || 0) + 0.22 * weakT;
  const centerOffset = FIELD_SKILL_CUT_CENTER_OFFSET * Math.max(0.35, variant.centerOffsetMul || 1);
  const centerX = (player.x ?? sx) + Math.cos(headingRad) * centerOffset;
  const centerY = (player.y ?? sy) + Math.sin(headingRad) * centerOffset;
  if (styleId === 'vine') {
    spawnFieldCutVineSlashFx(centerX, centerY, headingRad, {
      radiusTiles: useRadius,
      arcDeg: variant.arcDeg,
      lifeSec: variant.lifeSec + 0.04 * weakT
    });
  } else if (styleId === 'psychic') {
    spawnFieldCutPsychicSlashFx(centerX, centerY, headingRad, {
      radiusTiles: useRadius,
      arcDeg: variant.arcDeg,
      lifeSec: variant.lifeSec + 0.04 * weakT
    });
  } else {
    spawnFieldCutSlashFx(centerX, centerY, headingRad, {
      radiusTiles: useRadius,
      arcDeg: variant.arcDeg,
      lifeSec: variant.lifeSec + 0.04 * weakT
    });
  }
  tryPlayerCutHitWildCircle(player, data, centerX, centerY, useRadius, {
    damage: useDamage,
    knockback: useKnockback,
    cutWildHitSound: true
  });
  const worldHitOnceSet = new Set();
  const spawnedHitOnceSet = new Set();
  const rays = styleId === 'psychic' ? 11 : 8;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const ex = centerX + Math.cos(ang) * useRadius;
    const ey = centerY + Math.sin(ang) * useRadius;
    tryBreakDetailsAlongSegment(centerX, centerY, ex, ey, data, {
      worldHitOnceSet,
      spawnedHitOnceSet,
      hitSource: 'cut',
      pz: player.z ?? 0
    });
  }
  cutGrassInCircle(centerX, centerY, useRadius, data, player.z ?? 0);
}

function castChargedFieldSpinAttack(player, data, meleeId, charge01 = 1) {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  player._tackleReachTiles = FIELD_SKILL_SPIN_OR_TACKLE_CUT_ADVANCE_TILES;
  const nx = Number(player.tackleDirNx) || 0;
  const ny = Number(player.tackleDirNy) || 1;
  const headingRad = Math.atan2(ny, nx || 1e-6);
  const centerX = Number(player.x ?? sx);
  const centerY = Number(player.y ?? sy);
  let radius = 2.05;
  let damage = 16;
  let knockback = 5;
  let styleId = 'slash';
  let fxLifeSec = 0.44;
  let rays = 24;
  if (meleeId === 'cut') {
    const uRange = getChargeRange01(charge01);
    const uDamage = getChargeDamage01(charge01);
    const cutStyle = resolveCutStyleForDex(player.dexId ?? 1);
    const profile = resolveCutProfile(cutStyle);
    styleId = cutStyle;
    const radiusMul = 1 + (FIELD_CUT_CHARGE_MAX_RADIUS_MUL - 1) * uRange;
    radius = Math.max(2.1, profile.radius * radiusMul);
    damage = Math.round(profile.damage + 5 + 12 * uDamage);
    knockback = profile.knockback + 1.1 + 2.6 * uRange;
    fxLifeSec = 0.44 + 0.16 * uRange;
    rays = 24 + Math.round(20 * uRange);
    fieldCutComboStep = 0;
    fieldCutComboTimerSec = 0;
  }
  spawnFieldSpinAttackFx(centerX, centerY, headingRad, {
    radiusTiles: radius,
    styleId,
    lifeSec: fxLifeSec,
    windTex: meleeId === 'cut'
  });
  tryPlayerCutHitWildCircle(player, data, centerX, centerY, radius, {
    damage,
    knockback,
    cutWildHitSound: meleeId === 'cut'
  });
  const worldHitOnceSet = new Set();
  const spawnedHitOnceSet = new Set();
  const spinHitSource = meleeId === 'cut' ? 'cut' : 'tackle';
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const ex = centerX + Math.cos(ang) * radius;
    const ey = centerY + Math.sin(ang) * radius;
    tryBreakDetailsAlongSegment(centerX, centerY, ex, ey, data, {
      worldHitOnceSet,
      spawnedHitOnceSet,
      hitSource: spinHitSource,
      pz: player.z ?? 0,
      detailCharge01: charge01
    });
  }
  if (meleeId === 'cut') {
    cutGrassInCircle(centerX, centerY, radius, data, player.z ?? 0);
  }
}

function castSelectedFieldSkill(player, data, charged = false, charge01 = 0, meleeId = 'tackle') {
  if (!player) return;
  if (charged && meleeId === 'cut') {
    if (isChargeStrongAttackEligible(charge01)) {
      playLinkSuperSwordSfx(player);
      castChargedFieldSpinAttack(player, data, meleeId, charge01);
    } else {
      castWeakPartialChargedCut(player, data, charge01);
    }
    return;
  }
  if (meleeId === 'cut') {
    castPlayerCut(player, data, false);
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
  if (meleeId === 'tackle') {
    if (charged && isChargeStrongAttackEligible(charge01)) {
      const uRange = getChargeRange01(charge01);
      const uDamage = getChargeDamage01(charge01);
      const chargedReach = 2 + (FIELD_TACKLE_CHARGE_MAX_REACH_TILES - 2) * uRange;
      const tackleDamage = Math.round(12 + 10 * uDamage);
      player._tackleReachTiles = Math.max(2, chargedReach);
      tryPlayerTackleHitWild(player, data, { damage: tackleDamage });
      tryBreakCrystalOnPlayerTackle(player, data, charge01);
    } else if (charged) {
      const weakT = getWeakPartialChargeT(charge01);
      const tackleDamage = Math.round(12 + 2 + 6 * weakT);
      const reach = 2 + 0.9 * weakT;
      player._tackleReachTiles = Math.max(2, reach);
      tryPlayerTackleHitWild(player, data, { damage: tackleDamage });
      tryBreakCrystalOnPlayerTackle(player, data, 0.1 + 0.22 * weakT);
    } else {
      const uRange = getChargeRange01(charge01);
      const uDamage = getChargeDamage01(charge01);
      const chargedReach = 2 + (FIELD_TACKLE_CHARGE_MAX_REACH_TILES - 2) * uRange;
      const tackleDamage = Math.round(12 + 10 * uDamage);
      player._tackleReachTiles = Math.max(2, chargedReach);
      tryPlayerTackleHitWild(player, data, { damage: tackleDamage });
      tryBreakCrystalOnPlayerTackle(player, data, null);
    }
    return;
  }
  tryPlayerTackleHitWild(player, data);
  tryBreakCrystalOnPlayerTackle(player, data, null);
}

/** True when this bound id maps to the (charge-tiered) Thunder move. Thunderbolt is
 *  separate: it uses the same 4-segment charge meter but skips the storm-cell *preview*
 *  (no dark cloud over aim while charging — only the HUD fills). */
function moveIdIsThunder(moveId) {
  return moveId === 'thunder';
}

/** Ids used for Thunder preview ownership so each button has its own cell slot. */
const THUNDER_PREVIEW_OWNER_IDS = ['lmb', 'rmb', 'mmb'];

function isHoldStreamMoveId(moveId) {
  return (
    moveId === 'flamethrower' ||
    moveId === 'waterGun' ||
    moveId === 'hydroPump' ||
    moveId === 'bubbleBeam' ||
    moveId === 'surf' ||
    moveId === 'prismaticLaser' ||
    moveId === 'solarBeam' ||
    moveId === 'hyperBeam' ||
    moveId === 'triAttack' ||
    moveId === 'thunderShock'
  );
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
 * Legacy digit hotkeys were removed: play combat uses five pointer binds + 1–5 to configure.
 * @returns {boolean}
 */
export function castMappedMoveByHotkey(_code, _player) {
  return false;
}

function getBindingsOrDefault(pl) {
  const dex = Math.floor(Number(pl?.dexId) || 0);
  return dex >= 1 ? getPlayerInputBindings(dex) : getPlayerInputBindings(1);
}

function isMeleeTackleOrCut(moveId) {
  return moveId === 'tackle' || moveId === 'cut';
}

/**
 * @param {string} moveId
 * @param {import('../player.js').player} pl
 * @param {object | null} data
 */
function castScrollSlotMove(moveId, pl, data) {
  if (!pl || !data) return;
  if (isMeleeTackleOrCut(moveId)) {
    castSelectedFieldSkill(pl, data, false, 0, moveId);
    return;
  }
  const { sx, sy, tx, ty } = aimAtCursor(pl);
  if (moveId === 'ultimate') {
    castUltimate(sx, sy, tx, ty, pl);
    return;
  }
  castMoveById(moveId, sx, sy, tx, ty, pl);
}

/**
 * @param {string} moveId
 * @param {import('../player.js').player} pl
 * @param {object | null} data
 * @param {number} heldMs
 * @param {number} charge01
 * @param {'l' | 'r' | 'm'} which
 */
function finishMoveButtonUp(moveId, pl, data, heldMs, charge01, which) {
  // Withdraw the Thunder charging-cloud preview tied to *this* button before any cast
  // side-effects run. Cheap no-op when the bind wasn't Thunder; guarantees the preview
  // can't overlap the real summoned cell for even a single frame on release.
  withdrawThunderChargePreview(which === 'l' ? 'lmb' : which === 'r' ? 'rmb' : 'mmb');
  const chargeLevel = getChargeLevel(charge01);
  if (isMeleeTackleOrCut(moveId)) {
    const charged = heldMs >= FIELD_LMB_CHARGE_MIN_HOLD_MS && charge01 >= CHARGE_FIELD_RELEASE_MIN_01;
    if (charged && chargeLevel >= 3) {
      playHomeRunBatHitSfx(pl);
    }
    castSelectedFieldSkill(pl, data, charged, charge01, moveId);
    return;
  }
  const { sx, sy, tx, ty } = aimAtCursor(pl);
  if (moveId === 'ultimate') {
    castUltimate(sx, sy, tx, ty, pl);
    return;
  }
  if (moveId === 'fireSpin') {
    applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
    if (heldMs < TAP_MS) {
      castFireSpinMove(sx, sy, tx, ty, pl);
    } else {
      castFireSpinCharged(sx, sy, tx, ty, pl, charge01 || 0);
    }
    return;
  }
  if (moveId === 'earthquake') {
    if (heldMs < TAP_MS) {
      castEarthquakeMove(sx, sy, tx, ty, pl);
    } else {
      castEarthquakeCharged(sx, sy, tx, ty, pl, charge01 || 0);
    }
    return;
  }
  const flame = which === 'l' ? leftFlameStreamedThisPress : which === 'm' ? middleFlameStreamedThisPress : rightFlameStreamedThisPress;
  const water = which === 'l' ? leftWaterStreamedThisPress : which === 'm' ? middleWaterStreamedThisPress : rightWaterStreamedThisPress;
  const bubble = which === 'l' ? leftBubbleBeamStreamedThisPress : which === 'm' ? middleBubbleBeamStreamedThisPress : rightBubbleBeamStreamedThisPress;
  const prismatic = which === 'l' ? leftPrismaticStreamedThisPress : which === 'm' ? middlePrismaticStreamedThisPress : rightPrismaticStreamedThisPress;
  const tshock = which === 'l' ? leftThundershockStreamedThisPress : which === 'm' ? middleThundershockStreamedThisPress : rightThundershockStreamedThisPress;

  if (moveId === 'flamethrower') {
    if (!flame) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'waterGun' || moveId === 'hydroPump') {
    if (!water) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerWaterGunStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'bubbleBeam' || moveId === 'surf') {
    if (!bubble) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerBubbleBeamStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (
    moveId === 'prismaticLaser' ||
    moveId === 'solarBeam' ||
    moveId === 'hyperBeam' ||
    moveId === 'triAttack'
  ) {
    if (!prismatic) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'thunderShock') {
    if (!tshock) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'psybeam') {
    applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
    tryReleasePlayerPsybeam(sx, sy, tx, ty, pl);
  } else if (heldMs < TAP_MS) {
    castMoveById(moveId, sx, sy, tx, ty, pl);
  } else {
    if (chargeLevel >= 3) {
      playHomeRunBatHitSfx(pl);
    }
    castMoveChargedById(moveId, sx, sy, tx, ty, pl, charge01 || 0);
  }
}

/**
 * @param {number} dt
 * @param {import('../player.js').player} player
 * @param {object | null | undefined} data
 */
export function updatePlayPointerCombat(dt, player, data) {
  void data;
  if (!player) return;
  const dex = Math.floor(Number(player?.dexId) || 0);
  if (dex !== lastComboDexId) {
    fieldCutComboStep = 0;
    fieldCutComboTimerSec = 0;
    lastComboDexId = dex;
  }
  if (fieldCutComboTimerSec > 0) {
    fieldCutComboTimerSec = Math.max(0, fieldCutComboTimerSec - dt);
    if (fieldCutComboTimerSec <= 0) fieldCutComboStep = 0;
  }
  updateBindWheelHover(player);

  const b = getBindingsOrDefault(player);
  const lmb = b.lmb;
  const rmb = b.rmb;
  const mmb = b.mmb;

  playInputState.strengthCarryLmbAim = !!(
    leftHeld && !combatModifierHeld() && player._strengthCarry && playInputState.mouseValid
  );

  const mod = combatModifierHeld();

  if (leftHeld && !mod && !player._strengthCarry) {
    if (isMeleeTackleOrCut(lmb)) {
      const maxSec = Math.max(0.2, resolveFieldLmbChargeMaxSec(lmb));
      playInputState.chargeLeft01 = Math.min(1, (playInputState.chargeLeft01 || 0) + dt / maxSec);
    } else if (!isHoldStreamMoveId(lmb) && lmb !== 'psybeam') {
      playInputState.chargeLeft01 = Math.min(1, (playInputState.chargeLeft01 || 0) + dt / CHARGE_MAX_SEC);
    }
  } else {
    playInputState.chargeLeft01 = 0;
  }

  if (rightHeld && !mod && !isHoldStreamMoveId(rmb) && rmb !== 'psybeam') {
    playInputState.chargeRight01 = Math.min(1, (playInputState.chargeRight01 || 0) + dt / CHARGE_MAX_SEC);
  }
  if (middleHeld && !mod && !isHoldStreamMoveId(mmb) && mmb !== 'psybeam') {
    playInputState.chargeMmb01 = Math.min(1, (playInputState.chargeMmb01 || 0) + dt / CHARGE_MAX_SEC);
  }

  if (leftHeld && !mod && lmb === 'psybeam') {
    if (!playInputState.psybeamLeftHold) playInputState.psybeamLeftHold = { pulse: 0 };
    playInputState.psybeamLeftHold.pulse += dt * 7.2;
  } else {
    playInputState.psybeamLeftHold = null;
  }
  if (rightHeld && !mod && rmb === 'psybeam') {
    if (!playInputState.psybeamRightHold) playInputState.psybeamRightHold = { pulse: 0 };
    playInputState.psybeamRightHold.pulse += dt * 7.2;
  } else {
    playInputState.psybeamRightHold = null;
  }
  if (middleHeld && !mod && mmb === 'psybeam') {
    if (!playInputState.psybeamMiddleHold) playInputState.psybeamMiddleHold = { pulse: 0 };
    playInputState.psybeamMiddleHold.pulse += dt * 7.2;
  } else {
    playInputState.psybeamMiddleHold = null;
  }

  const { sx, sy, tx, ty } = aimAtCursor(player);
  if (leftHeld && !mod && lmb === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) leftFlameStreamedThisPress = true;
  }
  if (leftHeld && !mod && lmb === 'fireSpin') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    tickFireSpinHold(player, dt, pushParticle, playInputState.chargeLeft01 || 0);
  }
  if (leftHeld && !mod && (lmb === 'waterGun' || lmb === 'hydroPump')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerWaterGunStreamPuff(sx, sy, tx, ty, player)) leftWaterStreamedThisPress = true;
  }
  if (leftHeld && !mod && (lmb === 'bubbleBeam' || lmb === 'surf')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerBubbleBeamStreamPuff(sx, sy, tx, ty, player)) leftBubbleBeamStreamedThisPress = true;
  }
  if (
    leftHeld &&
    !mod &&
    (lmb === 'prismaticLaser' ||
      lmb === 'solarBeam' ||
      lmb === 'hyperBeam' ||
      lmb === 'triAttack')
  ) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) leftPrismaticStreamedThisPress = true;
  }
  if (leftHeld && !mod && lmb === 'thunderShock') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, player)) leftThundershockStreamedThisPress = true;
  }

  if (rightHeld && !mod && rmb === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) rightFlameStreamedThisPress = true;
  }
  if (rightHeld && !mod && rmb === 'fireSpin') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    tickFireSpinHold(player, dt, pushParticle, playInputState.chargeRight01 || 0);
  }
  if (rightHeld && !mod && (rmb === 'waterGun' || rmb === 'hydroPump')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerWaterGunStreamPuff(sx, sy, tx, ty, player)) rightWaterStreamedThisPress = true;
  }
  if (rightHeld && !mod && (rmb === 'bubbleBeam' || rmb === 'surf')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerBubbleBeamStreamPuff(sx, sy, tx, ty, player)) rightBubbleBeamStreamedThisPress = true;
  }
  if (
    rightHeld &&
    !mod &&
    (rmb === 'prismaticLaser' ||
      rmb === 'solarBeam' ||
      rmb === 'hyperBeam' ||
      rmb === 'triAttack')
  ) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) rightPrismaticStreamedThisPress = true;
  }
  if (rightHeld && !mod && rmb === 'thunderShock') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, player)) rightThundershockStreamedThisPress = true;
  }

  if (middleHeld && !mod && mmb === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) middleFlameStreamedThisPress = true;
  }
  if (middleHeld && !mod && mmb === 'fireSpin') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    tickFireSpinHold(player, dt, pushParticle, playInputState.chargeMmb01 || 0);
  }
  if (middleHeld && !mod && (mmb === 'waterGun' || mmb === 'hydroPump')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerWaterGunStreamPuff(sx, sy, tx, ty, player)) middleWaterStreamedThisPress = true;
  }
  if (middleHeld && !mod && (mmb === 'bubbleBeam' || mmb === 'surf')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerBubbleBeamStreamPuff(sx, sy, tx, ty, player)) middleBubbleBeamStreamedThisPress = true;
  }
  if (
    middleHeld &&
    !mod &&
    (mmb === 'prismaticLaser' ||
      mmb === 'solarBeam' ||
      mmb === 'hyperBeam' ||
      mmb === 'triAttack')
  ) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) middlePrismaticStreamedThisPress = true;
  }
  if (middleHeld && !mod && mmb === 'thunderShock') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, player)) middleThundershockStreamedThisPress = true;
  }

  const prismaticLaserStreamHeld =
    !!(leftHeld && !mod && lmb === 'prismaticLaser') ||
    !!(rightHeld && !mod && rmb === 'prismaticLaser') ||
    !!(middleHeld && !mod && mmb === 'prismaticLaser');
  updatePlayerPrismaticMergedBeamVisual(prismaticLaserStreamHeld, sx, sy, tx, ty, player);

  // Thunder charge preview: while a held button is bound to Thunder and the charge has
  // passed the first bar, broadcast a "charging storm cell" + ground-shadow at the live
  // cursor. The publisher gates on L2+ internally so Level 1 tap stays stealth.
  const thunderHolders = [
    { held: leftHeld && !mod && !player._strengthCarry, moveId: lmb, ownerId: 'lmb', charge01: playInputState.chargeLeft01 || 0 },
    { held: rightHeld && !mod, moveId: rmb, ownerId: 'rmb', charge01: playInputState.chargeRight01 || 0 },
    { held: middleHeld && !mod, moveId: mmb, ownerId: 'mmb', charge01: playInputState.chargeMmb01 || 0 }
  ];
  for (const { held, moveId, ownerId, charge01 } of thunderHolders) {
    if (held && moveIdIsThunder(moveId)) {
      publishThunderChargePreview(ownerId, { worldX: tx, worldY: ty, charge01 });
    } else {
      withdrawThunderChargePreview(ownerId);
    }
  }
}

/**
 * @param {{ canvas: HTMLCanvasElement, getAppMode: () => string, getPlayer: () => import('../player.js').player, getCurrentData?: () => object | null }} deps
 */
export function installPlayPointerCombat(deps) {
  const { canvas, getAppMode, getPlayer, getCurrentData } = deps;
  fieldWheelMouseClientX = window.innerWidth * 0.5;
  fieldWheelMouseClientY = window.innerHeight * 0.5;

  window.addEventListener('attack-wheel-confirm-bind', (ev) => {
    if (getAppMode() !== 'play') return;
    const moveId =
      ev instanceof CustomEvent && ev.detail && typeof ev.detail.moveId === 'string' ? ev.detail.moveId : null;
    if (!moveId) return;
    applyAttackWheelMoveBind(getPlayer(), moveId);
  });

  window.addEventListener('attack-wheel-dismiss', () => {
    if (getAppMode() !== 'play') return;
    dismissAttackWheelIfOpen();
  });

  window.addEventListener(
    'pointermove',
    (e) => {
      fieldWheelMouseClientX = Number(e.clientX) || 0;
      fieldWheelMouseClientY = Number(e.clientY) || 0;
      const p = getPlayer();
      if (attackWheel.isOpen) updateBindWheelHover(p);
    },
    true
  );

  canvas.addEventListener('contextmenu', (e) => {
    if (getAppMode() === 'play' && !e.ctrlKey) e.preventDefault();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (getAppMode() !== 'play' || e.target !== canvas) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastScrollBindCastMs < 95) return;
      lastScrollBindCastMs = now;
      const pl = getPlayer();
      const dex = Math.floor(Number(pl?.dexId) || 0);
      if (dex < 1) return;
      const bb = getPlayerInputBindings(dex);
      const moveId = e.deltaY < 0 ? bb.wheelUp : bb.wheelDown;
      const data = getCurrentData?.() ?? null;
      castScrollSlotMove(moveId, pl, data);
    },
    { passive: false }
  );

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (getAppMode() !== 'play') return;
      if (e.target !== canvas) return;
      const pl = getPlayer();
      const sh = combatModifierHeld();

      if (e.button === 0) {
        e.preventDefault();
        fieldWheelMouseClientX = Number(e.clientX) || fieldWheelMouseClientX;
        fieldWheelMouseClientY = Number(e.clientY) || fieldWheelMouseClientY;
        leftHeld = true;
        leftDownAt = performance.now();
        leftShiftAtDown = sh;
        playInputState.chargeLeft01 = 0;
        leftFlameStreamedThisPress = false;
        leftWaterStreamedThisPress = false;
        leftBubbleBeamStreamedThisPress = false;
        leftPrismaticStreamedThisPress = false;
        leftThundershockStreamedThisPress = false;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 2) {
        e.preventDefault();
        rightHeld = true;
        rightDownAt = performance.now();
        rightFlameStreamedThisPress = false;
        rightWaterStreamedThisPress = false;
        rightBubbleBeamStreamedThisPress = false;
        rightPrismaticStreamedThisPress = false;
        rightThundershockStreamedThisPress = false;
        playInputState.chargeRight01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 1) {
        e.preventDefault();
        middleHeld = true;
        middleDownAt = performance.now();
        middleFlameStreamedThisPress = false;
        middleWaterStreamedThisPress = false;
        middleBubbleBeamStreamedThisPress = false;
        middlePrismaticStreamedThisPress = false;
        middleThundershockStreamedThisPress = false;
        playInputState.chargeMmb01 = 0;
        canvas.setPointerCapture?.(e.pointerId);
      }
    },
    { passive: false }
  );

  const onPointerUp = (e) => {
    if (getAppMode() !== 'play') return;
    const pl = getPlayer();
    const now = performance.now();
    const dex = Math.floor(Number(pl?.dexId) || 0);
    const bind = dex >= 1 ? getPlayerInputBindings(dex) : getPlayerInputBindings(1);

    if (e.button === 0 && leftHeld) {
      leftHeld = false;
      const { sx, sy, tx, ty } = aimAtCursor(pl);
      const heldMs = now - leftDownAt;
      const charge01 = Math.max(0, Math.min(1, Number(playInputState.chargeLeft01) || 0));
      const charged = heldMs >= FIELD_LMB_CHARGE_MIN_HOLD_MS && charge01 >= CHARGE_FIELD_RELEASE_MIN_01;
      const data = getCurrentData?.() ?? null;
      const threw = !!(pl._strengthCarry && data && beginStrengthThrowFromPointer(pl, data, tx, ty));
      if (threw) {
        triggerPlayerLmbAttack(pl, tx - sx, ty - sy);
      } else if (isMeleeTackleOrCut(bind.lmb)) {
        finishMoveButtonUp(bind.lmb, pl, data, heldMs, charge01, 'l');
      } else {
        finishMoveButtonUp(bind.lmb, pl, data, heldMs, charge01, 'l');
      }
      leftShiftAtDown = false;
      playInputState.chargeLeft01 = 0;
    }
    if (e.button === 2 && rightHeld) {
      rightHeld = false;
      const heldMs = now - rightDownAt;
      const data = getCurrentData?.() ?? null;
      finishMoveButtonUp(bind.rmb, pl, data, heldMs, playInputState.chargeRight01 || 0, 'r');
      playInputState.chargeRight01 = 0;
    }
    if (e.button === 1 && middleHeld) {
      middleHeld = false;
      const heldMs = now - middleDownAt;
      const data = getCurrentData?.() ?? null;
      finishMoveButtonUp(bind.mmb, pl, data, heldMs, playInputState.chargeMmb01 || 0, 'm');
      playInputState.chargeMmb01 = 0;
    }
  };

  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  canvas.addEventListener('pointerleave', () => {
    if (getAppMode() !== 'play') return;
    leftHeld = false;
    leftShiftAtDown = false;
    rightHeld = false;
    middleHeld = false;
    playInputState.chargeLeft01 = 0;
    playInputState.chargeRight01 = 0;
    playInputState.chargeMmb01 = 0;
    playInputState.psybeamLeftHold = null;
    playInputState.psybeamRightHold = null;
    playInputState.psybeamMiddleHold = null;
    playInputState.strengthCarryLmbAim = false;
    playInputState.mouseValid = false;
    invalidatePlayPointerHover();
    for (const ownerId of THUNDER_PREVIEW_OWNER_IDS) withdrawThunderChargePreview(ownerId);
    updatePlayerPrismaticMergedBeamVisual(false, 0, 0, 0, 0, null);
  });

  window.addEventListener('blur', () => {
    bindingWheelArmed = false;
    bindingWheelSlotIdx = -1;
    closeBindWheel();
  });
}
