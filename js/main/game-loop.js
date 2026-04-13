import { updatePlayer, tryJumpPlayer, togglePlayerCreativeFlight } from '../player.js';
import { getPlayLodDetail } from '../render/play-view-camera.js';
import { playInputState } from './play-input-state.js';
import {
  syncWildPokemonWindow,
  updateWildPokemon,
  getWildPokemonEntities
} from '../wild-pokemon/wild-pokemon-manager.js';
import { updateMoves } from '../moves/moves-manager.js';
import { updateGrassFire } from '../play-grass-fire.js';
import { updatePlayPointerCombat, castMappedMoveByHotkey } from './play-mouse-combat.js';

export const heldKeys = new Set();
export const playFpsSampleTimes = [];

let lastTimestamp = 0;
let animFrameId = null;

export function keyToDir(key) {
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'up';
  if (key === 'ArrowDown' || key === 's' || key === 'S') return 'down';
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left';
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
  return null;
}

/** WASD or arrows — used to block browser Ctrl+W / Ctrl+S etc. in play mode. */
function isPlayMovementKeyEvent(e) {
  if (keyToDir(e.key)) return true;
  const c = e.code;
  return c === 'KeyW' || c === 'KeyA' || c === 'KeyS' || c === 'KeyD';
}

/**
 * @param {{
 *   getAppMode: () => string,
 *   setGameTime: (t: number) => void,
 *   getCurrentData: () => object | null,
 *   updateView: () => void,
 *   refreshPlayModeInfoBar: () => void,
 *   getPlayFpsEl: () => HTMLElement | null,
 *   player: import('../player.js').player,
 *   onPlayHudFrame?: (data: object | null) => void
 * }} api
 */
export function createGameLoop(api) {
  const {
    getAppMode,
    setGameTime,
    getCurrentData,
    updateView,
    refreshPlayModeInfoBar,
    getPlayFpsEl,
    player,
    onPlayHudFrame
  } = api;

  function gameLoop(timestamp) {
    const dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    setGameTime(timestamp / 1000);

    let inX = 0;
    let inY = 0;
    if (heldKeys.has('up')) inY -= 1;
    if (heldKeys.has('down')) inY += 1;
    if (heldKeys.has('left')) inX -= 1;
    if (heldKeys.has('right')) inX += 1;

    if (inX !== 0 && inY !== 0) {
      const mag = Math.hypot(inX, inY);
      inX /= mag;
      inY /= mag;
    }

    if (['play'].includes(getAppMode())) {
      if (inX === 0 && inY === 0) {
        player.runMode = false;
      }
      player.inputX = inX;
      player.inputY = inY;
    } else {
      player.inputX = 0;
      player.inputY = 0;
    }

    const currentData = getCurrentData();
    updatePlayer(dt, currentData);

    if (currentData && getAppMode() === 'play') {
      const pvx = player.visualX ?? player.x;
      const pvy = player.visualY ?? player.y;
      syncWildPokemonWindow(currentData, pvx, pvy);
      updateWildPokemon(dt, currentData, pvx, pvy);
      updatePlayPointerCombat(dt, player);
      updateMoves(dt, getWildPokemonEntities(), currentData, player);
      updateGrassFire(dt, currentData, pvx, pvy);
      refreshPlayModeInfoBar();
      onPlayHudFrame?.(currentData);
    }

    const tFrameStart = performance.now();
    updateView();
    const playFpsEl = getPlayFpsEl();
    if (getAppMode() === 'play' && playFpsEl) {
      const tEnd = performance.now();
      const frameMs = tEnd - tFrameStart;
      playFpsSampleTimes.push(tEnd);
      const cutoff = tEnd - 1000;
      while (playFpsSampleTimes.length && playFpsSampleTimes[0] < cutoff) playFpsSampleTimes.shift();
      const fps = playFpsSampleTimes.length;
      const lod = getPlayLodDetail();
      playFpsEl.textContent = `${fps} FPS · LOD ${lod} · ${frameMs.toFixed(1)} ms`;
    }
    if (getAppMode() === 'play') {
      animFrameId = requestAnimationFrame(gameLoop);
    }
  }

  function startGameLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(gameLoop);
  }

  function stopGameLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  return { gameLoop, startGameLoop, stopGameLoop };
}

/**
 * Registra keydown/keyup globais do modo play (movimento + ESC delegado).
 * @param {{
 *   getAppMode: () => string,
 *   getCurrentData: () => object | null,
 *   refreshPlayModeInfoBar: () => void,
 *   onEscapePlay: () => void,
 *   player: import('../player.js').player
 * }} api
 */
export function registerPlayKeyboard(api) {
  const { getAppMode, getCurrentData, refreshPlayModeInfoBar, onEscapePlay, player } = api;

  /** Same cardinal twice within this window enables sprint; clears when movement stops (game loop). */
  const RUN_DOUBLE_TAP_MS = 320;
  let runTapDir = /** @type {'up'|'down'|'left'|'right'|null} */ (null);
  let runTapAt = 0;

  /** Capture phase: run before browser default actions (e.g. Ctrl+W close tab). */
  window.addEventListener(
    'keydown',
    (e) => {
    if (getAppMode() === 'play') {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      ) {
        return;
      }

      if (
        [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          ' ',
          'w',
          'a',
          's',
          'd',
          'W',
          'A',
          'S',
          'D'
        ].includes(e.key)
      ) {
        e.preventDefault();
      }

      // Block Ctrl+W / Ctrl+S / Ctrl+N… with movement keys (capture + stopPropagation).
      if (e.ctrlKey && isPlayMovementKeyEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (e.code === 'Space') {
        playInputState.spaceHeld = true;
      }
      if (e.code === 'KeyF') {
        e.preventDefault();
        togglePlayerCreativeFlight();
        if (getCurrentData()) refreshPlayModeInfoBar(true);
      }

      if (e.code === 'ShiftLeft') {
        e.preventDefault();
        playInputState.shiftLeftHeld = true;
      }
      if (e.code === 'ShiftRight') {
        e.preventDefault();
        playInputState.shiftRightHeld = true;
      }
      if (e.code === 'ControlLeft') {
        playInputState.ctrlLeftHeld = true;
      }

      const dir = keyToDir(e.key);
      if (dir) {
        if (!e.repeat) {
          const now = performance.now();
          if (runTapDir === dir && now - runTapAt <= RUN_DOUBLE_TAP_MS) {
            player.runMode = true;
            runTapDir = null;
            runTapAt = 0;
          } else {
            runTapDir = dir;
            runTapAt = now;
          }
        }
        heldKeys.add(dir);
        if (getCurrentData()) refreshPlayModeInfoBar(true);
      }

      if (e.key === ' ' && !e.repeat) {
        tryJumpPlayer(getCurrentData());
      }

      if (!e.repeat && castMappedMoveByHotkey(e.code, player)) {
        e.preventDefault();
      }

      if (e.key === 'Escape') {
        onEscapePlay();
      }
    }
    },
    true
  );

  window.addEventListener(
    'keyup',
    (e) => {
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (
      el &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    ) {
      return;
    }

    if (e.code === 'Space') {
      playInputState.spaceHeld = false;
    }
    if (e.code === 'ShiftLeft') {
      playInputState.shiftLeftHeld = false;
    }
    if (e.code === 'ShiftRight') {
      playInputState.shiftRightHeld = false;
    }
    if (e.code === 'ControlLeft') {
      playInputState.ctrlLeftHeld = false;
    }
    const dir = keyToDir(e.key);
    if (dir) heldKeys.delete(dir);
    },
    true
  );
}
