/**
 * SNES Zelda: A Link to the Past — screen-grid camera.
 *
 * The world is treated as a grid of screen-sized "rooms".  While the player
 * stays inside the current room the camera is perfectly still.  When the
 * player steps across a room boundary the camera performs a fast,
 * fixed-duration scroll to the adjacent room.
 *
 * Supports two activation modes:
 *   – **Manual toggle** (G key / minimap icon) — persisted in localStorage,
 *     snaps on/off instantly.
 *   – **Encounter-driven** — activated programmatically centered on a world
 *     position, with smooth cross-fade from center-follow to grid-locked
 *     (and smooth fade-out when the encounter ends).
 *
 * Zero per-frame heap allocation.  All state is module-level primitives.
 */

/* ── Transition timing ────────────────────────────────────────────────── */

/** Seconds for a full-screen room-to-room scroll. */
let _scrollDurationS = 0.75;

/** Seconds to cross-fade centre-follow → grid-locked (encounter blend-in). */
let _blendInS = 0.4;

/** Seconds to cross-fade grid-locked → centre-follow (encounter blend-out). */
let _blendOutS = 0.45;

/* ── State (primitives only — zero GC pressure) ──────────────────────── */

const LS_KEY = 'pkmn_dz_cam';
let _manualOn = false;

let _roomX = 0;
let _roomY = 0;
let _screenW = 0;
let _screenH = 0;

let _scrolling = false;
let _fromRoomX = 0;
let _fromRoomY = 0;
let _toRoomX = 0;
let _toRoomY = 0;
let _scrollT = 0;

/** NaN = uninitialised → snap to room on first frame. */
let _initDone = NaN;
let _lastPerfMs = 0;
let _prevPlayerVx = NaN;
let _prevPlayerVy = NaN;

/* ── Encounter-driven activation ──────────────────────────────────────── */

let _encounterActive = false;
let _encounterAnchorX = 0;
let _encounterAnchorY = 0;
let _allowManualRoomTransitions = true;

/**
 * Blend factor 0..1: 0 = pure centre-follow, 1 = pure grid-locked.
 * Smoothly animated toward target each frame.
 */
let _blend = 0;

/** Listeners notified on effective-state change (for UI sync). */
const _listeners = [];

// Self-init from localStorage.
try { _manualOn = localStorage.getItem(LS_KEY) === '1'; } catch (_) { /* noop */ }
// If manual was persisted ON, start fully blended.
if (_manualOn) _blend = 1;

/* ── Derived helpers ──────────────────────────────────────────────────── */

function _isEffectivelyOn() { return _manualOn || _encounterActive; }

function _roomIndexFromCoord(coord, anchor, screenSpan) {
  return Math.floor((coord - (anchor - screenSpan * 0.5)) / screenSpan);
}

function _roomCenterFromIndex(roomIndex, anchor, screenSpan) {
  return anchor + roomIndex * screenSpan;
}

function _notifyListeners() {
  const on = _isEffectivelyOn();
  for (let i = 0; i < _listeners.length; i++) _listeners[i](on);
}

/* ── Public API ───────────────────────────────────────────────────────── */

/** @returns {boolean} Whether the grid camera is logically active. */
export function isScreenGridCameraOn() { return _isEffectivelyOn(); }

/** @returns {boolean} Manual toggle state (ignoring encounter). */
export function isScreenGridCameraManualOn() { return _manualOn; }

/** Subscribe to toggle changes. Returns unsubscribe function. */
export function onScreenGridCameraChange(fn) {
  _listeners.push(fn);
  return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); };
}

/** Enable / disable manual mode. Persists in localStorage. */
export function setScreenGridCameraOn(v) {
  _manualOn = !!v;
  _initDone = NaN;
  _scrolling = false;
  _lastPerfMs = 0;
  _prevPlayerVx = NaN;
  _prevPlayerVy = NaN;
  if (_manualOn) _blend = 1; // manual toggle snaps fully on
  else if (!_encounterActive) _blend = 0;
  try { localStorage.setItem(LS_KEY, _manualOn ? '1' : '0'); } catch (_) { /* noop */ }
  _notifyListeners();
}

/** Toggle manual mode and return the new state. */
export function toggleScreenGridCamera() { setScreenGridCameraOn(!_manualOn); return _manualOn; }

/**
 * Activate grid camera centred on a world position (encounter mode).
 * Blends in smoothly over BLEND_IN_S.
 *
 * @param {number} centerX — world tile X of encounter
 * @param {number} centerY — world tile Y of encounter
 * @param {number} tw — current effTileW (for screen-size calc)
 * @param {number} th — current effTileH
 * @param {number} cw — canvas width
 * @param {number} ch — canvas height
 */
export function activateEncounterScreenGrid(centerX, centerY, tw, th, cw, ch) {
  _encounterActive = true;
  const sw = cw / tw;
  const sh = ch / th;
  _screenW = sw;
  _screenH = sh;
  _encounterAnchorX = Number(centerX) || 0;
  _encounterAnchorY = Number(centerY) || 0;
  _roomX = 0;
  _roomY = 0;
  _scrolling = false;
  _initDone = 1;
  _lastPerfMs = 0;
  _prevPlayerVx = NaN;
  _prevPlayerVy = NaN;
  // Encounter must snap directly to spawn-centered Zelda room.
  _blend = 1;
  _notifyListeners();
}

/** Deactivate encounter mode (blends out smoothly). */
export function deactivateEncounterScreenGrid() {
  _encounterActive = false;
  // Encounter end: avoid long lerp back to player-follow camera.
  // If manual mode is still on, keep grid fully active.
  if (_manualOn) {
    _blend = 1;
    // Reinitialize room from the live player position on next frame.
    // Prevents carrying encounter-relative room state into manual mode.
    _scrolling = false;
    _initDone = NaN;
    _lastPerfMs = 0;
    _prevPlayerVx = NaN;
    _prevPlayerVy = NaN;
  } else {
    _blend = 0;
    _scrolling = false;
    _initDone = NaN;
    _lastPerfMs = 0;
    _prevPlayerVx = NaN;
    _prevPlayerVy = NaN;
  }
  _notifyListeners();
}

// Aliases for game-loop.js backward compat.
export { isScreenGridCameraOn as isDeadzoneCameraOn };
export { toggleScreenGridCamera as toggleDeadzoneCamera };

/**
 * Current blend factor 0..1 (0 = centre-follow, 1 = grid-locked).
 * Used by play-view-camera to blend zoom locking.
 */
export function getScreenGridBlend() { return _blend; }

/**
 * Current Zelda room in world tiles for the active grid camera.
 * @returns {{ centerX: number, centerY: number, minX: number, maxX: number, minY: number, maxY: number, screenW: number, screenH: number } | null}
 */
export function getScreenGridCurrentRoomBounds() {
  if (!_isEffectivelyOn() || _blend <= 0.001 || _screenW <= 0 || _screenH <= 0) return null;
  const centerX = _encounterActive
    ? _roomCenterFromIndex(_roomX, _encounterAnchorX, _screenW)
    : (_roomX + 0.5) * _screenW;
  const centerY = _encounterActive
    ? _roomCenterFromIndex(_roomY, _encounterAnchorY, _screenH)
    : (_roomY + 0.5) * _screenH;
  const halfW = _screenW * 0.5;
  const halfH = _screenH * 0.5;
  return {
    centerX,
    centerY,
    minX: centerX - halfW,
    maxX: centerX + halfW,
    minY: centerY - halfH,
    maxY: centerY + halfH,
    screenW: _screenW,
    screenH: _screenH
  };
}

/**
 * Runtime camera tuning for ALTTP grid mode.
 * @returns {{ scrollDurationS: number, blendInS: number, blendOutS: number }}
 */
export function getScreenGridCameraConfig() {
  return {
    scrollDurationS: _scrollDurationS,
    blendInS: _blendInS,
    blendOutS: _blendOutS,
    allowManualRoomTransitions: _allowManualRoomTransitions
  };
}

/**
 * @param {{ scrollDurationS?: number, blendInS?: number, blendOutS?: number, allowManualRoomTransitions?: boolean }} next
 */
export function setScreenGridCameraConfig(next = {}) {
  if (Number.isFinite(next.scrollDurationS)) {
    _scrollDurationS = Math.max(0.05, Math.min(1.25, Number(next.scrollDurationS)));
  }
  if (Number.isFinite(next.blendInS)) {
    _blendInS = Math.max(0.05, Math.min(1.5, Number(next.blendInS)));
  }
  if (Number.isFinite(next.blendOutS)) {
    _blendOutS = Math.max(0.05, Math.min(1.5, Number(next.blendOutS)));
  }
  if (typeof next.allowManualRoomTransitions === 'boolean') {
    _allowManualRoomTransitions = !!next.allowManualRoomTransitions;
  }
}

/* ── Per-frame core ───────────────────────────────────────────────────── */

/**
 * @param {number} idealTX  Centre-follow currentTransX (px)
 * @param {number} idealTY  Centre-follow currentTransY (px)
 * @param {number} vx       Player world X (tiles)
 * @param {number} vy       Player world Y (tiles)
 * @param {number} tw       Tile width (px)
 * @param {number} th       Tile height (px)
 * @param {number} cw       Canvas width (px)
 * @param {number} ch       Canvas height (px)
 * @returns {{ tx: number, ty: number, ax: number, ay: number } | null}
 */
export function applyScreenGridCamera(idealTX, idealTY, vx, vy, tw, th, cw, ch) {
  /* ── dt ──────────────────────────────────────────────────────────────── */
  const now = performance.now();
  const dt = _lastPerfMs ? Math.min(0.1, (now - _lastPerfMs) / 1000) : 1 / 60;
  _lastPerfMs = now;

  /* ── Animate blend toward target ────────────────────────────────────── */
  const wantOn = _isEffectivelyOn();
  if (wantOn) {
    _blend = Math.min(1, _blend + dt / _blendInS);
  } else {
    _blend = Math.max(0, _blend - dt / _blendOutS);
  }

  if (_blend <= 0.001) { _blend = 0; return null; }

  /* ── Screen size in world tiles ─────────────────────────────────────── */
  _screenW = cw / tw;
  _screenH = ch / th;

  /* ── First frame → snap to player's room ────────────────────────────── */
  if (_initDone !== _initDone) { // NaN !== NaN
    if (_encounterActive) {
      _roomX = _roomIndexFromCoord(vx, _encounterAnchorX, _screenW);
      _roomY = _roomIndexFromCoord(vy, _encounterAnchorY, _screenH);
    } else {
      _roomX = Math.floor(vx / _screenW);
      _roomY = Math.floor(vy / _screenH);
    }
    _initDone = 1;
  }

  // Teleport/respawn guard: large instantaneous jumps should re-snap room
  // instead of animating a long scroll from stale room coordinates.
  if (!_encounterActive && _prevPlayerVx === _prevPlayerVx && _prevPlayerVy === _prevPlayerVy) {
    const jumpDx = Math.abs(vx - _prevPlayerVx);
    const jumpDy = Math.abs(vy - _prevPlayerVy);
    if (jumpDx > _screenW * 0.75 || jumpDy > _screenH * 0.75) {
      _roomX = Math.floor(vx / _screenW);
      _roomY = Math.floor(vy / _screenH);
      _scrolling = false;
      _scrollT = 0;
    }
  }
  _prevPlayerVx = vx;
  _prevPlayerVy = vy;

  /* ── Detect room crossing ───────────────────────────────────────────── */
  const roomTransitionsEnabled = _encounterActive ? false : _allowManualRoomTransitions;
  if (!_scrolling && roomTransitionsEnabled) {
    const prx = _encounterActive
      ? _roomIndexFromCoord(vx, _encounterAnchorX, _screenW)
      : Math.floor(vx / _screenW);
    const pry = _encounterActive
      ? _roomIndexFromCoord(vy, _encounterAnchorY, _screenH)
      : Math.floor(vy / _screenH);
    if (prx !== _roomX || pry !== _roomY) {
      _scrolling = true;
      _scrollT = 0;
      _fromRoomX = _roomX;
      _fromRoomY = _roomY;
      _toRoomX = prx;
      _toRoomY = pry;
    }
  }

  /* ── Advance room scroll ────────────────────────────────────────────── */
  let camCX, camCY;

  if (_scrolling) {
    _scrollT = Math.min(1, _scrollT + dt / _scrollDurationS);
    const t = _scrollT * _scrollT * (3 - 2 * _scrollT);
    const fCX = _encounterActive
      ? _roomCenterFromIndex(_fromRoomX, _encounterAnchorX, _screenW)
      : (_fromRoomX + 0.5) * _screenW;
    const fCY = _encounterActive
      ? _roomCenterFromIndex(_fromRoomY, _encounterAnchorY, _screenH)
      : (_fromRoomY + 0.5) * _screenH;
    const tCX = _encounterActive
      ? _roomCenterFromIndex(_toRoomX, _encounterAnchorX, _screenW)
      : (_toRoomX + 0.5) * _screenW;
    const tCY = _encounterActive
      ? _roomCenterFromIndex(_toRoomY, _encounterAnchorY, _screenH)
      : (_toRoomY + 0.5) * _screenH;
    camCX = fCX + (tCX - fCX) * t;
    camCY = fCY + (tCY - fCY) * t;
    if (_scrollT >= 1) {
      _scrolling = false;
      _roomX = _toRoomX;
      _roomY = _toRoomY;
      camCX = tCX;
      camCY = tCY;
    }
  } else {
    camCX = _encounterActive
      ? _roomCenterFromIndex(_roomX, _encounterAnchorX, _screenW)
      : (_roomX + 0.5) * _screenW;
    camCY = _encounterActive
      ? _roomCenterFromIndex(_roomY, _encounterAnchorY, _screenH)
      : (_roomY + 0.5) * _screenH;
  }

  /* ── Grid translation ───────────────────────────────────────────────── */
  const gridTX = Math.round(cw / 2 - camCX * tw);
  const gridTY = Math.round(ch / 2 - camCY * th);

  /* ── Cross-fade between centre-follow and grid ──────────────────────── */
  const b = _blend * _blend * (3 - 2 * _blend); // smoothstep
  const tx = Math.round(idealTX + (gridTX - idealTX) * b);
  const ty = Math.round(idealTY + (gridTY - idealTY) * b);

  const idealCX = (cw / 2 - idealTX) / tw;
  const idealCY = (cw / 2 - idealTY) / th;  // intentional: inverse of translation
  const ax = idealCX + (camCX - idealCX) * b;
  const ay = idealCY + (camCY - idealCY) * b;

  return { tx, ty, ax, ay };
}
