import { isPlayShell } from './main/app-shell.js';
import { setPlayPointerMode } from './main/play-pointer-mode.js';
import { generate, DEFAULT_CONFIG } from './generator.js';
import { render, loadTilesetImages } from './render.js';
import {
  resetWildPokemonManager,
  triggerPlayerSocialAction
} from './wild-pokemon/index.js';
import { resetThrownMapDetailEntities } from './main/thrown-map-detail-entities.js';
import { ensurePokemonSheetsLoaded } from './pokemon/pokemon-asset-loader.js';
import { ensureEffectAssetsLoaded } from './pokemon/effect-asset-loader.js';
import { CharacterSelector } from './ui/character-selector.js';
import { imageCache } from './image-cache.js';
import { BiomesModal } from './biomes-modal.js';
import { BIOMES } from './biomes.js';
import { getEncounters } from './ecodex.js';
import { player, setPlayerPos, showPlayerSocialEmotion } from './player.js';
import { speciesHasFlyingType } from './pokemon/pokemon-type-helpers.js';
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
import { computeTerrainRoleAndSprite } from './main/terrain-role-helpers.js';
import { installPlayContextMenu } from './main/play-context-menu.js';
import { createGameLoop, registerPlayKeyboard, playFpsSampleTimes } from './main/game-loop.js';
import {
  setWeatherRenderState,
  getWeatherWindDirectionRad,
  getWeatherWindFeltIntensity
} from './main/weather-state.js';
import { forceTriggerLightningNearPlayer } from './weather/lightning.js';
import { installPlayPointerCombat } from './main/play-mouse-combat.js';
import { clearPlayCrystalTackleState } from './main/play-crystal-tackle.js';
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
import {
  playScreenPixelsToWorldTileCoords,
  clearPlayCameraSnapshot
} from './render/play-camera-snapshot.js';
import { setPlayForceLod0Always } from './render/play-view-camera.js';
import { OBJECT_SETS } from './tessellation-data.js';
import { parseShape } from './tessellation-logic.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getBiomeBgmUiState, stopBiomeBgm } from './audio/biome-bgm.js';
import { stopWeatherAmbientAudio } from './audio/weather-ambient-audio.js';
import { stopFireLoopAudio } from './audio/fire-loop-sfx.js';
import { isBgmTrackChangeToastSuppressed } from './audio/play-audio-mix-settings.js';
import { installMinimapAudioUi } from './main/minimap-audio-ui.js';
import { installPlayHelpWikiModal } from './main/play-help-wiki-modal.js';
import { cycleMinimapZoom } from './render/render-minimap.js';
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

if (isPlayShell()) {
  setPlayPointerMode('game');
}

const canvas = document.getElementById('map');

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
const btnMinimapZoom = document.getElementById('minimap-zoom-btn');

/** Zoom labels shown in the panel badge */
const ZOOM_LABELS = { far: '🗺 Far', mid: '🔍 Mid', close: '🔍+ Close' };

function syncMinimapZoomBadge() {
  if (!minimap || !minimapPanel) return;
  const zoom = minimap.dataset.zoom || 'close';
  minimapPanel.dataset.zoomLevel = ZOOM_LABELS[zoom] ?? zoom;
}

if (btnMinimapZoom && minimap) {
  btnMinimapZoom.addEventListener('click', () => {
    const next = cycleMinimapZoom(/** @type {HTMLCanvasElement} */ (minimap));
    syncMinimapZoomBadge();
    // Tooltip update to reflect new state
    const NEXT_LABELS = { far: 'Zoom: mapa completo — clique para zoom médio', mid: 'Zoom: médio — clique para zoom aproximado', close: 'Zoom: aproximado — clique para mapa completo' };
    btnMinimapZoom.title = NEXT_LABELS[next] ?? 'Alterar zoom';
  });
}
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
const playWeatherIntensityEl = document.getElementById('play-weather-intensity');
const playWeatherCurrentEl = document.getElementById('play-weather-current');
const playWeatherPresetBtns = Array.from(document.querySelectorAll('.play-weather-preset'));
const chkRotas = document.getElementById('chkRotas');
const chkGrafo = document.getElementById('chkGrafo');
const chkCurvas = document.getElementById('chkCurvas');
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
/** @type {import('./ui/character-selector.js').CharacterSelector | null} */
let playCharacterSelector = null;
let appMode = 'map';
let currentConfig = { ...DEFAULT_CONFIG };
let gameTime = 0;
/** World clock for day phases (hours in [0, 24)). */
let worldHours = 12;
let worldTimeRunning = true;
/** @type {'clear' | 'cloudy' | 'rain'} */
let currentWeatherPreset = 'cloudy';
/** 0..1 intensity scalar (UI slider target). */
let currentWeatherIntensity = 0.75;
/** Currently-displayed weather params (smoothly eased toward the target preset+intensity). */
let activeWeatherParams = null;
/** Time constant (seconds) for exponential smoothing of weather transitions. */
const WEATHER_SMOOTH_TAU_SEC = 1.2;
/**
 * Base wind direction in radians (0 = east, +π/2 = south). Roughly matches the cloud drift
 * vector used in {@link drawSnesCloudParallax} (vx=0.32, vy=0.09 → atan2 ≈ 0.274 rad).
 * A slow wobble is added per frame so tree sway and particles don't feel locked to a grid.
 */
const WIND_BASE_DIR_RAD = 0.274;
/** @type {string | null} */
let lastWorldTimePanelPhase = null;
let lastBgmUiSignature = '';
/** Last track title used for immersive toast dedupe (not the full panel signature). */
/** @type {string | null} */
let lastBgmToastTrackKey = null;
let playBgmToastHideTimer = 0;
/** @type {object | null} */
let playDetailColliderHighlight = null;

const PLAY_BGM_TOAST_MS = 4600;

function isPlayImmersiveMinimalUi() {
  return document.querySelector('.app')?.classList.contains('app--play-immersive') ?? false;
}

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
installPlayHelpWikiModal({
  forceCloseMinimapAudioPopover: minimapAudioUi.forceCloseMinimapAudioPopover
});

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

function detailPreviewHtmlForInfoBar(itemKey) {
  const objSet = OBJECT_SETS[String(itemKey || '')];
  if (!objSet) return '';
  const base = objSet.parts?.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return '';
  const { cols } = parseShape(objSet.shape || '[1x1]');
  const imgPath = TessellationEngine.getImagePath(objSet.file);
  if (!imgPath) return '';
  const atlasCols = imgPath.includes('caves') ? 50 : 57;
  const previewIds = base.ids.slice(0, Math.max(1, Math.min(4, cols)));
  const tiles = previewIds
    .map((id) => {
      const sx = (id % atlasCols) * 16;
      const sy = Math.floor(id / atlasCols) * 16;
      return `<span style="display:inline-block;width:14px;height:14px;background-image:url('${imgPath}');background-repeat:no-repeat;background-size:auto;background-position:-${sx}px -${sy}px;image-rendering:pixelated;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,0.18) inset"></span>`;
    })
    .join('');
  return `<span style="display:inline-flex;gap:2px;vertical-align:middle;margin-right:6px">${tiles}</span>`;
}

function detailPreviewHtmlForImmersiveHint(itemKey) {
  const objSet = OBJECT_SETS[String(itemKey || '')];
  if (!objSet) return '';
  const base = objSet.parts?.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return '';
  const { cols } = parseShape(objSet.shape || '[1x1]');
  const imgPath = TessellationEngine.getImagePath(objSet.file);
  if (!imgPath) return '';
  const atlasCols = imgPath.includes('caves') ? 50 : 57;
  const gridCols = Math.max(1, cols | 0);
  const tiles = base.ids
    .map((id) => {
      const sx = (id % atlasCols) * 16;
      const sy = Math.floor(id / atlasCols) * 16;
      return `<span style="display:inline-block;width:15px;height:15px;background-image:url('${imgPath}');background-repeat:no-repeat;background-position:-${sx}px -${sy}px;image-rendering:pixelated;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,0.16) inset"></span>`;
    })
    .join('');
  return `<span class="play-immersive-hint__sprite" aria-hidden="true" style="display:grid;grid-template-columns:repeat(${gridCols},15px);gap:2px">${tiles}</span>`;
}

/** @param {boolean} [force] when true, skip throttle (e.g. keyboard) */
function refreshPlayModeInfoBar(force = false) {
  if (!infoBar || !currentData || appMode !== 'play') return;
  const mx = Math.floor(player.x);
  const my = Math.floor(player.y);
  const key = `${mx},${my}`;
  const now = performance.now();
  if (!force) {
    const sameTile = key === lastHudTileKey;
    if (sameTile && now - lastHudMs < HUD_MIN_INTERVAL_MS) return;
  }
  lastHudTileKey = key;
  lastHudMs = now;

  const tile = getMicroTile(mx, my, currentData);
  const bId = tile.biomeId;
  const bio = Object.values(BIOMES).find((b) => b.id === bId);
  const encounters = getEncounters(bId);
  let prefix = '';
  const macroX = Math.floor(player.x / MACRO_TILE_STRIDE);
  const macroY = Math.floor(player.y / MACRO_TILE_STRIDE);
  if (currentData.graph) {
    const city = currentData.graph.nodes.find(
      (n) => Math.abs(n.x - macroX) <= 1 && Math.abs(n.y - macroY) <= 1
    );
    if (city) prefix = `<span style="color:#ff5b5b">🏙️ ${city.name}</span> | `;
  }
  if (!prefix && currentData.paths) {
    const activePath = currentData.paths.find((p) => p.some((c) => c.x === macroX && c.y === macroY));
    if (activePath) prefix = `<span style="color:#ffd700">🛣️ ${activePath.name || 'Rota'}</span> | `;
  }
  const baseAt = computeTerrainRoleAndSprite(mx, my, currentData, tile.heightStep);
  const flyHint =
    speciesHasFlyingType(player.dexId ?? 0) &&
    ` · Flight ${player.flightActive ? 'ON' : 'OFF'} (F toggle · Space/Shift altitude · hops: 2 or 6 flying)`;
  const hp = player.hp ?? player.maxHp ?? 100;
  const maxH = player.maxHp ?? 100;
  const psn =
    (player.poisonVisualSec ?? 0) > 0.05
      ? ` <span style="color:#d080ff;font-weight:700">PSN ${(player.poisonVisualSec ?? 0).toFixed(1)}s</span>`
      : '';
  const ifr = (player.projIFrameSec ?? 0) > 0 ? ` · i-frames ${(player.projIFrameSec ?? 0).toFixed(2)}s` : '';
  const carryPrompt = player._strengthCarry
    ? {
      itemKey: String(player._strengthCarry.itemKey || ''),
      displayName: String(player._strengthCarry.displayName || '')
    }
    : null;
  const carryMobility = getStrengthCarryMobilityInfo(player);
  const grabPrompt = getStrengthGrabPromptInfo(player, currentData);
  const immersive = isPlayImmersiveMinimalUi();
  if (playImmersiveHintEl) {
    if (immersive && (carryPrompt || grabPrompt)) {
      const ctxPrompt = carryPrompt || grabPrompt;
      const label = String(ctxPrompt.displayName || detailLabelFromItemKey(ctxPrompt.itemKey) || 'Detail');
      const actionHtml = carryPrompt
        ? `<div class="play-immersive-hint__action-row"><span class="play-immersive-hint__action">Place</span><span class="play-immersive-hint__key">E</span></div>` +
          `<div class="play-immersive-hint__action-row"><span class="play-immersive-hint__action">Throw</span><span class="play-immersive-hint__key">LMB</span></div>` +
          `${carryMobility ? `<div class="play-immersive-hint__action-row"><span class="play-immersive-hint__warn">${carryMobility.message}</span></div>` : ''}`
        : `<span class="play-immersive-hint__action">Grab</span><span class="play-immersive-hint__key">E</span>`;
      playImmersiveHintEl.innerHTML =
        `<div class="play-immersive-hint__row">` +
        `${detailPreviewHtmlForImmersiveHint(ctxPrompt.itemKey)}` +
        `<span>(${label})</span>` +
        `${actionHtml}` +
        `</div>`;
      playImmersiveHintEl.classList.add('play-immersive-hint--visible');
    } else {
      playImmersiveHintEl.innerHTML = '';
      playImmersiveHintEl.classList.remove('play-immersive-hint--visible');
    }
  }
  if (immersive) return;
  const carryHint = carryPrompt
    ? `<span style="display:block;margin-top:4px;color:#ffdcb2;font-weight:700">${detailPreviewHtmlForInfoBar(carryPrompt.itemKey)}(${String(carryPrompt.displayName || detailLabelFromItemKey(carryPrompt.itemKey) || 'Detail')})</span>` +
      `<span style="display:block;margin-top:2px;color:#ffdcb2;font-weight:700">Place [E]</span>` +
      `<span style="display:block;margin-top:2px;color:#ffdcb2;font-weight:700">Throw [LMB]</span>` +
      `${carryMobility ? `<span style="display:block;margin-top:2px;color:#ffc6a8;font-weight:700">${carryMobility.message}</span>` : ''}`
    : '';
  const grabHint = grabPrompt
    ? `<span style="display:block;margin-top:4px;color:#ffe69b;font-weight:700">${detailPreviewHtmlForInfoBar(grabPrompt.itemKey)}(${String(grabPrompt.displayName || detailLabelFromItemKey(grabPrompt.itemKey) || 'Detail')}) Grab [E]</span>`
    : '';
  const telem = `<span style="opacity:0.8;font-size:0.72rem;display:block;margin-top:4px;color:#9ad8ff;font-family:'JetBrains Mono',monospace">HP ${Math.ceil(hp)}/${maxH}${psn}${ifr} · Telemetry · [${mx},${my}] H=${tile.heightStep} · ${bio?.name ?? '?'} · ${baseAt.setName ?? '—'} · role ${baseAt.role ?? '—'}${flyHint || ''}</span>`;
  infoBar.innerHTML = `${prefix}<span style="color:#8ceda1">Biome: ${bio?.name ?? '?'} | Selvagens: ${encounters.slice(0, 3).join(', ')}</span>${carryHint}${grabHint}${telem}`;
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
  playWorldTimeHourEl.textContent = `${wh.toFixed(2)} h`;
  if (playWorldTimeSlider) {
    const stepped = Math.round(wh / 0.05) * 0.05;
    const sVal = parseFloat(playWorldTimeSlider.value);
    if (!Number.isFinite(sVal) || Math.abs(sVal - stepped) > 1e-4) {
      playWorldTimeSlider.value = String(stepped);
    }
  }
}

function syncPlayBgmNowPlayingPanel() {
  if (appMode !== 'play') return;
  if (!playBgmNowPlayingTrackEl || !playBgmNowPlayingStatusEl) return;
  const st = getBiomeBgmUiState();
  const title = st.currentTrackName || '—';
  const statusText =
    st.status === 'playing'
      ? `Playing · biome ${st.playingBiomeId ?? '?'}`
      : st.status === 'transitioning'
        ? `Transitioning · target biome ${st.transitionTargetBiome ?? '?'}`
        : 'Idle';
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
    player,
    time: gameTime,
    dayPhase,
    worldHours: hoursWrapped,
    dayCycleTint,
    weatherPreset: currentWeatherPreset,
    weatherIntensity: currentWeatherIntensity,
    weatherCloudPresence: weather.cloudPresence,
    weatherCloudThreshold: weather.cloudThreshold,
    weatherCloudMinMul: weather.cloudMinMul,
    weatherCloudMaxMul: weather.cloudMaxMul,
    weatherCloudAlphaMul: weather.cloudAlphaMul,
    weatherRainIntensity: weather.rainIntensity,
    weatherScreenTint: weather.screenTint,
    weatherCloudNoiseSeed,
    weatherWindIntensity: getWeatherWindFeltIntensity(),
    weatherWindDirRad: getWeatherWindDirectionRad()
  };
}

function cloneWeatherParams(src) {
  return {
    cloudPresence: src.cloudPresence,
    cloudThreshold: src.cloudThreshold,
    cloudMinMul: src.cloudMinMul,
    cloudMaxMul: src.cloudMaxMul,
    cloudAlphaMul: src.cloudAlphaMul,
    rainIntensity: src.rainIntensity,
    screenTint: src.screenTint ? { ...src.screenTint } : null
  };
}

function getActiveWeatherParams() {
  if (!activeWeatherParams) {
    activeWeatherParams = cloneWeatherParams(
      resolveWeatherParams(currentWeatherPreset, currentWeatherIntensity)
    );
  }
  return activeWeatherParams;
}

/**
 * Exponentially eases the currently displayed weather params toward the target preset.
 * Called from the game loop's per-tick hook with `dt` in seconds.
 */
function tickWeatherSmoothing(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const target = resolveWeatherParams(currentWeatherPreset, currentWeatherIntensity);
  const active = getActiveWeatherParams();
  const k = 1 - Math.exp(-dt / Math.max(0.05, WEATHER_SMOOTH_TAU_SEC));
  const lerpN = (a, b) => a + (b - a) * k;

  active.cloudPresence = lerpN(active.cloudPresence, target.cloudPresence);
  active.cloudThreshold = lerpN(active.cloudThreshold, target.cloudThreshold);
  active.cloudMinMul = lerpN(active.cloudMinMul, target.cloudMinMul);
  active.cloudMaxMul = lerpN(active.cloudMaxMul, target.cloudMaxMul);
  active.cloudAlphaMul = lerpN(active.cloudAlphaMul, target.cloudAlphaMul);
  active.rainIntensity = lerpN(active.rainIntensity, target.rainIntensity);

  // Tint blends via alpha so `null` targets smoothly fade out instead of popping.
  const curT = active.screenTint;
  const tgtT = target.screenTint;
  if (!curT && !tgtT) {
    active.screenTint = null;
  } else {
    const cur = curT || { r: tgtT.r, g: tgtT.g, b: tgtT.b, a: 0 };
    const tgt = tgtT || { r: cur.r, g: cur.g, b: cur.b, a: 0 };
    const blended = {
      r: lerpN(cur.r, tgt.r),
      g: lerpN(cur.g, tgt.g),
      b: lerpN(cur.b, tgt.b),
      a: lerpN(cur.a, tgt.a)
    };
    active.screenTint = blended.a > 0.002 ? blended : null;
  }

  // Share smoothed rain intensity + evolving wind with gameplay / render / audio systems.
  const wind = computeLiveWindState(gameTime, currentWeatherPreset, active.rainIntensity);
  setWeatherRenderState({
    rainIntensity: active.rainIntensity,
    preset: currentWeatherPreset,
    windBaseIntensity: wind.baseIntensity,
    windDirRad: wind.dirRad,
    windGust: wind.gust
  });
}

/**
 * Evolves the live wind envelope each tick. The *base* intensity is preset-dependent (clear ≈
 * silent, cloudy has a low steady breeze, rain scales strongly with rainIntensity). On top of
 * that we layer a slow two-sinusoid gust envelope so both the on-screen particles and the
 * `Wind.ogg` ambient loop pulse naturally instead of reading as a flat hum.
 *
 * Direction wobbles gently around {@link WIND_BASE_DIR_RAD} so streamlines don't look rigid.
 * @param {number} time world time seconds
 * @param {'clear' | 'cloudy' | 'rain'} preset
 * @param {number} rainIntensity01
 * @returns {{ baseIntensity: number, dirRad: number, gust: number }}
 */
function computeLiveWindState(time, preset, rainIntensity01) {
  const rain = Math.max(0, Math.min(1, Number(rainIntensity01) || 0));
  const baseByPreset =
    preset === 'rain' ? 0.25 + 0.55 * rain : preset === 'cloudy' ? 0.3 : 0.08;
  const baseIntensity = Math.max(0, Math.min(1, baseByPreset));
  // Two-sine gust envelope (period ≈ 6–16 s), biased so average sits near ~0.7.
  const g1 = Math.sin(time * 0.38);
  const g2 = Math.sin(time * 0.11 + 1.7);
  const gust = Math.max(0.15, Math.min(1, 0.55 + 0.3 * g1 + 0.2 * g2));
  const dirRad = WIND_BASE_DIR_RAD + Math.sin(time * 0.07) * 0.22;
  return { baseIntensity, dirRad, gust };
}

/**
 * Maps a weather preset + 0..1 intensity to cloud/rain render params.
 * Kept in main.js so both UI sync and `getSettings` share the same contract.
 */
function resolveWeatherParams(preset, intensity01) {
  const t = Math.max(0, Math.min(1, Number(intensity01) || 0));
  const lerp = (a, b) => a + (b - a) * t;
  switch (preset) {
    case 'rain':
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.42, 0.02),
        cloudMinMul: lerp(0.45, 0.7),
        cloudMaxMul: lerp(1.55, 1.95),
        cloudAlphaMul: lerp(1, 1.25),
        rainIntensity: t,
        screenTint: t > 0 ? { r: 110, g: 120, b: 145, a: lerp(0, 0.28) } : null
      };
    case 'cloudy':
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.42, 0.22),
        cloudMinMul: 0.45,
        cloudMaxMul: lerp(1.55, 1.7),
        cloudAlphaMul: 1,
        rainIntensity: 0,
        screenTint: null
      };
    case 'clear':
    default:
      return {
        cloudPresence: 1,
        cloudThreshold: lerp(0.42, 0.78),
        cloudMinMul: 0.4,
        cloudMaxMul: lerp(1.55, 1.1),
        cloudAlphaMul: lerp(1, 0.75),
        rainIntensity: 0,
        screenTint: null
      };
  }
}

function syncWeatherUi() {
  for (const btn of playWeatherPresetBtns) {
    btn.classList.toggle('is-active', btn.dataset.weather === currentWeatherPreset);
  }
  if (playWeatherCurrentEl) {
    const label = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain' }[currentWeatherPreset] || '—';
    playWeatherCurrentEl.textContent = label;
  }
  if (playWeatherIntensityEl) {
    playWeatherIntensityEl.value = String(Math.round(currentWeatherIntensity * 100));
  }
}

function updateView() {
  refreshPlayPointerWorldFromLastClientIfHovering();
  if (currentData) render(canvas, currentData, { settings: getSettings(), hover: lastHoverTile });
}

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
  advanceWorldTime: (dt) => {
    if (appMode !== 'play') return;
    worldHours = advanceWorldHours(worldHours, dt, worldTimeRunning, readWorldHoursPerRealSec());
    tickDayCycleTintSmooth(dt, wrapHours(worldHours));
    tickWeatherSmoothing(dt);
  },
  onPlayHudFrame: (data) => {
    playCharacterSelector?.updatePlayAltitudeHud(data);
    playCharacterSelector?.updatePlayMovesCooldownHud();
    playCharacterSelector?.updatePlayFieldMoveChargeHud();
    playCharacterSelector?.updatePlayItemsHud();
    syncPlayWorldTimePanel();
    syncPlayBgmNowPlayingPanel();
    minimapAudioUi.syncMinimapAudioPopover();
  }
});

/** Help wiki registers Escape (capture) before this so Esc closes the modal instead of exiting play. */
registerPlayKeyboard({
  getAppMode: () => appMode,
  getCurrentData: () => currentData,
  refreshPlayModeInfoBar,
  onEscapePlay: () => btnBackToMap?.click?.(),
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
  resizeCanvas();
  currentData = generate(seedInput.value, currentConfig);
  clearScatterSolidBlockCache();
  clearPlayColliderOverlayCache();
  resetWildPokemonManager();
  resetThrownMapDetailEntities();
  playDetailColliderHighlight = null;
  updateView();
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
/** Last pointer client coords on window (play); used to reproject aim/hover every frame while camera moves. */
let playPointerLastClientX = 0;
let playPointerLastClientY = 0;

/** World aim under cursor in play (also used by `pointermove` while LMB/RMB held / captured). */
function syncPlayPointerWorldFromClient(clientX, clientY) {
  if (!currentData || appMode !== 'play') return;
  playPointerLastClientX = clientX;
  playPointerLastClientY = clientY;
  const rect = canvas.getBoundingClientRect();
  const mouseClientX = clientX - rect.left;
  const mouseClientY = clientY - rect.top;
  const mousePxX = (mouseClientX / rect.width) * canvas.width;
  const mousePxY = (mouseClientY / rect.height) * canvas.height;
  const { worldX, worldY } = playScreenPixelsToWorldTileCoords(
    canvas.width,
    canvas.height,
    mousePxX,
    mousePxY,
    player
  );
  playInputState.mouseX = worldX;
  playInputState.mouseY = worldY;
  playInputState.mouseValid = true;
  lastHoverTile = { x: Math.floor(worldX), y: Math.floor(worldY) };
}

/** Recompute world under cursor when the play camera moves but the mouse has not (hover ring + aim). */
function refreshPlayPointerWorldFromLastClientIfHovering() {
  if (!currentData || appMode !== 'play' || !playInputState.mouseValid) return;
  syncPlayPointerWorldFromClient(playPointerLastClientX, playPointerLastClientY);
}

canvas.addEventListener('mousemove', (e) => {
  if (!currentData) return;

  if (appMode === 'play') {
    syncPlayPointerWorldFromClient(e.clientX, e.clientY);
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const mouseClientX = e.clientX - rect.left;
  const mouseClientY = e.clientY - rect.top;
  const mousePxX = (mouseClientX / rect.width) * canvas.width;
  const mousePxY = (mouseClientY / rect.height) * canvas.height;

  const gx = Math.floor((mouseClientX / rect.width) * currentData.width);
  const gy = Math.floor((mouseClientY / rect.height) * currentData.height);
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
  syncPlayPointerWorldFromClient(e.clientX, e.clientY);
});

canvas.addEventListener('mouseleave', () => {
  if (appMode === 'play') playInputState.mouseValid = false;
  if (currentData && appMode === 'map') updateView();
});

function enterPlayMode(gx, gy) {
  resetWildPokemonManager();
  resetThrownMapDetailEntities();
  clearPlayCrystalTackleState();
  setPlayerPos(gx * MACRO_TILE_STRIDE + MACRO_TILE_STRIDE / 2, gy * MACRO_TILE_STRIDE + MACRO_TILE_STRIDE / 2);
  playInputState.mouseValid = false;
  appMode = 'play';
  btnExport?.classList.add('hidden');
  btnBackToMap?.classList.remove('hidden');
  if (minimapPanel) minimapPanel.classList.remove('hidden');
  else minimap?.classList.remove('hidden');
  syncMinimapZoomBadge();
  minimapAudioUi.forceCloseMinimapAudioPopover();
  infoBar.innerHTML =
    "<b style='color:#fff'>WASD / setas · duplo toque na mesma direção = correr · ESC = sair.</b><br><span style='color:#cfe7ff;font-size:0.88rem'>Golpes: 5 entradas — clique esquerdo, direito, meio da rolagem, rolagem para cima, rolagem para baixo — cada uma dispara o golpe que você amarrou nela. Segure 1–5 um instante para abrir a roda e escolher o golpe daquele botão (qualquer golpe da lista). Tackle/Cut no clique esquerdo: combo do Cut e carregar soltando como antes. Carregar pedra: E; com pedra, soltar LMB arremessa na mira. Social: Numpad 1–9. Debug: Ctrl+clique direito.</span>";
  playFpsSampleTimes.length = 0;
  if (playFpsEl) playFpsEl.textContent = '…';

  if (playWorldTimeRun) playWorldTimeRun.checked = worldTimeRunning;
  lastWorldTimePanelPhase = null;
  snapDayCycleTintSmoothToHours(wrapHours(worldHours));
  syncPlayWorldTimePanel();
  lastBgmUiSignature = '';
  lastBgmToastTrackKey = null;
  dismissPlayBgmToast();
  syncPlayBgmNowPlayingPanel();

  document.body.classList.add('play-mode-active');
  document.querySelector('.app').classList.add('play-mode-active');
  playSocialOverlay.clearActive();

  playCharacterSelector?.syncPlayPointerModeRadios();

  resizeCanvas();
  startGameLoop();
}

btnMinimapBackToMap?.addEventListener('click', () => {
  btnBackToMap?.click();
});

btnBackToMap?.addEventListener('click', () => {
  stopBiomeBgm();
  stopWeatherAmbientAudio();
  stopFireLoopAudio();
  clearPlayCrystalTackleState();
  clearPlayCameraSnapshot();
  appMode = 'map';
  btnExport?.classList.remove('hidden');
  btnBackToMap?.classList.add('hidden');
  if (minimapPanel) minimapPanel.classList.add('hidden');
  else minimap?.classList.add('hidden');
  minimapAudioUi.forceCloseMinimapAudioPopover();
  infoBar.innerHTML = 'Mova o mouse sobre o mapa para ver os detalhes do terreno';
  playDetailColliderHighlight = null;

  document.body.classList.remove('play-mode-active');
  document.querySelector('.app').classList.remove('play-mode-active');
  playSocialOverlay.clearActive();

  stopGameLoop();
  playCharacterSelector?.updatePlayAltitudeHud(null);
  playCharacterSelector?.clearPlayMovesCooldownHud();
  playCharacterSelector?.clearPlayItemsHud();
  lastBgmUiSignature = '';
  lastBgmToastTrackKey = null;
  dismissPlayBgmToast();
  if (playBgmNowPlayingTrackEl) playBgmNowPlayingTrackEl.textContent = '—';
  if (playBgmNowPlayingStatusEl) playBgmNowPlayingStatusEl.textContent = 'Idle';
  resizeCanvas();
  updateView();
});

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (appMode === 'play') {
    const wrap = document.querySelector('.map-wrap');
    const w = Math.max(1, Math.floor(wrap.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(wrap.clientHeight || window.innerHeight));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
  } else {
    const wrap = document.querySelector('.map-wrap');
    const cssW = Math.max(1, Math.floor(wrap?.clientWidth || window.innerWidth));
    const cssH = cssW;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
  }
}

window.addEventListener('resize', () => {
  if (currentData) {
    resizeCanvas();
    updateView();
  }
});

canvas.addEventListener('click', (e) => {
  if (!currentData || appMode !== 'map') return;
  const rect = canvas.getBoundingClientRect();
  const gx = Math.floor(((e.clientX - rect.left) / rect.width) * currentData.width);
  const gy = Math.floor(((e.clientY - rect.top) / rect.height) * currentData.height);

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
  snapDayCycleTintSmoothToHours(worldHours);
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
    snapDayCycleTintSmoothToHours(worldHours);
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
    if (next !== 'clear' && next !== 'cloudy' && next !== 'rain') return;
    currentWeatherPreset = next;
    syncWeatherUi();
  });
}
playWeatherIntensityEl?.addEventListener('input', () => {
  const v = Number(playWeatherIntensityEl.value);
  currentWeatherIntensity = Math.max(0, Math.min(1, (Number.isFinite(v) ? v : 100) / 100));
});

document.getElementById('play-weather-lightning')?.addEventListener('click', () => {
  if (appMode !== 'play') return;
  const pvx = player.visualX ?? player.x;
  const pvy = player.visualY ?? player.y;
  forceTriggerLightningNearPlayer(pvx, pvy, currentData);
});

syncWeatherUi();

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

loadTilesetImages().then(async () => {
  if (document.getElementById('biomesModal') && document.getElementById('biomesGrid')) {
    new BiomesModal();
  }
  playCharacterSelector = new CharacterSelector('character-selector-container', {
    getCurrentData: () => currentData,
    getAppMode: () => appMode,
    defaultPlayImmersiveChrome: document.documentElement?.dataset?.appShell === 'play'
  });
  playSocialOverlay = createPlaySocialOverlay(playCharacterSelector.getSocialOverlayElement());
  void playSocialOverlay.refreshPortraits(player.dexId);
  window.addEventListener('pkmn-player-species-changed', () => {
    void playSocialOverlay.refreshPortraits(player.dexId);
  });
  await ensurePokemonSheetsLoaded(imageCache, player.dexId);
  await ensureEffectAssetsLoaded(imageCache);
  run();
});
