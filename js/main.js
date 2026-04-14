import { isPlayShell } from './main/app-shell.js';
import { setPlayPointerMode } from './main/play-pointer-mode.js';
import { generate, DEFAULT_CONFIG } from './generator.js';
import { render, loadTilesetImages } from './render.js';
import {
  resetWildPokemonManager,
  triggerPlayerSocialAction
} from './wild-pokemon/wild-pokemon-manager.js';
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
import { installPlayPointerCombat } from './main/play-mouse-combat.js';
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
import { getBiomeBgmUiState, stopBiomeBgm } from './audio/biome-bgm.js';
import {
  advanceWorldHours,
  dayPhaseLabelEn,
  getDayCycleTintRgb,
  getDayPhaseFromHours,
  PRESET_HOUR,
  wrapHours
} from './main/world-time-of-day.js';

if (isPlayShell()) {
  setPlayPointerMode('game');
}

const canvas = document.getElementById('map');
const minimap = document.getElementById('minimap');
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
const playWorldTimeSlider = document.getElementById('play-world-time-slider');
const playWorldTimeRun = document.getElementById('play-world-time-run');
const playWorldTimePhaseEl = document.getElementById('play-world-time-phase');
const playWorldTimeHourEl = document.getElementById('play-world-time-hour');
let playSocialOverlay = {
  flashAction: () => {},
  clearActive: () => {}
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
/** @type {string | null} */
let lastWorldTimePanelPhase = null;
let lastBgmUiSignature = '';
/** @type {object | null} */
let playDetailColliderHighlight = null;

configureTileDebugModal({
  getCurrentData: () => currentData,
  debugModal,
  debugContent
});

let lastHudTileKey = '';
let lastHudMs = 0;
const HUD_MIN_INTERVAL_MS = 100;

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
    ` · Flight ${player.flightActive ? 'ON' : 'OFF'} (Space twice · F · Space↑ Shift↓)`;
  const hp = player.hp ?? player.maxHp ?? 100;
  const maxH = player.maxHp ?? 100;
  const psn =
    (player.poisonVisualSec ?? 0) > 0.05
      ? ` <span style="color:#d080ff;font-weight:700">PSN ${(player.poisonVisualSec ?? 0).toFixed(1)}s</span>`
      : '';
  const ifr = (player.projIFrameSec ?? 0) > 0 ? ` · i-frames ${(player.projIFrameSec ?? 0).toFixed(2)}s` : '';
  const telem = `<span style="opacity:0.8;font-size:0.72rem;display:block;margin-top:4px;color:#9ad8ff;font-family:'JetBrains Mono',monospace">HP ${Math.ceil(hp)}/${maxH}${psn}${ifr} · Telemetry · [${mx},${my}] H=${tile.heightStep} · ${bio?.name ?? '?'} · ${baseAt.setName ?? '—'} · role ${baseAt.role ?? '—'}${flyHint || ''}</span>`;
  infoBar.innerHTML = `${prefix}<span style="color:#8ceda1">Biome: ${bio?.name ?? '?'} | Selvagens: ${encounters.slice(0, 3).join(', ')}</span>${telem}`;
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
}

function getSettings() {
  const viewType = document.querySelector('input[name="viewType"]:checked')?.value || 'biomes';
  const overlayPaths = document.getElementById('chkRotas')?.checked ?? true;
  const overlayGraph = document.getElementById('chkGrafo')?.checked ?? true;
  const overlayContours = document.getElementById('chkCurvas')?.checked ?? false;
  const showPlayColliders = document.getElementById('chkPlayColliders')?.checked ?? false;
  const collidersOn = showPlayColliders || window.debugColliders;
  if (appMode === 'play' && currentData && collidersOn) {
    ensurePlayColliderOverlayCache(currentData, player, imageCache, collidersOn);
  } else {
    clearPlayColliderOverlayCache();
  }
  const dayPhase = getDayPhaseFromHours(wrapHours(worldHours));
  const dayCycleTint = getDayCycleTintRgb(dayPhase);
  return {
    viewType,
    overlayPaths,
    overlayGraph,
    overlayContours,
    showPlayColliders,
    playColliderOverlayCache: collidersOn ? getPlayColliderOverlayCache() : null,
    playDetailColliderHighlight,
    appMode,
    player,
    time: gameTime,
    dayPhase,
    worldHours: wrapHours(worldHours),
    dayCycleTint
  };
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
  player,
  advanceWorldTime: (dt) => {
    if (appMode !== 'play') return;
    worldHours = advanceWorldHours(worldHours, dt, worldTimeRunning, readWorldHoursPerRealSec());
  },
  onPlayHudFrame: (data) => {
    playCharacterSelector?.updatePlayAltitudeHud(data);
    playCharacterSelector?.updatePlayMovesCooldownHud();
    syncPlayWorldTimePanel();
    syncPlayBgmNowPlayingPanel();
  }
});

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
  getPlayer: () => player
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
  setPlayerPos(gx * MACRO_TILE_STRIDE + MACRO_TILE_STRIDE / 2, gy * MACRO_TILE_STRIDE + MACRO_TILE_STRIDE / 2);
  playInputState.mouseValid = false;
  appMode = 'play';
  btnExport?.classList.add('hidden');
  btnBackToMap?.classList.remove('hidden');
  minimap.classList.remove('hidden');
  infoBar.innerHTML =
    "<b style='color:#fff'>WASD / setas · duplo toque na mesma direção = correr · ESC = sair.</b><br><span style='color:#cfe7ff;font-size:0.88rem'>Mouse: LMB 1º golpe, RMB 2º golpe, Hold = Charged, Left Ctrl+LMB 3º golpe, Left Ctrl+RMB 4º golpe, MMB Ultimate. Hotkeys para testar todos os ports: 1 Ember · 2 Flamethrower · 3 Confusion · 4 Bubble · 5 Water Gun · 6 Psybeam · 7 Prismatic Laser · 8 Poison Sting · 9 Poison Powder · 0 Incinerate · - Silk Shoot. Social: Numpad 1-9 envia sinais com emoji para os selvagens próximos. Debug menu: Ctrl+RMB.</span>";
  playFpsSampleTimes.length = 0;
  if (playFpsEl) playFpsEl.textContent = '…';

  if (playWorldTimeRun) playWorldTimeRun.checked = worldTimeRunning;
  lastWorldTimePanelPhase = null;
  syncPlayWorldTimePanel();
  lastBgmUiSignature = '';
  syncPlayBgmNowPlayingPanel();

  document.body.classList.add('play-mode-active');
  document.querySelector('.app').classList.add('play-mode-active');
  playSocialOverlay.clearActive();

  playCharacterSelector?.syncPlayPointerModeRadios();

  resizeCanvas();
  startGameLoop();
}

btnBackToMap?.addEventListener('click', () => {
  stopBiomeBgm();
  clearPlayCameraSnapshot();
  appMode = 'map';
  btnExport?.classList.remove('hidden');
  btnBackToMap?.classList.add('hidden');
  minimap.classList.add('hidden');
  infoBar.innerHTML = 'Mova o mouse sobre o mapa para ver os detalhes do terreno';
  playDetailColliderHighlight = null;

  document.body.classList.remove('play-mode-active');
  document.querySelector('.app').classList.remove('play-mode-active');
  playSocialOverlay.clearActive();

  stopGameLoop();
  playCharacterSelector?.updatePlayAltitudeHud(null);
  playCharacterSelector?.clearPlayMovesCooldownHud();
  lastBgmUiSignature = '';
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
      document.getElementById('cfgWaterLevel').value = (currentConfig.waterLevel || 0.38) * 100;
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
    worldHours = hour;
    lastWorldTimePanelPhase = null;
    syncPlayWorldTimePanel();
    updateView();
  });
}
wireWorldTimePreset('play-world-preset-dawn', PRESET_HOUR.dawn);
wireWorldTimePreset('play-world-preset-day', PRESET_HOUR.day);
wireWorldTimePreset('play-world-preset-afternoon', PRESET_HOUR.afternoon);
wireWorldTimePreset('play-world-preset-night', PRESET_HOUR.night);

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

loadTilesetImages().then(async () => {
  if (document.getElementById('biomesModal') && document.getElementById('biomesGrid')) {
    new BiomesModal();
  }
  playCharacterSelector = new CharacterSelector('character-selector-container');
  playSocialOverlay = createPlaySocialOverlay(playCharacterSelector.getSocialOverlayElement());
  await ensurePokemonSheetsLoaded(imageCache, player.dexId);
  await ensureEffectAssetsLoaded(imageCache);
  run();
});
