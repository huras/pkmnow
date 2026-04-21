import { playInputState } from './play-input-state.js';
import { invalidatePlayPointerHover } from './play-pointer-world.js';
import {
  setPlayerFacingFromWorldAimDelta,
  triggerPlayerLmbAttack,
  player,
  getTackleDirUnitFromFacing
} from '../player.js';
import {
  castMoveById,
  castMoveChargedById,
  moveSupportsChargedRelease,
  castUltimate,
  spawnFieldCutPsychicSlashFx,
  spawnFieldCutSlashFx,
  spawnFieldSpinAttackFx,
  spawnFieldCutVineSlashFx,
  spawnFieldCutScratchFx,
  tryCastPlayerFlamethrowerStreamPuff,
  tryCastPlayerHydroPumpStreamPuff,
  castWaterGunMove,
  castWaterGunCharged,
  tryCastPlayerBubbleBeamStreamPuff,
  tryCastPlayerPrismaticStreamPuff,
  updatePlayerPrismaticMergedBeamVisual,
  tryCastPlayerSteelBeamStreamPuff,
  updatePlayerSteelBeamMergedBeamVisual,
  tryCastPlayerWaterCannonStreamPuff,
  updatePlayerWaterCannonMergedBeamVisual,
  tryCastPlayerThundershockStreamPuff,
  tryCastPlayerAbsorbStreamPuff,
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
import { tryBreakCrystalOnPlayerTackle, tryBreakDetailsInCircle } from './play-crystal-tackle.js';
import { beginStrengthThrowFromPointer } from './thrown-map-detail-entities.js';
import { tryPlayerCutHitWildCircle, tryPlayerTackleHitWild } from '../wild-pokemon/index.js';
import { cutGrassInCircle } from '../play-grass-cut.js';
import { speciesHasType } from '../pokemon/pokemon-type-helpers.js';
import { playModerateSwordHitSfx } from '../audio/moderate-sword-hit-sfx.js';
import { playCutComboSwordSwishSfx } from '../audio/cut-sword-swish-sfx.js';
import {
  getChargeLevel,
  getEarthquakeChargeLevel,
  getChargeRange01,
  getChargeDamage01,
  isChargeStrongAttackEligible,
  getWeakPartialChargeT,
  CHARGE_FIELD_RELEASE_MIN_01,
  getChargeBarProgresses,
  getEarthquakeChargeBarProgresses
} from './play-charge-levels.js';
import { playLinkSuperSwordSfx } from '../audio/link-super-sword-sfx.js';
import {
  rumblePlayerGamepadChargeFlow,
  rumblePlayerGamepadChargeStepLock
} from './play-gamepad-rumble.js';
import { attackWheel } from '../ui/attack-wheel.js';
import { dualBindWheel } from '../ui/dual-bind-wheel.js';

const TAP_MS = 220;
const CHARGE_TIME_MULT = 3;
const CHARGE_MAX_SEC = 1.12 * CHARGE_TIME_MULT;

/** Earthquake uses a 5th segment that fills over the same duration as bars 1–4 combined → 2× wall-clock to reach `charge01 === 1`. */
function chargeMeterMaxSecForMove(moveId) {
  return moveId === 'earthquake' ? CHARGE_MAX_SEC * 4 : CHARGE_MAX_SEC;
}
const FIELD_LMB_CHARGE_MAX_SEC_DEFAULT = 1.05 * CHARGE_TIME_MULT;
const FIELD_LMB_CHARGE_MIN_HOLD_MS = 180;
const FIELD_CUT_COMBO_RESET_SEC = 1.15;
const FIELD_TACKLE_CHARGE_MAX_SEC = 2.0 * CHARGE_TIME_MULT;
const FIELD_TACKLE_CHARGE_MIN_REACH_TILES = 1;
const FIELD_TACKLE_CHARGE_MAX_REACH_TILES = 3;
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
  cut: 'Cut',
  scratch: 'Scratch',
  psychoCut: 'Psycho Cut',
  vineWhip: 'Vine Whip'
};

/** Same threshold as `drawFieldCombatChargeBar` “full” segment highlight. */
const FIELD_CHARGE_SEG_FULL = 0.994;
let _fieldChargeSegTrackKey = '';
/** @type {number[] | null} */
let _fieldChargeSegPrev = null;

function resetFieldChargeSegmentTracker() {
  _fieldChargeSegTrackKey = '';
  _fieldChargeSegPrev = null;
}

function bumpPlayerFieldChargeShine(pl) {
  if (!pl) return;
  pl._fieldChargeShineStartMs = performance.now();
  pl._fieldChargeShineDurMs = 340;
}

/**
 * When a HUD charge segment completes, trigger a short shine on the player sprite.
 * @param {import('../player.js').player} pl
 * @param {{ moveId: string, charge01: number, slot: 'l' | 'r' | 'm' } | null} active
 */
function tickFieldChargeSegmentCompletionShine(pl, active) {
  if (!pl || !active) {
    resetFieldChargeSegmentTracker();
    return;
  }
  const moveId = active.moveId;
  const slot = active.slot;
  const charge01 = Math.max(0, Math.min(1, Number(active.charge01) || 0));
  if (!fieldMoveUsesChargeMeter(moveId) || charge01 <= 0.005) {
    resetFieldChargeSegmentTracker();
    return;
  }
  const isEq = moveId === 'earthquake';
  const progresses = isEq ? getEarthquakeChargeBarProgresses(charge01) : getChargeBarProgresses(charge01);
  const key = `${moveId}|${slot}`;
  if (key !== _fieldChargeSegTrackKey) {
    _fieldChargeSegTrackKey = key;
    _fieldChargeSegPrev = progresses.map(() => 0);
  }
  const prev = _fieldChargeSegPrev;
  if (prev && prev.length === progresses.length) {
    for (let i = 0; i < progresses.length; i++) {
      if (prev[i] < FIELD_CHARGE_SEG_FULL && progresses[i] >= FIELD_CHARGE_SEG_FULL - 1e-8) {
        bumpPlayerFieldChargeShine(pl);
      }
    }
  }
  _fieldChargeSegPrev = progresses.slice();
}

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
    case 'waterCannon':
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
    case 'steelBeam':
      return 'type-steel';
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
    case 'scratch':
    case 'cut':
      return 'type-normal';
    case 'vineWhip':
      return 'type-grass';
    case 'psychoCut':
      return 'type-psychic';
    default:
      return 'type-normal';
  }
}

function applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty) {
  setPlayerFacingFromWorldAimDelta(player, tx - sx, ty - sy);
}

let leftHeld = false;
/** True when LMB field session started from Square only — melee aim must not use mouse tiles. */
let leftCombatAimIgnoreMouse = false;
/** Same idea for R2 / MMB when the press began from triggers only. */
let rightCombatAimIgnoreMouse = false;
let middleCombatAimIgnoreMouse = false;
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
let rightSteelBeamStreamedThisPress = false;
let leftSteelBeamStreamedThisPress = false;
let middleSteelBeamStreamedThisPress = false;
let rightWaterCannonStreamedThisPress = false;
let leftWaterCannonStreamedThisPress = false;
let middleWaterCannonStreamedThisPress = false;
let rightAbsorbStreamedThisPress = false;
let leftAbsorbStreamedThisPress = false;
let middleAbsorbStreamedThisPress = false;
let middleThundershockStreamedThisPress = false;
let fieldCutComboStep = 0;
let fieldCutComboTimerSec = 0;
let lastComboDexId = 0;
let fieldWheelMouseClientX = 0;
let fieldWheelMouseClientY = 0;
/** Last wheel step time (play canvas) to avoid scroll spam. */
let lastScrollBindCastMs = 0;
/** Prior frame Square/LMB gamepad bit (for press/release edges in `updatePlayPointerCombat`). */
let prevGamepadFieldLmbHeld = false;
let prevGamepadFieldRmbHeld = false;
let prevGamepadFieldMmbHeld = false;
let prevGamepadThrowHeld = false;
/** Highest reached charge bar level this hold (per gamepad slot) for lock-click edges. */
const gamepadChargeLevelBySlot = { l: 0, r: 0, m: 0 };

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
  dualBindWheel.dismissWithoutSaving();
  const dex = Math.floor(Number(player?.dexId) || 0);
  attackWheel.open(bindingWheelSlotIdx, dex >= 1 ? dex : 1);
}

function closeBindWheel() {
  dualBindWheel.dismissWithoutSaving();
  attackWheel.close();
}

function updateBindWheelHover(p) {
  void p;
  if (dualBindWheel.isOpen) return;
  if (!attackWheel.isOpen) return;
  if (playInputState.gamepadWheelAimActive) return;
  attackWheel.updateMouse(fieldWheelMouseClientX, fieldWheelMouseClientY);
}

/**
 * D-pad / R3 slot open for the bind wheel (same rules as digit hotkeys 1–5).
 * @param {number} slotIdx 0..4
 */
export function handleGamepadBindWheelSlotPress(slotIdx) {
  if (slotIdx < 0 || slotIdx > 4) return;
  const dex = Math.floor(Number(player?.dexId) || 0);
  if (dualBindWheel.isOpen && dualBindWheel.getPendingSlotIdx() === slotIdx) {
    dualBindWheel.dismissWithoutSaving();
    bindingWheelSlotIdx = -1;
    bindingWheelArmed = false;
    return;
  }
  if (attackWheel.isOpen && attackWheel.getPendingSlotIdx() === slotIdx) {
    closeBindWheel();
    bindingWheelSlotIdx = -1;
    bindingWheelArmed = false;
    return;
  }
  dismissAttackWheelIfOpen();
  bindingWheelSlotIdx = slotIdx;
  bindingWheelArmed = true;
  dualBindWheel.open(slotIdx, dex >= 1 ? dex : 1);
}

export function handleBindSlotHotkeyDown(code) {
  const idx = digitToBindingSlotIndex(code);
  if (idx < 0) return false;
  if (dualBindWheel.isOpen && dualBindWheel.getPendingSlotIdx() === idx) {
    dualBindWheel.dismissWithoutSaving();
    bindingWheelSlotIdx = -1;
    bindingWheelArmed = false;
    return true;
  }
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
 * @param {string | { moveId?: string, fromDualWheel?: boolean, slotIdx?: number } | null} [detailOrMoveId]
 */
function applyAttackWheelMoveBind(pl, detailOrMoveId) {
  let moveId = null;
  let fromDual = false;
  let slotIdxDual = -1;
  if (typeof detailOrMoveId === 'string') {
    moveId = detailOrMoveId;
  } else if (detailOrMoveId && typeof detailOrMoveId === 'object') {
    if (typeof detailOrMoveId.moveId === 'string') moveId = detailOrMoveId.moveId;
    if (detailOrMoveId.fromDualWheel === true && Number.isFinite(detailOrMoveId.slotIdx)) {
      fromDual = true;
      slotIdxDual = Math.floor(Number(detailOrMoveId.slotIdx));
    }
  }
  if (!fromDual && !moveId) moveId = attackWheel.getSelectedMove();
  if (!moveId) return;

  const dex = Math.floor(Number(pl?.dexId) || 0);

  if (fromDual) {
    if (dex < 1 || slotIdxDual < 0 || slotIdxDual > 4) {
      dualBindWheel.dismissWithoutSaving();
      bindingWheelSlotIdx = -1;
      bindingWheelArmed = false;
      return;
    }
    setPlayerInputBinding(dex, slotIdxDual, moveId);
    dispatchPlayerInputBindingsChanged(dex);
    window.dispatchEvent(
      new CustomEvent('play-field-skill-change', {
        detail: { dexId: dex, skillId: getSelectedFieldSkillForDex(dex) }
      })
    );
    dualBindWheel.dismissWithoutSaving();
    bindingWheelSlotIdx = -1;
    bindingWheelArmed = false;
    return;
  }

  if (!attackWheel.isOpen || attackWheel.getPhase() !== 'move') return;
  const slotIdx = attackWheel.getPendingSlotIdx();
  if (dex < 1 || slotIdx < 0) {
    attackWheel.dismissWithoutSaving();
    bindingWheelSlotIdx = -1;
    bindingWheelArmed = false;
    return;
  }
  setPlayerInputBinding(dex, slotIdx, moveId);
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
  let did = false;
  if (dualBindWheel.isOpen) {
    dualBindWheel.dismissWithoutSaving();
    did = true;
  }
  if (attackWheel.isOpen) {
    attackWheel.dismissWithoutSaving();
    did = true;
  }
  if (did) {
    bindingWheelArmed = false;
    bindingWheelSlotIdx = -1;
  }
  return did;
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

function resolveCutStyle(meleeId, dexId) {
  if (meleeId === 'vineWhip') return 'vine';
  if (meleeId === 'psychoCut') return 'psychic';
  if (meleeId === 'scratch') return 'scratch';
  if (meleeId === 'cut') return 'slash';
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
  if (styleId === 'scratch') {
    return { radius: FIELD_SKILL_CUT_RADIUS + 0.1, damage: 9, knockback: 3.0 };
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

function castPlayerCut(player, data, charged = false, meleeId = 'cut') {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  const styleId = resolveCutStyle(meleeId, player.dexId ?? 1);
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
  } else if (styleId === 'scratch') {
    spawnFieldCutScratchFx(centerX, centerY, headingRad, {
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
  tryBreakDetailsInCircle(centerX, centerY, useRadius, data, {
    hitSource: 'cut',
    pz: player.z ?? 0,
    gamepadRumblePlayer: true
  });
  cutGrassInCircle(centerX, centerY, useRadius, data, player.z ?? 0);
}

/** Charged Cut release before the first bar is full: one slash, slightly stronger than tap 1. */
function castWeakPartialChargedCut(player, data, charge01, meleeId = 'cut') {
  if (!player || !data) return;
  const weakT = getWeakPartialChargeT(charge01);
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  player._tackleReachTiles = FIELD_CUT_HIT_ADVANCE_TILES;
  playCutComboSwordSwishSfx(player, 1);
  const styleId = resolveCutStyle(meleeId, player.dexId ?? 1);
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
  } else if (styleId === 'scratch') {
    spawnFieldCutScratchFx(centerX, centerY, headingRad, {
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
  tryBreakDetailsInCircle(centerX, centerY, useRadius, data, {
    hitSource: 'cut',
    pz: player.z ?? 0,
    gamepadRumblePlayer: true
  });
  cutGrassInCircle(centerX, centerY, useRadius, data, player.z ?? 0);
}

function castChargedFieldSpinAttack(player, data, meleeId, charge01 = 1) {
  if (!player || !data) return;
  const { sx, sy, tx, ty } = aimAtCursor(player);
  triggerPlayerLmbAttack(player, tx - sx, ty - sy);
  player._tackleReachTiles =
    meleeId === 'tackle' ? FIELD_TACKLE_CHARGE_MIN_REACH_TILES : FIELD_SKILL_SPIN_OR_TACKLE_CUT_ADVANCE_TILES;
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
  if (meleeId !== 'tackle') {
    const uRange = getChargeRange01(charge01);
    const uDamage = getChargeDamage01(charge01);
    const cutStyle = resolveCutStyle(meleeId, player.dexId ?? 1);
    const profile = resolveCutProfile(cutStyle);
    styleId = cutStyle;
    const radiusMul = 1 + (FIELD_CUT_CHARGE_MAX_RADIUS_MUL - 1) * uRange;
    radius = Math.max(2.1, profile.radius * radiusMul);
    damage = Math.round(profile.damage + 5 + 12 * uDamage);
    knockback = profile.knockback + 1.1 + 2.6 * uRange;
    fxLifeSec = 0.44 + 0.16 * uRange;
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
  const spinHitSource = meleeId === 'cut' ? 'cut' : 'tackle';
  tryBreakDetailsInCircle(centerX, centerY, radius, data, {
    hitSource: spinHitSource,
    pz: player.z ?? 0,
    detailCharge01: charge01,
    gamepadRumblePlayer: true
  });
  if (meleeId === 'cut') {
    cutGrassInCircle(centerX, centerY, radius, data, player.z ?? 0);
  }
}

function castSelectedFieldSkill(player, data, charged = false, charge01 = 0, meleeId = 'tackle') {
  if (!player) return;
  const isCutFamily = meleeId === 'cut' || meleeId === 'scratch' || meleeId === 'psychoCut' || meleeId === 'vineWhip';
  if (charged && isCutFamily) {
    if (isChargeStrongAttackEligible(charge01)) {
      playLinkSuperSwordSfx(player);
      castChargedFieldSpinAttack(player, data, meleeId, charge01);
    } else {
      castWeakPartialChargedCut(player, data, charge01, meleeId);
    }
    return;
  }
  if (isCutFamily) {
    castPlayerCut(player, data, false, meleeId);
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
      const span = FIELD_TACKLE_CHARGE_MAX_REACH_TILES - FIELD_TACKLE_CHARGE_MIN_REACH_TILES;
      const chargedReach = FIELD_TACKLE_CHARGE_MIN_REACH_TILES + span * uRange;
      const tackleDamage = Math.round(12 + 10 * uDamage);
      player._tackleReachTiles = Math.min(
        FIELD_TACKLE_CHARGE_MAX_REACH_TILES,
        Math.max(FIELD_TACKLE_CHARGE_MIN_REACH_TILES, chargedReach)
      );
      tryPlayerTackleHitWild(player, data, { damage: tackleDamage });
      tryBreakCrystalOnPlayerTackle(player, data, charge01);
    } else if (charged) {
      const weakT = getWeakPartialChargeT(charge01);
      const tackleDamage = Math.round(12 + 2 + 6 * weakT);
      const span = FIELD_TACKLE_CHARGE_MAX_REACH_TILES - FIELD_TACKLE_CHARGE_MIN_REACH_TILES;
      const reach = FIELD_TACKLE_CHARGE_MIN_REACH_TILES + span * weakT;
      player._tackleReachTiles = Math.min(
        FIELD_TACKLE_CHARGE_MAX_REACH_TILES,
        Math.max(FIELD_TACKLE_CHARGE_MIN_REACH_TILES, reach)
      );
      tryPlayerTackleHitWild(player, data, { damage: tackleDamage });
      tryBreakCrystalOnPlayerTackle(player, data, 0.1 + 0.22 * weakT);
    } else {
      const uRange = getChargeRange01(charge01);
      const uDamage = getChargeDamage01(charge01);
      const span = FIELD_TACKLE_CHARGE_MAX_REACH_TILES - FIELD_TACKLE_CHARGE_MIN_REACH_TILES;
      const chargedReach = FIELD_TACKLE_CHARGE_MIN_REACH_TILES + span * uRange;
      const tackleDamage = Math.round(12 + 10 * uDamage);
      player._tackleReachTiles = Math.min(
        FIELD_TACKLE_CHARGE_MAX_REACH_TILES,
        Math.max(FIELD_TACKLE_CHARGE_MIN_REACH_TILES, chargedReach)
      );
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
    moveId === 'hydroPump' ||
    moveId === 'bubbleBeam' ||
    moveId === 'surf' ||
    moveId === 'prismaticLaser' ||
    moveId === 'steelBeam' ||
    moveId === 'waterCannon' ||
    moveId === 'solarBeam' ||
    moveId === 'hyperBeam' ||
    moveId === 'triAttack' ||
    moveId === 'thunderShock' ||
    moveId === 'absorb' ||
    moveId === 'megaDrain'
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
  const gamepadCombatAimActive =
    !!playInputState.gamepadFieldLmbHeld ||
    !!playInputState.gamepadFieldRmbHeld ||
    !!playInputState.gamepadFieldMmbHeld ||
    !!playInputState.gamepadThrowHeld;
  const useFacingAim =
    forceFacingFieldAimOnce ||
    gamepadCombatAimActive ||
    leftCombatAimIgnoreMouse ||
    rightCombatAimIgnoreMouse ||
    middleCombatAimIgnoreMouse ||
    !playInputState.mouseValid;
  if (forceFacingFieldAimOnce) forceFacingFieldAimOnce = false;
  if (player?._strengthCarry) {
    const preferGamepadAim = playInputState.throwAimInputMode === 'gamepad';
    if (preferGamepadAim) {
      if (playInputState.gamepadAimActive) {
        const nx = Number(playInputState.gamepadAimNx) || 0;
        const ny = Number(playInputState.gamepadAimNy) || 1;
        const mag01 = Math.max(0, Math.min(1, Number(playInputState.gamepadAimMag01) || 0));
        // Stick controls throw distance: short nudge = short toss, full deflection = long throw.
        const throwDistTiles = 1.15 + 7.15 * mag01;
        return { sx, sy, tx: sx + nx * throwDistTiles, ty: sy + ny * throwDistTiles };
      }
      // Last aim came from joystick; keep throw aim independent from mouse drift.
      const { nx, ny } = getTackleDirUnitFromFacing(player);
      return { sx, sy, tx: sx + nx, ty: sy + ny };
    }
    if (playInputState.mouseValid) {
      return { tx: playInputState.mouseX, ty: playInputState.mouseY, sx, sy };
    }
  }
  if (useFacingAim) {
    const { nx, ny } = getTackleDirUnitFromFacing(player);
    return { sx, sy, tx: sx + nx, ty: sy + ny };
  }
  const wx = playInputState.mouseX;
  const wy = playInputState.mouseY;
  return { tx: wx, ty: wy, sx, sy };
}

/**
 * @param {boolean} modifierSnapshot
 * @param {boolean} [useMouseForMeleeAim] false when session started from gamepad Square without mouse down.
 */
function initLeftCombatPressFromPointerOrGamepad(modifierSnapshot, useMouseForMeleeAim = true) {
  leftCombatAimIgnoreMouse = !useMouseForMeleeAim;
  leftDownAt = performance.now();
  leftShiftAtDown = !!modifierSnapshot;
  playInputState.chargeLeft01 = 0;
  leftFlameStreamedThisPress = false;
  leftWaterStreamedThisPress = false;
  leftBubbleBeamStreamedThisPress = false;
  leftPrismaticStreamedThisPress = false;
  leftSteelBeamStreamedThisPress = false;
  leftWaterCannonStreamedThisPress = false;
  leftThundershockStreamedThisPress = false;
  leftAbsorbStreamedThisPress = false;
}

/**
 * @param {import('../player.js').player} pl
 * @param {object | null | undefined} data
 * @param {number} now
 */
function finalizeLeftCombatPointerOrGamepad(pl, data, now) {
  const dex = Math.floor(Number(pl?.dexId) || 0);
  const bind = dex >= 1 ? getPlayerInputBindings(dex) : getPlayerInputBindings(1);
  let sx;
  let sy;
  let tx;
  let ty;
  if (pl?._strengthCarry && leftCombatAimIgnoreMouse) {
    // Gamepad-originated throw: never fallback to stale mouse coordinates on release.
    const px = pl.visualX ?? pl.x;
    const py = pl.visualY ?? pl.y;
    sx = px + 0.5;
    sy = py + 0.5;
    if (playInputState.gamepadAimActive) {
      const nx = Number(playInputState.gamepadAimNx) || 0;
      const ny = Number(playInputState.gamepadAimNy) || 1;
      const mag01 = Math.max(0, Math.min(1, Number(playInputState.gamepadAimMag01) || 0));
      const throwDistTiles = 1.15 + 7.15 * mag01;
      tx = sx + nx * throwDistTiles;
      ty = sy + ny * throwDistTiles;
    } else {
      const { nx, ny } = getTackleDirUnitFromFacing(pl);
      tx = sx + nx;
      ty = sy + ny;
    }
  } else {
    ({ sx, sy, tx, ty } = aimAtCursor(pl));
  }
  const heldMs = now - leftDownAt;
  const charge01 = Math.max(0, Math.min(1, Number(playInputState.chargeLeft01) || 0));
  const threw = !!(pl._strengthCarry && data && beginStrengthThrowFromPointer(pl, data, tx, ty));
  if (threw) {
    triggerPlayerLmbAttack(pl, tx - sx, ty - sy);
  } else {
    finishMoveButtonUp(bind.lmb, pl, data, heldMs, charge01, 'l');
  }
  leftShiftAtDown = false;
  playInputState.chargeLeft01 = 0;
  leftCombatAimIgnoreMouse = false;
}

/**
 * @param {boolean} [useMouseForMeleeAim] false when session started from gamepad RT only.
 */
function initRightCombatPressFromGamepad(useMouseForMeleeAim = true) {
  rightCombatAimIgnoreMouse = !useMouseForMeleeAim;
  rightDownAt = performance.now();
  playInputState.chargeRight01 = 0;
  rightFlameStreamedThisPress = false;
  rightWaterStreamedThisPress = false;
  rightBubbleBeamStreamedThisPress = false;
  rightPrismaticStreamedThisPress = false;
  rightSteelBeamStreamedThisPress = false;
  rightWaterCannonStreamedThisPress = false;
  rightThundershockStreamedThisPress = false;
  rightAbsorbStreamedThisPress = false;
}

/**
 * @param {import('../player.js').player} pl
 * @param {object | null | undefined} data
 * @param {number} now
 */
function finalizeRightCombatPointerOrGamepad(pl, data, now) {
  const dex = Math.floor(Number(pl?.dexId) || 0);
  const bind = dex >= 1 ? getPlayerInputBindings(dex) : getPlayerInputBindings(1);
  const heldMs = now - rightDownAt;
  const charge01 = Math.max(0, Math.min(1, Number(playInputState.chargeRight01) || 0));
  finishMoveButtonUp(bind.rmb, pl, data, heldMs, charge01, 'r');
  playInputState.chargeRight01 = 0;
  rightCombatAimIgnoreMouse = false;
}

/**
 * @param {boolean} [useMouseForMeleeAim] false when session started from gamepad LT only.
 */
function initMiddleCombatPressFromGamepad(useMouseForMeleeAim = true) {
  middleCombatAimIgnoreMouse = !useMouseForMeleeAim;
  middleDownAt = performance.now();
  playInputState.chargeMmb01 = 0;
  middleFlameStreamedThisPress = false;
  middleWaterStreamedThisPress = false;
  middleBubbleBeamStreamedThisPress = false;
  middlePrismaticStreamedThisPress = false;
  middleSteelBeamStreamedThisPress = false;
  middleWaterCannonStreamedThisPress = false;
  middleThundershockStreamedThisPress = false;
  middleAbsorbStreamedThisPress = false;
}

/**
 * @param {import('../player.js').player} pl
 * @param {object | null | undefined} data
 * @param {number} now
 */
function finalizeMiddleCombatPointerOrGamepad(pl, data, now) {
  const dex = Math.floor(Number(pl?.dexId) || 0);
  const bind = dex >= 1 ? getPlayerInputBindings(dex) : getPlayerInputBindings(1);
  const heldMs = now - middleDownAt;
  const charge01 = Math.max(0, Math.min(1, Number(playInputState.chargeMmb01) || 0));
  finishMoveButtonUp(bind.mmb, pl, data, heldMs, charge01, 'm');
  playInputState.chargeMmb01 = 0;
  middleCombatAimIgnoreMouse = false;
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
  return moveId === 'tackle' || moveId === 'cut' || moveId === 'scratch' || moveId === 'psychoCut' || moveId === 'vineWhip';
}

function fieldMoveUsesChargeMeter(moveId) {
  return isMeleeTackleOrCut(moveId) || moveSupportsChargedRelease(moveId);
}

/**
 * @param {string} moveId
 * @returns {number}
 */
function chargeMaxLevelForMove(moveId) {
  return moveId === 'earthquake' ? 5 : 4;
}

/**
 * @param {string} moveId
 * @param {number} charge01
 * @returns {number}
 */
function chargeLevelForMove(moveId, charge01) {
  return moveId === 'earthquake' ? getEarthquakeChargeLevel(charge01) : getChargeLevel(charge01);
}

/**
 * Controller-only charge haptics:
 * - low repeating texture while charging
 * - distinct lock pulse when crossing a filled bar level
 * @param {'l'|'r'|'m'} slot
 * @param {boolean} active
 * @param {string} moveId
 * @param {number} charge01
 */
function tickGamepadChargeRumbleForSlot(slot, active, moveId, charge01) {
  if (!active || !fieldMoveUsesChargeMeter(moveId)) {
    gamepadChargeLevelBySlot[slot] = 0;
    return;
  }
  const p = Math.max(0, Math.min(1, Number(charge01) || 0));
  if (p <= 0.005) {
    gamepadChargeLevelBySlot[slot] = 0;
    return;
  }
  rumblePlayerGamepadChargeFlow(p);
  const level = chargeLevelForMove(moveId, p);
  const prev = Math.max(0, Math.floor(Number(gamepadChargeLevelBySlot[slot]) || 0));
  if (level > prev) {
    rumblePlayerGamepadChargeStepLock(level, chargeMaxLevelForMove(moveId));
  }
  gamepadChargeLevelBySlot[slot] = level;
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

/** One-shot: next `aimAtCursor` uses facing (gamepad wheel slots with no mouse aim). */
let forceFacingFieldAimOnce = false;

/**
 * Fire wheel-up / wheel-down bind from gamepad (L1+□ / L1+△) with facing-based aim.
 * @param {import('../player.js').player} pl
 * @param {object | null | undefined} data
 * @param {'up'|'down'} kind
 */
export function tryGamepadWheelBindCastFromFacing(pl, data, kind) {
  if (!pl || !data) return;
  if (dualBindWheel.isOpen || attackWheel.isOpen) return;
  const dex = Math.floor(Number(pl?.dexId) || 0);
  const bb = getPlayerInputBindings(dex >= 1 ? dex : 1);
  const moveId = kind === 'up' ? bb.wheelUp : bb.wheelDown;
  forceFacingFieldAimOnce = true;
  castScrollSlotMove(moveId, pl, data);
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
      playModerateSwordHitSfx(pl);
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
  const steel = which === 'l' ? leftSteelBeamStreamedThisPress : which === 'm' ? middleSteelBeamStreamedThisPress : rightSteelBeamStreamedThisPress;
  const waterCannon =
    which === 'l' ? leftWaterCannonStreamedThisPress : which === 'm' ? middleWaterCannonStreamedThisPress : rightWaterCannonStreamedThisPress;
  const tshock = which === 'l' ? leftThundershockStreamedThisPress : which === 'm' ? middleThundershockStreamedThisPress : rightThundershockStreamedThisPress;
  const absorb = which === 'l' ? leftAbsorbStreamedThisPress : which === 'm' ? middleAbsorbStreamedThisPress : rightAbsorbStreamedThisPress;

  if (moveId === 'flamethrower') {
    if (!flame) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'hydroPump') {
    if (!water) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerHydroPumpStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'waterGun') {
    applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
    if (heldMs < TAP_MS) {
      castWaterGunMove(sx, sy, tx, ty, pl);
    } else {
      castWaterGunCharged(sx, sy, tx, ty, pl, charge01 || 0);
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
  } else if (moveId === 'steelBeam') {
    if (!steel) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerSteelBeamStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'waterCannon') {
    if (!waterCannon) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerWaterCannonStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'thunderShock') {
    if (!tshock) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, pl);
    }
  } else if (moveId === 'absorb' || moveId === 'megaDrain') {
    if (!absorb) {
      applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
      tryCastPlayerAbsorbStreamPuff(sx, sy, tx, ty, pl, data);
    }
  } else if (moveId === 'psybeam') {
    applyPlayerFacingFromStreamAim(pl, sx, sy, tx, ty);
    tryReleasePlayerPsybeam(sx, sy, tx, ty, pl);
  } else if (heldMs < TAP_MS) {
    castMoveById(moveId, sx, sy, tx, ty, pl);
  } else {
    if (chargeLevel >= 3) {
      playModerateSwordHitSfx(pl);
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

  const gpLmb = !!playInputState.gamepadFieldLmbHeld;
  const gpRmb = !!playInputState.gamepadFieldRmbHeld;
  const gpMmb = !!playInputState.gamepadFieldMmbHeld;
  const gpThrow = !!playInputState.gamepadThrowHeld;
  const nowCombat = performance.now();
  const carryThrowMode = !!player._strengthCarry;
  const gpLeftActionHeld = carryThrowMode ? gpThrow : gpLmb;
  const prevGpLeftActionHeld = carryThrowMode ? prevGamepadThrowHeld : prevGamepadFieldLmbHeld;
  if (!gpLeftActionHeld && prevGpLeftActionHeld && !leftHeld) {
    finalizeLeftCombatPointerOrGamepad(player, data, nowCombat);
  }
  if (gpLeftActionHeld && !prevGpLeftActionHeld && !leftHeld) {
    initLeftCombatPressFromPointerOrGamepad(combatModifierHeld(), false);
  }
  if (!gpRmb && prevGamepadFieldRmbHeld && !rightHeld) {
    finalizeRightCombatPointerOrGamepad(player, data, nowCombat);
  }
  if (gpRmb && !prevGamepadFieldRmbHeld && !rightHeld) {
    initRightCombatPressFromGamepad(false);
  }
  if (!gpMmb && prevGamepadFieldMmbHeld && !middleHeld) {
    finalizeMiddleCombatPointerOrGamepad(player, data, nowCombat);
  }
  if (gpMmb && !prevGamepadFieldMmbHeld && !middleHeld) {
    initMiddleCombatPressFromGamepad(false);
  }

  const b = getBindingsOrDefault(player);
  const lmb = b.lmb;
  const rmb = b.rmb;
  const mmb = b.mmb;

  const virtLeft = leftHeld || gpLmb;
  const virtRight = rightHeld || gpRmb;
  const virtMiddle = middleHeld || gpMmb;

  playInputState.strengthCarryLmbAim = !!(
    player._strengthCarry &&
    !combatModifierHeld() &&
    (
      playInputState.throwAimInputMode === 'gamepad' ||
      playInputState.mouseValid ||
      playInputState.gamepadAimActive
    )
  );

  const mod = combatModifierHeld();

  if (virtLeft && !mod && !player._strengthCarry) {
    if (isMeleeTackleOrCut(lmb)) {
      const maxSec = Math.max(0.2, resolveFieldLmbChargeMaxSec(lmb));
      playInputState.chargeLeft01 = Math.min(1, (playInputState.chargeLeft01 || 0) + dt / maxSec);
    } else if (!isHoldStreamMoveId(lmb) && lmb !== 'psybeam') {
      playInputState.chargeLeft01 = Math.min(
        1,
        (playInputState.chargeLeft01 || 0) + dt / chargeMeterMaxSecForMove(lmb)
      );
    }
  } else {
    playInputState.chargeLeft01 = 0;
  }

  if (virtRight && !mod && !isHoldStreamMoveId(rmb) && rmb !== 'psybeam') {
    playInputState.chargeRight01 = Math.min(
      1,
      (playInputState.chargeRight01 || 0) + dt / chargeMeterMaxSecForMove(rmb)
    );
  }
  if (virtMiddle && !mod && !isHoldStreamMoveId(mmb) && mmb !== 'psybeam') {
    playInputState.chargeMmb01 = Math.min(
      1,
      (playInputState.chargeMmb01 || 0) + dt / chargeMeterMaxSecForMove(mmb)
    );
  }

  tickGamepadChargeRumbleForSlot(
    'l',
    gpLmb && !mod && !player._strengthCarry,
    lmb,
    playInputState.chargeLeft01 || 0
  );
  tickGamepadChargeRumbleForSlot('r', gpRmb && !mod, rmb, playInputState.chargeRight01 || 0);
  tickGamepadChargeRumbleForSlot('m', gpMmb && !mod, mmb, playInputState.chargeMmb01 || 0);

  if (virtLeft && !mod && lmb === 'psybeam') {
    if (!playInputState.psybeamLeftHold) playInputState.psybeamLeftHold = { pulse: 0 };
    playInputState.psybeamLeftHold.pulse += dt * 7.2;
  } else {
    playInputState.psybeamLeftHold = null;
  }
  if (virtRight && !mod && rmb === 'psybeam') {
    if (!playInputState.psybeamRightHold) playInputState.psybeamRightHold = { pulse: 0 };
    playInputState.psybeamRightHold.pulse += dt * 7.2;
  } else {
    playInputState.psybeamRightHold = null;
  }
  if (virtMiddle && !mod && mmb === 'psybeam') {
    if (!playInputState.psybeamMiddleHold) playInputState.psybeamMiddleHold = { pulse: 0 };
    playInputState.psybeamMiddleHold.pulse += dt * 7.2;
  } else {
    playInputState.psybeamMiddleHold = null;
  }

  const { sx, sy, tx, ty } = aimAtCursor(player);
  if (virtLeft && !mod && lmb === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) leftFlameStreamedThisPress = true;
  }
  if (virtLeft && !mod && lmb === 'fireSpin') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    tickFireSpinHold(player, dt, pushParticle, playInputState.chargeLeft01 || 0);
  }
  if (virtLeft && !mod && lmb === 'hydroPump') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerHydroPumpStreamPuff(sx, sy, tx, ty, player)) leftWaterStreamedThisPress = true;
  }
  if (virtLeft && !mod && (lmb === 'bubbleBeam' || lmb === 'surf')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerBubbleBeamStreamPuff(sx, sy, tx, ty, player)) leftBubbleBeamStreamedThisPress = true;
  }
  if (
    virtLeft &&
    !mod &&
    (lmb === 'prismaticLaser' ||
      lmb === 'solarBeam' ||
      lmb === 'hyperBeam' ||
      lmb === 'triAttack')
  ) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) leftPrismaticStreamedThisPress = true;
  }
  if (virtLeft && !mod && lmb === 'steelBeam') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerSteelBeamStreamPuff(sx, sy, tx, ty, player)) leftSteelBeamStreamedThisPress = true;
  }
  if (virtLeft && !mod && lmb === 'waterCannon') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerWaterCannonStreamPuff(sx, sy, tx, ty, player)) leftWaterCannonStreamedThisPress = true;
  }
  if (virtLeft && !mod && lmb === 'thunderShock') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, player)) leftThundershockStreamedThisPress = true;
  }
  if (virtLeft && !mod && (lmb === 'absorb' || lmb === 'megaDrain')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerAbsorbStreamPuff(sx, sy, tx, ty, player, data)) leftAbsorbStreamedThisPress = true;
  }

  if (virtRight && !mod && rmb === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) rightFlameStreamedThisPress = true;
  }
  if (virtRight && !mod && rmb === 'fireSpin') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    tickFireSpinHold(player, dt, pushParticle, playInputState.chargeRight01 || 0);
  }
  if (virtRight && !mod && rmb === 'hydroPump') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerHydroPumpStreamPuff(sx, sy, tx, ty, player)) rightWaterStreamedThisPress = true;
  }
  if (virtRight && !mod && (rmb === 'bubbleBeam' || rmb === 'surf')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerBubbleBeamStreamPuff(sx, sy, tx, ty, player)) rightBubbleBeamStreamedThisPress = true;
  }
  if (
    virtRight &&
    !mod &&
    (rmb === 'prismaticLaser' ||
      rmb === 'solarBeam' ||
      rmb === 'hyperBeam' ||
      rmb === 'triAttack')
  ) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) rightPrismaticStreamedThisPress = true;
  }
  if (virtRight && !mod && rmb === 'steelBeam') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerSteelBeamStreamPuff(sx, sy, tx, ty, player)) rightSteelBeamStreamedThisPress = true;
  }
  if (virtRight && !mod && rmb === 'waterCannon') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerWaterCannonStreamPuff(sx, sy, tx, ty, player)) rightWaterCannonStreamedThisPress = true;
  }
  if (virtRight && !mod && rmb === 'thunderShock') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, player)) rightThundershockStreamedThisPress = true;
  }
  if (virtRight && !mod && (rmb === 'absorb' || rmb === 'megaDrain')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerAbsorbStreamPuff(sx, sy, tx, ty, player, data)) rightAbsorbStreamedThisPress = true;
  }

  if (virtMiddle && !mod && mmb === 'flamethrower') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerFlamethrowerStreamPuff(sx, sy, tx, ty, player)) middleFlameStreamedThisPress = true;
  }
  if (virtMiddle && !mod && mmb === 'fireSpin') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    tickFireSpinHold(player, dt, pushParticle, playInputState.chargeMmb01 || 0);
  }
  if (virtMiddle && !mod && mmb === 'hydroPump') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerHydroPumpStreamPuff(sx, sy, tx, ty, player)) middleWaterStreamedThisPress = true;
  }
  if (virtMiddle && !mod && (mmb === 'bubbleBeam' || mmb === 'surf')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerBubbleBeamStreamPuff(sx, sy, tx, ty, player)) middleBubbleBeamStreamedThisPress = true;
  }
  if (
    virtMiddle &&
    !mod &&
    (mmb === 'prismaticLaser' ||
      mmb === 'solarBeam' ||
      mmb === 'hyperBeam' ||
      mmb === 'triAttack')
  ) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerPrismaticStreamPuff(sx, sy, tx, ty, player)) middlePrismaticStreamedThisPress = true;
  }
  if (virtMiddle && !mod && mmb === 'steelBeam') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerSteelBeamStreamPuff(sx, sy, tx, ty, player)) middleSteelBeamStreamedThisPress = true;
  }
  if (virtMiddle && !mod && mmb === 'waterCannon') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerWaterCannonStreamPuff(sx, sy, tx, ty, player)) middleWaterCannonStreamedThisPress = true;
  }
  if (virtMiddle && !mod && mmb === 'thunderShock') {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerThundershockStreamPuff(sx, sy, tx, ty, player)) middleThundershockStreamedThisPress = true;
  }
  if (virtMiddle && !mod && (mmb === 'absorb' || mmb === 'megaDrain')) {
    applyPlayerFacingFromStreamAim(player, sx, sy, tx, ty);
    if (tryCastPlayerAbsorbStreamPuff(sx, sy, tx, ty, player, data)) middleAbsorbStreamedThisPress = true;
  }

  const prismaticLaserStreamHeld =
    !!(virtLeft && !mod && lmb === 'prismaticLaser') ||
    !!(virtRight && !mod && rmb === 'prismaticLaser') ||
    !!(virtMiddle && !mod && mmb === 'prismaticLaser');
  updatePlayerPrismaticMergedBeamVisual(prismaticLaserStreamHeld, sx, sy, tx, ty, player);

  const steelBeamStreamHeld =
    !!(virtLeft && !mod && lmb === 'steelBeam') ||
    !!(virtRight && !mod && rmb === 'steelBeam') ||
    !!(virtMiddle && !mod && mmb === 'steelBeam');
  updatePlayerSteelBeamMergedBeamVisual(steelBeamStreamHeld, sx, sy, tx, ty, player);

  const waterCannonStreamHeld =
    !!(virtLeft && !mod && lmb === 'waterCannon') ||
    !!(virtRight && !mod && rmb === 'waterCannon') ||
    !!(virtMiddle && !mod && mmb === 'waterCannon');
  updatePlayerWaterCannonMergedBeamVisual(waterCannonStreamHeld, sx, sy, tx, ty, player);

  /** First held slot L→R→M with a charge-tiered field move (4-bar meter on canvas; Earthquake uses 5). */
  let fieldChargeUiActive = null;
  if (virtLeft && !mod && !player._strengthCarry) {
    const pL = Math.max(0, Math.min(1, Number(playInputState.chargeLeft01) || 0));
    if (fieldMoveUsesChargeMeter(lmb) && pL > 0.005) {
      fieldChargeUiActive = { moveId: lmb, charge01: pL, slot: 'l' };
    }
  }
  if (!fieldChargeUiActive && virtRight && !mod) {
    const pR = Math.max(0, Math.min(1, Number(playInputState.chargeRight01) || 0));
    if (fieldMoveUsesChargeMeter(rmb) && pR > 0.005) {
      fieldChargeUiActive = { moveId: rmb, charge01: pR, slot: 'r' };
    }
  }
  if (!fieldChargeUiActive && virtMiddle && !mod) {
    const pM = Math.max(0, Math.min(1, Number(playInputState.chargeMmb01) || 0));
    if (fieldMoveUsesChargeMeter(mmb) && pM > 0.005) {
      fieldChargeUiActive = { moveId: mmb, charge01: pM, slot: 'm' };
    }
  }
  playInputState.fieldChargeUiActive = fieldChargeUiActive;
  tickFieldChargeSegmentCompletionShine(player, fieldChargeUiActive);

  // Thunder charge preview: while a held button is bound to Thunder and the charge has
  // passed the first bar, broadcast a "charging storm cell" + ground-shadow at the live
  // cursor. The publisher gates on L2+ internally so Level 1 tap stays stealth.
  const thunderHolders = [
    { held: virtLeft && !mod && !player._strengthCarry, moveId: lmb, ownerId: 'lmb', charge01: playInputState.chargeLeft01 || 0 },
    { held: virtRight && !mod, moveId: rmb, ownerId: 'rmb', charge01: playInputState.chargeRight01 || 0 },
    { held: virtMiddle && !mod, moveId: mmb, ownerId: 'mmb', charge01: playInputState.chargeMmb01 || 0 }
  ];
  for (const { held, moveId, ownerId, charge01 } of thunderHolders) {
    if (held && moveIdIsThunder(moveId)) {
      publishThunderChargePreview(ownerId, { worldX: tx, worldY: ty, charge01 });
    } else {
      withdrawThunderChargePreview(ownerId);
    }
  }

  prevGamepadFieldLmbHeld = gpLmb;
  prevGamepadFieldRmbHeld = gpRmb;
  prevGamepadFieldMmbHeld = gpMmb;
  prevGamepadThrowHeld = gpThrow;
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
    const detail = ev instanceof CustomEvent ? ev.detail : null;
    applyAttackWheelMoveBind(getPlayer(), detail);
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
      playInputState.throwAimInputMode = 'mouse';
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
        if (!playInputState.gamepadFieldLmbHeld) {
          initLeftCombatPressFromPointerOrGamepad(sh, true);
        } else {
          leftShiftAtDown = sh;
          leftCombatAimIgnoreMouse = false;
        }
        canvas.setPointerCapture?.(e.pointerId);
      } else if (e.button === 2) {
        e.preventDefault();
        rightHeld = true;
        rightDownAt = performance.now();
        rightFlameStreamedThisPress = false;
        rightWaterStreamedThisPress = false;
        rightBubbleBeamStreamedThisPress = false;
        rightPrismaticStreamedThisPress = false;
        rightSteelBeamStreamedThisPress = false;
        rightWaterCannonStreamedThisPress = false;
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
        middleSteelBeamStreamedThisPress = false;
        middleWaterCannonStreamedThisPress = false;
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
      const dataUp = getCurrentData?.() ?? null;
      if (!playInputState.gamepadFieldLmbHeld) {
        finalizeLeftCombatPointerOrGamepad(pl, dataUp, now);
      }
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
    if (!playInputState.gamepadFieldLmbHeld) {
      playInputState.chargeLeft01 = 0;
      playInputState.psybeamLeftHold = null;
      leftCombatAimIgnoreMouse = false;
    }
    playInputState.chargeRight01 = 0;
    playInputState.chargeMmb01 = 0;
    playInputState.fieldChargeUiActive = null;
    playInputState.psybeamRightHold = null;
    playInputState.psybeamMiddleHold = null;
    playInputState.strengthCarryLmbAim = false;
    playInputState.mouseValid = false;
    invalidatePlayPointerHover();
    for (const ownerId of THUNDER_PREVIEW_OWNER_IDS) withdrawThunderChargePreview(ownerId);
    updatePlayerPrismaticMergedBeamVisual(false, 0, 0, 0, 0, null);
    updatePlayerSteelBeamMergedBeamVisual(false, 0, 0, 0, 0, null);
    updatePlayerWaterCannonMergedBeamVisual(false, 0, 0, 0, 0, null);
  });

  window.addEventListener('blur', () => {
    bindingWheelArmed = false;
    bindingWheelSlotIdx = -1;
    leftCombatAimIgnoreMouse = false;
    dismissAttackWheelIfOpen();
  });
}
