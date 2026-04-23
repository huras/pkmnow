/**
 * Play-session autosave / resume (localStorage).
 * Extend {@link PlaySessionSaveV2} with new optional blocks; bump {@link PLAY_SESSION_SAVE_VERSION} when breaking shape.
 */
import LZString from '../vendor/lz-string.mjs';
import { MACRO_TILE_STRIDE } from '../chunking.js';
import {
  getCollectedDetailInventorySnapshot,
  restoreCollectedDetailInventoryFromSnapshot
} from './play-crystal-drops.js';
import { applyPlayerWorldResumePosition } from '../player.js';
import { flashPlaySessionSaveIndicator } from './play-save-indicator-ui.js';
import { getWeatherTarget } from './weather-system.js';
import { getEarthquakeActiveIntensity01 } from './earthquake-layer.js';
import { getSunLightRaysTargetIntensity01 } from './sun-light-rays-layer.js';
import { isWeatherPreset } from './weather-presets.js';
import { wrapHours } from './world-time-of-day.js';
import { getFogDiscoveredSnapshot, restoreFogDiscoveredFromSnapshot } from './play-vision-fog.js';
import {
  getFaintedPokemonSnapshot,
  restoreFaintedPokemonFromSnapshot
} from '../wild-pokemon/wild-pokemon-persistence.js';
import { getCryIdentifiedDexIdsSnapshot } from '../wild-pokemon/cry-identification-progress.js';

export const PLAY_SESSION_SAVE_VERSION = 2;
const STORAGE_KEY = 'pkmn_play_session_save_v1';
/** Prefix on localStorage value: LZ-String UTF-16 payload after JSON.stringify. Legacy entries are raw JSON (start with `{`). */
const STORAGE_LZ_PREFIX = 'pkmn_lz1:';

/** @type {Worker | null} */
let packWorker = null;
let packWorkerJobSeq = 0;
/** @type {Map<number, { resolve: (s: string) => void, reject: (e: Error) => void }>} */
const packWorkerPending = new Map();
/** Serializes browser writes so overlapping flush/import do not interleave badly. */
let persistWriteTail = Promise.resolve();
/** Incremented on {@link clearPlaySessionSave} so async writes started earlier do not call `setItem` after clear. */
let persistEpoch = 0;

/** @typedef {{ itemKey: string, count: number }} PlaySessionInventoryRow */

/**
 * @typedef {Object} PlaySessionSaveV2
 * @property {number} version
 * @property {string} mapFingerprint — ties save to map instance: `WxH@seed36+macroStride` (see {@link buildPlayMapFingerprint}).
 * @property {number} savedAtWallSec — `performance.now() * 0.001` when written.
 * @property {{ x: number, y: number, z?: number }} player
 * @property {{ rows: PlaySessionInventoryRow[] }} inventory
 * @property {number} [worldHours] — [0,24) day clock
 * @property {number} [playSessionSeconds] — accumulated in-play elapsed time (seconds)
 * @property {import('./weather-presets.js').WeatherPresetId} [weatherPreset]
 * @property {number} [weatherIntensity01]
 * @property {number} [weatherCloudIntensity01]
 * @property {number} [weatherPrecipIntensity01]
 * @property {number} [earthquakeIntensity01]
 * @property {number} [sunLightRaysIntensity01]
 * @property {boolean} [moonlightEnabled]
 * @property {number[]} [cryIdentifiedDexIds] — national dex ids that passed the Far Cry listen / ID minigame
 */

/** First autosave after entering play (seconds). */
const AUTOSAVE_FIRST_DELAY_SEC = 10;
/** Subsequent autosave interval (seconds). */
const AUTOSAVE_INTERVAL_SEC = 30;

let nextAutosaveWallSec = 0;
let autosaveFlushScheduled = false;
let autosaveFlushHandle = 0;
let queuedAutosavePayloadArgs = null;
let autosaveFlushRunning = false;
let autosaveFlushNeedsReplay = false;

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
  const stride = MACRO_TILE_STRIDE >>> 0;
  if (!Number.isFinite(seed)) return `${w}x${h}@0+${stride}`;
  return `${w}x${h}@${(seed >>> 0).toString(36)}+${stride}`;
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
 * @param {unknown} o
 * @returns {PlaySessionSaveV2 | null}
 */
function parseValidatedSaveObject(o) {
  if (!o || typeof o !== 'object') return null;
  const v = /** @type {{ version?: unknown, mapFingerprint?: unknown }} */ (o);
  if (v.version !== 1 && v.version !== 2) return null;
  const fp = typeof v.mapFingerprint === 'string' ? v.mapFingerprint : '';
  if (!fp) return null;
  return /** @type {PlaySessionSaveV2} */ (o);
}

/**
 * @returns {PlaySessionSaveV2 | null}
 */
function readSaveFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    let o;
    if (raw.startsWith(STORAGE_LZ_PREFIX)) {
      const json = LZString.decompressFromUTF16(raw.slice(STORAGE_LZ_PREFIX.length));
      if (json == null || json === '') return null;
      o = JSON.parse(json);
    } else {
      o = JSON.parse(raw);
    }
    return parseValidatedSaveObject(o);
  } catch {
    return null;
  }
}

/**
 * @param {PlaySessionSaveV2} p
 * @returns {PlaySessionSaveV2}
 */
function stripFogDiscovered(p) {
  const { fogDiscovered: _f, ...rest } = p;
  return /** @type {PlaySessionSaveV2} */ (rest);
}

/**
 * @param {PlaySessionSaveV2} p
 * @returns {PlaySessionSaveV2}
 */
function stripFogAndFainted(p) {
  const { fogDiscovered: _f, faintedWildPokemon: _fa, ...rest } = p;
  return /** @type {PlaySessionSaveV2} */ (rest);
}

/**
 * Smallest resume payload: position, inventory, clock/weather, cry ID progress — no fog / fainted keys.
 * @param {PlaySessionSaveV2} p
 * @returns {PlaySessionSaveV2}
 */
function minimalPersistSnapshot(p) {
  return /** @type {PlaySessionSaveV2} */ ({
    version: p.version,
    mapFingerprint: p.mapFingerprint,
    savedAtWallSec: p.savedAtWallSec,
    player: p.player,
    inventory: p.inventory,
    worldHours: p.worldHours,
    playSessionSeconds: p.playSessionSeconds,
    weatherPreset: p.weatherPreset,
    weatherIntensity01: p.weatherIntensity01,
    weatherCloudIntensity01: p.weatherCloudIntensity01,
    weatherPrecipIntensity01: p.weatherPrecipIntensity01,
    earthquakeIntensity01: p.earthquakeIntensity01,
    sunLightRaysIntensity01: p.sunLightRaysIntensity01,
    moonlightEnabled: p.moonlightEnabled,
    cryIdentifiedDexIds: p.cryIdentifiedDexIds
  });
}

function failAllPackWorkerJobs(reason) {
  for (const [, pr] of packWorkerPending) {
    pr.reject(new Error(reason));
  }
  packWorkerPending.clear();
}

function terminatePackWorker() {
  if (packWorker) {
    try {
      packWorker.terminate();
    } catch {
      /* ignore */
    }
    packWorker = null;
  }
  failAllPackWorkerJobs('pack worker terminated');
}

function ensurePackWorker() {
  if (packWorker) return packWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    const url = new URL('./play-session-storage-worker.mjs', import.meta.url);
    const w = new Worker(url, { type: 'module' });
    w.onmessage = (ev) => {
      const d = ev.data;
      if (!d || d.cmd !== 'packed') return;
      const pending = packWorkerPending.get(d.id);
      if (!pending) return;
      packWorkerPending.delete(d.id);
      if (d.error) pending.reject(new Error(d.error));
      else pending.resolve(d.packed);
    };
    w.onerror = (ev) => {
      console.warn('[play-session-persist] pack worker load/runtime error', ev.message || ev);
      terminatePackWorker();
    };
    packWorker = w;
  } catch (e) {
    console.warn('[play-session-persist] pack worker unavailable, using main-thread pack', e);
    packWorker = null;
  }
  return packWorker;
}

/**
 * @param {PlaySessionSaveV2} payload
 * @returns {string}
 */
function packPlaySessionSync(payload) {
  const json = JSON.stringify(payload);
  return STORAGE_LZ_PREFIX + LZString.compressToUTF16(json);
}

/**
 * @param {PlaySessionSaveV2} payload
 * @returns {Promise<string>}
 */
function packPlaySessionInWorker(payload) {
  const w = ensurePackWorker();
  if (!w) {
    return Promise.resolve(packPlaySessionSync(payload));
  }
  return new Promise((resolve, reject) => {
    const id = ++packWorkerJobSeq;
    packWorkerPending.set(id, { resolve, reject });
    try {
      w.postMessage({ cmd: 'pack', id, payload });
    } catch (e) {
      packWorkerPending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * @param {PlaySessionSaveV2} payload
 * @returns {Promise<string>}
 */
async function packPayloadToStorageString(payload) {
  try {
    return await packPlaySessionInWorker(payload);
  } catch {
    return packPlaySessionSync(payload);
  }
}

/**
 * @param {PlaySessionSaveV2} payload
 * @param {number} epoch — captured when the write was scheduled; must match {@link persistEpoch} to apply `setItem`.
 */
async function writeSaveToStorageAsyncInner(payload, epoch) {
  const attempts = [
    payload,
    stripFogDiscovered(payload),
    stripFogAndFainted(payload),
    minimalPersistSnapshot(payload)
  ];
  /** @type {unknown} */
  let lastQuota = null;
  for (let i = 0; i < attempts.length; i++) {
    const p = attempts[i];
    try {
      const packed = await packPayloadToStorageString(p);
      if (epoch !== persistEpoch) return;
      localStorage.setItem(STORAGE_KEY, packed);
      if (i > 0) {
        console.warn('[play-session-persist] saved reduced payload to fit storage quota', { step: i });
      }
      return;
    } catch (e) {
      if (e && typeof e === 'object' && /** @type {DOMException} */ (e).name === 'QuotaExceededError') {
        lastQuota = e;
        continue;
      }
      console.warn('[play-session-persist] write failed', e);
      return;
    }
  }
  console.warn('[play-session-persist] write failed after quota retries', lastQuota);
}

/**
 * Queue a persist write after any in-flight write (non-blocking for callers).
 * @param {PlaySessionSaveV2} payload
 * @returns {Promise<void>} resolves when this payload has been written (or skipped on error).
 */
function schedulePersistWrite(payload) {
  const epoch = persistEpoch;
  const done = persistWriteTail.then(() => writeSaveToStorageAsyncInner(payload, epoch));
  persistWriteTail = done.catch((e) => {
    console.warn('[play-session-persist] persist write chain', e);
  });
  return done;
}

/**
 * @param {string} mapFingerprint
 * @returns {{ width: number, height: number, seed: number, stride: number | null } | null}
 */
export function parseMapFingerprint(mapFingerprint) {
  if (typeof mapFingerprint !== 'string') return null;
  const mStride = mapFingerprint.match(/^(\d+)x(\d+)@([0-9a-z]+)\+(\d+)$/i);
  if (mStride) {
    const width = Number(mStride[1]);
    const height = Number(mStride[2]);
    const seed = parseInt(mStride[3], 36) >>> 0;
    const stride = Number(mStride[4]) >>> 0;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || stride <= 0) {
      return null;
    }
    return { width, height, seed, stride };
  }
  const m = mapFingerprint.match(/^(\d+)x(\d+)@([0-9a-z]+)$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  const seed = parseInt(m[3], 36) >>> 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, seed, stride: null };
}

/**
 * True when a stored fingerprint refers to the same region identity as `data`
 * (width, height, seed). Accepts legacy saves without `+macroStride`; if both sides
 * encode stride and they differ, returns false (incompatible tile space).
 *
 * @param {object | null | undefined} data
 * @param {string | null | undefined} storedFp
 * @returns {boolean}
 */
export function savedMapFingerprintMatchesData(data, storedFp) {
  if (!data || typeof storedFp !== 'string' || !storedFp) return false;
  const curFp = buildPlayMapFingerprint(data);
  if (!curFp) return false;
  if (storedFp === curFp) return true;
  const a = parseMapFingerprint(storedFp);
  const b = parseMapFingerprint(curFp);
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if ((a.seed >>> 0) !== (b.seed >>> 0)) return false;
  const sa = a.stride;
  const sb = b.stride;
  if (sa != null && sb != null && sa !== sb) return false;
  return true;
}

/**
 * UTF-8 byte length of JSON (matches typical `.json` file size).
 * @param {unknown} value
 */
export function utf8JsonByteLength(value) {
  return new Blob([JSON.stringify(value)]).size;
}

/**
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @param {PlaySessionPersistExtra | null | undefined} persistExtra
 */
export function estimatePlaySessionSaveUtf8Bytes(data, playerRef, persistExtra = null) {
  if (!data || !playerRef) return 0;
  const p = buildPlaySessionSavePayload(data, playerRef, persistExtra);
  return utf8JsonByteLength(p);
}

/** @returns {number | null} */
export function estimateStoredPlaySessionSaveUtf8Bytes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return new Blob([raw]).size;
  } catch {
    return null;
  }
}

/**
 * @returns {PlaySessionSaveV2 | null}
 */
export function readStoredPlaySessionSavePayload() {
  return readSaveFromStorage();
}

/**
 * Validates and replaces browser save slot (same storage key as autosave).
 * @param {unknown} o
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function tryImportPlaySessionSavePayload(o) {
  if (!o || typeof o !== 'object') return { ok: false, reason: 'empty' };
  const v = /** @type {{ version?: unknown, mapFingerprint?: unknown, player?: unknown }} */ (o);
  if (v.version !== 1 && v.version !== 2) return { ok: false, reason: 'version' };
  if (typeof v.mapFingerprint !== 'string' || !v.mapFingerprint) return { ok: false, reason: 'fingerprint' };
  const px = Number(v.player?.x);
  const py = Number(v.player?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { ok: false, reason: 'player' };
  void schedulePersistWrite(/** @type {PlaySessionSaveV2} */ (o));
  return { ok: true };
}

/**
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @param {PlaySessionPersistExtra | null | undefined} persistExtra
 * @param {string} [filenameBase]
 */
export function downloadPlaySessionSaveJsonFile(data, playerRef, persistExtra = null, filenameBase = 'pkmn-play-save') {
  if (!data || !playerRef) return;
  const p = buildPlaySessionSavePayload(data, playerRef, persistExtra);
  const safeFp = String(p.mapFingerprint || 'map').replace(/[^\w@-]+/g, '_');
  const jsonStr = JSON.stringify(p, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `${filenameBase}-${safeFp}.json`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * @param {object | null | undefined} data
 * @returns {PlaySessionSaveV2 | null}
 */
export function peekPlaySessionSaveForMap(data) {
  if (!data) return null;
  const saved = readSaveFromStorage();
  if (!saved || typeof saved.mapFingerprint !== 'string') return null;
  if (!savedMapFingerprintMatchesData(data, saved.mapFingerprint)) return null;
  return saved;
}

/**
 * After a fresh `generate(...)`, if the browser slot has a play save whose **width×height** match `data`
 * but `peekPlaySessionSaveForMap(data)` is null (almost always a **different numeric seed** — e.g. refresh
 * with an empty seed field uses `stringToSeed('default')` while the save was made on another seed),
 * returns the save's fingerprint seed so the host can set the seed UI and `run()` once to recover resume.
 *
 * @param {object | null | undefined} data
 * @returns {number | null} unsigned seed, or null
 */
export function getReconcilableSeedFromStoredPlaySave(data) {
  if (!data) return null;
  if (peekPlaySessionSaveForMap(data)) return null;
  const stored = readStoredPlaySessionSavePayload();
  if (!stored?.mapFingerprint) return null;
  const parsed = parseMapFingerprint(String(stored.mapFingerprint));
  if (!parsed) return null;
  const dw = data.width | 0;
  const dh = data.height | 0;
  if (parsed.width !== dw || parsed.height !== dh) return null;
  const want = parsed.seed >>> 0;
  const have = Number(data.seed) >>> 0;
  if (want === have) return null;
  return want;
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
 * @returns {{ worldHours: number, playSessionSeconds: number, weatherPreset: import('./weather-presets.js').WeatherPresetId, weatherIntensity01: number, weatherCloudIntensity01: number, weatherPrecipIntensity01: number, earthquakeIntensity01: number, sunLightRaysIntensity01: number, moonlightEnabled: boolean } | null}
 */
export function extractPlaySessionEnvironmentForRestore(saved) {
  if (!saved || saved.version < 2) return null;
  const preset = readSavedWeatherPreset(saved);
  if (!preset) return null;
  const whRaw = Number(saved.worldHours);
  const worldHours = Number.isFinite(whRaw) ? wrapHours(whRaw) : 12;
  const psRaw = Number(saved.playSessionSeconds);
  const playSessionSeconds = Number.isFinite(psRaw) ? Math.max(0, Math.min(31_536_000, psRaw)) : 0;
  const legacyRaw = Number(saved.weatherIntensity01);
  const legacy = Number.isFinite(legacyRaw) ? Math.max(0, Math.min(1, legacyRaw)) : 1;
  const wcRaw = Number(saved.weatherCloudIntensity01);
  const wpRaw = Number(saved.weatherPrecipIntensity01);
  const weatherCloudIntensity01 = Number.isFinite(wcRaw) ? Math.max(0, Math.min(1, wcRaw)) : legacy;
  const weatherPrecipIntensity01 = Number.isFinite(wpRaw) ? Math.max(0, Math.min(1, wpRaw)) : legacy;
  const eq = Number(saved.earthquakeIntensity01);
  const earthquakeIntensity01 = Number.isFinite(eq) ? Math.max(0, Math.min(1, eq)) : 0;
  const sr = Number(saved.sunLightRaysIntensity01);
  const sunLightRaysIntensity01 = Number.isFinite(sr) ? Math.max(0, Math.min(1, sr)) : 0;
  const moonlightEnabled = saved.moonlightEnabled !== false;
  return {
    worldHours,
    playSessionSeconds,
    weatherPreset: preset,
    weatherIntensity01: legacy,
    weatherCloudIntensity01,
    weatherPrecipIntensity01,
    earthquakeIntensity01,
    sunLightRaysIntensity01,
    moonlightEnabled
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
 *   onRestoreEnvironment?: (env: ReturnType<typeof extractPlaySessionEnvironmentForRestore>) => void,
 *   applyPlaySessionSecondsFromSave?: boolean,
 *   onRestorePlaySessionSeconds?: (seconds: number) => void
 * }} [opts] — map click should use `{ position: false, inventory: true }`; cold resume `{ position: true, inventory: true, applyEnvironmentFromSave: true, onRestoreEnvironment }`.
 * @returns {boolean} true if anything was applied (HUD may need refresh).
 */
export function tryApplyPlaySessionResumeOnEnter(data, playerRef, opts = {}) {
  const applyInventory = opts.inventory !== false;
  const applyPosition = opts.position === true;
  const applyEnv = opts.applyEnvironmentFromSave === true && typeof opts.onRestoreEnvironment === 'function';
  const applyPlaySessionSeconds =
    opts.applyPlaySessionSecondsFromSave === true &&
    typeof opts.onRestorePlaySessionSeconds === 'function';
  if (!data || !playerRef) return false;
  if (!applyInventory && !applyPosition && !applyEnv && !applyPlaySessionSeconds) return false;

  const saved = peekPlaySessionSaveForMap(data);
  if (!saved) return false;

  let did = false;
  if (applyInventory) {
    restoreCollectedDetailInventoryFromSnapshot(saved.inventory?.rows);
    did = true;
  }
  if (saved.fogDiscovered) {
    restoreFogDiscoveredFromSnapshot(saved.fogDiscovered, data);
    did = true;
  }
  if (saved.faintedWildPokemon) {
    restoreFaintedPokemonFromSnapshot(saved.faintedWildPokemon);
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
  if (applyPlaySessionSeconds) {
    const secRaw = Number(saved.playSessionSeconds);
    const sec = Number.isFinite(secRaw) ? Math.max(0, Math.min(31_536_000, secRaw)) : 0;
    opts.onRestorePlaySessionSeconds(sec);
    did = true;
  }
  return did;
}

/**
 * @typedef {{ worldHours: number, playSessionSeconds?: number, weatherPreset: import('./weather-presets.js').WeatherPresetId, weatherIntensity01?: number, weatherCloudIntensity01?: number, weatherPrecipIntensity01?: number, earthquakeIntensity01: number, sunLightRaysIntensity01?: number, moonlightEnabled?: boolean }} PlaySessionPersistExtra
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
  const vx = Number(playerRef?.visualX);
  const vy = Number(playerRef?.visualY);
  const useVisual = Number.isFinite(vx) && Number.isFinite(vy);
  /** @type {PlaySessionSaveV2} */
  const out = {
    version: PLAY_SESSION_SAVE_VERSION,
    mapFingerprint,
    savedAtWallSec: wallSecNow(),
    player: {
      x: useVisual ? vx : Number(playerRef?.x) || 0,
      y: useVisual ? vy : Number(playerRef?.y) || 0,
      z: Math.max(0, Number(playerRef?.z) || 0)
    },
    inventory: { rows }
  };
  const whSrc = persistExtra != null ? Number(persistExtra.worldHours) : NaN;
  if (Number.isFinite(whSrc)) {
    out.worldHours = wrapHours(whSrc);
  }
  const psSrc = persistExtra != null ? Number(persistExtra.playSessionSeconds) : NaN;
  if (Number.isFinite(psSrc)) {
    out.playSessionSeconds = Math.max(0, Math.min(31_536_000, psSrc));
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
  const sr = Number(persistExtra?.sunLightRaysIntensity01 ?? getSunLightRaysTargetIntensity01());
  out.sunLightRaysIntensity01 = Number.isFinite(sr) ? Math.max(0, Math.min(1, sr)) : 0;
  out.moonlightEnabled = persistExtra?.moonlightEnabled !== false;
  const fogSnap = getFogDiscoveredSnapshot();
  if (fogSnap) out.fogDiscovered = fogSnap;
  const faintedSnap = getFaintedPokemonSnapshot();
  if (faintedSnap.length > 0) out.faintedWildPokemon = faintedSnap;
  const crySnap = getCryIdentifiedDexIdsSnapshot();
  if (crySnap.length > 0) out.cryIdentifiedDexIds = crySnap;
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
  const p = buildPlaySessionSavePayload(data, playerRef, persistExtra);
  void schedulePersistWrite(p).then(() => {
    flashPlaySessionSaveIndicator();
  });
}

/**
 * @param {object | null | undefined} data
 * @param {import('../player.js').player} playerRef
 * @param {PlaySessionPersistExtra | null} persistExtra
 */
function queuePlaySessionAutosave(data, playerRef, persistExtra = null) {
  if (!data || !playerRef) return;
  queuedAutosavePayloadArgs = { data, playerRef, persistExtra };
  if (autosaveFlushRunning) {
    autosaveFlushNeedsReplay = true;
    return;
  }
  if (autosaveFlushScheduled) return;
  autosaveFlushScheduled = true;
  if (typeof window.requestIdleCallback === 'function') {
    autosaveFlushHandle = window.requestIdleCallback(runDeferredAutosaveFlush, { timeout: 700 });
    return;
  }
  autosaveFlushHandle = window.setTimeout(runDeferredAutosaveFlush, 0);
}

function clearAutosaveFlushSchedule() {
  if (!autosaveFlushScheduled) return;
  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(autosaveFlushHandle);
  } else {
    clearTimeout(autosaveFlushHandle);
  }
  autosaveFlushHandle = 0;
  autosaveFlushScheduled = false;
}

function runDeferredAutosaveFlush() {
  autosaveFlushHandle = 0;
  autosaveFlushScheduled = false;
  const args = queuedAutosavePayloadArgs;
  if (!args) return;
  queuedAutosavePayloadArgs = null;
  autosaveFlushRunning = true;
  const { data, playerRef, persistExtra } = args;
  if (!data || !playerRef || !buildPlayMapFingerprint(data)) {
    autosaveFlushRunning = false;
    if (autosaveFlushNeedsReplay || queuedAutosavePayloadArgs) {
      autosaveFlushNeedsReplay = false;
      queuePlaySessionAutosave(
        queuedAutosavePayloadArgs?.data ?? args.data,
        queuedAutosavePayloadArgs?.playerRef ?? args.playerRef,
        queuedAutosavePayloadArgs?.persistExtra ?? args.persistExtra
      );
    }
    return;
  }
  const payload = buildPlaySessionSavePayload(data, playerRef, persistExtra);
  void schedulePersistWrite(payload)
    .then(() => {
      flashPlaySessionSaveIndicator();
    })
    .finally(() => {
      autosaveFlushRunning = false;
      if (autosaveFlushNeedsReplay || queuedAutosavePayloadArgs) {
        autosaveFlushNeedsReplay = false;
        queuePlaySessionAutosave(
          queuedAutosavePayloadArgs?.data ?? args.data,
          queuedAutosavePayloadArgs?.playerRef ?? args.playerRef,
          queuedAutosavePayloadArgs?.persistExtra ?? args.persistExtra
        );
      }
    });
}

/** Removes the persisted play snapshot from localStorage (next resume for this map will be empty). */
export function clearPlaySessionSave() {
  persistEpoch++;
  terminatePackWorker();
  clearAutosaveFlushSchedule();
  queuedAutosavePayloadArgs = null;
  autosaveFlushNeedsReplay = false;
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
  clearAutosaveFlushSchedule();
  queuedAutosavePayloadArgs = null;
  autosaveFlushNeedsReplay = false;
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
  queuePlaySessionAutosave(data, playerRef, persistExtra);
  nextAutosaveWallSec = wallSec + AUTOSAVE_INTERVAL_SEC;
}
