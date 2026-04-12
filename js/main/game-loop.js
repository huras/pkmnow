import { updatePlayer, tryJumpPlayer } from '../player.js';
import {
  syncWildPokemonWindow,
  updateWildPokemon
} from '../wild-pokemon/wild-pokemon-manager.js';

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

/**
 * @param {{
 *   getAppMode: () => string,
 *   setGameTime: (t: number) => void,
 *   getCurrentData: () => object | null,
 *   updateView: () => void,
 *   refreshPlayModeInfoBar: () => void,
 *   getPlayFpsEl: () => HTMLElement | null,
 *   player: import('../player.js').player
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
    player
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
      const runMult = heldKeys.has('shift') ? 2.0 : 1.0;
      player.inputX = inX * runMult;
      player.inputY = inY * runMult;
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
      refreshPlayModeInfoBar();
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
      playFpsEl.textContent = `${fps} FPS · ${frameMs.toFixed(1)} ms/frame`;
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

  window.addEventListener('keydown', (e) => {
    if (getAppMode() === 'play') {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'Shift'].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === 'Shift') {
        heldKeys.add('shift');
      }

      const dir = keyToDir(e.key);
      if (dir) {
        heldKeys.add(dir);
        if (getCurrentData()) refreshPlayModeInfoBar();
      }

      if (e.key === ' ') {
        tryJumpPlayer(getCurrentData());
      }

      if (e.key === 'Escape') {
        onEscapePlay();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') heldKeys.delete('shift');
    const dir = keyToDir(e.key);
    if (dir) heldKeys.delete(dir);
  });
}
