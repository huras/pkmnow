/**
 * Play-session autosave / resume (localStorage).
 * Extend {@link PlaySessionSaveV1} with new optional blocks; bump {@link PLAY_SESSION_SAVE_VERSION} when breaking shape.
 */
import { MACRO_TILE_STRIDE } from '../chunking.js';
import {
  getCollectedDetailInventorySnapshot,
  restoreCollectedDetailInventoryFromSnapshot
} from './play-crystal-drops.js';
import { applyPlayerWorldResumePosition } from '../player.js';
import { flashPlaySessionSaveIndicator } from './play-save-indicator-ui.js';

export const PLAY_SESSION_SAVE_VERSION = 1;
const STORAGE_KEY = 'pkmn_play_session_save_v1';

/** @typedef {{ itemKey: string, count: number }} PlaySessionInventoryRow */

/**
 * @typedef {Object} PlaySessionSaveV1
 * @property {number} version
 * @property {string} mapFingerprint — ties save to a specific generated map instance.
 * @property {number} savedAtWallSec — `performance.now() * 0.001` when written.
 * @property {{ x: number, y: number, z?: number }} player
 * @property {{ rows: PlaySessionInventoryRow[] }} inventory
 */

/** First autosave after entering play (seconds). */
const AUTOSAVE_FIRST_DELAY_SEC = 10;
/** Subsequent autosave interval (seconds). */
const AUTOSAVE_INTERVAL_SEC = 30;

let nextAutosaveWallSec = 0;

function wallSecNow() {
  return performance.now() * 0.001;
}

/**
 * @param {object | null | undefined} data
 * @returns {string | null}
 */
export function buildPlayMapFingerprint(data) {
  if (!data) return null;
  const w = data.width | 0;
  const h = data.height | 0;
  const seed = data.seed != null ? Number(data.seed) : 0;
  if (!Number.isFinite(seed)) return `${w}x${h}@0`;
  return `${w}x${h}@${(seed >>> 0).toString(36)}`;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {object} data
 */
function clampPlayerXYToMap(x, y, data) {
  const gw = data.width * MACRO_TILE_STRIDE;
  const gh = data.height * MACRO_TILE_STRIDE;
  const m = 0.51;
  return {
    x: Math.min(gw - m, Math.max(m, x)),
    y: Math.min(gh - m, Math.max(m, y))
  };
}

/**
 * @returns {PlaySessionSaveV1 | null}
 */
function readSaveFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.version !== PLAY_SESSION_SAVE_VERSION) return null;
    const fp = typeof o.mapFingerprint === 'string' ? o.mapFingerprint : '';
    if (!fp) return null;
    return o;
  } catch {
    return null;
  }
}

/**
 * @param {PlaySessionSaveV1} payload
 */
function writeSaveToStorage(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[play-session-persist] write failed', e);
  }
}

/**
 * @param {object | null | undefined} data
 * @returns {PlaySessionSaveV1 | null}
 */
export function peekPlaySessionSaveForMap(data) {
  if (!data) return null;
  const curFp = buildPlayMapFingerprint(data);
  const saved = readSaveFromStorage();
  if (!saved || saved.mapFingerprint !== curFp) return null;
  return saved;
}

/**
 * Macro tile (map click space) that contains the saved player position.
 * @param {PlaySessionSaveV1} saved
 * @param {object} data
 * @returns {{ gx: number, gy: number } | null}
 */
export function getPlayResumeMacroTileFromSave(saved, data) {
  if (!saved || !data) return null;
  const px = Number(saved.player?.x);
  const py = Number(saved.player?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const gx = Math.max(0, Math.min(data.width - 1, Math.floor(px / MACRO_TILE_STRIDE)));
  const gy = Math.max(0, Math.min(data.height - 1, Math.floor(py / MACRO_TILE_STRIDE)));
  return { gx, gy };
}

/**
 * After `setPlayerPos` (or equivalent), optionally restore session fields from localStorage.
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @param {{ position?: boolean, inventory?: boolean }} [opts] — map click should use `{ position: false, inventory: true }`; cold resume `{ position: true, inventory: true }`.
 * @returns {boolean} true if anything was applied (HUD may need refresh).
 */
export function tryApplyPlaySessionResumeOnEnter(data, playerRef, opts = {}) {
  const applyInventory = opts.inventory !== false;
  const applyPosition = opts.position === true;
  if (!data || !playerRef) return false;
  if (!applyInventory && !applyPosition) return false;

  const saved = peekPlaySessionSaveForMap(data);
  if (!saved) return false;

  let did = false;
  if (applyInventory) {
    restoreCollectedDetailInventoryFromSnapshot(saved.inventory?.rows);
    did = true;
  }
  if (applyPosition) {
    const px = Number(saved.player?.x);
    const py = Number(saved.player?.y);
    const pz = Number(saved.player?.z);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return did;
    const { x, y } = clampPlayerXYToMap(px, py, data);
    const z = Number.isFinite(pz) && pz > 0 ? Math.min(pz, 1e6) : 0;
    applyPlayerWorldResumePosition(x, y, z);
    did = true;
  }
  return did;
}

/**
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @returns {PlaySessionSaveV1}
 */
export function buildPlaySessionSavePayload(data, playerRef) {
  const mapFingerprint = buildPlayMapFingerprint(data) || '';
  const rows = getCollectedDetailInventorySnapshot();
  return {
    version: PLAY_SESSION_SAVE_VERSION,
    mapFingerprint,
    savedAtWallSec: wallSecNow(),
    player: {
      x: Number(playerRef?.x) || 0,
      y: Number(playerRef?.y) || 0,
      z: Math.max(0, Number(playerRef?.z) || 0)
    },
    inventory: { rows }
  };
}

/**
 * Persists current play session (position + inventory + map id).
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 */
export function flushPlaySessionSave(data, playerRef) {
  if (!data || !playerRef) return;
  const fp = buildPlayMapFingerprint(data);
  if (!fp) return;
  flashPlaySessionSaveIndicator();
  const p = buildPlaySessionSavePayload(data, playerRef);
  writeSaveToStorage(p);
}

/**
 * Resets the wall-clock autosave schedule (first fire at +10s, then every +30s).
 */
export function resetPlayAutosaveSchedule() {
  const t = wallSecNow();
  nextAutosaveWallSec = t + AUTOSAVE_FIRST_DELAY_SEC;
}

/**
 * @param {number} wallSec — same clock as {@link wallSecNow}
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 */
export function tickPlaySessionAutosave(wallSec, data, playerRef) {
  if (!data || !playerRef) return;
  if (!Number.isFinite(wallSec) || nextAutosaveWallSec <= 0) return;
  if (wallSec < nextAutosaveWallSec) return;
  flushPlaySessionSave(data, playerRef);
  nextAutosaveWallSec = wallSec + AUTOSAVE_INTERVAL_SEC;
}
