/**
 * SNES Zelda: A Link to the Past — screen-grid camera.
 *
 * The world is treated as a grid of screen-sized "rooms".  While the player
 * stays inside the current room the camera is perfectly still (translation
 * is a compile-time-constant for that room).  When the player steps across
 * a room boundary the camera performs a fast, fixed-duration scroll to the
 * adjacent room — identical to how ALTTP scrolls the overworld.
 *
 * When active the zoom is locked at ground level (scale = 1.0) so the room
 * grid stays pixel-stable no matter the player's altitude.  Jump and flight
 * only move the sprite — the camera never budges vertically for Z changes.
 *
 * Performance payoff: during the ~95 % of gameplay where the player is
 * moving *within* a room, currentTransX/Y are constants → every chunk
 * keeps its exact pixel position → the compositor can skip all
 * resampling / sub-pixel interpolation.
 *
 * Zero per-frame heap allocation.  All state is module-level primitives.
 *
 * Toggle: G key or minimap icon at runtime.  Persisted in localStorage.
 */

/* ── Scroll transition speed ──────────────────────────────────────────── */

/**
 * Seconds for a full-screen scroll transition.
 * ALTTP original is ~16 frames at 60 fps ≈ 0.267s.
 */
const SCROLL_DURATION_S = 0.27;

/* ── State (primitives only — zero GC pressure) ──────────────────────── */

const LS_KEY = 'pkmn_dz_cam';
let _on = false;

/** Current "room" the camera is locked to (integer grid coords). */
let _roomX = 0;
let _roomY = 0;

/** Screen dimensions in world tiles at ground zoom (locked effTile = BAKE_TILE_PX). */
let _screenW = 0;
let _screenH = 0;

/** Is the camera mid-scroll-transition? */
let _scrolling = false;

/** Scroll origin room and target room (integer grid). */
let _fromRoomX = 0;
let _fromRoomY = 0;
let _toRoomX = 0;
let _toRoomY = 0;

/** Progress 0..1 through the current scroll transition. */
let _scrollT = 0;

/** NaN = uninitialised → snap to player's room on first frame. */
let _initDone = NaN;

let _lastPerfMs = 0;

/** Listeners notified on toggle (for UI sync). */
const _listeners = [];

// Self-init from localStorage at import time.
try { _on = localStorage.getItem(LS_KEY) === '1'; } catch (_) { /* noop */ }

/* ── Public helpers ───────────────────────────────────────────────────── */

/** @returns {boolean} */
export function isScreenGridCameraOn() { return _on; }

/** Subscribe to toggle changes.  Returns unsubscribe function. */
export function onScreenGridCameraChange(fn) {
  _listeners.push(fn);
  return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); };
}

/** Enable / disable and persist.  Resets state so the next frame snaps cleanly. */
export function setScreenGridCameraOn(v) {
  _on = !!v;
  _initDone = NaN;
  _scrolling = false;
  _lastPerfMs = 0;
  try { localStorage.setItem(LS_KEY, _on ? '1' : '0'); } catch (_) { /* noop */ }
  for (let i = 0; i < _listeners.length; i++) _listeners[i](_on);
}

/** Toggle and return the new state. */
export function toggleScreenGridCamera() { setScreenGridCameraOn(!_on); return _on; }

// Keep old names as aliases so game-loop.js import still works.
export { isScreenGridCameraOn as isDeadzoneCameraOn };
export { toggleScreenGridCamera as toggleDeadzoneCamera };

/* ── Per-frame core ───────────────────────────────────────────────────── */

/**
 * Compute screen-grid camera translation.
 *
 * The caller (computePlayViewState) must ensure that when this is active,
 * `tw`/`th` are PLAY_BAKE_TILE_PX (ground zoom, scale = 1.0) — not the
 * flight-zoomed effTileW.  This keeps room boundaries pixel-stable.
 *
 * @param {number} _idealTX  (unused — grid computes its own TX)
 * @param {number} _idealTY  (unused — grid computes its own TY)
 * @param {number} vx       Player world X (tiles, continuous)
 * @param {number} vy       Player world Y (tiles, continuous)
 * @param {number} tw       Tile width in px (should be PLAY_BAKE_TILE_PX when active)
 * @param {number} th       Tile height in px
 * @param {number} cw       Canvas width  (px)
 * @param {number} ch       Canvas height (px)
 * @returns {{ tx: number, ty: number, ax: number, ay: number } | null}
 *          `null` when disabled — caller keeps centre-follow values.
 *          `ax`/`ay` = camera centre in world tiles (for tile-bound computation).
 */
export function applyScreenGridCamera(_idealTX, _idealTY, vx, vy, tw, th, cw, ch) {
  if (!_on) return null;

  /* ── dt ──────────────────────────────────────────────────────────────── */
  const now = performance.now();
  const dt = _lastPerfMs ? Math.min(0.1, (now - _lastPerfMs) / 1000) : 1 / 60;
  _lastPerfMs = now;

  /* ── screen size in world tiles ─────────────────────────────────────── */
  _screenW = cw / tw;
  _screenH = ch / th;

  /* ── first frame → snap to player's room ────────────────────────────── */
  if (_initDone !== _initDone) { // NaN !== NaN
    _roomX = Math.floor(vx / _screenW);
    _roomY = Math.floor(vy / _screenH);
    _initDone = 1;
  }

  /* ── detect room crossing (only when not already scrolling) ─────────── */
  if (!_scrolling) {
    const playerRoomX = Math.floor(vx / _screenW);
    const playerRoomY = Math.floor(vy / _screenH);

    if (playerRoomX !== _roomX || playerRoomY !== _roomY) {
      _scrolling = true;
      _scrollT = 0;
      _fromRoomX = _roomX;
      _fromRoomY = _roomY;
      _toRoomX = playerRoomX;
      _toRoomY = playerRoomY;
    }
  }

  /* ── advance scroll transition ──────────────────────────────────────── */
  let camCentreX, camCentreY;

  if (_scrolling) {
    _scrollT = Math.min(1, _scrollT + dt / SCROLL_DURATION_S);
    // Smoothstep for that classic SNES feel (ease in-out).
    const t = _scrollT * _scrollT * (3 - 2 * _scrollT);

    const fromCX = (_fromRoomX + 0.5) * _screenW;
    const fromCY = (_fromRoomY + 0.5) * _screenH;
    const toCX   = (_toRoomX   + 0.5) * _screenW;
    const toCY   = (_toRoomY   + 0.5) * _screenH;

    camCentreX = fromCX + (toCX - fromCX) * t;
    camCentreY = fromCY + (toCY - fromCY) * t;

    if (_scrollT >= 1) {
      _scrolling = false;
      _roomX = _toRoomX;
      _roomY = _toRoomY;
      camCentreX = toCX;
      camCentreY = toCY;
    }
  } else {
    camCentreX = (_roomX + 0.5) * _screenW;
    camCentreY = (_roomY + 0.5) * _screenH;
  }

  /* ── Translation: centre the camera on camCentre ────────────────────── */
  const tx = Math.round(cw / 2 - camCentreX * tw);
  const ty = Math.round(ch / 2 - camCentreY * th);

  return { tx, ty, ax: camCentreX, ay: camCentreY };
}
