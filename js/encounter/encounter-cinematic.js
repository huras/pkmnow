/**
 * Encounter Cinematic — SNES-style random encounter presentation.
 *
 * Phase 1 – TENSION (cry + sprite preloading)
 *   • Player stops, exclamation balloon, cinema bars slide in, mild zoom
 *   • Player cycles facing directions ("looking around")
 *   • Screen-grid camera smoothly blends in, centred on encounter location
 *
 * Phase 2 – REVEAL (assets ready)
 *   • Cry plays, wild entity spawned, cinema bars slide out, zoom normalises
 *   • Screen-grid camera stays active while the entity is alive
 *
 * Phase 3 – WATCHING (entity alive, cinematic bars gone)
 *   • No bars, no zoom override, grid camera still on
 *   • Each frame checks if the tracked entity died / was removed
 *   • On death → grid camera smoothly blends off
 *
 * Zero per-frame heap allocation.  All state is module-level primitives.
 */

import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { preloadPokemonCry, playPokemonCry } from '../pokemon/pokemon-cries.js';
import { imageCache } from '../image-cache.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';
import { PLAY_BAKE_TILE_PX } from '../render/render-constants.js';
import {
  activateEncounterScreenGrid,
  deactivateEncounterScreenGrid,
  getScreenGridCurrentRoomBounds
} from '../render/play-deadzone-camera.js';
import { playEncounterMeLoop, stopEncounterMeLoop } from '../audio/encounter-me.js';
import { pushPlayEventLog } from '../main/play-event-log-state.js';

/* ── Tuning constants ─────────────────────────────────────────────────── */

const BARS_TRANSITION_S = 0.18;
const BAR_HEIGHT_FRAC   = 0.09;
const ZOOM_PEAK         = 1.12;
const ZOOM_IN_S         = 0.35;
const ZOOM_OUT_S        = 0.25;
const LOOK_INTERVAL_S   = 0.28;
const MAX_WAIT_S        = 4.0;
const MIN_TENSION_S     = 0.6;
export const ENCOUNTER_SCREEN_RECENTER_MARGIN_TILES = 2;

const LOOK_SEQUENCE = [0, 2, 4, 6, 1, 5, 3, 7];

/* ── State ────────────────────────────────────────────────────────────── */

/** @type {'idle'|'tension'|'reveal'|'watching'} */
let _phase = 'idle';

let _tensionElapsed = 0;
let _revealElapsed  = 0;
let _lookIndex      = 0;
let _lookTimer      = 0;
let _assetsReady    = false;
let _barT           = 0;
let _zoomMul        = 1;
let _pendingDex     = 0;

/** @type {(() => string|null) | null} */
let _onRevealFn = null;

let _savedAnimRow = 0;
let _savedFacing  = '';

/** Entity key returned by the reveal callback — tracked for death. */
let _trackedEntityKey = '';

/** Encounter world position — used to centre the grid camera. */
let _encounterX = 0;
let _encounterY = 0;

/** Whether we activated grid camera for this encounter (so we deactivate it). */
let _gridActivatedByUs = false;

/* ── Public API ───────────────────────────────────────────────────────── */

export function isEncounterCinematicActive() {
  return _phase !== 'idle';
}

/** True only during tension/reveal — blocks player input. */
export function isEncounterCinematicBlocking() {
  return _phase === 'tension' || _phase === 'reveal';
}

export function getEncounterZoomMul() {
  return _zoomMul;
}

/**
 * Start the encounter cinematic.
 *
 * @param {object}  player
 * @param {number}  dexId
 * @param {number}  encounterWorldX — world tile X where the encounter happens
 * @param {number}  encounterWorldY — world tile Y
 * @param {() => string|null} onReveal — called on reveal; must return the entity key (or null)
 */
export function startEncounterCinematic(player, dexId, encounterWorldX, encounterWorldY, onReveal) {
  if (_phase !== 'idle') {
    onReveal?.();
    return;
  }

  const encounterDex = Math.max(1, Math.floor(Number(dexId) || 1));
  pushPlayEventLog({
    channel: 'local',
    text: 'Random encounter appeared!',
    dedupeKey: `encounter:random:${encounterDex}:${Math.floor(Number(encounterWorldX) || 0)}:${Math.floor(Number(encounterWorldY) || 0)}`,
    portraitDexId: encounterDex
  });

  _phase           = 'tension';
  _tensionElapsed  = 0;
  _revealElapsed   = 0;
  _lookIndex       = 0;
  _lookTimer       = 0;
  _assetsReady     = false;
  _barT            = 0;
  _zoomMul         = 1;
  _pendingDex      = encounterDex;
  _onRevealFn      = onReveal;
  _trackedEntityKey = '';
  _encounterX      = encounterWorldX;
  _encounterY      = encounterWorldY;
  _gridActivatedByUs = false;

  _savedAnimRow = player.animRow || 0;
  _savedFacing  = player.facing || 'down';

  player.vx = 0;
  player.vy = 0;
  player.socialEmotionType = 0;
  player.socialEmotionAge  = 0;
  player.socialEmotionPortraitSlug = 'Surprised';
  playEncounterMeLoop();

  const sheetP = ensurePokemonSheetsLoaded(imageCache, encounterDex);
  const cryP   = preloadPokemonCry(encounterDex);

  Promise.all([sheetP, cryP]).then(
    () => { _assetsReady = true; },
    () => { _assetsReady = true; }
  );
}

/**
 * Per-frame tick — call from game loop.
 *
 * @param {object} player
 * @param {number} dt
 */
export function updateEncounterCinematic(player, dt) {
  if (_phase === 'idle') return;

  /* ── TENSION ────────────────────────────────────────────────────────── */
  if (_phase === 'tension') {
    _tensionElapsed += dt;

    _barT = Math.min(1, _tensionElapsed / BARS_TRANSITION_S);

    const zp = Math.min(1, _tensionElapsed / ZOOM_IN_S);
    const zt = zp * zp * (3 - 2 * zp);
    _zoomMul = 1 + (ZOOM_PEAK - 1) * zt;

    _lookTimer += dt;
    if (_lookTimer >= LOOK_INTERVAL_S) {
      _lookTimer -= LOOK_INTERVAL_S;
      _lookIndex = (_lookIndex + 1) % LOOK_SEQUENCE.length;
      player.animRow = LOOK_SEQUENCE[_lookIndex];
    }

    player.vx = 0;
    player.vy = 0;

    const ready = (_assetsReady && _tensionElapsed >= MIN_TENSION_S) || _tensionElapsed >= MAX_WAIT_S;
    if (ready) {
      _phase = 'reveal';
      _revealElapsed = 0;

      playPokemonCry(_pendingDex, { volume: 0.85 });

      if (_onRevealFn) {
        const key = _onRevealFn();
        _trackedEntityKey = typeof key === 'string' ? key : '';
        _onRevealFn = null;
      }

      // Activate screen-grid camera centred on encounter position
      if (_trackedEntityKey) {
        const cvs = document.querySelector('#play-canvas') || document.querySelector('canvas');
        const cw = cvs ? cvs.width : window.innerWidth;
        const ch = cvs ? cvs.height : window.innerHeight;
        const tw = PLAY_BAKE_TILE_PX;
        const th = PLAY_BAKE_TILE_PX;
        activateEncounterScreenGrid(_encounterX, _encounterY, tw, th, cw, ch);
        _gridActivatedByUs = true;
      }
    }
    return;
  }

  /* ── REVEAL ─────────────────────────────────────────────────────────── */
  if (_phase === 'reveal') {
    _revealElapsed += dt;
    _enforceEncounterScreenContainment(player);

    _barT = Math.max(0, 1 - _revealElapsed / BARS_TRANSITION_S);

    const zp = Math.min(1, _revealElapsed / ZOOM_OUT_S);
    const zt = zp * zp * (3 - 2 * zp);
    _zoomMul = ZOOM_PEAK - (ZOOM_PEAK - 1) * zt;

    if (_revealElapsed >= Math.max(BARS_TRANSITION_S, ZOOM_OUT_S)) {
      _zoomMul = 1;
      _barT = 0;

      if (_trackedEntityKey) {
        _phase = 'watching';
      } else {
        _endCinematic();
      }
    }
    return;
  }

  /* ── WATCHING (grid cam on, wait for entity death) ──────────────────── */
  if (_phase === 'watching') {
    _enforceEncounterScreenContainment(player);
    if (!_trackedEntityKey) {
      _endCinematic();
      return;
    }

    const entity = entitiesByKey.get(_trackedEntityKey);

    // Entity removed from world or dead → end
    if (!entity || entity.deadState) {
      _endCinematic();
    }
  }
}

function _isOutOfRoomWithMargin(x, y, room, margin) {
  return x < room.minX - margin || x > room.maxX + margin || y < room.minY - margin || y > room.maxY + margin;
}

function _enforceEncounterScreenContainment(player) {
  if (!_gridActivatedByUs) return;
  const room = getScreenGridCurrentRoomBounds();
  if (!room) return;
  const margin = Math.max(0, Number(ENCOUNTER_SCREEN_RECENTER_MARGIN_TILES) || 0);

  const px = Number(player?.x);
  const py = Number(player?.y);
  if (Number.isFinite(px) && Number.isFinite(py) && _isOutOfRoomWithMargin(px, py, room, margin)) {
    player.x = room.centerX;
    player.y = room.centerY;
    player.visualX = room.centerX;
    player.visualY = room.centerY;
    player.vx = 0;
    player.vy = 0;
  }

  if (!_trackedEntityKey) return;
  const entity = entitiesByKey.get(_trackedEntityKey);
  if (!entity || entity.deadState || entity.isDespawning) return;
  const ex = Number(entity.x);
  const ey = Number(entity.y);
  if (!Number.isFinite(ex) || !Number.isFinite(ey)) return;
  if (!_isOutOfRoomWithMargin(ex, ey, room, margin)) return;
  entity.x = room.centerX;
  entity.y = room.centerY;
  entity.vx = 0;
  entity.vy = 0;
  entity.targetX = null;
  entity.targetY = null;
}

function _endCinematic() {
  stopEncounterMeLoop();
  _phase = 'idle';
  _zoomMul = 1;
  _barT = 0;
  _trackedEntityKey = '';

  if (_gridActivatedByUs) {
    deactivateEncounterScreenGrid();
    _gridActivatedByUs = false;
  }
}

/**
 * Draw cinema bars overlay in screen space.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 */
export function drawEncounterCinematicOverlay(ctx, cw, ch) {
  if (_barT <= 0.001) return;

  const barH = ch * BAR_HEIGHT_FRAC * _barT;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, barH | 0);
  ctx.fillRect(0, (ch - barH) | 0, cw, barH | 0);
}
