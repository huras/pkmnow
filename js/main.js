import { isPlayShell } from './main/app-shell.js';
import { setPlayPointerMode } from './main/play-pointer-mode.js';
import { generate, DEFAULT_CONFIG } from './generator.js';
import { render, loadTilesetImages } from './render.js';
import {
  resetWildPokemonManager,
  triggerPlayerSocialAction
} from './wild-pokemon/index.js';
import { resetThrownMapDetailEntities } from './main/thrown-map-detail-entities.js';
import { ensurePokemonSheetsLoaded, getResolvedSheets } from './pokemon/pokemon-asset-loader.js';
import { resolvePmdFrameSpecForSlice } from './pokemon/pmd-layout-metrics.js';
import { ensureEffectAssetsLoaded } from './pokemon/effect-asset-loader.js';
import { CharacterSelector } from './ui/character-selector.js';
import { imageCache } from './image-cache.js';
import { BIOMES } from './biomes.js';
import { player, setPlayerPos, showPlayerSocialEmotion } from './player.js';
import { MACRO_TILE_STRIDE, getMicroTile } from './chunking.js';
import { buildPlayModeTileDebugInfo } from './main/play-tile-debug-info.js';
import {
  configureTileDebugModal,
  getLastTileDebugInfo,
  getLastDetailDebugInfo,
  openDebugModal,
  openDetailDebugModal
} from './main/tile-debug-modal.js';
import { buildPlayModeDetailDebugPayload } from './main/play-tree-debug-payload.js';
import { installPlayContextMenu } from './main/play-context-menu.js';
import {
  createGameLoop,
  registerPlayKeyboard,
  playFpsSampleTimes,
  getPlayAdaptivePerfConfig,
  patchPlayAdaptivePerfConfig,
  resetPlayAdaptivePerfConfig
} from './main/game-loop.js';
import { registerPlayGamepadListeners } from './main/play-gamepad.js';
import {
  tryApplyPlaySessionResumeOnEnter,
  resetPlayAutosaveSchedule,
  flushPlaySessionSave,
  peekPlaySessionSaveForMap,
  getPlayResumeMacroTileFromSave,
  parseMapFingerprint
} from './main/play-session-persist.js';
import { getWindDirectionRad, getWindFeltIntensity } from './main/wind-state.js';
import { getWeatherPresetLabel } from './main/weather-presets.js';
import {
  initWeatherSystem,
  tickWeather,
  getWeatherTarget,
  setWeatherTarget,
  getActiveWeatherParams,
  getActiveWeatherPresetBlend,
  addWeatherTargetChangeListener
} from './main/weather-system.js';
import {
  initEarthquakeLayer,
  tickEarthquakeLayer,
  setEarthquakeTargetIntensity01,
  getEarthquakeActiveIntensity01
} from './main/earthquake-layer.js';
import {
  initSunLightRaysLayer,
  tickSunLightRaysLayer,
  setSunLightRaysTargetIntensity01,
  getSunLightRaysActiveIntensity01,
  getSunLightRaysTargetIntensity01
} from './main/sun-light-rays-layer.js';
import { forceTriggerLightningNearPlayer } from './weather/lightning.js';
import { installPlayPointerCombat } from './main/play-mouse-combat.js';
import {
  clearPlayCrystalTackleState,
  placeInventoryItemAsScatterDetailNear,
  refundOneInventoryUnitFromGroundDrop,
  trySpendOneInventoryUnitForGroundDrop
} from './main/play-crystal-tackle.js';
import { getStrengthGrabPromptInfo, getStrengthCarryMobilityInfo } from './main/play-strength-carry.js';
import { renderMapHoverDetails, MAP_HOVER_MIN_INTERVAL_MS } from './main/map-hover-hud.js';
import { createPlaySocialOverlay } from './main/play-social-overlay.js';
import { clearScatterSolidBlockCache } from './scatter-pass2-debug.js';
import {
  buildPlayColliderOverlayCache,
  clearPlayColliderOverlayCache,
  ensurePlayColliderOverlayCache,
  getPlayColliderOverlayCache
} from './main/play-collider-overlay-cache.js';
import { playInputState } from './main/play-input-state.js';
import { playScreenPixelsToWorldTileCoords, clearPlayCameraSnapshot } from './render/play-camera-snapshot.js';
import {
  recordPlayPointerClient,
  clientToCanvasPixels,
  getPlayHoverMicroTile,
  invalidatePlayPointerHover
} from './main/play-pointer-world.js';
import { setPlayForceLod0Always } from './render/play-view-camera.js';
import { detailScatterGridPreviewHtml } from './main/detail-scatter-preview-html.js';
import { getBiomeBgmUiState, stopBiomeBgm } from './audio/biome-bgm.js';
import { stopWeatherAmbientAudio } from './audio/weather-ambient-audio.js';
import { stopEarthquakeAmbientAudio } from './audio/earthquake-ambient-audio.js';
import { stopFireLoopAudio } from './audio/fire-loop-sfx.js';
import { isBgmTrackChangeToastSuppressed } from './audio/play-audio-mix-settings.js';
import { installMinimapAudioUi } from './main/minimap-audio-ui.js';
import { installPlayHelpWikiModal } from './main/play-help-wiki-modal.js';
import { installMinimapSaveModal } from './main/minimap-save-modal.js';
import { renderMapOverlaySvg } from './render/render-map-overlay-svg.js';
import { stepMinimapZoom, getMinimapZoomUiLines } from './render/render-minimap.js';
import {
  configureWorldMapCamera,
  getWorldMapCamera,
  panWorldMapByScreenDelta,
  resetWorldMapCamera,
  screenPxToWorldMacro,
  tickWorldMapCamera,
  zoomWorldMapByFactorAtScreenPoint
} from './main/world-map-camera-state.js';
import {
  advanceWorldHours,
  dayPhaseLabelEn,
  getDayPhaseFromHours,
  getSmoothedDayCycleTintForRender,
  PRESET_HOUR,
  snapDayCycleTintSmoothToHours,
  tickDayCycleTintSmooth,
  wrapHours
} from './main/world-time-of-day.js';
import { installMinimapHudPopovers } from './main/minimap-hud-popovers.js';
import { initMods } from './core/mod-loader.js';
import { resetFarCrySystem } from './main/far-cry-system.js';
import {
  applyI18nDom,
  formatNumber,
  getBiomeNameById,
  getLocale,
  getSupportedLocales,
  initI18n,
  onLocaleChanged,
  setLocale,
  t
} from './i18n/index.js';


if (isPlayShell()) {
  setPlayPointerMode('game');
}

initI18n();

const canvas = document.getElementById('map');
const mapOverlaySvg = /** @type {SVGSVGElement | null} */ (document.getElementById('map-overlay-svg'));
const WORLD_MAP_CONTINUOUS_ZOOM_ENABLED = true;
const WORLD_MAP_USE_SVG_OVERLAY = false;

/** Blur inputs / buttons so WASD and hotkeys go to the game after clicking the map. */
function blurFocusedUiAwayFromCanvas() {
  const ae = document.activeElement;
  if (!ae || ae === canvas) return;
  if (!(ae instanceof HTMLElement)) return;
  if (
    ae instanceof HTMLInputElement ||
    ae instanceof HTMLTextAreaElement ||
    ae instanceof HTMLSelectElement ||
    ae instanceof HTMLButtonElement
  ) {
    ae.blur();
    return;
  }
  if (ae.isContentEditable) {
    ae.blur();
  }
}

function focusGameCanvas() {
  if (!canvas) return;
  try {
    canvas.focus({ preventScroll: true });
  } catch {
    try {
      canvas.focus();
    } catch {
      /* ignore */
    }
  }
}

if (canvas) {
  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.currentTarget !== canvas) return;
    blurFocusedUiAwayFromCanvas();
    focusGameCanvas();
  });
}

const minimap = document.getElementById('minimap');
const minimapPanel = document.getElementById('minimap-panel');
const btnMinimapBackToMap = document.getElementById('minimap-back-to-map');
const btnMinimapZoomIn = document.getElementById('minimap-zoom-in-btn');
const btnMinimapZoomOut = document.getElementById('minimap-zoom-out-btn');
const btnMinimapAdaptivePerfToggle = document.getElementById('minimap-adaptive-perf-toggle');
const btnMinimapShowSpawnedToggle = document.getElementById('minimap-show-spawned-toggle');
const minimapLanguageSelect = /** @type {HTMLSelectElement | null} */ (
  document.getElementById('minimap-language-select')
);
const LS_MINIMAP_SHOW_ALL_SPAWNED_DEBUG = 'pkmn_debug_minimap_show_all_spawned';
let minimapShowAllSpawnedDebug = false;

function syncMinimapShowSpawnedToggleUi() {
  btnMinimapShowSpawnedToggle?.setAttribute('aria-pressed', minimapShowAllSpawnedDebug ? 'true' : 'false');
}

function setMinimapShowSpawnedDebug(next) {
  minimapShowAllSpawnedDebug = !!next;
  syncMinimapShowSpawnedToggleUi();
  try {
    localStorage.setItem(LS_MINIMAP_SHOW_ALL_SPAWNED_DEBUG, minimapShowAllSpawnedDebug ? '1' : '0');
  } catch {
    // ignore localStorage failures
  }
}

try {
  minimapShowAllSpawnedDebug = localStorage.getItem(LS_MINIMAP_SHOW_ALL_SPAWNED_DEBUG) === '1';
} catch {
  minimapShowAllSpawnedDebug = false;
}
syncMinimapShowSpawnedToggleUi();
btnMinimapShowSpawnedToggle?.addEventListener('click', () => {
  setMinimapShowSpawnedDebug(!minimapShowAllSpawnedDebug);
});

function syncMinimapZoomReadout() {
  if (!minimap) return;
  const zoom = minimap.dataset.zoom || 'close';
  const { title, subtitle } = getMinimapZoomUiLines(zoom);
  const titleEl = document.getElementById('minimap-zoom-readout-title');
  const subEl = document.getElementById('minimap-zoom-readout-sub');
  const readout = document.getElementById('minimap-zoom-readout');
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  if (readout) readout.title = `${title} — ${subtitle}`;
}

function wireMinimapZoomStepButtons() {
  if (!minimap) return;
  const c = /** @type {HTMLCanvasElement} */ (minimap);
  btnMinimapZoomIn?.addEventListener('click', () => {
    stepMinimapZoom(c, 1);
    syncMinimapZoomReadout();
  });
  btnMinimapZoomOut?.addEventListener('click', () => {
    stepMinimapZoom(c, -1);
    syncMinimapZoomReadout();
  });
}

function syncMinimapLanguageSelect() {
  if (!minimapLanguageSelect) return;
  minimapLanguageSelect.textContent = '';
  const labels = {
    'pt-BR': 'Portugues (BR)',
    'en-US': 'English (US)',
    'ja-JP': '日本語'
  };
  for (const locale of getSupportedLocales()) {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = labels[locale] || locale;
    minimapLanguageSelect.appendChild(option);
  }
  minimapLanguageSelect.value = getLocale();
}

function wireMinimapLanguageSelect() {
  if (!minimapLanguageSelect) return;
  syncMinimapLanguageSelect();
  minimapLanguageSelect.addEventListener('change', () => {
    setLocale(minimapLanguageSelect.value);
  });
}

wireMinimapZoomStepButtons();
wireMinimapLanguageSelect();
syncMinimapZoomReadout();
const seedInput = document.getElementById('seed');
const btnGenerate = document.getElementById('generate');
const infoBar = document.getElementById('hud-info');
const btnExport = document.getElementById('exportBtn');
const btnImport = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const btnSettings = document.getElementById('btnSettings');
const settingsModal = document.getElementById('settingsModal');
const btnApplySettings = document.getElementById('btnApplySettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnExportWorldSettings = document.getElementById('btnExportWorldSettings');
const btnContinuePlay = document.getElementById('btnContinuePlay');
const btnBackToMap = document.getElementById('btnBackToMap');
const playFpsEl = document.getElementById('play-fps');
const playContextMenu = document.getElementById('play-context-menu');
const btnPlayCtxTeleport = document.getElementById('play-ctx-teleport');
const btnPlayCtxDebug = document.getElementById('play-ctx-debug');
const btnPlayCtxViewDetailData = document.getElementById('play-ctx-view-detail-data');
const btnPlayCtxShowDetailCollider = document.getElementById('play-ctx-show-detail-collider');
const btnPlayCtxClearDetailCollider = document.getElementById('play-ctx-clear-detail-collider');
const debugModal = document.getElementById('tile-debug-modal');
const debugContent = document.getElementById('tile-debug-content');
const btnDebugClose = document.getElementById('tile-debug-close');
const btnDebugCopy = document.getElementById('tile-debug-copy-json');
const btnDebugCopyDetail = document.getElementById('tile-debug-copy-detail-json');
const playBgmNowPlayingEl = document.getElementById('play-bgm-now-playing');
const playBgmNowPlayingTrackEl = document.getElementById('play-bgm-now-playing-track');
const playBgmNowPlayingStatusEl = document.getElementById('play-bgm-now-playing-status');
const playBgmToastEl = document.getElementById('play-bgm-toast');
const playBgmToastTrackEl = document.getElementById('play-bgm-toast-track');
const playBgmToastStatusEl = document.getElementById('play-bgm-toast-status');
const playImmersiveHintEl = document.getElementById('play-immersive-hint');
const playWorldTimeSlider = document.getElementById('play-world-time-slider');
const playWorldTimeRun = document.getElementById('play-world-time-run');
const playWorldTimePhaseEl = document.getElementById('play-world-time-phase');
const playWorldTimeHourEl = document.getElementById('play-world-time-hour');
const playSessionTimeEl = document.getElementById('play-session-time');
const playWeatherCloudIntensityEl = document.getElementById('play-weather-cloud-intensity');
const playWeatherRainIntensityEl = document.getElementById('play-weather-rain-intensity');
const playEarthquakeIntensityEl = document.getElementById('play-earthquake-intensity');
const playSunLightRaysIntensityEl = document.getElementById('play-sun-light-rays-intensity');
const playVisionFogToggleEl = document.getElementById('play-vision-fog-toggle');
const playWeatherCurrentEl = document.getElementById('play-weather-current');
const playWeatherPresetBtns = Array.from(document.querySelectorAll('.play-weather-preset'));
const chkRotas = document.getElementById('chkRotas');
const chkGrafo = document.getElementById('chkGrafo');
const chkCurvas = document.getElementById('chkCurvas');

if (playBgmNowPlayingEl) {
  playBgmNowPlayingEl.hidden = true;
  playBgmNowPlayingEl.style.display = 'none';
}
const chkPlayColliders = document.getElementById('chkPlayColliders');
const chkWorldReactionsOverlay = document.getElementById('chkWorldReactionsOverlay');
const inputViewTypeBiomes = document.querySelector('input[name="viewType"][value="biomes"]');
const inputViewTypeTerrain = document.querySelector('input[name="viewType"][value="terrain"]');
let playSocialOverlay = {
  flashAction: () => {},
  clearActive: () => {},
  refreshPortraits: () => Promise.resolve()
};

let currentData = null;
/** One-shot: after first region load, auto-enter play (save resume or random city). */
let didAutoResumePlayOnInitialLoad = false;
/** @type {import('./ui/character-selector.js').CharacterSelector | null} */
let playCharacterSelector = null;
let appMode = 'map';
let currentConfig = { ...DEFAULT_CONFIG };
let gameTime = 0;
/** World clock for day phases (hours in [0, 24)). */
let worldHours = 12;
/** Accumulated elapsed seconds while in play mode. */
let playSessionSeconds = 0;
let worldTimeRunning = true;
/** After play on this map in the page session; map overview can show live player if there is no save yet. */
let sessionEnteredPlayOnCurrentMap = false;
// Weather engine state lives in `./main/weather-system.js` — this file only wires the
// DOM panel + the tick call. Initial seed here so the first `getActiveWeatherParams()`
// read (during `getSettings()` before the first tick) returns the correct shape.
initWeatherSystem({ preset: 'cloudy', intensity01: 0.75 });
initEarthquakeLayer({ intensity01: 0 });
initSunLightRaysLayer({ intensity01: 0 });
/** @type {string | null} */
let lastWorldTimePanelPhase = null;
let lastBgmUiSignature = '';
/** Last track title used for immersive toast dedupe (not the full panel signature). */
/** @type {string | null} */
let lastBgmToastTrackKey = null;
let playBgmToastHideTimer = 0;
/** @type {object | null} */
let playDetailColliderHighlight = null;
let worldMapCameraRaf = 0;
let worldMapRenderLoopRaf = 0;
let mapDragPointerId = -1;
let mapDragMovedPx = 0;
let mapDragLastClientX = 0;
let mapDragLastClientY = 0;
let suppressNextMapClick = false;

const PLAY_BGM_TOAST_MS = 4600;

function isPlayImmersiveMinimalUi() {
  return document.querySelector('.app')?.classList.contains('app--play-immersive') ?? false;
}

function installAdaptivePerfDebugPanel() {
  const host = document.body;
  if (!host) return;
  const LS_ADAPTIVE_CFG = 'pkmn_adaptive_perf_caps_cfg_v1';
  const LS_ADAPTIVE_PRESET = 'pkmn_adaptive_perf_caps_preset_v1';
  const panel = document.createElement('details');
  panel.id = 'play-adaptive-perf-debug-panel';
  panel.style.position = 'fixed';
  panel.style.right = '10px';
  panel.style.bottom = '10px';
  panel.style.zIndex = '1200';
  panel.style.maxWidth = '460px';
  panel.style.width = 'min(460px, calc(100vw - 20px))';
  panel.style.background = 'rgba(16,22,28,0.92)';
  panel.style.color = '#d7e0ea';
  panel.style.border = '1px solid rgba(255,255,255,0.2)';
  panel.style.borderRadius = '8px';
  panel.style.padding = '6px 8px';
  panel.style.font = '12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  panel.style.backdropFilter = 'blur(2px)';
  panel.style.display = 'none';
  panel.dataset.open = '0';

  const summary = document.createElement('summary');
  summary.textContent = 'Adaptive perf caps';
  summary.style.cursor = 'pointer';
  summary.style.userSelect = 'none';
  summary.style.fontWeight = '600';
  summary.style.margin = '0 0 6px 0';
  panel.appendChild(summary);

  const status = document.createElement('div');
  status.style.marginBottom = '6px';
  status.style.opacity = '0.9';
  panel.appendChild(status);

  const tabs = document.createElement('div');
  tabs.style.display = 'flex';
  tabs.style.gap = '6px';
  tabs.style.marginBottom = '6px';
  panel.appendChild(tabs);

  const mkTabBtn = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.flex = '1';
    b.style.padding = '4px 6px';
    b.style.borderRadius = '6px';
    b.style.border = '1px solid rgba(255,255,255,0.25)';
    b.style.background = 'rgba(255,255,255,0.08)';
    b.style.color = 'inherit';
    b.style.cursor = 'pointer';
    return b;
  };
  const tabJson = mkTabBtn('JSON');
  const tabControls = mkTabBtn('Controles');
  tabs.append(tabJson, tabControls);

  const jsonView = document.createElement('div');
  const controlsView = document.createElement('div');
  panel.append(jsonView, controlsView);

  const text = document.createElement('textarea');
  text.id = 'play-adaptive-perf-debug-json';
  text.rows = 12;
  text.style.width = '100%';
  text.style.resize = 'vertical';
  text.style.boxSizing = 'border-box';
  text.style.background = 'rgba(0,0,0,0.25)';
  text.style.color = 'inherit';
  text.style.border = '1px solid rgba(255,255,255,0.18)';
  text.style.borderRadius = '6px';
  text.style.padding = '6px';
  jsonView.appendChild(text);

  const controlsGrid = document.createElement('div');
  controlsGrid.style.display = 'grid';
  controlsGrid.style.gridTemplateColumns = '1fr 110px';
  controlsGrid.style.gap = '6px';
  controlsGrid.style.maxHeight = '360px';
  controlsGrid.style.overflow = 'auto';
  controlsGrid.style.paddingRight = '2px';
  controlsView.appendChild(controlsGrid);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '6px';
  row.style.marginTop = '6px';
  panel.appendChild(row);

  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.flex = '1';
    b.style.padding = '4px 6px';
    b.style.borderRadius = '6px';
    b.style.border = '1px solid rgba(255,255,255,0.25)';
    b.style.background = 'rgba(255,255,255,0.08)';
    b.style.color = 'inherit';
    b.style.cursor = 'pointer';
    return b;
  };
  const btnApply = mkBtn('Apply JSON');
  const btnRefresh = mkBtn('Refresh');
  const btnReset = mkBtn('Reset defaults');
  row.append(btnApply, btnRefresh, btnReset);

  const note = document.createElement('div');
  note.style.marginTop = '6px';
  note.style.opacity = '0.8';
  note.textContent = 'JSON e Controles editam o mesmo estado. Tooltips nos labels.';
  panel.appendChild(note);

  const ADAPTIVE_PRESETS = {
    low: {
      label: 'Low',
      tip: 'Max performance: caps mais agressivos (menos atualizacoes por segundo).',
      patch: {
        enabled: true,
        relaxAfterMs: 5400,
        thresholds: {
          updateModerateMs: 5.2,
          updateHeavyMs: 6.2,
          updateVeryHeavyMs: 7.8,
          renderModerateMs: 5.8,
          renderHeavyMs: 7.0,
          wildModerateMs: 1.9,
          wildHeavyMs: 3.0,
          hudHeavyMs: 0.75,
          bgmHeavyMs: 0.55
        },
        moderate: {
          subsystemCadenceSec: { wildUpdate: 0.08, hud: 0.16, farCry: 0.16, autosave: 0.8 },
          audioCadenceMs: { biomeBgm: 240, weatherAmbient: 200 }
        },
        heavy: {
          subsystemCadenceSec: { wildUpdate: 0.14, hud: 0.22, farCry: 0.26, autosave: 1.4 },
          audioCadenceMs: { biomeBgm: 340, weatherAmbient: 290 }
        }
      }
    },
    medium: {
      label: 'Medium',
      tip: 'Balanceado: proximo dos defaults.',
      patch: {
        enabled: true,
        relaxAfterMs: 4200,
        thresholds: {
          updateModerateMs: 6.8,
          updateHeavyMs: 8.0,
          updateVeryHeavyMs: 10.5,
          renderModerateMs: 7.2,
          renderHeavyMs: 9.0,
          wildModerateMs: 2.5,
          wildHeavyMs: 4.0,
          hudHeavyMs: 1.2,
          bgmHeavyMs: 0.8
        },
        moderate: {
          subsystemCadenceSec: { wildUpdate: 0.05, hud: 0.1, farCry: 0.1, autosave: 0.5 },
          audioCadenceMs: { biomeBgm: 170, weatherAmbient: 140 }
        },
        heavy: {
          subsystemCadenceSec: { wildUpdate: 0.1, hud: 0.16, farCry: 0.2, autosave: 1.0 },
          audioCadenceMs: { biomeBgm: 260, weatherAmbient: 220 }
        }
      }
    },
    high: {
      label: 'High',
      tip: 'Prioriza responsividade: aciona caps so sob carga mais alta.',
      patch: {
        enabled: true,
        relaxAfterMs: 3200,
        thresholds: {
          updateModerateMs: 7.9,
          updateHeavyMs: 9.6,
          updateVeryHeavyMs: 12.0,
          renderModerateMs: 8.4,
          renderHeavyMs: 10.2,
          wildModerateMs: 3.1,
          wildHeavyMs: 4.9,
          hudHeavyMs: 1.45,
          bgmHeavyMs: 1.0
        },
        moderate: {
          subsystemCadenceSec: { wildUpdate: 0.04, hud: 0.08, farCry: 0.08, autosave: 0.4 },
          audioCadenceMs: { biomeBgm: 150, weatherAmbient: 120 }
        },
        heavy: {
          subsystemCadenceSec: { wildUpdate: 0.08, hud: 0.12, farCry: 0.16, autosave: 0.8 },
          audioCadenceMs: { biomeBgm: 210, weatherAmbient: 180 }
        }
      }
    },
    ultra: {
      label: 'Ultra',
      tip: 'Max quality: quase sem cap (usa cap so em emergencias).',
      patch: {
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
          subsystemCadenceSec: { wildUpdate: 0.02, hud: 0.05, farCry: 0.05, autosave: 0.25 },
          audioCadenceMs: { biomeBgm: 110, weatherAmbient: 95 }
        },
        heavy: {
          subsystemCadenceSec: { wildUpdate: 0.05, hud: 0.08, farCry: 0.1, autosave: 0.5 },
          audioCadenceMs: { biomeBgm: 150, weatherAmbient: 130 }
        }
      }
    }
  };
  /** @type {'low'|'medium'|'high'|'ultra'|'custom'} */
  let activePreset = 'ultra';

  function loadPersistedAdaptivePerfState() {
    const rawCfg = localStorage.getItem(LS_ADAPTIVE_CFG);
    if (rawCfg) {
      try {
        const parsed = JSON.parse(rawCfg);
        if (parsed && typeof parsed === 'object') {
          patchPlayAdaptivePerfConfig(parsed);
        }
      } catch {
        /* ignore invalid storage payload */
      }
    }
    const rawPreset = localStorage.getItem(LS_ADAPTIVE_PRESET);
    if (
      rawPreset === 'low' ||
      rawPreset === 'medium' ||
      rawPreset === 'high' ||
      rawPreset === 'ultra' ||
      rawPreset === 'custom'
    ) {
      activePreset = rawPreset;
    }
  }

  function persistAdaptivePerfState() {
    try {
      const cfg = getPlayAdaptivePerfConfig();
      const editable = { ...cfg };
      delete editable.runtime;
      localStorage.setItem(LS_ADAPTIVE_CFG, JSON.stringify(editable));
      localStorage.setItem(LS_ADAPTIVE_PRESET, activePreset);
    } catch {
      /* ignore localStorage failures */
    }
  }

  const FIELD_SCHEMA = [
    { path: 'enabled', type: 'bool', label: 'enabled', tip: 'Liga/desliga cap adaptativo.' },
    { path: 'relaxAfterMs', type: 'num', label: 'relaxAfterMs', tip: 'Tempo minimo para aliviar nivel de pressao.' },
    {
      section: 'Thresholds (ms)',
      tip: 'Quando p95 passar destes valores, aumenta score de pressao.'
    },
    { path: 'thresholds.updateModerateMs', type: 'num', label: 'updateModerateMs', tip: 'update p95 inicia cap moderado.' },
    { path: 'thresholds.updateHeavyMs', type: 'num', label: 'updateHeavyMs', tip: 'update p95 empurra para mais forte.' },
    { path: 'thresholds.updateVeryHeavyMs', type: 'num', label: 'updateVeryHeavyMs', tip: 'update p95 muito alto, score maximo.' },
    { path: 'thresholds.renderModerateMs', type: 'num', label: 'renderModerateMs', tip: 'render p95 contribui score moderado.' },
    { path: 'thresholds.renderHeavyMs', type: 'num', label: 'renderHeavyMs', tip: 'render p95 contribui score alto.' },
    { path: 'thresholds.wildModerateMs', type: 'num', label: 'wildModerateMs', tip: 'wild p95 para cap moderado.' },
    { path: 'thresholds.wildHeavyMs', type: 'num', label: 'wildHeavyMs', tip: 'wild p95 para cap pesado.' },
    { path: 'thresholds.hudHeavyMs', type: 'num', label: 'hudHeavyMs', tip: 'HUD p95 adiciona score.' },
    { path: 'thresholds.bgmHeavyMs', type: 'num', label: 'bgmHeavyMs', tip: 'Audio sync p95 adiciona score.' },
    { section: 'Moderate cadences', tip: 'Cadencias no nivel p1.' },
    { path: 'moderate.subsystemCadenceSec.wildUpdate', type: 'num', label: 'p1 wildUpdateSec', tip: '0.05 = 20Hz.' },
    { path: 'moderate.subsystemCadenceSec.hud', type: 'num', label: 'p1 hudSec', tip: 'Cadencia de HUD auxiliar.' },
    { path: 'moderate.subsystemCadenceSec.farCry', type: 'num', label: 'p1 farCrySec', tip: 'Cadencia do sistema Far Cry.' },
    { path: 'moderate.subsystemCadenceSec.autosave', type: 'num', label: 'p1 autosaveSec', tip: 'Intervalo de checagem de autosave.' },
    { path: 'moderate.audioCadenceMs.biomeBgm', type: 'num', label: 'p1 biomeBgmMs', tip: 'Polling BGM por biome.' },
    { path: 'moderate.audioCadenceMs.weatherAmbient', type: 'num', label: 'p1 weatherAmbientMs', tip: 'Polling audio ambiente clima.' },
    { section: 'Heavy cadences', tip: 'Cadencias no nivel p2.' },
    { path: 'heavy.subsystemCadenceSec.wildUpdate', type: 'num', label: 'p2 wildUpdateSec', tip: '0.1 = 10Hz.' },
    { path: 'heavy.subsystemCadenceSec.hud', type: 'num', label: 'p2 hudSec', tip: 'HUD mais desacoplado em carga alta.' },
    { path: 'heavy.subsystemCadenceSec.farCry', type: 'num', label: 'p2 farCrySec', tip: 'Far Cry em carga alta.' },
    { path: 'heavy.subsystemCadenceSec.autosave', type: 'num', label: 'p2 autosaveSec', tip: 'Autosave mais espaçado em carga alta.' },
    { path: 'heavy.audioCadenceMs.biomeBgm', type: 'num', label: 'p2 biomeBgmMs', tip: 'Polling BGM em carga alta.' },
    { path: 'heavy.audioCadenceMs.weatherAmbient', type: 'num', label: 'p2 weatherAmbientMs', tip: 'Polling ambiente em carga alta.' }
  ];

  const controlsByPath = new Map();
  const presetButtons = new Map();

  const getByPath = (obj, path) =>
    String(path)
      .split('.')
      .reduce((acc, k) => (acc && Object.prototype.hasOwnProperty.call(acc, k) ? acc[k] : undefined), obj);
  const setByPath = (obj, path, value) => {
    const keys = String(path).split('.');
    let ptr = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!ptr[k] || typeof ptr[k] !== 'object') ptr[k] = {};
      ptr = ptr[k];
    }
    ptr[keys[keys.length - 1]] = value;
  };

  function buildControlsForm() {
    for (const f of FIELD_SCHEMA) {
      if (f.section) {
        const sec = document.createElement('div');
        sec.style.gridColumn = '1 / -1';
        sec.style.marginTop = '4px';
        sec.style.paddingTop = '4px';
        sec.style.borderTop = '1px solid rgba(255,255,255,0.12)';
        sec.title = f.tip || '';
        sec.textContent = f.section;
        sec.style.fontWeight = '600';
        controlsGrid.appendChild(sec);
        continue;
      }
      const label = document.createElement('label');
      label.textContent = f.label;
      label.style.alignSelf = 'center';
      label.title = f.tip || '';
      controlsGrid.appendChild(label);
      const input = document.createElement('input');
      input.title = f.tip || '';
      input.style.width = '100%';
      input.style.boxSizing = 'border-box';
      input.style.borderRadius = '5px';
      input.style.border = '1px solid rgba(255,255,255,0.2)';
      input.style.background = 'rgba(0,0,0,0.24)';
      input.style.color = 'inherit';
      input.style.padding = '3px 5px';
      if (f.type === 'bool') {
        input.type = 'checkbox';
        input.style.width = '18px';
        input.style.height = '18px';
        input.style.padding = '0';
      } else {
        input.type = 'number';
        input.step = '0.01';
      }
      controlsByPath.set(f.path, { input, field: f });
      controlsGrid.appendChild(input);
    }
  }

  const presetRow = document.createElement('div');
  presetRow.style.display = 'grid';
  presetRow.style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
  presetRow.style.gap = '6px';
  presetRow.style.marginBottom = '6px';
  controlsView.insertBefore(presetRow, controlsGrid);

  buildControlsForm();

  function renderPresetButtons() {
    presetRow.textContent = '';
    presetButtons.clear();
    for (const key of ['low', 'medium', 'high', 'ultra']) {
      const def = ADAPTIVE_PRESETS[key];
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = def.label;
      b.title = def.tip;
      b.style.padding = '4px 6px';
      b.style.borderRadius = '6px';
      b.style.border = '1px solid rgba(255,255,255,0.25)';
      b.style.background = 'rgba(255,255,255,0.08)';
      b.style.color = 'inherit';
      b.style.cursor = 'pointer';
      b.addEventListener('click', () => {
        const cfg = patchPlayAdaptivePerfConfig(def.patch);
        activePreset = /** @type {any} */ (key);
        text.value = JSON.stringify(toEditableConfig(cfg), null, 2);
        persistAdaptivePerfState();
        refreshFromRuntime();
      });
      presetButtons.set(key, b);
      presetRow.appendChild(b);
    }
  }
  renderPresetButtons();

  function refreshPresetButtons() {
    for (const [key, btn] of presetButtons.entries()) {
      const active = key === activePreset;
      btn.style.background = active ? 'rgba(86,154,255,0.35)' : 'rgba(255,255,255,0.08)';
      btn.style.borderColor = active ? 'rgba(120,180,255,0.8)' : 'rgba(255,255,255,0.25)';
      btn.style.fontWeight = active ? '700' : '500';
    }
  }

  function syncControlsFromConfig(cfg) {
    for (const [path, meta] of controlsByPath.entries()) {
      if (document.activeElement === meta.input) continue;
      const v = getByPath(cfg, path);
      if (meta.field.type === 'bool') {
        meta.input.checked = !!v;
      } else {
        meta.input.value = Number.isFinite(Number(v)) ? String(v) : '';
      }
    }
  }

  function buildPatchFromControls() {
    const patch = {};
    for (const [path, meta] of controlsByPath.entries()) {
      if (meta.field.type === 'bool') {
        setByPath(patch, path, !!meta.input.checked);
      } else {
        const n = Number(meta.input.value);
        if (Number.isFinite(n)) setByPath(patch, path, n);
      }
    }
    return patch;
  }

  function toEditableConfig(cfg) {
    const editable = { ...cfg };
    delete editable.runtime;
    return editable;
  }

  const setActiveTab = (tab) => {
    const isJson = tab === 'json';
    jsonView.style.display = isJson ? '' : 'none';
    controlsView.style.display = isJson ? 'none' : '';
    tabJson.style.background = isJson ? 'rgba(86,154,255,0.35)' : 'rgba(255,255,255,0.08)';
    tabControls.style.background = isJson ? 'rgba(255,255,255,0.08)' : 'rgba(86,154,255,0.35)';
  };

  function refreshFromRuntime() {
    const cfg = getPlayAdaptivePerfConfig();
    const rt = cfg.runtime || {};
    status.textContent =
      `pressure p${rt.pressureLevel ?? 0}` +
      ` · enabled ${cfg.enabled ? 'yes' : 'no'}` +
      ` · relax ${cfg.relaxAfterMs}ms`;
    if (document.activeElement !== text) {
      text.value = JSON.stringify(toEditableConfig(cfg), null, 2);
    }
    syncControlsFromConfig(cfg);
    refreshPresetButtons();
  }

  btnApply.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(text.value || '{}');
      if (parsed && typeof parsed === 'object' && 'runtime' in parsed) delete parsed.runtime;
      const cfg = patchPlayAdaptivePerfConfig(parsed);
      activePreset = 'custom';
      text.value = JSON.stringify(toEditableConfig(cfg), null, 2);
      persistAdaptivePerfState();
      refreshFromRuntime();
    } catch (err) {
      status.textContent = `JSON parse error: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
  btnRefresh.addEventListener('click', refreshFromRuntime);
  btnReset.addEventListener('click', () => {
    const cfg = resetPlayAdaptivePerfConfig();
    activePreset = 'ultra';
    text.value = JSON.stringify(toEditableConfig(cfg), null, 2);
    persistAdaptivePerfState();
    refreshFromRuntime();
  });
  tabJson.addEventListener('click', () => setActiveTab('json'));
  tabControls.addEventListener('click', () => setActiveTab('controls'));

  const btnApplyControls = mkBtn('Apply controls');
  btnApplyControls.style.marginTop = '6px';
  controlsView.appendChild(btnApplyControls);
  btnApplyControls.addEventListener('click', () => {
    const cfg = patchPlayAdaptivePerfConfig(buildPatchFromControls());
    activePreset = 'custom';
    text.value = JSON.stringify(toEditableConfig(cfg), null, 2);
    persistAdaptivePerfState();
    refreshFromRuntime();
  });

  loadPersistedAdaptivePerfState();
  host.appendChild(panel);
  setActiveTab('controls');
  refreshFromRuntime();
  setInterval(refreshFromRuntime, 900);

  const setPanelOpen = (nextOpen) => {
    const open = !!nextOpen;
    panel.style.display = open ? '' : 'none';
    panel.dataset.open = open ? '1' : '0';
    if (open) panel.open = true;
    if (btnMinimapAdaptivePerfToggle) {
      btnMinimapAdaptivePerfToggle.setAttribute('aria-pressed', open ? 'true' : 'false');
    }
  };

  btnMinimapAdaptivePerfToggle?.addEventListener('click', () => {
    const open = panel.dataset.open === '1';
    setPanelOpen(!open);
  });
}

installAdaptivePerfDebugPanel();

function dismissPlayBgmToast() {
  if (playBgmToastHideTimer) {
    clearTimeout(playBgmToastHideTimer);
    playBgmToastHideTimer = 0;
  }
  playBgmToastEl?.classList.remove('play-bgm-toast--visible');
}

function schedulePlayBgmToastHide() {
  if (!playBgmToastEl?.classList.contains('play-bgm-toast--visible')) return;
  if (playBgmToastHideTimer) clearTimeout(playBgmToastHideTimer);
  playBgmToastHideTimer = window.setTimeout(() => {
    playBgmToastHideTimer = 0;
    playBgmToastEl?.classList.remove('play-bgm-toast--visible');
  }, PLAY_BGM_TOAST_MS);
}

function wirePlayBgmToastUi() {
  if (!playBgmToastEl || playBgmToastEl.dataset.wired === '1') return;
  playBgmToastEl.dataset.wired = '1';
  playBgmToastEl.addEventListener('mouseenter', () => {
    if (playBgmToastHideTimer) {
      clearTimeout(playBgmToastHideTimer);
      playBgmToastHideTimer = 0;
    }
  });
  playBgmToastEl.addEventListener('mouseleave', () => {
    if (playBgmToastEl.classList.contains('play-bgm-toast--visible')) {
      schedulePlayBgmToastHide();
    }
  });
  document.getElementById('play-bgm-toast-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissPlayBgmToast();
  });
}

wirePlayBgmToastUi();

/**
 * @param {string} trackTitle
 * @param {string} statusText
 */
function showPlayBgmTrackToast(trackTitle, statusText) {
  if (!playBgmToastEl || !playBgmToastTrackEl || !playBgmToastStatusEl) return;
  dismissPlayBgmToast();
  playBgmToastTrackEl.textContent = trackTitle;
  playBgmToastStatusEl.textContent = statusText;
  requestAnimationFrame(() => {
    playBgmToastEl.classList.add('play-bgm-toast--visible');
    schedulePlayBgmToastHide();
  });
}

configureTileDebugModal({
  getCurrentData: () => currentData,
  debugModal,
  debugContent
});

const minimapAudioUi = installMinimapAudioUi();
const minimapHudPopovers = installMinimapHudPopovers({ imageCache, getCurrentData: () => currentData });
const minimapSaveModal = installMinimapSaveModal({
  getCurrentData: () => currentData,
  getPlayer: () => player,
  getPersistExtra: () => buildPlaySessionPersistExtra(),
  onImportedSaveNeedRegenerate: (mapFingerprint) => {
    const meta = parseMapFingerprint(mapFingerprint);
    if (meta && seedInput) seedInput.value = String(meta.seed >>> 0);
  }
});
installPlayHelpWikiModal({
  forceCloseMinimapAudioPopover: () => {
    minimapAudioUi.forceCloseMinimapAudioPopover();
    minimapHudPopovers.forceCloseAllPopovers();
    minimapSaveModal.forceClose();
  }
});

function escapeFromPlayOrCloseOverlays() {
  if (minimapSaveModal.isOpen()) {
    minimapSaveModal.forceClose();
    return;
  }
  btnBackToMap?.click?.();
}

let lastHudTileKey = '';
let lastHudMs = 0;
const HUD_MIN_INTERVAL_MS = 100;

function detailLabelFromItemKey(itemKey) {
  const raw = String(itemKey || '').replace(/\s*\[[^\]]+\]\s*$/g, '');
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function detailPreviewHtmlForImmersiveHint(itemKey) {
  return detailScatterGridPreviewHtml(
    itemKey,
    15,
    'play-immersive-hint__sprite',
    'vertical-align:middle;line-height:0',
    { seamless: true, gapPx: 0 }
  );
}

/** First frame of faint (or idle) PMD sheet for Strength HUD. */
function faintedWildHudSpriteHtml(dexId, displayW) {
  const dex = Math.max(1, Math.floor(Number(dexId) || 1));
  void ensurePokemonSheetsLoaded(imageCache, dex);
  const { faint: wFaint, idle: wIdle, walk: wWalk } = getResolvedSheets(imageCache, dex);
  const sheet = wFaint || wIdle || wWalk;
  if (!sheet || !(sheet.naturalWidth || sheet.width)) return '';
  const { sw, sh } = resolvePmdFrameSpecForSlice(sheet, dex, 'faint');
  const natW = sheet.naturalWidth || sheet.width;
  const natH = sheet.naturalHeight || sheet.height;
  const dw = Math.max(20, Math.floor(displayW));
  const dh = Math.max(16, Math.round((sh * dw) / Math.max(1, sw)));
  const scale = dw / Math.max(1, sw);
  const bgW = natW * scale;
  const bgH = natH * scale;
  const src = String(sheet.currentSrc || sheet.src || '').replace(/'/g, '%27');
  if (!src) return '';
  return `<span aria-hidden="true" style="display:inline-block;vertical-align:middle;margin-right:6px;width:${dw}px;height:${dh}px;background-image:url('${src}');background-repeat:no-repeat;background-size:${bgW}px ${bgH}px;background-position:0 0;image-rendering:pixelated;box-shadow:0 0 0 1px rgba(255,255,255,0.14) inset;border-radius:2px"></span>`;
}

/** @param {{ itemKey: string, wildDexId?: number }} ctx */
function strengthHudObjectPreviewHtmlImmersive(ctx) {
  const wid = Math.floor(Number(ctx?.wildDexId) || 0);
  if (wid > 0) return faintedWildHudSpriteHtml(wid, 40);
  return detailPreviewHtmlForImmersiveHint(String(ctx?.itemKey || ''));
}

/**
 * Minimap biome row + coords — always in sync (must not sit behind the HUD throttle return).
 * @param {{ id: number, name?: string, color?: string } | undefined} bio
 * @param {number} px
 * @param {number} py
 * @param {number} pz
 */
function syncMinimapPlayFooter(bio, px, py, pz) {
  const root = minimapPanel || document.getElementById('minimap-panel');
  if (!root) return;
  const nameEl = root.querySelector('#minimap-biome-readout');
  const swatchEl = root.querySelector('#minimap-biome-swatch');
  const coordsEl = root.querySelector('#minimap-coords-readout');
  const biomeLabel = bio?.id != null ? getBiomeNameById(bio.id) : '—';
  if (nameEl && nameEl.textContent !== biomeLabel) nameEl.textContent = biomeLabel;
  if (swatchEl) {
    const sw = bio?.color && typeof bio.color === 'string' ? bio.color.trim() : '';
    const bg = sw && /^#[0-9a-fA-F]{6}$/.test(sw) ? sw : '#3a3a44';
    if (swatchEl.style.background !== bg) swatchEl.style.background = bg;
  }
  const coordsLine = t('play.minimapCoords', {
    x: formatNumber(px, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    y: formatNumber(py, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    z: formatNumber(pz, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  });
  if (coordsEl && coordsEl.textContent !== coordsLine) coordsEl.textContent = coordsLine;
}

function resetMinimapPlayFooter() {
  const root = minimapPanel || document.getElementById('minimap-panel');
  if (!root) return;
  const nameEl = root.querySelector('#minimap-biome-readout');
  const swatchEl = root.querySelector('#minimap-biome-swatch');
  const coordsEl = root.querySelector('#minimap-coords-readout');
  if (nameEl) nameEl.textContent = '—';
  if (swatchEl) swatchEl.style.background = '#3a3a44';
  if (coordsEl) coordsEl.textContent = t('play.minimapCoordsEmpty');
}

/** @param {boolean} [force] when true, skip throttle (e.g. keyboard) */
function refreshPlayModeInfoBar(force = false) {
  if (!currentData || appMode !== 'play') return;
  const mx = Math.floor(player.x);
  const my = Math.floor(player.y);
  const tile = getMicroTile(mx, my, currentData);
  const bId = tile.biomeId;
  const bio = Object.values(BIOMES).find((b) => b.id === bId);
  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  const pz = Number(player.z) || 0;
  syncMinimapPlayFooter(bio, px, py, pz);

  const rx = Math.round(px * 10);
  const ry = Math.round(py * 10);
  const rz = Math.round(pz * 100);
  const key = `${rx},${ry},${rz},${bId}`;
  const now = performance.now();
  if (!force) {
    const sameSig = key === lastHudTileKey;
    if (sameSig && now - lastHudMs < HUD_MIN_INTERVAL_MS) return;
  }
  lastHudTileKey = key;
  lastHudMs = now;

  const carryPrompt = player._strengthCarry
    ? {
      itemKey: String(player._strengthCarry.itemKey || ''),
      displayName: String(player._strengthCarry.displayName || ''),
      wildDexId:
        player._strengthCarry.kind === 'faintedWild'
          ? Math.max(1, Math.floor(Number(player._strengthCarry.wildDexId) || 0))
          : 0
    }
    : null;
  const carryMobility = getStrengthCarryMobilityInfo(player);
  const grabPrompt = getStrengthGrabPromptInfo(player, currentData);
  const immersive = isPlayImmersiveMinimalUi();
  if (playImmersiveHintEl) {
    if (immersive && (carryPrompt || grabPrompt)) {
      const ctxPrompt = carryPrompt || grabPrompt;
      const label = String(
        ctxPrompt.displayName || detailLabelFromItemKey(ctxPrompt.itemKey) || t('play.detailLabelFallback')
      );
      const actionHtml = carryPrompt
        ? `<div class="play-immersive-hint__action-row"><span class="play-immersive-hint__action">${t('play.actionPlace')}</span><span class="play-immersive-hint__key">E</span></div>` +
          `<div class="play-immersive-hint__action-row"><span class="play-immersive-hint__action">${t('play.actionThrow')}</span><span class="play-immersive-hint__key">LMB</span></div>` +
          `${carryMobility ? `<div class="play-immersive-hint__action-row"><span class="play-immersive-hint__warn">${carryMobility.message}</span></div>` : ''}`
        : `<span class="play-immersive-hint__action">${t('play.actionGrab')}</span><span class="play-immersive-hint__key">E</span>`;
      const immersiveHtml =
        `<div class="play-immersive-hint__row">` +
        `${strengthHudObjectPreviewHtmlImmersive(ctxPrompt)}` +
        `<span>(${label})</span>` +
        `${actionHtml}` +
        `</div>`;
      if (playImmersiveHintEl.innerHTML !== immersiveHtml) {
        playImmersiveHintEl.innerHTML = immersiveHtml;
      }
      playImmersiveHintEl.classList.add('play-immersive-hint--visible');
    } else {
      if (playImmersiveHintEl.innerHTML) playImmersiveHintEl.innerHTML = '';
      playImmersiveHintEl.classList.remove('play-immersive-hint--visible');
    }
  }
}

function readWorldHoursPerRealSec() {
  const el = document.getElementById('play-world-time-speed');
  const v = parseFloat(String(el?.value ?? '0.02'));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function syncPlayWorldTimePanel() {
  if (appMode !== 'play') return;
  if (!playWorldTimePhaseEl || !playWorldTimeHourEl) return;
  const wh = wrapHours(worldHours);
  const phase = getDayPhaseFromHours(wh);
  if (phase !== lastWorldTimePanelPhase) {
    lastWorldTimePanelPhase = phase;
    playWorldTimePhaseEl.textContent = dayPhaseLabelEn(phase);
  }
  playWorldTimeHourEl.textContent = t('play.worldTimeHour', {
    hours: formatNumber(wh, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  });
  if (playWorldTimeSlider) {
    const stepped = Math.round(wh / 0.05) * 0.05;
    const sVal = parseFloat(playWorldTimeSlider.value);
    if (!Number.isFinite(sVal) || Math.abs(sVal - stepped) > 1e-4) {
      playWorldTimeSlider.value = String(stepped);
    }
  }
  if (playSessionTimeEl) {
    const totalSec = Math.max(0, Math.floor(playSessionSeconds));
    const hh = Math.floor(totalSec / 3600)
      .toString()
      .padStart(2, '0');
    const mm = Math.floor((totalSec % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const ss = Math.floor(totalSec % 60)
      .toString()
      .padStart(2, '0');
    playSessionTimeEl.textContent = t('play.playSessionTime', {
      time: `${hh}:${mm}:${ss}`
    });
  }
}

function buildPlaySessionPersistExtra() {
  const wt = getWeatherTarget();
  return {
    worldHours: wrapHours(worldHours),
    playSessionSeconds,
    weatherPreset: wt.preset,
    weatherCloudIntensity01: wt.cloudIntensity01,
    weatherPrecipIntensity01: wt.precipIntensity01,
    weatherIntensity01: wt.precipIntensity01,
    earthquakeIntensity01: getEarthquakeActiveIntensity01(),
    sunLightRaysIntensity01: getSunLightRaysTargetIntensity01()
  };
}

/**
 * Restores clock + sky + earthquake slider from a v2+ session snapshot (cold resume).
 * @param {{ worldHours: number, weatherPreset: string, weatherIntensity01?: number, weatherCloudIntensity01?: number, weatherPrecipIntensity01?: number, earthquakeIntensity01: number, sunLightRaysIntensity01?: number }} env
 */
function applyRestoredPlayEnvironmentFromSave(env) {
  if (!env) return;
  worldHours = wrapHours(env.worldHours);
  const stepped = Math.round(worldHours / 0.05) * 0.05;
  if (playWorldTimeSlider) playWorldTimeSlider.value = String(stepped);
  const phase = getDayPhaseFromHours(worldHours);
  lastWorldTimePanelPhase = phase;
  if (playWorldTimePhaseEl) playWorldTimePhaseEl.textContent = dayPhaseLabelEn(phase);
  if (playWorldTimeHourEl) {
    playWorldTimeHourEl.textContent = t('play.worldTimeHour', {
      hours: formatNumber(worldHours, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    });
  }
  snapDayCycleTintSmoothToHours(worldHours);
  const legacy = Number(env.weatherIntensity01);
  const fallback = Number.isFinite(legacy) ? Math.max(0, Math.min(1, legacy)) : 1;
  const wc = Number(env.weatherCloudIntensity01);
  const wp = Number(env.weatherPrecipIntensity01);
  setWeatherTarget(
    {
      preset: env.weatherPreset,
      cloudIntensity01: Number.isFinite(wc) ? wc : fallback,
      precipIntensity01: Number.isFinite(wp) ? wp : fallback
    },
    'external'
  );
  syncWeatherUi();
  setEarthquakeTargetIntensity01(env.earthquakeIntensity01);
  if (playEarthquakeIntensityEl) {
    playEarthquakeIntensityEl.value = String(Math.round(env.earthquakeIntensity01 * 100));
  }
  const sunR = Number(env.sunLightRaysIntensity01);
  const sun01 = Number.isFinite(sunR) ? Math.max(0, Math.min(1, sunR)) : 0;
  setSunLightRaysTargetIntensity01(sun01);
  if (playSunLightRaysIntensityEl) {
    playSunLightRaysIntensityEl.value = String(Math.round(sun01 * 100));
  }
}

function syncPlayBgmNowPlayingPanel() {
  if (appMode !== 'play') return;
  if (!playBgmNowPlayingTrackEl || !playBgmNowPlayingStatusEl) return;
  const st = getBiomeBgmUiState();
  const title = st.currentTrackName || '—';
  const statusText =
    st.status === 'playing'
      ? t('play.bgmStatusPlayingBiomeId', { biomeId: st.playingBiomeId ?? '?' })
      : st.status === 'transitioning'
        ? t('play.bgmStatusTransitionBiomeId', { biomeId: st.transitionTargetBiome ?? '?' })
        : t('play.idle');
  const sig = `${title}|${statusText}`;
  if (sig === lastBgmUiSignature) return;
  lastBgmUiSignature = sig;
  playBgmNowPlayingTrackEl.textContent = title;
  playBgmNowPlayingStatusEl.textContent = statusText;

  const immersive = isPlayImmersiveMinimalUi();
  if (!immersive) {
    lastBgmToastTrackKey = title;
    dismissPlayBgmToast();
  } else if (title !== '—' && title !== lastBgmToastTrackKey) {
    lastBgmToastTrackKey = title;
    if (!isBgmTrackChangeToastSuppressed()) {
      showPlayBgmTrackToast(title, statusText);
    }
  }
}

function syncRegionViewShell() {
  const appEl = document.querySelector('.app');
  if (!appEl) return;
  if (appMode === 'play') {
    document.body.classList.add('play-mode-active');
    document.body.classList.remove('region-atlas-active');
    appEl.classList.add('play-mode-active');
    appEl.classList.remove('region-atlas-active');
  } else if (appMode === 'map' && currentData) {
    document.body.classList.remove('play-mode-active');
    document.body.classList.add('region-atlas-active');
    appEl.classList.remove('play-mode-active');
    appEl.classList.add('region-atlas-active');
  } else {
    document.body.classList.remove('play-mode-active', 'region-atlas-active');
    appEl.classList.remove('play-mode-active', 'region-atlas-active');
  }
}

function hasMapContinuePosition() {
  if (appMode !== 'map' || !currentData || !sessionEnteredPlayOnCurrentMap) return false;
  const px = Number(player.visualX ?? player.x);
  const py = Number(player.visualY ?? player.y);
  return Number.isFinite(px) && Number.isFinite(py);
}

function syncMapContinueButtonVisibility() {
  if (!btnContinuePlay) return;
  btnContinuePlay.classList.toggle('hidden', !hasMapContinuePosition());
}

function continueFromMapToPlay() {
  if (!currentData || appMode !== 'map') return;
  const px = Number(player.visualX ?? player.x);
  const py = Number(player.visualY ?? player.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  const mapMicroW = Math.max(1, Number(currentData.width) * MACRO_TILE_STRIDE);
  const mapMicroH = Math.max(1, Number(currentData.height) * MACRO_TILE_STRIDE);
  const clampedX = Math.max(0, Math.min(mapMicroW - 1, px));
  const clampedY = Math.max(0, Math.min(mapMicroH - 1, py));
  const gx = Math.floor(clampedX / MACRO_TILE_STRIDE);
  const gy = Math.floor(clampedY / MACRO_TILE_STRIDE);
  enterPlayMode(gx, gy, { resumePosition: false });
}

/**
 * @param {object} data
 * @returns {{ gx: number, gy: number }}
 */
function pickRandomCityMacroForPlayStart(data) {
  const nodes = data?.graph?.nodes;
  if (nodes?.length) {
    const u = (Number(data.seed) >>> 0) ^ 0x243f6a88;
    const n = nodes[u % nodes.length];
    return { gx: n.x, gy: n.y };
  }
  const w = Math.max(1, data.width | 0);
  const h = Math.max(1, data.height | 0);
  return { gx: Math.floor(w / 2), gy: Math.floor(h / 2) };
}

function updateWorldMapCameraBounds() {
  if (!WORLD_MAP_CONTINUOUS_ZOOM_ENABLED || !currentData || !canvas || appMode !== 'map') return;
  configureWorldMapCamera(currentData.width, currentData.height, canvas.width, canvas.height);
}

function requestWorldMapCameraFrame() {
  if (!WORLD_MAP_CONTINUOUS_ZOOM_ENABLED || appMode !== 'map') return;
  if (worldMapRenderLoopRaf) return;
  if (worldMapCameraRaf) return;
  worldMapCameraRaf = requestAnimationFrame(() => {
    worldMapCameraRaf = 0;
    const moving = tickWorldMapCamera(performance.now());
    updateView();
    if (moving) requestWorldMapCameraFrame();
  });
}

function worldMapRenderLoop() {
  worldMapRenderLoopRaf = 0;
  if (appMode !== 'map' || !currentData) return;
  if (WORLD_MAP_CONTINUOUS_ZOOM_ENABLED) {
    tickWorldMapCamera(performance.now());
  }
  updateView();
  worldMapRenderLoopRaf = requestAnimationFrame(worldMapRenderLoop);
}

function startWorldMapRenderLoop() {
  if (appMode !== 'map' || !currentData) return;
  if (worldMapRenderLoopRaf) return;
  worldMapRenderLoopRaf = requestAnimationFrame(worldMapRenderLoop);
}

function stopWorldMapRenderLoop() {
  if (!worldMapRenderLoopRaf) return;
  cancelAnimationFrame(worldMapRenderLoopRaf);
  worldMapRenderLoopRaf = 0;
}

function mapClientToCanvasPx(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
  const y = ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
  return { x, y, rect };
}

function mapClientToMacro(clientX, clientY) {
  if (!currentData) return { gx: -1, gy: -1 };
  const { x, y, rect } = mapClientToCanvasPx(clientX, clientY);
  if (!WORLD_MAP_CONTINUOUS_ZOOM_ENABLED) {
    const gx = Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * currentData.width);
    const gy = Math.floor(((clientY - rect.top) / Math.max(1, rect.height)) * currentData.height);
    return { gx, gy };
  }
  const p = screenPxToWorldMacro(x, y);
  return { gx: Math.floor(p.x), gy: Math.floor(p.y) };
}

function getSettings() {
  const viewType = document.querySelector('input[name="viewType"]:checked')?.value || 'biomes';
  const overlayPaths = chkRotas?.checked ?? true;
  const overlayGraph = chkGrafo?.checked ?? true;
  const overlayContours = chkCurvas?.checked ?? false;
  const showPlayColliders = chkPlayColliders?.checked ?? false;
  const showWorldReactionsOverlay = chkWorldReactionsOverlay?.checked ?? false;
  const collidersOn = showPlayColliders || window.debugColliders;

  if (appMode === 'play' && currentData && collidersOn) {
    ensurePlayColliderOverlayCache(currentData, player, imageCache, collidersOn);
  } else {
    clearPlayColliderOverlayCache();
  }

  const hoursWrapped = wrapHours(worldHours);
  const dayPhase = getDayPhaseFromHours(hoursWrapped);
  const rawDayCycleTint = appMode === 'play' ? getSmoothedDayCycleTintForRender() : null;
  const weatherCloudNoiseSeed =
    appMode === 'play' && currentData?.seed != null ? (currentData.seed >>> 0) % 1000003 : 0;
  const weather = getActiveWeatherParams();
  const weatherTarget = getWeatherTarget();
  const worldMapCamera =
    appMode === 'map' && WORLD_MAP_CONTINUOUS_ZOOM_ENABLED && currentData
      ? getWorldMapCamera()
      : null;

  // Rain dims the ambient day tint — overcast sky blocks daylight proportionally to intensity.
  // R/G are dimmed more than B so heavy rain also pulls the scene slightly cool, not just dark.
  let dayCycleTint = rawDayCycleTint;
  if (rawDayCycleTint && weather.rainIntensity > 0.01) {
    const rain = Math.min(1, weather.rainIntensity);
    const dim = 1 - rain * 0.38;
    const dimBlue = 1 - rain * 0.28;
    dayCycleTint = {
      r: Math.max(0, Math.round(rawDayCycleTint.r * dim)),
      g: Math.max(0, Math.round(rawDayCycleTint.g * dim)),
      b: Math.max(0, Math.round(rawDayCycleTint.b * dimBlue))
    };
  }

  return {
    viewType,
    overlayPaths,
    overlayGraph,
    overlayContours,
    showPlayColliders,
    showWorldReactionsOverlay,
    playColliderOverlayCache: collidersOn ? getPlayColliderOverlayCache() : null,
    playDetailColliderHighlight,
    appMode,
    sessionEnteredPlayOnCurrentMap,
    player,
    time: gameTime,
    dayPhase,
    worldHours: hoursWrapped,
    dayCycleTint,
    weatherPreset: weatherTarget.preset,
    weatherCloudIntensity01: weatherTarget.cloudIntensity01,
    weatherPrecipIntensity01: weatherTarget.precipIntensity01,
    weatherCloudPresence: weather.cloudPresence,
    weatherCloudThreshold: weather.cloudThreshold,
    weatherCloudMinMul: weather.cloudMinMul,
    weatherCloudMaxMul: weather.cloudMaxMul,
    weatherCloudAlphaMul: weather.cloudAlphaMul,
    weatherRainIntensity: weather.rainIntensity,
    weatherScreenTint: weather.screenTint,
    weatherBlizzardBlend01: getActiveWeatherPresetBlend('blizzard'),
    weatherSandstormBlend01: getActiveWeatherPresetBlend('sandstorm'),
    weatherCloudNoiseSeed,
    weatherWindIntensity: getWindFeltIntensity(),
    weatherWindDirRad: getWindDirectionRad(),
    weatherEarthquakeIntensity: getEarthquakeActiveIntensity01(),
    weatherSunLightRaysIntensity: getSunLightRaysActiveIntensity01(hoursWrapped),
    weatherVolumetricMode: weather.weatherMode,
    weatherVolumetricParticleDensity: weather.volumetricParticleDensity,
    weatherVolumetricVolumeDepth: weather.volumetricVolumeDepth,
    weatherVolumetricFallSpeed: weather.volumetricFallSpeed,
    weatherVolumetricWindCarry: weather.volumetricWindCarry,
    weatherVolumetricTurbulence: weather.volumetricTurbulence,
    weatherVolumetricAbsorptionBias: weather.volumetricAbsorptionBias,
    weatherVolumetricSplashBias: weather.volumetricSplashBias,
    worldMapCamera,
    worldMapUseSvgOverlay: WORLD_MAP_USE_SVG_OVERLAY,
    visionFogEnabled: playVisionFogToggleEl?.checked ?? false,
    minimapShowAllSpawnedDebug
  };
}

/**
 * DOM panel sync for the weather engine. Registered as a listener so moves / programmatic
 * `setWeatherTarget` calls keep the UI in lockstep without scattering `syncWeatherUi()`
 * calls throughout the file.
 *
 * `ui-cloud` / `ui-precip` skip the matching range so the active drag is not overwritten.
 * @param {{ preset: import('./main/weather-presets.js').WeatherPresetId, cloudIntensity01: number, precipIntensity01: number, source: string }} [ev]
 */
function syncWeatherUi(ev) {
  const { preset, cloudIntensity01, precipIntensity01 } = ev ?? getWeatherTarget();
  for (const btn of playWeatherPresetBtns) {
    btn.classList.toggle('is-active', btn.dataset.weather === preset);
  }
  if (playWeatherCurrentEl) {
    playWeatherCurrentEl.textContent = getWeatherPresetLabel(preset);
  }
  if (playWeatherCloudIntensityEl && ev?.source !== 'ui-cloud') {
    playWeatherCloudIntensityEl.value = String(Math.round(cloudIntensity01 * 100));
  }
  if (playWeatherRainIntensityEl && ev?.source !== 'ui-precip') {
    playWeatherRainIntensityEl.value = String(Math.round(precipIntensity01 * 100));
  }
}

addWeatherTargetChangeListener(syncWeatherUi);

function updateView() {
  const hover = appMode === 'play' ? getPlayHoverMicroTile() : lastHoverTile;
  syncMapContinueButtonVisibility();
  if (appMode === 'map') updateWorldMapCameraBounds();
  const settings = getSettings();
  if (currentData) {
    render(canvas, currentData, { settings, hover });
    renderMapOverlaySvg(mapOverlaySvg, currentData, {
      canvas,
      appMode,
      overlayPaths: settings.overlayPaths,
      overlayGraph: settings.overlayGraph,
      useSvgOverlay: settings.worldMapUseSvgOverlay,
      camera: settings.worldMapCamera
    });
  }
}

const PLAY_AUX_HUD_SYNC_CADENCE_MS = 120;
let lastPlayAuxHudSyncAtMs = 0;

const { startGameLoop, stopGameLoop } = createGameLoop({
  getAppMode: () => appMode,
  setGameTime: (t) => {
    gameTime = t;
  },
  getCurrentData: () => currentData,
  updateView,
  refreshPlayModeInfoBar,
  getPlayFpsEl: () => playFpsEl,
  getPlayFpsCompact: () => isPlayImmersiveMinimalUi(),
  player,
  onEscapePlay: escapeFromPlayOrCloseOverlays,
  advanceWorldTime: (dt) => {
    if (appMode !== 'play') return;
    worldHours = advanceWorldHours(worldHours, dt, worldTimeRunning, readWorldHoursPerRealSec());
    tickDayCycleTintSmooth(dt, wrapHours(worldHours));
    tickWeather(dt, gameTime);
    tickEarthquakeLayer(dt, gameTime);
    tickSunLightRaysLayer(dt, { data: currentData, player });
  },
  advancePlaySessionSeconds: (dt) => {
    if (appMode !== 'play') return;
    const d = Number(dt);
    if (!Number.isFinite(d) || d <= 0) return;
    playSessionSeconds = Math.max(0, Math.min(31_536_000, playSessionSeconds + d));
  },
  getGameTimeSec: () => gameTime,
  onPlayHudFrame: (data) => {
    const nowMs = performance.now();
    if (nowMs - lastPlayAuxHudSyncAtMs < PLAY_AUX_HUD_SYNC_CADENCE_MS) return;
    lastPlayAuxHudSyncAtMs = nowMs;
    playCharacterSelector?.updatePlayAltitudeHud(data);
    playCharacterSelector?.updatePlayMovesCooldownHud();
    playCharacterSelector?.updatePlayFieldMoveChargeHud();
    playCharacterSelector?.updatePlayItemsHud();
    syncPlayWorldTimePanel();
    syncPlayBgmNowPlayingPanel();
    minimapAudioUi.syncMinimapAudioPopover();
  },
  getPlaySessionPersistExtra: () => buildPlaySessionPersistExtra()
});

/** Help wiki registers Escape (capture) before this so Esc closes the modal instead of exiting play. */
registerPlayGamepadListeners();

registerPlayKeyboard({
  getAppMode: () => appMode,
  getCurrentData: () => currentData,
  refreshPlayModeInfoBar,
  onEscapePlay: escapeFromPlayOrCloseOverlays,
  onPlaySocialAction: (action) => {
    if (appMode !== 'play') return;
    playSocialOverlay.flashAction(action.id);
    showPlayerSocialEmotion(action);
    triggerPlayerSocialAction(action, player, currentData);
  },
  player
});

installPlayPointerCombat({
  canvas,
  getAppMode: () => appMode,
  getPlayer: () => player,
  getCurrentData: () => currentData
});

installPlayContextMenu({
  canvas,
  getAppMode: () => appMode,
  getCurrentData: () => currentData,
  updateView,
  refreshPlayModeInfoBar,
  openDebugModal,
  openDetailDebugModal,
  buildPlayModeTileDebugInfo,
  buildPlayModeDetailDebugPayload,
  playContextMenu,
  btnPlayCtxTeleport,
  btnPlayCtxDebug,
  btnPlayCtxViewDetailData,
  btnPlayCtxShowDetailCollider,
  btnPlayCtxClearDetailCollider,
  getPlayDetailColliderHighlight: () => playDetailColliderHighlight,
  setPlayDetailColliderHighlight: (v) => {
    playDetailColliderHighlight = v;
  },
  getPlayer: () => player
});

function run() {
  resetWorldMapCamera();
  sessionEnteredPlayOnCurrentMap = false;
  resetFarCrySystem();
  try {
    const hint = sessionStorage.getItem('pkmn_resume_seed_hint');
    if (hint != null && hint !== '') {
      sessionStorage.removeItem('pkmn_resume_seed_hint');
      if (seedInput) seedInput.value = hint;
    }
  } catch {
    /* ignore */
  }
  currentData = generate(seedInput.value, currentConfig);
  playSessionSeconds = 0;
  clearScatterSolidBlockCache();
  clearPlayColliderOverlayCache();
  resetWildPokemonManager();
  resetThrownMapDetailEntities();
  playDetailColliderHighlight = null;
  stopWorldMapRenderLoop();
  syncMapContinueButtonVisibility();
  syncRegionViewShell();
  resizeCanvas();
  updateView();
  startWorldMapRenderLoop();
}

function downloadJsonFile(filename, payload) {
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

document.querySelectorAll('input[name="viewType"], #chkRotas, #chkGrafo').forEach((el) => {
  el.addEventListener('change', updateView);
});

let lastHoverTile = null;
let lastMapHoverRenderTs = 0;
let lastMapNoiseProgressRenderTs = 0;

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!currentData || appMode !== 'map' || !WORLD_MAP_CONTINUOUS_ZOOM_ENABLED) return;
    e.preventDefault();
    const { x, y } = mapClientToCanvasPx(e.clientX, e.clientY);
    const zoomFactor = Math.exp(-e.deltaY * 0.0017);
    zoomWorldMapByFactorAtScreenPoint(zoomFactor, x, y);
    requestWorldMapCameraFrame();
  },
  { passive: false }
);

canvas.addEventListener('pointerdown', (e) => {
  if (!currentData || appMode !== 'map' || !WORLD_MAP_CONTINUOUS_ZOOM_ENABLED) return;
  if (e.button !== 0) return;
  mapDragPointerId = e.pointerId;
  mapDragMovedPx = 0;
  mapDragLastClientX = e.clientX;
  mapDragLastClientY = e.clientY;
  suppressNextMapClick = false;
  canvas.setPointerCapture?.(e.pointerId);
});

canvas.addEventListener('pointerup', (e) => {
  if (appMode !== 'map' || e.pointerId !== mapDragPointerId) return;
  suppressNextMapClick = mapDragMovedPx > 7;
  mapDragPointerId = -1;
  mapDragMovedPx = 0;
  canvas.releasePointerCapture?.(e.pointerId);
});

canvas.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== mapDragPointerId) return;
  mapDragPointerId = -1;
  mapDragMovedPx = 0;
  canvas.releasePointerCapture?.(e.pointerId);
});

canvas.addEventListener('mousemove', (e) => {
  if (!currentData) return;

  if (appMode === 'play') {
    recordPlayPointerClient(e.clientX, e.clientY);
    playInputState.mouseValid = true;
    return;
  }

  if (WORLD_MAP_CONTINUOUS_ZOOM_ENABLED && mapDragPointerId !== -1 && (e.buttons & 1) === 1) {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - mapDragLastClientX) * (canvas.width / Math.max(1, rect.width));
    const sy = (e.clientY - mapDragLastClientY) * (canvas.height / Math.max(1, rect.height));
    mapDragMovedPx += Math.hypot(sx, sy);
    mapDragLastClientX = e.clientX;
    mapDragLastClientY = e.clientY;
    if (Math.abs(sx) > 0.001 || Math.abs(sy) > 0.001) {
      panWorldMapByScreenDelta(sx, sy);
      requestWorldMapCameraFrame();
    }
    return;
  }

  const { gx, gy } = mapClientToMacro(e.clientX, e.clientY);
  if (lastHoverTile && lastHoverTile.x === gx && lastHoverTile.y === gy) return;
  lastHoverTile = { x: gx, y: gy };
  const now = performance.now();
  if (now - lastMapHoverRenderTs < MAP_HOVER_MIN_INTERVAL_MS) return;
  lastMapHoverRenderTs = now;
  renderMapHoverDetails(gx, gy, {
    currentData,
    infoBar,
    canvas,
    render,
    getSettings,
    updateView
  });
});

canvas.addEventListener('pointermove', (e) => {
  if (!currentData || appMode !== 'play') return;
  recordPlayPointerClient(e.clientX, e.clientY);
  playInputState.mouseValid = true;
});

const PLAY_INVENTORY_DROP_PREFIX = 'pkmn-inventory-drop:';

canvas.addEventListener('dragover', (e) => {
  if (!currentData || appMode !== 'play') return;
  const types = e.dataTransfer?.types;
  if (!types || ![...types].includes('text/plain')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvas.addEventListener('drop', (e) => {
  if (!currentData || appMode !== 'play' || !canvas) return;
  const raw = e.dataTransfer?.getData('text/plain') || '';
  if (!raw.startsWith(PLAY_INVENTORY_DROP_PREFIX)) return;
  e.preventDefault();
  e.stopPropagation();
  const token = raw.slice(PLAY_INVENTORY_DROP_PREFIX.length);
  const spent = trySpendOneInventoryUnitForGroundDrop(token);
  if (!spent?.itemKey) return;
  const { mousePxX, mousePxY } = clientToCanvasPixels(canvas, e.clientX, e.clientY);
  const { worldX, worldY } = playScreenPixelsToWorldTileCoords(
    canvas.width,
    canvas.height,
    mousePxX,
    mousePxY,
    player
  );
  const placed = placeInventoryItemAsScatterDetailNear(worldX, worldY, spent.itemKey, currentData, 12);
  if (!placed) {
    refundOneInventoryUnitFromGroundDrop(spent.itemKey);
  }
  playCharacterSelector?.invalidatePlayItemsHudSignature?.();
  playCharacterSelector?.updatePlayItemsHud?.();
  focusGameCanvas();
});

canvas.addEventListener('mouseleave', () => {
  if (appMode === 'play') {
    playInputState.mouseValid = false;
    invalidatePlayPointerHover();
  }
  if (currentData && appMode === 'map') updateView();
});

window.addEventListener('pkmn-map-overview-noise-progress', () => {
  if (appMode !== 'map' || !currentData) return;
  const now = performance.now();
  if (now - lastMapNoiseProgressRenderTs < 33) return;
  lastMapNoiseProgressRenderTs = now;
  updateView();
});

/**
 * @param {number} gx
 * @param {number} gy
 * @param {{ resumePosition?: boolean }} [opts] — `resumePosition: true` only for cold resume on load; map click omits it so the clicked tile wins.
 */
function enterPlayMode(gx, gy, opts = {}) {
  const resumePosition = opts.resumePosition === true;
  playSessionSeconds = 0;
  resetWildPokemonManager();
  resetThrownMapDetailEntities();
  clearPlayCrystalTackleState();
  setPlayerPos(gx * MACRO_TILE_STRIDE + MACRO_TILE_STRIDE / 2, gy * MACRO_TILE_STRIDE + MACRO_TILE_STRIDE / 2);
  if (
    currentData &&
    tryApplyPlaySessionResumeOnEnter(currentData, player, {
      position: resumePosition,
      inventory: true,
      applyEnvironmentFromSave: resumePosition,
      onRestoreEnvironment: applyRestoredPlayEnvironmentFromSave,
      applyPlaySessionSecondsFromSave: true,
      onRestorePlaySessionSeconds: (seconds) => {
        playSessionSeconds = Math.max(0, Number(seconds) || 0);
      }
    })
  ) {
    playCharacterSelector?.invalidatePlayItemsHudSignature?.();
    playCharacterSelector?.updatePlayItemsHud?.();
  }
  resetPlayAutosaveSchedule();
  sessionEnteredPlayOnCurrentMap = true;
  playInputState.mouseValid = false;
  invalidatePlayPointerHover();
  appMode = 'play';
  syncMapContinueButtonVisibility();
  btnExport?.classList.add('hidden');
  btnBackToMap?.classList.remove('hidden');
  if (minimapPanel) minimapPanel.classList.remove('hidden');
  else minimap?.classList.remove('hidden');
  syncMinimapZoomReadout();
  minimapAudioUi.forceCloseMinimapAudioPopover();
  minimapHudPopovers.forceCloseAllPopovers();
  if (infoBar) infoBar.innerHTML = '';
  playFpsSampleTimes.length = 0;
  if (playFpsEl) playFpsEl.textContent = t('play.fpsPlaceholder');

  if (playWorldTimeRun) playWorldTimeRun.checked = worldTimeRunning;
  lastWorldTimePanelPhase = null;
  snapDayCycleTintSmoothToHours(wrapHours(worldHours));
  syncPlayWorldTimePanel();
  lastBgmUiSignature = '';
  lastBgmToastTrackKey = null;
  dismissPlayBgmToast();
  syncPlayBgmNowPlayingPanel();

  playSocialOverlay.clearActive();

  playCharacterSelector?.syncPlayPointerModeRadios();

  syncRegionViewShell();
  resizeCanvas();
  stopWorldMapRenderLoop();
  startGameLoop();
  refreshPlayModeInfoBar(true);
}

btnMinimapBackToMap?.addEventListener('click', () => {
  btnBackToMap?.click();
});

btnBackToMap?.addEventListener('click', () => {
  if (appMode === 'play' && currentData) flushPlaySessionSave(currentData, player, buildPlaySessionPersistExtra());
  resetFarCrySystem();
  stopBiomeBgm();
  stopWeatherAmbientAudio();
  stopEarthquakeAmbientAudio();
  stopFireLoopAudio();
  clearPlayCrystalTackleState();
  clearPlayCameraSnapshot();
  playInputState.fieldChargeUiActive = null;
  appMode = 'map';
  syncMapContinueButtonVisibility();
  btnExport?.classList.remove('hidden');
  btnBackToMap?.classList.add('hidden');
  if (minimapPanel) minimapPanel.classList.add('hidden');
  else minimap?.classList.add('hidden');
  minimapAudioUi.forceCloseMinimapAudioPopover();
  minimapHudPopovers.forceCloseAllPopovers();
  minimapSaveModal.forceClose();
  if (infoBar) infoBar.innerHTML = t('play.hudHintMap');
  resetMinimapPlayFooter();
  playDetailColliderHighlight = null;

  playSocialOverlay.clearActive();

  stopGameLoop();
  playCharacterSelector?.updatePlayAltitudeHud(null);
  playCharacterSelector?.clearPlayMovesCooldownHud();
  playCharacterSelector?.clearPlayItemsHud();
  lastBgmUiSignature = '';
  lastBgmToastTrackKey = null;
  dismissPlayBgmToast();
  if (playBgmNowPlayingTrackEl) playBgmNowPlayingTrackEl.textContent = '—';
  if (playBgmNowPlayingStatusEl) playBgmNowPlayingStatusEl.textContent = t('play.idle');
  syncRegionViewShell();
  resizeCanvas();
  updateView();
  startWorldMapRenderLoop();
});

btnContinuePlay?.addEventListener('click', () => {
  continueFromMapToPlay();
});

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const wrap = document.querySelector('.map-wrap');
  const w = Math.max(1, Math.floor(wrap?.clientWidth || window.innerWidth));
  const h = Math.max(1, Math.floor(wrap?.clientHeight || window.innerHeight));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
}

window.addEventListener('resize', () => {
  if (currentData) {
    resizeCanvas();
    updateView();
  }
});

canvas.addEventListener('click', (e) => {
  if (!currentData || appMode !== 'map') return;
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }
  const { gx, gy } = mapClientToMacro(e.clientX, e.clientY);

  if (gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height) {
    enterPlayMode(gx, gy);
  }
});

if (btnDebugClose && debugModal) {
  btnDebugClose.addEventListener('click', () => {
    debugModal.classList.remove('is-open');
  });
}

if (btnDebugCopy) {
  btnDebugCopy.addEventListener('click', () => {
    const lastDebugInfo = getLastTileDebugInfo();
    if (lastDebugInfo) {
      navigator.clipboard.writeText(JSON.stringify(lastDebugInfo, null, 2)).then(() => {
        const oldText = btnDebugCopy.textContent;
        btnDebugCopy.textContent = 'COPIED!';
        setTimeout(() => {
          btnDebugCopy.textContent = oldText;
        }, 2000);
      });
    }
  });
}

if (btnDebugCopyDetail) {
  btnDebugCopyDetail.addEventListener('click', () => {
    const detailPayload = getLastDetailDebugInfo();
    if (detailPayload) {
      navigator.clipboard.writeText(JSON.stringify(detailPayload, null, 2)).then(() => {
        const oldText = btnDebugCopyDetail.textContent;
        btnDebugCopyDetail.textContent = 'COPIED!';
        setTimeout(() => {
          btnDebugCopyDetail.textContent = oldText;
        }, 2000);
      });
    }
  });
}

function wireDebugGeneratorChrome() {
  if (btnSettings && settingsModal) {
    btnSettings.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
      document.getElementById('cfgWaterLevel').value = (currentConfig.waterLevel ?? DEFAULT_CONFIG.waterLevel) * 100;
      document.getElementById('cfgElevation').value = currentConfig.elevationScale;
      document.getElementById('cfgElevationDetailOctaves').value =
        currentConfig.elevationDetailOctaves ?? DEFAULT_CONFIG.elevationDetailOctaves;
      document.getElementById('cfgElevationDetailStrength').value = Math.round(
        (currentConfig.elevationDetailStrength ?? DEFAULT_CONFIG.elevationDetailStrength) * 1000
      );
      document.getElementById('cfgTemperature').value = currentConfig.temperatureScale;
      document.getElementById('cfgMoisture').value = currentConfig.moistureScale;
      document.getElementById('cfgDesertMoisture').value = (currentConfig.desertMoisture || 0.38) * 100;
      document.getElementById('cfgForestMoisture').value = (currentConfig.forestMoisture || 0.58) * 100;
      document.getElementById('cfgAnomaly').value = currentConfig.anomalyScale;
      document.getElementById('cfgCities').value = currentConfig.cityCount;
      document.getElementById('cfgGyms').value = currentConfig.gymCount;
    });
  }

  btnCloseSettings?.addEventListener('click', () => settingsModal?.classList.add('hidden'));

  if (btnExportWorldSettings) {
    btnExportWorldSettings.addEventListener('click', () => {
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        config: currentConfig
      };
      const safeSeed = String(seedInput.value || 'world').replace(/[^\w-]+/g, '_');
      downloadJsonFile(`world-settings-${safeSeed}.json`, exportData);
    });
  }

  btnApplySettings?.addEventListener('click', () => {
    currentConfig = {
      ...DEFAULT_CONFIG,
      ...currentConfig,
      waterLevel: parseInt(document.getElementById('cfgWaterLevel').value, 10) / 100,
      elevationScale: parseInt(document.getElementById('cfgElevation').value, 10),
      elevationDetailOctaves: parseInt(document.getElementById('cfgElevationDetailOctaves').value, 10),
      elevationDetailStrength:
        parseInt(document.getElementById('cfgElevationDetailStrength').value, 10) / 1000,
      elevationDetailPersistence:
        currentConfig.elevationDetailPersistence ?? DEFAULT_CONFIG.elevationDetailPersistence,
      temperatureScale: parseInt(document.getElementById('cfgTemperature').value, 10),
      moistureScale: parseInt(document.getElementById('cfgMoisture').value, 10),
      desertMoisture: parseInt(document.getElementById('cfgDesertMoisture').value, 10) / 100,
      forestMoisture: parseInt(document.getElementById('cfgForestMoisture').value, 10) / 100,
      anomalyScale: parseInt(document.getElementById('cfgAnomaly').value, 10),
      cityCount: parseInt(document.getElementById('cfgCities').value, 10),
      gymCount: parseInt(document.getElementById('cfgGyms').value, 10)
    };
    settingsModal?.classList.add('hidden');
    run();
  });

  if (btnImport && importFile) {
    btnImport.addEventListener('click', () => importFile.click());

    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          if (data.seed && data.config) {
            seedInput.value = data.seed;
            currentConfig = { ...DEFAULT_CONFIG, ...data.config };
            run();
            infoBar.innerHTML = "<b style='color:#00ff00'>MUNDO IMPORTADO!</b>";
          } else {
            alert('Arquivo JSON inválido ou formato antigo.');
          }
        } catch (err) {
          alert('Erro ao ler JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }
}

wireDebugGeneratorChrome();

if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (!currentData) return;

    const exportData = {
      version: 2,
      seed: seedInput.value,
      config: currentConfig
    };

    downloadJsonFile(`pkmn-config-${exportData.seed}.json`, exportData);

    const originalContent = infoBar.innerHTML;
    infoBar.innerHTML = "<b style='color:#00ff00'>JSON EXPORTADO COM SUCESSO!</b>";
    setTimeout(() => {
      if (infoBar.innerHTML.includes('JSON EXPORTADO')) {
        infoBar.innerHTML = originalContent;
      }
    }, 2000);
  });
}

btnGenerate.addEventListener('click', run);
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

playWorldTimeSlider?.addEventListener('input', () => {
  const v = parseFloat(playWorldTimeSlider.value);
  if (!Number.isFinite(v)) return;
  worldHours = wrapHours(v);
  lastWorldTimePanelPhase = null;
  syncPlayWorldTimePanel();
  updateView();
});

playWorldTimeRun?.addEventListener('change', () => {
  worldTimeRunning = !!playWorldTimeRun.checked;
});

function wireWorldTimePreset(id, hour) {
  document.getElementById(id)?.addEventListener('click', () => {
    worldHours = wrapHours(hour);
    lastWorldTimePanelPhase = null;
    syncPlayWorldTimePanel();
    updateView();
  });
}
wireWorldTimePreset('play-world-preset-dawn', PRESET_HOUR.dawn);
wireWorldTimePreset('play-world-preset-day', PRESET_HOUR.day);
wireWorldTimePreset('play-world-preset-afternoon', PRESET_HOUR.afternoon);
wireWorldTimePreset('play-world-preset-night', PRESET_HOUR.night);

for (const btn of playWeatherPresetBtns) {
  btn.addEventListener('click', () => {
    const next = btn.dataset.weather;
    setWeatherTarget({ preset: next }, 'ui');
  });
}
playWeatherCloudIntensityEl?.addEventListener('input', () => {
  const v = Number(playWeatherCloudIntensityEl.value);
  setWeatherTarget({ cloudIntensity01: (Number.isFinite(v) ? v : 100) / 100 }, 'ui-cloud');
});
playWeatherRainIntensityEl?.addEventListener('input', () => {
  const v = Number(playWeatherRainIntensityEl.value);
  setWeatherTarget({ precipIntensity01: (Number.isFinite(v) ? v : 100) / 100 }, 'ui-precip');
});

playEarthquakeIntensityEl?.addEventListener('input', () => {
  const v = Number(playEarthquakeIntensityEl.value);
  setEarthquakeTargetIntensity01((Number.isFinite(v) ? v : 0) / 100);
});

playSunLightRaysIntensityEl?.addEventListener('input', () => {
  const v = Number(playSunLightRaysIntensityEl.value);
  setSunLightRaysTargetIntensity01((Number.isFinite(v) ? v : 0) / 100);
});

document.getElementById('play-weather-lightning')?.addEventListener('click', () => {
  if (appMode !== 'play') return;
  const pvx = player.visualX ?? player.x;
  const pvy = player.visualY ?? player.y;
  forceTriggerLightningNearPlayer(pvx, pvy, currentData);
});

syncWeatherUi();

onLocaleChanged(() => {
  applyI18nDom(document);
  syncMinimapLanguageSelect();
  syncMinimapZoomReadout();
  syncWeatherUi();
  syncPlayWorldTimePanel();
  syncPlayBgmNowPlayingPanel();
  if (appMode === 'map' && infoBar) {
    infoBar.innerHTML = t('play.hudHintMap');
    resetMinimapPlayFooter();
  }
  refreshPlayModeInfoBar(true);
});

document.getElementById('chkCurvas')?.addEventListener('change', updateView);
document.getElementById('chkPlayColliders')?.addEventListener('change', () => {
  const on = document.getElementById('chkPlayColliders')?.checked ?? false;
  if (on && appMode === 'play' && currentData) {
    const overlayFeetMoving =
      !!player.grounded && Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.1;
    buildPlayColliderOverlayCache(currentData, player, imageCache, overlayFeetMoving);
  } else if (!on) {
    clearPlayColliderOverlayCache();
  }
  updateView();
});
document.getElementById('chkWorldReactionsOverlay')?.addEventListener('change', updateView);

function syncForceLod0FromUi() {
  setPlayForceLod0Always(!!document.getElementById('chkForceLod0')?.checked);
}
document.getElementById('chkForceLod0')?.addEventListener('change', () => {
  syncForceLod0FromUi();
  updateView();
});
syncForceLod0FromUi();

void initMods();

loadTilesetImages().then(async () => {
  playCharacterSelector = new CharacterSelector('character-selector-container', {
    getCurrentData: () => currentData,
    getAppMode: () => appMode,
    defaultPlayImmersiveChrome: document.documentElement?.dataset?.appShell === 'play'
  });
  playSocialOverlay = createPlaySocialOverlay(document.getElementById('character-social-numpad'));
  void playSocialOverlay.refreshPortraits(player.dexId);
  window.addEventListener('pkmn-player-species-changed', () => {
    void playSocialOverlay.refreshPortraits(player.dexId);
  });
  await ensurePokemonSheetsLoaded(imageCache, player.dexId);
  await ensureEffectAssetsLoaded(imageCache);
  run();
  queueTryAutoResumePlayFromSave();
});

function queueTryAutoResumePlayFromSave() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => tryAutoResumePlayFromSave());
  });
}

function tryAutoResumePlayFromSave() {
  if (didAutoResumePlayOnInitialLoad) return;
  if (appMode !== 'map' || !currentData) return;
  const saved = peekPlaySessionSaveForMap(currentData);
  if (saved) {
    const tile = getPlayResumeMacroTileFromSave(saved, currentData);
    if (tile) {
      didAutoResumePlayOnInitialLoad = true;
      enterPlayMode(tile.gx, tile.gy, { resumePosition: true });
      return;
    }
  }
  const city = pickRandomCityMacroForPlayStart(currentData);
  didAutoResumePlayOnInitialLoad = true;
  enterPlayMode(city.gx, city.gy, { resumePosition: false });
}
