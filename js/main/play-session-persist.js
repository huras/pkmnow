/**
 * Play-session autosave / resume (localStorage).
 * Extend {@link PlaySessionSaveV2} with new optional blocks; bump {@link PLAY_SESSION_SAVE_VERSION} when breaking shape.
 */
import { MACRO_TILE_STRIDE } from '../chunking.js';
import {
  getCollectedDetailInventorySnapshot,
  restoreCollectedDetailInventoryFromSnapshot
} from './play-crystal-drops.js';
import { applyPlayerWorldResumePosition } from '../player.js';
import { flashPlaySessionSaveIndicator } from './play-save-indicator-ui.js';
import { getWeatherTarget } from './weather-system.js';
import { getEarthquakeActiveIntensity01 } from './earthquake-layer.js';
import { isWeatherPreset } from './weather-presets.js';
import { wrapHours } from './world-time-of-day.js';

export const PLAY_SESSION_SAVE_VERSION = 2;
const STORAGE_KEY = 'pkmn_play_session_save_v1';

/** @typedef {{ itemKey: string, count: number }} PlaySessionInventoryRow */

/**
 * @typedef {Object} PlaySessionSaveV2
 * @property {number} version
 * @property {string} mapFingerprint — ties save to a specific generated map instance.
 * @property {number} savedAtWallSec — `performance.now() * 0.001` when written.
 * @property {{ x: number, y: number, z?: number }} player
 * @property {{ rows: PlaySessionInventoryRow[] }} inventory
 * @property {number} [worldHours] — [0,24) day clock
 * @property {import('./weather-presets.js').WeatherPresetId} [weatherPreset]
 * @property {number} [weatherIntensity01]
 * @property {number} [weatherCloudIntensity01]
 * @property {number} [weatherPrecipIntensity01]
 * @property {number} [earthquakeIntensity01]
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
 * @returns {PlaySessionSaveV2 | null}
 */
function readSaveFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || (o.version !== 1 && o.version !== 2)) return null;
    const fp = typeof o.mapFingerprint === 'string' ? o.mapFingerprint : '';
    if (!fp) return null;
    return o;
  } catch {
    return null;
  }
}

/**
 * @param {PlaySessionSaveV2} payload
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
 * @returns {PlaySessionSaveV2 | null}
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
 * @param {PlaySessionSaveV2} saved
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
 * Micro-tile position to draw on the global region map (map mode), or null.
 * Prefers persisted save for this fingerprint; otherwise in-map live `player` after play this session.
 *
 * @param {object | null | undefined} data
 * @param {import('../player.js').player | null | undefined} playerRef
 * @param {'map' | 'play'} appMode
 * @param {{ sessionEnteredPlayOnCurrentMap?: boolean }} [opts]
 * @returns {{ x: number, y: number } | null}
 */
export function resolveMapGlobalPlayerMicroForMarker(data, playerRef, appMode, opts = {}) {
  if (!data || !playerRef) return null;
  const saved = peekPlaySessionSaveForMap(data);
  if (saved) {
    const px = Number(saved.player?.x);
    const py = Number(saved.player?.y);
    if (Number.isFinite(px) && Number.isFinite(py)) return clampPlayerXYToMap(px, py, data);
  }
  if (appMode === 'map' && opts.sessionEnteredPlayOnCurrentMap) {
    const px = Number(playerRef.visualX ?? playerRef.x);
    const py = Number(playerRef.visualY ?? playerRef.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const gw = data.width * MACRO_TILE_STRIDE;
    const gh = data.height * MACRO_TILE_STRIDE;
    if (px < 0 || py < 0 || px > gw || py > gh) return null;
    return clampPlayerXYToMap(px, py, data);
  }
  return null;
}

/**
 * @param {PlaySessionSaveV2 | null | undefined} saved
 * @returns {import('./weather-presets.js').WeatherPresetId | null}
 */
function readSavedWeatherPreset(saved) {
  const p = saved?.weatherPreset;
  return isWeatherPreset(p) ? p : null;
}

/**
 * Weather + clock block for cold resume (v2+).
 * @param {PlaySessionSaveV2 | null | undefined} saved
 * @returns {{ worldHours: number, weatherPreset: import('./weather-presets.js').WeatherPresetId, weatherIntensity01: number, weatherCloudIntensity01: number, weatherPrecipIntensity01: number, earthquakeIntensity01: number } | null}
 */
export function extractPlaySessionEnvironmentForRestore(saved) {
  if (!saved || saved.version < 2) return null;
  const preset = readSavedWeatherPreset(saved);
  if (!preset) return null;
  const whRaw = Number(saved.worldHours);
  const worldHours = Number.isFinite(whRaw) ? wrapHours(whRaw) : 12;
  const legacyRaw = Number(saved.weatherIntensity01);
  const legacy = Number.isFinite(legacyRaw) ? Math.max(0, Math.min(1, legacyRaw)) : 1;
  const wcRaw = Number(saved.weatherCloudIntensity01);
  const wpRaw = Number(saved.weatherPrecipIntensity01);
  const weatherCloudIntensity01 = Number.isFinite(wcRaw) ? Math.max(0, Math.min(1, wcRaw)) : legacy;
  const weatherPrecipIntensity01 = Number.isFinite(wpRaw) ? Math.max(0, Math.min(1, wpRaw)) : legacy;
  const eq = Number(saved.earthquakeIntensity01);
  const earthquakeIntensity01 = Number.isFinite(eq) ? Math.max(0, Math.min(1, eq)) : 0;
  return {
    worldHours,
    weatherPreset: preset,
    weatherIntensity01: legacy,
    weatherCloudIntensity01,
    weatherPrecipIntensity01,
    earthquakeIntensity01
  };
}

/**
 * After `setPlayerPos` (or equivalent), optionally restore session fields from localStorage.
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @param {{
 *   position?: boolean,
 *   inventory?: boolean,
 *   applyEnvironmentFromSave?: boolean,
 *   onRestoreEnvironment?: (env: ReturnType<typeof extractPlaySessionEnvironmentForRestore>) => void
 * }} [opts] — map click should use `{ position: false, inventory: true }`; cold resume `{ position: true, inventory: true, applyEnvironmentFromSave: true, onRestoreEnvironment }`.
 * @returns {boolean} true if anything was applied (HUD may need refresh).
 */
export function tryApplyPlaySessionResumeOnEnter(data, playerRef, opts = {}) {
  const applyInventory = opts.inventory !== false;
  const applyPosition = opts.position === true;
  const applyEnv = opts.applyEnvironmentFromSave === true && typeof opts.onRestoreEnvironment === 'function';
  if (!data || !playerRef) return false;
  if (!applyInventory && !applyPosition && !applyEnv) return false;

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
    if (Number.isFinite(px) && Number.isFinite(py)) {
      const { x, y } = clampPlayerXYToMap(px, py, data);
      const z = Number.isFinite(pz) && pz > 0 ? Math.min(pz, 1e6) : 0;
      applyPlayerWorldResumePosition(x, y, z);
      did = true;
    }
  }
  if (applyEnv) {
    const env = extractPlaySessionEnvironmentForRestore(saved);
    if (env) {
      opts.onRestoreEnvironment(env);
      did = true;
    }
  }
  return did;
}

/**
 * @typedef {{ worldHours: number, weatherPreset: import('./weather-presets.js').WeatherPresetId, weatherIntensity01?: number, weatherCloudIntensity01?: number, weatherPrecipIntensity01?: number, earthquakeIntensity01: number }} PlaySessionPersistExtra
 */

/**
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @param {PlaySessionPersistExtra | null | undefined} persistExtra
 * @returns {PlaySessionSaveV2}
 */
export function buildPlaySessionSavePayload(data, playerRef, persistExtra = null) {
  const mapFingerprint = buildPlayMapFingerprint(data) || '';
  const rows = getCollectedDetailInventorySnapshot();
  const wt = getWeatherTarget();
  /** @type {PlaySessionSaveV2} */
  const out = {
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
  const whSrc = persistExtra != null ? Number(persistExtra.worldHours) : NaN;
  if (Number.isFinite(whSrc)) {
    out.worldHours = wrapHours(whSrc);
  }
  const presetCandidate = persistExtra?.weatherPreset ?? wt.preset;
  if (isWeatherPreset(presetCandidate)) {
    out.weatherPreset = presetCandidate;
  } else {
    out.weatherPreset = wt.preset;
  }
  const legacyW = Number(persistExtra?.weatherIntensity01);
  const legacyOk = Number.isFinite(legacyW);
  const wcRaw = Number(persistExtra?.weatherCloudIntensity01);
  const wpRaw = Number(persistExtra?.weatherPrecipIntensity01);
  const wcSrc = Number.isFinite(wcRaw)
    ? wcRaw
    : legacyOk
      ? legacyW
      : Number(wt.cloudIntensity01);
  const wpSrc = Number.isFinite(wpRaw)
    ? wpRaw
    : legacyOk
      ? legacyW
      : Number(wt.precipIntensity01);
  const weatherCloudIntensity01 = Number.isFinite(wcSrc) ? Math.max(0, Math.min(1, wcSrc)) : 1;
  const weatherPrecipIntensity01 = Number.isFinite(wpSrc) ? Math.max(0, Math.min(1, wpSrc)) : 1;
  out.weatherCloudIntensity01 = weatherCloudIntensity01;
  out.weatherPrecipIntensity01 = weatherPrecipIntensity01;
  const wiLegacy = Number(persistExtra?.weatherIntensity01 ?? weatherPrecipIntensity01);
  out.weatherIntensity01 = Number.isFinite(wiLegacy) ? Math.max(0, Math.min(1, wiLegacy)) : 1;
  const eq = Number(persistExtra?.earthquakeIntensity01 ?? getEarthquakeActiveIntensity01());
  out.earthquakeIntensity01 = Number.isFinite(eq) ? Math.max(0, Math.min(1, eq)) : 0;
  return out;
}

/**
 * Persists current play session (position + inventory + map id + optional clock/weather).
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @param {PlaySessionPersistExtra | null} [persistExtra] — when null, still stores weather from engine + NaN worldHours skipped in payload.
 */
export function flushPlaySessionSave(data, playerRef, persistExtra = null) {
  if (!data || !playerRef) return;
  const fp = buildPlayMapFingerprint(data);
  if (!fp) return;
  flashPlaySessionSaveIndicator();
  const p = buildPlaySessionSavePayload(data, playerRef, persistExtra);
  writeSaveToStorage(p);
}

/** Removes the persisted play snapshot from localStorage (next resume for this map will be empty). */
export function clearPlaySessionSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[play-session-persist] clear failed', e);
  }
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
 * @param {PlaySessionPersistExtra | null} [persistExtra]
 */
export function tickPlaySessionAutosave(wallSec, data, playerRef, persistExtra = null) {
  if (!data || !playerRef) return;
  if (!Number.isFinite(wallSec) || nextAutosaveWallSec <= 0) return;
  if (wallSec < nextAutosaveWallSec) return;
  flushPlaySessionSave(data, playerRef, persistExtra);
  nextAutosaveWallSec = wallSec + AUTOSAVE_INTERVAL_SEC;
}
