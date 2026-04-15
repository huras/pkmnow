import { updatePlayer, tryJumpPlayer, togglePlayerCreativeFlight } from '../player.js';
import { getPlayLodDetail } from '../render/play-view-camera.js';
import { getPlayChunkFrameStats } from '../render.js';
import { playInputState } from './play-input-state.js';
import {
  syncWildPokemonWindow,
  updateWildPokemon,
  getWildPokemonEntities
} from '../wild-pokemon/wild-pokemon-manager.js';
import { updateMoves } from '../moves/moves-manager.js';
import { updateGrassFire } from '../play-grass-fire.js';
import {
  updatePlayPointerCombat,
  castMappedMoveByHotkey,
  handleFieldSkillHotkeyDown,
  handleFieldSkillHotkeyUp
} from './play-mouse-combat.js';
import {
  updateCrystalShardParticles,
  updateCrystalDropsAndPickup,
  updateBreakableDetailRegeneration
} from './play-crystal-tackle.js';
import { syncSpatialListenerFromPlayer } from '../audio/spatial-audio.js';
import { syncBiomeBgm } from '../audio/biome-bgm.js';
import { ingestPlayPerfSample, resetPlayPerfProfiler } from './play-performance-profiler.js';
import { getSocialActionByNumpadCode } from '../social/social-actions.js';

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
 *   getPlayFpsCompact?: () => boolean,
 *   player: import('../player.js').player,
 *   onPlayHudFrame?: (data: object | null) => void,
 *   advanceWorldTime?: (dt: number) => void
 * }} api When `getPlayFpsCompact` is true, `#play-fps` shows only the rolling FPS (minimal / immersive UI).
 */
export function createGameLoop(api) {
  const {
    getAppMode,
    setGameTime,
    getCurrentData,
    updateView,
    refreshPlayModeInfoBar,
    getPlayFpsEl,
    getPlayFpsCompact,
    player,
    onPlayHudFrame,
    advanceWorldTime
  } = api;

  function gameLoop(timestamp) {
    const tLoopStart = performance.now();
    const dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    setGameTime(timestamp / 1000);
    if (getAppMode() === 'play') advanceWorldTime?.(dt);

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

    const updateBreakdown = {
      updPlayerMs: 0,
      updWildWindowMs: 0,
      updWildMs: 0,
      updPointerMs: 0,
      updMovesMs: 0,
      updGrassFireMs: 0,
      updBgmMs: 0,
      updHudMs: 0
    };

    const currentData = getCurrentData();
    const tUpdPlayer0 = performance.now();
    updatePlayer(dt, currentData);
    updateBreakdown.updPlayerMs = performance.now() - tUpdPlayer0;

    if (getAppMode() === 'play') {
      updateCrystalShardParticles(dt);
      updateCrystalDropsAndPickup(dt, player);
      updateBreakableDetailRegeneration(dt, currentData);
    }

    if (currentData && getAppMode() === 'play') {
      const pvx = player.visualX ?? player.x;
      const pvy = player.visualY ?? player.y;
      syncSpatialListenerFromPlayer(player);
      const tWildWindow0 = performance.now();
      syncWildPokemonWindow(currentData, pvx, pvy);
      updateBreakdown.updWildWindowMs = performance.now() - tWildWindow0;
      const tWild0 = performance.now();
      updateWildPokemon(dt, currentData, pvx, pvy);
      updateBreakdown.updWildMs = performance.now() - tWild0;
      const tPointer0 = performance.now();
      updatePlayPointerCombat(dt, player, currentData);
      updateBreakdown.updPointerMs = performance.now() - tPointer0;
      const tMoves0 = performance.now();
      updateMoves(dt, getWildPokemonEntities(), currentData, player);
      updateBreakdown.updMovesMs = performance.now() - tMoves0;
      const tGrassFire0 = performance.now();
      updateGrassFire(dt, currentData, pvx, pvy);
      updateBreakdown.updGrassFireMs = performance.now() - tGrassFire0;
      const tBgm0 = performance.now();
      syncBiomeBgm(currentData, player);
      updateBreakdown.updBgmMs = performance.now() - tBgm0;
      const tHud0 = performance.now();
      refreshPlayModeInfoBar();
      onPlayHudFrame?.(currentData);
      updateBreakdown.updHudMs = performance.now() - tHud0;
    }

    const tRenderStart = performance.now();
    updateView();
    const tRenderEnd = performance.now();
    const playFpsEl = getPlayFpsEl();
    if (getAppMode() === 'play' && playFpsEl) {
      const tEnd = performance.now();
      const frameMs = tEnd - tLoopStart;
      playFpsSampleTimes.push(tEnd);
      const cutoff = tEnd - 1000;
      while (playFpsSampleTimes.length && playFpsSampleTimes[0] < cutoff) playFpsSampleTimes.shift();
      const fps = playFpsSampleTimes.length;
      const compact = getPlayFpsCompact?.() ?? false;
      if (compact) {
        playFpsEl.textContent = `${fps} FPS`;
      } else {
        const lod = getPlayLodDetail();
        const updateMs = tRenderStart - tLoopStart;
        const renderMs = tRenderEnd - tRenderStart;
        const perf = ingestPlayPerfSample(frameMs, updateMs, renderMs, tEnd, updateBreakdown);
        const stablePct = perf.stableRatio01 * 100;
        const heavyUpdateSlices = [
          ['ply', perf.p95UpdPlayerMsStable],
          ['wnd', perf.p95UpdWildWindowMsStable],
          ['wld', perf.p95UpdWildMsStable],
          ['ptr', perf.p95UpdPointerMsStable],
          ['mov', perf.p95UpdMovesMsStable],
          ['grs', perf.p95UpdGrassFireMsStable],
          ['bgm', perf.p95UpdBgmMsStable],
          ['hud', perf.p95UpdHudMsStable]
        ]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, ms]) => `${k} ${ms.toFixed(1)}`)
          .join(' | ');
        const chunkStats = getPlayChunkFrameStats();
        const chunkBoostTag = chunkStats.bakeBoost > 0 ? ` · boost +${chunkStats.bakeBoost}` : '';
        const chunkInfo =
          chunkStats.mode === 'play'
            ? ` · chk ${chunkStats.drawnVisible}/${chunkStats.totalVisible}` +
              ` · miss ${chunkStats.missingVisible}` +
              ` · bake ${chunkStats.bakedThisFrame}/${chunkStats.bakeBudget}` +
              ` · q ${chunkStats.queueSize}` +
              chunkBoostTag
            : '';
        playFpsEl.textContent =
          `${fps} FPS · LOD ${lod} · ${frameMs.toFixed(1)} ms` +
          ` · p50 ${perf.p50Fps.toFixed(1)}fps` +
          ` · p95 ${perf.p95FrameMsStable.toFixed(1)}ms (stable)` +
          ` · upd p95 ${perf.p95UpdateMsStable.toFixed(1)}ms` +
          ` · rnd p95 ${perf.p95RenderMsStable.toFixed(1)}ms` +
          ` · upd top ${heavyUpdateSlices}` +
          ` · stable ${stablePct.toFixed(0)}%` +
          chunkInfo;
      }
    }
    if (getAppMode() === 'play') {
      animFrameId = requestAnimationFrame(gameLoop);
    }
  }

  function startGameLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    resetPlayPerfProfiler();
    playFpsSampleTimes.length = 0;
    lastTimestamp = performance.now();
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
 *   onPlaySocialAction?: (action: import('../social/social-actions.js').SocialAction) => void,
 *   player: import('../player.js').player
 * }} api
 */
export function registerPlayKeyboard(api) {
  const { getAppMode, getCurrentData, refreshPlayModeInfoBar, onEscapePlay, onPlaySocialAction, player } = api;

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

      const socialAction = !e.repeat ? getSocialActionByNumpadCode(e.code) : null;
      if (socialAction) {
        e.preventDefault();
        onPlaySocialAction?.(socialAction);
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

      if (!e.repeat && handleFieldSkillHotkeyDown(e.code)) {
        e.preventDefault();
      } else if (!e.repeat && castMappedMoveByHotkey(e.code, player)) {
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
    if (getAppMode() === 'play' && handleFieldSkillHotkeyUp(e.code, player, getCurrentData())) {
      e.preventDefault();
    }
    const dir = keyToDir(e.key);
    if (dir) heldKeys.delete(dir);
    },
    true
  );
}
