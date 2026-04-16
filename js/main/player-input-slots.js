import { getPokemonMoveset, getMoveLabel, PLAYER_SPECIAL_WHEEL_MOVE_IDS } from '../moves/pokemon-moveset-config.js';

/** @typedef {'lmb'|'rmb'|'mmb'|'wheelUp'|'wheelDown'} PlayerInputSlotId */

export const INPUT_SLOT_IDS = /** @type {const PlayerInputSlotId[]} */ ([
  'lmb',
  'rmb',
  'mmb',
  'wheelUp',
  'wheelDown'
]);

export const INPUT_SLOT_DIGIT_CODES = /** @type {const string[]} */ ([
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5'
]);

/** Every move selectable in play (field melee + full special list). */
export const PLAYER_BINDABLE_MOVE_IDS = Object.freeze(
  /** @type {string[]} */ (['tackle', 'cut', ...PLAYER_SPECIAL_WHEEL_MOVE_IDS])
);

const STORAGE_KEY_V2 = 'pkmn_player_input_slots_v2';
const LEGACY_FIELD_KEY = 'pkmn_field_skill_by_dex';
const LEGACY_SPECIAL_KEY = 'pkmn_special_attack_by_dex';

/** @type {Record<string, Record<PlayerInputSlotId, string>>} */
let byDexStr = {};
let loadDone = false;

/**
 * @param {string} moveId
 */
export function normalizeBindableMoveId(moveId) {
  const m = String(moveId || '');
  return PLAYER_BINDABLE_MOVE_IDS.includes(m) ? m : 'tackle';
}

/**
 * @param {number} dexId
 * @returns {Record<PlayerInputSlotId, string>}
 */
function defaultBindingsForDex(dexId) {
  const dex = Math.floor(Number(dexId) || 0);
  const moves = getPokemonMoveset(dex >= 1 ? dex : 1);
  const pick = (idx, fallback) => {
    const cand = moves[idx];
    return cand && PLAYER_BINDABLE_MOVE_IDS.includes(cand) ? cand : fallback;
  };
  return {
    lmb: 'tackle',
    rmb: normalizeBindableMoveId(pick(0, 'ember')),
    mmb: 'ultimate',
    wheelUp: normalizeBindableMoveId(pick(1, 'confusion')),
    wheelDown: normalizeBindableMoveId(pick(2, 'bubble'))
  };
}

/**
 * @param {Record<PlayerInputSlotId, string>} row
 * @param {number} dex
 */
function migrateFromLegacyInto(row, dex) {
  try {
    const fieldRaw = localStorage.getItem(LEGACY_FIELD_KEY);
    const specRaw = localStorage.getItem(LEGACY_SPECIAL_KEY);
    const fieldParsed = fieldRaw ? JSON.parse(fieldRaw) : null;
    const specParsed = specRaw ? JSON.parse(specRaw) : null;
    const dKey = String(dex);
    const fieldSkill = fieldParsed?.[dKey];
    const special = specParsed?.[dKey];
    if (fieldSkill === 'cut' || fieldSkill === 'tackle') row.lmb = fieldSkill;
    if (special && PLAYER_BINDABLE_MOVE_IDS.includes(String(special))) row.rmb = String(special);
  } catch {
    // ignore
  }
}

function saveAll() {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(byDexStr));
  } catch {
    // ignore
  }
}

function loadAll() {
  if (loadDone) return;
  loadDone = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') byDexStr = /** @type {typeof byDexStr} */ (parsed);
    }
  } catch {
    byDexStr = {};
  }
  let wrote = false;
  for (let dex = 1; dex <= 151; dex++) {
    const dKey = String(dex);
    if (byDexStr[dKey]) continue;
    const row = defaultBindingsForDex(dex);
    migrateFromLegacyInto(row, dex);
    byDexStr[dKey] = row;
    wrote = true;
  }
  if (wrote) saveAll();
}

/**
 * @param {string} code
 */
export function digitToBindingSlotIndex(code) {
  return INPUT_SLOT_DIGIT_CODES.indexOf(/** @type {any} */ (code));
}

/**
 * @param {number} slotIdx
 * @returns {PlayerInputSlotId}
 */
export function getInputSlotId(slotIdx) {
  return INPUT_SLOT_IDS[slotIdx] || 'lmb';
}

/**
 * @param {number} dexId
 * @returns {Record<PlayerInputSlotId, string>}
 */
export function getPlayerInputBindings(dexId) {
  loadAll();
  const dex = Math.floor(Number(dexId) || 0);
  if (dex < 1 || dex > 151) {
    const d = defaultBindingsForDex(1);
    return { ...d };
  }
  const dKey = String(dex);
  let row = byDexStr[dKey];
  if (!row || typeof row !== 'object') {
    row = defaultBindingsForDex(dex);
    migrateFromLegacyInto(row, dex);
    byDexStr[dKey] = row;
    saveAll();
  } else {
    const def = defaultBindingsForDex(dex);
    let patched = false;
    for (const sid of INPUT_SLOT_IDS) {
      const v = row[sid];
      if (!v || !PLAYER_BINDABLE_MOVE_IDS.includes(String(v))) {
        row[sid] = def[sid];
        patched = true;
      }
    }
    if (patched) saveAll();
  }
  return {
    lmb: normalizeBindableMoveId(row.lmb),
    rmb: normalizeBindableMoveId(row.rmb),
    mmb: normalizeBindableMoveId(row.mmb),
    wheelUp: normalizeBindableMoveId(row.wheelUp),
    wheelDown: normalizeBindableMoveId(row.wheelDown)
  };
}

/**
 * @param {number} dexId
 * @param {number} slotIdx 0..4
 * @param {string} moveId
 */
export function setPlayerInputBinding(dexId, slotIdx, moveId) {
  loadAll();
  const dex = Math.floor(Number(dexId) || 0);
  if (dex < 1 || dex > 151) return;
  const slot = INPUT_SLOT_IDS[slotIdx];
  if (!slot) return;
  const dKey = String(dex);
  if (!byDexStr[dKey]) byDexStr[dKey] = defaultBindingsForDex(dex);
  byDexStr[dKey][slot] = normalizeBindableMoveId(moveId);
  saveAll();
}

/**
 * @param {string} moveId
 */
export function getBindableMoveLabel(moveId) {
  if (moveId === 'tackle') return 'Tackle';
  if (moveId === 'cut') return 'Cut';
  return getMoveLabel(moveId);
}

/**
 * @param {number} slotIdx
 */
export function slotIndexToUiHotkey(slotIdx) {
  const keys = ['LMB', 'RMB', 'MMB', 'Wheel↑', 'Wheel↓'];
  return keys[slotIdx] || `Slot${slotIdx}`;
}

/**
 * @param {number} dexId
 */
export function dispatchPlayerInputBindingsChanged(dexId) {
  window.dispatchEvent(
    new CustomEvent('play-player-input-bindings-change', {
      detail: { dexId: Math.floor(Number(dexId) || 0) }
    })
  );
}
