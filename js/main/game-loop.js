import { updatePlayer, tryJumpPlayer, togglePlayerCreativeFlight } from '../player.js';
import { getPlayLodDetail } from '../render/play-view-camera.js';
import { getPlayChunkFrameStats } from '../render.js';
import { playInputState } from './play-input-state.js';
import {
  syncWildPokemonWindow,
  updateWildPokemon,
  getWildPokemonEntities,
  wildUpdatePerfLast
} from '../wild-pokemon/index.js';
import { updateMoves, pushParticle } from '../moves/moves-manager.js';
import { updateGrassFire, GRASS_FIRE_PARTICLE_SEC } from '../play-grass-fire.js';
import { tickLightning } from '../weather/lightning.js';
import { getWeatherRainIntensity } from './weather-state.js';
import {
  updatePlayPointerCombat,
  handleFieldSkillHotkeyDown,
  handleFieldSkillHotkeyUp,
  handleSpecialAttackHotkeyDown,
  handleSpecialAttackHotkeyUp
} from './play-mouse-combat.js';
import { tryStrengthInteractKeyE, updateStrengthCarryInteraction } from './play-strength-carry.js';
import { updateThrownMapDetailEntities } from './thrown-map-detail-entities.js';
import {
  updateCrystalShardParticles,
  updateCrystalDropsAndPickup,
  updateBreakableDetailRegeneration
} from './play-crystal-tackle.js';
import { syncSpatialListenerFromPlayer } from '../audio/spatial-audio.js';
import { syncBiomeBgm } from '../audio/biome-bgm.js';
import { syncWeatherAmbientAudio } from '../audio/weather-ambient-audio.js';
import { syncEarthquakeAmbientAudio } from '../audio/earthquake-ambient-audio.js';
import { syncFireLoopAudio } from '../audio/fire-loop-sfx.js';
import { updatePlayGrassRustle } from '../audio/play-grass-rustle.js';
import { ingestPlayPerfSample, resetPlayPerfProfiler } from './play-performance-profiler.js';
import { getLastRenderFrameBreakdown, RENDER_FRAME_PHASE_HUD_LABELS } from '../render/render-frame-phases.js';
import { getSocialActionByNumpadCode } from '../social/social-actions.js';
import { tickPlaySessionAutosave } from './play-session-persist.js';
import { tickPlayGamepadFrame } from './play-gamepad.js';
import { getGameplaySimDt } from './play-dual-bind-wheel-time.js';
import { updateFarCrySystem } from './far-cry-system.js';
import { PluginRegistry } from '../core/plugin-registry.js';
import { canEntityStartSprint } from '../entity-stamina.js';
import { beginMicroTileCache, endMicroTileCache } from '../chunking.js';
import { updateBerryTrees, clearBerryTreeStates } from './berry-tree-system.js';

export const heldKeys = new Set();
export const playFpsSampleTimes = [];

let lastTimestamp = 0;
let animFrameId = null;
let lastBiomeBgmSyncAtMs = 0;
let lastWeatherAmbientSyncAtMs = 0;
let lastEarthquakeAmbientSyncAtMs = 0;
let lastFireLoopSyncAtMs = 0;

const PLAY_AUDIO_SYNC_BASE_CADENCE_MS = {
  biomeBgm: 120,
  weatherAmbient: 90,
  earthquakeAmbient: 70,
  fireLoop: 90
};
let playAudioSyncCadenceMs = { ...PLAY_AUDIO_SYNC_BASE_CADENCE_MS };

const PLAY_SUBSYSTEM_BASE_CADENCE_SEC = {
  wildWindow: 0,
  wildUpdate: 0,
  breakableRegen: 0,
  berryTrees: 0,
  thrownDetails: 0,
  hud: 0,
  farCry: 0,
  autosave: 0
};
let playSubsystemCadenceSec = { ...PLAY_SUBSYSTEM_BASE_CADENCE_SEC };

/** Built-in default = adaptive perf "Ultra" preset (main.js ADAPTIVE_PRESETS.ultra) merged onto full cadence shape. */
const PLAY_ADAPTIVE_DEFAULT = {
  enabled: true,
  relaxAfterMs: 2400,
  thresholds: {
    updateModerateMs: 9.5,
    updateHeavyMs: 11.4,
    updateVeryHeavyMs: 13.5,
    renderModerateMs: 9.8,
    renderHeavyMs: 11.5,
    wildModerateMs: 4.0,
    wildHeavyMs: 6.0,
    hudHeavyMs: 1.9,
    bgmHeavyMs: 1.35
  },
  moderate: {
    subsystemCadenceSec: {
      wildWindow: 0.05,
      wildUpdate: 0.02,
      breakableRegen: 0.08,
      berryTrees: 0.12,
      thrownDetails: 0.05,
      hud: 0.05,
      farCry: 0.05,
      autosave: 0.25
    },
    audioCadenceMs: {
      biomeBgm: 110,
      weatherAmbient: 95,
      earthquakeAmbient: 120,
      fireLoop: 140
    }
  },
  heavy: {
    subsystemCadenceSec: {
      wildWindow: 0.1,
      wildUpdate: 0.05,
      breakableRegen: 0.16,
      berryTrees: 0.2,
      thrownDetails: 0.1,
      hud: 0.08,
      farCry: 0.1,
      autosave: 0.5
    },
    audioCadenceMs: {
      biomeBgm: 150,
      weatherAmbient: 130,
      earthquakeAmbient: 180,
      fireLoop: 220
    }
  }
};
const playAdaptiveConfig = {
  enabled: PLAY_ADAPTIVE_DEFAULT.enabled,
  relaxAfterMs: PLAY_ADAPTIVE_DEFAULT.relaxAfterMs,
  thresholds: { ...PLAY_ADAPTIVE_DEFAULT.thresholds },
  moderate: {
    subsystemCadenceSec: { ...PLAY_ADAPTIVE_DEFAULT.moderate.subsystemCadenceSec },
    audioCadenceMs: { ...PLAY_ADAPTIVE_DEFAULT.moderate.audioCadenceMs }
  },
  heavy: {
    subsystemCadenceSec: { ...PLAY_ADAPTIVE_DEFAULT.heavy.subsystemCadenceSec },
    audioCadenceMs: { ...PLAY_ADAPTIVE_DEFAULT.heavy.audioCadenceMs }
  }
};

let playAdaptivePressure = 0;
let playAdaptivePressureChangedAtMs = 0;

/**
 * @param {ReturnType<typeof ingestPlayPerfSample>} perf
 * @returns {0 | 1 | 2}
 */
function getPlayAdaptivePressureFromPerf(perf) {
  let score = 0;
  const thr = playAdaptiveConfig.thresholds;
  if (perf.p95UpdateMsStable >= thr.updateVeryHeavyMs) score += 3;
  else if (perf.p95UpdateMsStable >= thr.updateHeavyMs) score += 2;
  else if (perf.p95UpdateMsStable >= thr.updateModerateMs) score += 1;

  if (perf.p95RenderMsStable >= thr.renderHeavyMs) score += 2;
  else if (perf.p95RenderMsStable >= thr.renderModerateMs) score += 1;

  if (perf.p95UpdWildMsStable >= thr.wildHeavyMs) score += 2;
  else if (perf.p95UpdWildMsStable >= thr.wildModerateMs) score += 1;

  if (perf.p95UpdHudMsStable >= thr.hudHeavyMs) score += 1;
  if (perf.p95UpdBgmMsStable >= thr.bgmHeavyMs) score += 1;

  if (score >= 5) return 2;
  if (score >= 2) return 1;
  return 0;
}

/**
 * @param {0 | 1 | 2} level
 */
function applyPlayAdaptivePressure(level) {
  playAdaptivePressure = level;
  if (level === 2) {
    playSubsystemCadenceSec = { ...playAdaptiveConfig.heavy.subsystemCadenceSec };
    playAudioSyncCadenceMs = { ...playAdaptiveConfig.heavy.audioCadenceMs };
    return;
  }
  if (level === 1) {
    playSubsystemCadenceSec = { ...playAdaptiveConfig.moderate.subsystemCadenceSec };
    playAudioSyncCadenceMs = { ...playAdaptiveConfig.moderate.audioCadenceMs };
    return;
  }
  playSubsystemCadenceSec = { ...PLAY_SUBSYSTEM_BASE_CADENCE_SEC };
  playAudioSyncCadenceMs = { ...PLAY_AUDIO_SYNC_BASE_CADENCE_MS };
}

/**
 * @param {ReturnType<typeof ingestPlayPerfSample>} perf
 * @param {number} nowMs
 */
function updatePlayAdaptivePressureFromPerf(perf, nowMs) {
  if (!playAdaptiveConfig.enabled) {
    if (playAdaptivePressure !== 0) {
      applyPlayAdaptivePressure(0);
      playAdaptivePressureChangedAtMs = nowMs;
    }
    return;
  }
  const nextLevel = getPlayAdaptivePressureFromPerf(perf);
  if (nextLevel === playAdaptivePressure) return;
  if (nextLevel > playAdaptivePressure) {
    applyPlayAdaptivePressure(nextLevel);
    playAdaptivePressureChangedAtMs = nowMs;
    return;
  }
  if (nowMs - playAdaptivePressureChangedAtMs < playAdaptiveConfig.relaxAfterMs) return;
  applyPlayAdaptivePressure(nextLevel);
  playAdaptivePressureChangedAtMs = nowMs;
}

function clonePlayAdaptiveConfigForUi() {
  return {
    enabled: playAdaptiveConfig.enabled,
    relaxAfterMs: playAdaptiveConfig.relaxAfterMs,
    thresholds: { ...playAdaptiveConfig.thresholds },
    moderate: {
      subsystemCadenceSec: { ...playAdaptiveConfig.moderate.subsystemCadenceSec },
      audioCadenceMs: { ...playAdaptiveConfig.moderate.audioCadenceMs }
    },
    heavy: {
      subsystemCadenceSec: { ...playAdaptiveConfig.heavy.subsystemCadenceSec },
      audioCadenceMs: { ...playAdaptiveConfig.heavy.audioCadenceMs }
    },
    runtime: {
      pressureLevel: playAdaptivePressure,
      activeSubsystemCadenceSec: { ...playSubsystemCadenceSec },
      activeAudioCadenceMs: { ...playAudioSyncCadenceMs }
    }
  };
}

/**
 * Runtime debug/tuning snapshot for adaptive perf caps.
 */
export function getPlayAdaptivePerfConfig() {
  return clonePlayAdaptiveConfigForUi();
}

/**
 * Runtime debug/tuning patch for adaptive perf caps.
 * @param {object} patch
 * @returns {ReturnType<typeof getPlayAdaptivePerfConfig>}
 */
export function patchPlayAdaptivePerfConfig(patch = {}) {
  if (!patch || typeof patch !== 'object') return clonePlayAdaptiveConfigForUi();

  const maybeBool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  const maybeNumber = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const mergeNumberObject = (target, src) => {
    if (!src || typeof src !== 'object') return;
    for (const k of Object.keys(target)) {
      target[k] = maybeNumber(src[k], target[k]);
    }
  };

  playAdaptiveConfig.enabled = maybeBool(patch.enabled, playAdaptiveConfig.enabled);
  playAdaptiveConfig.relaxAfterMs = Math.max(
    500,
    maybeNumber(patch.relaxAfterMs, playAdaptiveConfig.relaxAfterMs)
  );

  if (patch.thresholds && typeof patch.thresholds === 'object') {
    mergeNumberObject(playAdaptiveConfig.thresholds, patch.thresholds);
  }
  if (patch.moderate && typeof patch.moderate === 'object') {
    mergeNumberObject(playAdaptiveConfig.moderate.subsystemCadenceSec, patch.moderate.subsystemCadenceSec);
    mergeNumberObject(playAdaptiveConfig.moderate.audioCadenceMs, patch.moderate.audioCadenceMs);
  }
  if (patch.heavy && typeof patch.heavy === 'object') {
    mergeNumberObject(playAdaptiveConfig.heavy.subsystemCadenceSec, patch.heavy.subsystemCadenceSec);
    mergeNumberObject(playAdaptiveConfig.heavy.audioCadenceMs, patch.heavy.audioCadenceMs);
  }

  if (playAdaptivePressure > 0) {
    applyPlayAdaptivePressure(playAdaptivePressure);
  } else {
    applyPlayAdaptivePressure(0);
  }
  return clonePlayAdaptiveConfigForUi();
}

/**
 * Restore adaptive perf caps to built-in defaults.
 */
export function resetPlayAdaptivePerfConfig() {
  playAdaptiveConfig.enabled = PLAY_ADAPTIVE_DEFAULT.enabled;
  playAdaptiveConfig.relaxAfterMs = PLAY_ADAPTIVE_DEFAULT.relaxAfterMs;
  playAdaptiveConfig.thresholds = { ...PLAY_ADAPTIVE_DEFAULT.thresholds };
  playAdaptiveConfig.moderate = {
    subsystemCadenceSec: { ...PLAY_ADAPTIVE_DEFAULT.moderate.subsystemCadenceSec },
    audioCadenceMs: { ...PLAY_ADAPTIVE_DEFAULT.moderate.audioCadenceMs }
  };
  playAdaptiveConfig.heavy = {
    subsystemCadenceSec: { ...PLAY_ADAPTIVE_DEFAULT.heavy.subsystemCadenceSec },
    audioCadenceMs: { ...PLAY_ADAPTIVE_DEFAULT.heavy.audioCadenceMs }
  };
  if (playAdaptivePressure > 0) {
    applyPlayAdaptivePressure(playAdaptivePressure);
  } else {
    applyPlayAdaptivePressure(0);
  }
  return clonePlayAdaptiveConfigForUi();
}

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
 *   advanceWorldTime?: (dt: number) => void,
 *   getGameTimeSec?: () => number,
 *   onEscapePlay?: () => void,
 *   getPlaySessionPersistExtra?: () => object | null
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
    advanceWorldTime,
    getGameTimeSec,
    onEscapePlay,
    getPlaySessionPersistExtra
  } = api;
  let lastFpsHudWriteMs = 0;
  let lastFpsHudText = '';
  let lastFpsHudCompact = null;
  let accWildWindowSec = 0;
  let accWildUpdateSec = 0;
  let accBreakableRegenSec = 0;
  let accBerryTreesSec = 0;
  let accThrownDetailsSec = 0;
  let accHudSec = 0;
  let accFarCrySec = 0;
  let accAutosaveSec = 0;

  function shouldRunCadenced(nowMs, lastRunAtMs, cadenceMs) {
    return nowMs - lastRunAtMs >= cadenceMs;
  }

  /**
   * @param {number} accumulatorSec
   * @param {number} dtSec
   * @param {number} cadenceSec
   * @returns {{ nextAccumulatorSec: number, shouldRun: boolean, stepDtSec: number }}
   */
  function consumeCadence(accumulatorSec, dtSec, cadenceSec) {
    if (!(cadenceSec > 0)) {
      return { nextAccumulatorSec: 0, shouldRun: true, stepDtSec: dtSec };
    }
    const nextAccumulatorSec = accumulatorSec + dtSec;
    if (nextAccumulatorSec < cadenceSec) {
      return { nextAccumulatorSec, shouldRun: false, stepDtSec: 0 };
    }
    return { nextAccumulatorSec: 0, shouldRun: true, stepDtSec: nextAccumulatorSec };
  }

  function gameLoop(timestamp) {
    const tLoopStart = performance.now();
    const dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    const simDt = getGameplaySimDt(dt);
    setGameTime(timestamp / 1000);

    // --- Plugin Hooks: preUpdate ---
    PluginRegistry.executeHooks('preUpdate', simDt);

    if (getAppMode() === 'play') advanceWorldTime?.(simDt);

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

    const { inX: mergedX, inY: mergedY, gamepadAnalogMove } = tickPlayGamepadFrame({
      getAppMode,
      getCurrentData,
      player,
      refreshPlayModeInfoBar,
      onEscapePlay,
      keyboardMoveX: inX,
      keyboardMoveY: inY
    });

    if (['play'].includes(getAppMode())) {
      if (mergedX === 0 && mergedY === 0) {
        player.runMode = false;
      } else if (gamepadAnalogMove) {
        // Joystick move: sprint only while run button (A / Cross) is held — release stops running.
        if (playInputState.gamepadRunHeld && canEntityStartSprint(player)) {
          player.runMode = true;
        } else {
          player.runMode = false;
        }
      } else if (playInputState.gamepadRunHeld && canEntityStartSprint(player)) {
        player.runMode = true;
      }
      player.inputX = mergedX;
      player.inputY = mergedY;
    } else {
      player.inputX = 0;
      player.inputY = 0;
    }

    const updateBreakdown = {
      updPlayerMs: 0,
      updWildWindowMs: 0,
      updWildMs: 0,
      updWildMiscMs: 0,
      updWildVerticalMs: 0,
      updWildSocialMs: 0,
      updWildMotionMs: 0,
      updWildPostMs: 0,
      updPointerMs: 0,
      updMovesMs: 0,
      updGrassFireMs: 0,
      updBgmMs: 0,
      updHudMs: 0
    };

    beginMicroTileCache();
    try {

      const currentData = getCurrentData();
    const tUpdPlayer0 = performance.now();
    updatePlayer(simDt, currentData, getGameTimeSec?.());
    updateBreakdown.updPlayerMs = performance.now() - tUpdPlayer0;
    updatePlayGrassRustle(simDt, player, getAppMode() === 'play' ? currentData : null);

    if (getAppMode() === 'play') {
      updateCrystalShardParticles(simDt);
      updateCrystalDropsAndPickup(simDt, player);
      const breakableGate = consumeCadence(
        accBreakableRegenSec,
        simDt,
        playSubsystemCadenceSec.breakableRegen
      );
      accBreakableRegenSec = breakableGate.nextAccumulatorSec;
      if (breakableGate.shouldRun) {
        updateBreakableDetailRegeneration(breakableGate.stepDtSec, currentData);
      }
      const berryGate = consumeCadence(accBerryTreesSec, simDt, playSubsystemCadenceSec.berryTrees);
      accBerryTreesSec = berryGate.nextAccumulatorSec;
      if (berryGate.shouldRun) {
        updateBerryTrees(getGameTimeSec?.() ?? 0);
      }
    }

    if (currentData && getAppMode() === 'play') {
      const pvx = player.visualX ?? player.x;
      const pvy = player.visualY ?? player.y;
      syncSpatialListenerFromPlayer(player);
      const tWildWindow0 = performance.now();
      const wildWindowGate = consumeCadence(
        accWildWindowSec,
        simDt,
        playSubsystemCadenceSec.wildWindow
      );
      accWildWindowSec = wildWindowGate.nextAccumulatorSec;
      if (wildWindowGate.shouldRun) {
        syncWildPokemonWindow(currentData, pvx, pvy);
      }
      updateBreakdown.updWildWindowMs = performance.now() - tWildWindow0;
      const tWild0 = performance.now();
      const wildUpdateGate = consumeCadence(
        accWildUpdateSec,
        simDt,
        playSubsystemCadenceSec.wildUpdate
      );
      accWildUpdateSec = wildUpdateGate.nextAccumulatorSec;
      if (wildUpdateGate.shouldRun) {
        updateWildPokemon(wildUpdateGate.stepDtSec, currentData, pvx, pvy);
      }
      updateBreakdown.updWildMs = performance.now() - tWild0;
      updateBreakdown.updWildMiscMs = wildUpdatePerfLast.miscMs;
      updateBreakdown.updWildVerticalMs = wildUpdatePerfLast.verticalMs;
      updateBreakdown.updWildSocialMs = wildUpdatePerfLast.socialMs;
      updateBreakdown.updWildMotionMs = wildUpdatePerfLast.motionMs;
      updateBreakdown.updWildPostMs = wildUpdatePerfLast.postMs;
      const tPointer0 = performance.now();
      updatePlayPointerCombat(simDt, player, currentData);
      updateStrengthCarryInteraction(simDt, player, currentData);
      const thrownGate = consumeCadence(
        accThrownDetailsSec,
        simDt,
        playSubsystemCadenceSec.thrownDetails
      );
      accThrownDetailsSec = thrownGate.nextAccumulatorSec;
      if (thrownGate.shouldRun) {
        updateThrownMapDetailEntities(thrownGate.stepDtSec, currentData);
      }
      updateBreakdown.updPointerMs = performance.now() - tPointer0;
      const tMoves0 = performance.now();
      updateMoves(simDt, getWildPokemonEntities(), currentData, player);
      updateBreakdown.updMovesMs = performance.now() - tMoves0;
      const tGrassFire0 = performance.now();
      updateGrassFire(simDt, currentData, pvx, pvy, (wx, wy) => {
        pushParticle({
          type: 'grassFire',
          x: wx,
          y: wy,
          vx: 0,
          vy: 0,
          z: 0.06,
          vz: 0,
          life: GRASS_FIRE_PARTICLE_SEC,
          maxLife: GRASS_FIRE_PARTICLE_SEC
        });
      });
      updateBreakdown.updGrassFireMs = performance.now() - tGrassFire0;
      tickLightning(simDt, {
        rainIntensity: getWeatherRainIntensity(),
        playerWorldX: pvx,
        playerWorldY: pvy,
        data: currentData
      });
      const tBgm0 = performance.now();
      const nowMs = performance.now();
      if (
        shouldRunCadenced(
          nowMs,
          lastBiomeBgmSyncAtMs,
          playAudioSyncCadenceMs.biomeBgm
        )
      ) {
        syncBiomeBgm(currentData, player);
        lastBiomeBgmSyncAtMs = nowMs;
      }
      if (
        shouldRunCadenced(
          nowMs,
          lastWeatherAmbientSyncAtMs,
          playAudioSyncCadenceMs.weatherAmbient
        )
      ) {
        syncWeatherAmbientAudio();
        lastWeatherAmbientSyncAtMs = nowMs;
      }
      if (
        shouldRunCadenced(
          nowMs,
          lastEarthquakeAmbientSyncAtMs,
          playAudioSyncCadenceMs.earthquakeAmbient
        )
      ) {
        syncEarthquakeAmbientAudio(getGameTimeSec?.() ?? 0);
        lastEarthquakeAmbientSyncAtMs = nowMs;
      }
      if (
        shouldRunCadenced(
          nowMs,
          lastFireLoopSyncAtMs,
          playAudioSyncCadenceMs.fireLoop
        )
      ) {
        syncFireLoopAudio(currentData, player);
        lastFireLoopSyncAtMs = nowMs;
      }
      updateBreakdown.updBgmMs = performance.now() - tBgm0;
      const tHud0 = performance.now();
      const hudGate = consumeCadence(accHudSec, simDt, playSubsystemCadenceSec.hud);
      accHudSec = hudGate.nextAccumulatorSec;
      if (hudGate.shouldRun) {
        refreshPlayModeInfoBar();
        onPlayHudFrame?.(currentData);
      }
      updateBreakdown.updHudMs = performance.now() - tHud0;
      const farCryGate = consumeCadence(accFarCrySec, simDt, playSubsystemCadenceSec.farCry);
      accFarCrySec = farCryGate.nextAccumulatorSec;
      if (farCryGate.shouldRun) {
        updateFarCrySystem(farCryGate.stepDtSec, player, currentData);
      }
      const autosaveGate = consumeCadence(accAutosaveSec, simDt, playSubsystemCadenceSec.autosave);
      accAutosaveSec = autosaveGate.nextAccumulatorSec;
      if (autosaveGate.shouldRun) {
        tickPlaySessionAutosave(timestamp / 1000, currentData, player, getPlaySessionPersistExtra?.() ?? null);
      }
    }

      // --- Plugin Hooks: postUpdate ---
      PluginRegistry.executeHooks('postUpdate', simDt);
    } finally {
      endMicroTileCache();
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
      const hudCadenceMs = compact ? 250 : 160;
      const compactChanged = lastFpsHudCompact == null || compact !== lastFpsHudCompact;
      if (!compactChanged && tEnd - lastFpsHudWriteMs < hudCadenceMs) {
        // Keep HUD responsive enough while avoiding per-frame text/layout churn.
      } else if (compact) {
        const text = `${fps} FPS`;
        if (text !== lastFpsHudText) {
          playFpsEl.textContent = text;
          lastFpsHudText = text;
        }
        lastFpsHudWriteMs = tEnd;
        lastFpsHudCompact = compact;
      } else {
        const lod = getPlayLodDetail();
        const updateMs = tRenderStart - tLoopStart;
        const renderMs = tRenderEnd - tRenderStart;
        const perf = ingestPlayPerfSample(frameMs, updateMs, renderMs, tEnd, updateBreakdown, getLastRenderFrameBreakdown());
        updatePlayAdaptivePressureFromPerf(perf, tEnd);
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
        ].sort((a, b) => b[1] - a[1]);
        const top3HeavyUpdate = heavyUpdateSlices
          .slice(0, 3)
          .map(([k, ms]) => `${k} ${ms.toFixed(1)}`)
          .join(' | ');
        const maxHeavyMs = heavyUpdateSlices.length ? heavyUpdateSlices[0][1] : 0;
        const wildIsHeavy =
          perf.p95UpdWildMsStable >= 2.5 && perf.p95UpdWildMsStable >= maxHeavyMs * 0.92;
        const wildSubHeavy = wildIsHeavy
          ? [
              ['m', perf.p95UpdWildMotionMsStable],
              ['soc', perf.p95UpdWildSocialMsStable],
              ['misc', perf.p95UpdWildMiscMsStable],
              ['y', perf.p95UpdWildVerticalMsStable],
              ['post', perf.p95UpdWildPostMsStable]
            ]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([k, ms]) => `${k} ${ms.toFixed(1)}`)
              .join(' | ')
          : '';
        const wildSubTag = wildSubHeavy ? ` · wldΔ ${wildSubHeavy}` : '';
        const rndHeavy = Object.entries(perf.renderP95Stable)
          .map(([k, ms]) => [RENDER_FRAME_PHASE_HUD_LABELS[k] || k, ms])
          .sort((a, b) => b[1] - a[1]);
        const top3HeavyRender = rndHeavy
          .slice(0, 3)
          .map(([k, ms]) => `${k} ${ms.toFixed(1)}`)
          .join(' | ');
        const chunkStats = getPlayChunkFrameStats();
        const chunkBoostTag = chunkStats.bakeBoost > 0 ? ` · boost +${chunkStats.bakeBoost}` : '';
        const chunkInfo =
          chunkStats.mode === 'play'
            ? `chk ${chunkStats.drawnVisible}/${chunkStats.totalVisible}` +
              ` · miss ${chunkStats.missingVisible}` +
              ` · bake ${chunkStats.bakedThisFrame}/${chunkStats.bakeBudget}` +
              ` · q ${chunkStats.queueSize}` +
              chunkBoostTag
            : '';
        const fpsHudLines = [
          `${fps} FPS · LOD ${lod} · ${frameMs.toFixed(1)} ms · p50 ${perf.p50Fps.toFixed(1)}fps`,
          `p95 ${perf.p95FrameMsStable.toFixed(1)}ms (stable) · upd p95 ${perf.p95UpdateMsStable.toFixed(1)}ms · rnd p95 ${perf.p95RenderMsStable.toFixed(1)}ms`,
          `rnd top ${top3HeavyRender}`,
          `upd top ${top3HeavyUpdate}${wildSubTag}`,
          `stable ${stablePct.toFixed(0)}%${chunkInfo ? ` · ${chunkInfo}` : ''}${playAdaptivePressure ? ` · cap p${playAdaptivePressure}` : ''}`
        ];
        const text = fpsHudLines.join('\n');
        if (text !== lastFpsHudText) {
          playFpsEl.textContent = text;
          lastFpsHudText = text;
        }
        lastFpsHudWriteMs = tEnd;
        lastFpsHudCompact = compact;
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
    lastBiomeBgmSyncAtMs = 0;
    lastWeatherAmbientSyncAtMs = 0;
    lastEarthquakeAmbientSyncAtMs = 0;
    lastFireLoopSyncAtMs = 0;
    applyPlayAdaptivePressure(0);
    playAdaptivePressureChangedAtMs = performance.now();
    accWildWindowSec = 0;
    accWildUpdateSec = 0;
    accBreakableRegenSec = 0;
    accBerryTreesSec = 0;
    accThrownDetailsSec = 0;
    accHudSec = 0;
    accFarCrySec = 0;
    accAutosaveSec = 0;
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
            if (canEntityStartSprint(player)) player.runMode = true;
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
      } else if (!e.repeat && handleSpecialAttackHotkeyDown(e.code)) {
        e.preventDefault();
      } else if (!e.repeat && e.code === 'KeyE') {
        const data = getCurrentData();
        if (data && tryStrengthInteractKeyE(player, data)) {
          e.preventDefault();
        }
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
    } else if (getAppMode() === 'play' && handleSpecialAttackHotkeyUp(e.code, player)) {
      e.preventDefault();
    }
    const dir = keyToDir(e.key);
    if (dir) heldKeys.delete(dir);
    },
    true
  );
}
