import { renderWildGroupsPopoverList } from './minimap-wild-groups-popover.js';
import { renderBerriesPopoverList } from './minimap-berries-popover.js';
import {
  renderSocialInspectorList,
  populateScenarioSelect,
  triggerScenarioOnNearestGroup
} from './social-inspector-popover.js';
import { renderFeaturesPopoverList } from './minimap-features-popover.js';
import {
  isWildLeaderRoamTargetVisible,
  setWildLeaderRoamTargetVisible
} from './wild-groups-visual-toggle-state.js';
import { clearHoveredWildGroupEntityKey } from './wild-groups-hover-state.js';
import { player } from '../player.js';
import { triggerNextFarCryNow } from './far-cry-system.js';
import { onLocaleChanged, t } from '../i18n/index.js';
import {
  isScreenGridCameraManualOn,
  setScreenGridCameraOn,
  getScreenGridCameraConfig,
  setScreenGridCameraConfig,
  onScreenGridCameraChange
} from '../render/play-deadzone-camera.js';

/**
 * Manages Time, Weather, Social, Groups, and Audio popovers on the minimap header.
 * @param {{ imageCache?: Map<string, HTMLImageElement> }} [options]
 */
export function installMinimapHudPopovers(options = {}) {
  const { imageCache } = options;
  const getCurrentData = typeof options.getCurrentData === 'function' ? options.getCurrentData : () => null;
  const groupsToggle = document.getElementById('minimap-groups-toggle');
  const groupsPop = document.getElementById('minimap-groups-popover');
  const groupsList = document.getElementById('minimap-groups-popover-list');
  const groupsLeaderTargetToggle = document.getElementById('minimap-groups-leader-target-toggle');
  const groupsFarCryTriggerBtn = document.getElementById('minimap-groups-far-cry-trigger');
  const berriesToggle = document.getElementById('minimap-berries-toggle');
  const berriesPop = document.getElementById('minimap-berries-popover');
  const berriesList = document.getElementById('minimap-berries-popover-list');
  const treesToggle = document.getElementById('minimap-trees-toggle');
  const treesPop = document.getElementById('minimap-trees-popover');
  const treesAnimToggleBtn = document.getElementById('minimap-trees-animation-toggle');
  const treesFpsRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-trees-fps-range'));
  const treesFpsReadout = document.getElementById('minimap-trees-fps-readout');
  const timeToggle = document.getElementById('minimap-time-toggle');
  const timePop = document.getElementById('minimap-time-popover');
  const weatherToggle = document.getElementById('minimap-weather-toggle');
  const weatherPop = document.getElementById('minimap-weather-popover');
  const socialToggle = document.getElementById('minimap-social-toggle');
  const socialPop = document.getElementById('minimap-social-popover');
  const audioToggle = document.getElementById('minimap-audio-toggle');
  const audioPop = document.getElementById('minimap-audio-popover');
  const languageToggle = document.getElementById('minimap-language-toggle');
  const languagePop = document.getElementById('minimap-language-popover');
  const inspectorToggle = document.getElementById('minimap-social-inspector-toggle');
  const inspectorPop = document.getElementById('minimap-social-inspector-popover');
  const inspectorList = document.getElementById('social-inspector-list');
  const inspectorScenarioSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('social-inspector-scenario-select'));
  const inspectorTriggerBtn = document.getElementById('social-inspector-trigger-btn');
  const screenGridToggle = document.getElementById('minimap-screen-grid-cam-toggle');
  const cameraPop = document.getElementById('minimap-camera-popover');
  const debugToolsToggle = document.getElementById('minimap-debug-tools-toggle');
  const debugToolsPop = document.getElementById('minimap-debug-tools-popover');
  const featuresToggle = document.getElementById('minimap-features-toggle');
  const featuresPop = document.getElementById('minimap-features-popover');
  const featuresList = document.getElementById('minimap-features-list');
  const cameraEnableToggle = document.getElementById('minimap-camera-enable-toggle');
  const cameraAllowOtherScreensToggle = document.getElementById('minimap-camera-allow-other-screens-toggle');
  const cameraScrollRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-camera-scroll-duration'));
  const cameraBlendInRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-camera-blend-in'));
  const cameraBlendOutRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-camera-blend-out'));
  const cameraScrollReadout = document.getElementById('minimap-camera-scroll-duration-readout');
  const cameraBlendInReadout = document.getElementById('minimap-camera-blend-in-readout');
  const cameraBlendOutReadout = document.getElementById('minimap-camera-blend-out-readout');

  if (!timeToggle || !timePop || !weatherToggle || !weatherPop || !socialToggle || !socialPop) {
    return { forceCloseAllPopovers: () => {} };
  }

  /** @type {ReturnType<typeof setInterval> | null} */
  let groupsRefreshTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let inspectorRefreshTimer = null;
  let showLeaderRoamTarget = isWildLeaderRoamTargetVisible();
  window.debugSocialInspectorRadiiOverlay = false;

  function syncGroupsLeaderTargetToggleUi() {
    if (!groupsLeaderTargetToggle) return;
    groupsLeaderTargetToggle.setAttribute('aria-pressed', showLeaderRoamTarget ? 'true' : 'false');
  }

  function stopGroupsRefresh() {
    if (groupsRefreshTimer != null) {
      clearInterval(groupsRefreshTimer);
      groupsRefreshTimer = null;
    }
  }

  function stopInspectorRefresh() {
    if (inspectorRefreshTimer != null) {
      clearInterval(inspectorRefreshTimer);
      inspectorRefreshTimer = null;
    }
  }

  function refreshGroupsPanel() {
    if (!groupsList || !imageCache) return;
    renderWildGroupsPopoverList(groupsList, imageCache, { showLeaderRoamTarget });
  }

  function refreshBerriesPanel() {
    if (!berriesList) return;
    renderBerriesPopoverList(berriesList, player);
  }

  function refreshInspectorPanel() {
    if (!inspectorList || !imageCache) return;
    renderSocialInspectorList(inspectorList, imageCache);
  }

  function refreshFeaturesPanel() {
    if (!featuresList) return;
    const data = getCurrentData();
    if (!data) return;
    renderFeaturesPopoverList(featuresList, data);
  }

  function syncTranslatableButtons() {
    if (groupsFarCryTriggerBtn) groupsFarCryTriggerBtn.textContent = t('play.nextFarCry');
    if (groupsLeaderTargetToggle) groupsLeaderTargetToggle.textContent = t('play.leaderTarget');
  }

  const popovers = [
    ...(groupsToggle && groupsPop ? [{ toggle: groupsToggle, pop: groupsPop, name: 'groups' }] : []),
    ...(berriesToggle && berriesPop ? [{ toggle: berriesToggle, pop: berriesPop, name: 'berries' }] : []),
    ...(treesToggle && treesPop ? [{ toggle: treesToggle, pop: treesPop, name: 'trees' }] : []),
    { toggle: timeToggle, pop: timePop, name: 'time' },
    { toggle: weatherToggle, pop: weatherPop, name: 'weather' },
    { toggle: socialToggle, pop: socialPop, name: 'social' },
    ...(inspectorToggle && inspectorPop ? [{ toggle: inspectorToggle, pop: inspectorPop, name: 'inspector' }] : []),
    ...(languageToggle && languagePop ? [{ toggle: languageToggle, pop: languagePop, name: 'language' }] : []),
    ...(audioToggle && audioPop ? [{ toggle: audioToggle, pop: audioPop, name: 'audio' }] : []),
    ...(screenGridToggle && cameraPop ? [{ toggle: screenGridToggle, pop: cameraPop, name: 'camera' }] : []),
    ...(debugToolsToggle && debugToolsPop ? [{ toggle: debugToolsToggle, pop: debugToolsPop, name: 'debugTools' }] : []),
    ...(featuresToggle && featuresPop ? [{ toggle: featuresToggle, pop: featuresPop, name: 'features' }] : [])
  ];

  function closeAllExcept(activeName) {
    if (activeName !== 'groups') {
      stopGroupsRefresh();
      clearHoveredWildGroupEntityKey();
    }
    if (activeName !== 'inspector') {
      stopInspectorRefresh();
      window.debugSocialInspectorRadiiOverlay = false;
    }
    popovers.forEach((p) => {
      if (p.name !== activeName) {
        p.pop?.classList.add('hidden');
        p.toggle?.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function togglePopover(name) {
    const p = popovers.find((x) => x.name === name);
    if (!p || !p.pop) return;

    const isOpen = !p.pop.classList.contains('hidden');
    if (isOpen) {
      p.pop.classList.add('hidden');
      p.toggle?.setAttribute('aria-pressed', 'false');
      if (name === 'groups') {
        stopGroupsRefresh();
        clearHoveredWildGroupEntityKey();
      }
      if (name === 'inspector') {
        stopInspectorRefresh();
        window.debugSocialInspectorRadiiOverlay = false;
      }
    } else {
      closeAllExcept(name);
      p.pop.classList.remove('hidden');
      p.toggle?.setAttribute('aria-pressed', 'true');
      if (name === 'groups') {
        refreshGroupsPanel();
        stopGroupsRefresh();
        groupsRefreshTimer = setInterval(refreshGroupsPanel, 380);
      }
      if (name === 'berries') {
        refreshBerriesPanel();
      }
      if (name === 'trees') {
        syncTreesPopoverUi();
      }
      if (name === 'inspector') {
        populateScenarioSelect(inspectorScenarioSelect);
        refreshInspectorPanel();
        stopInspectorRefresh();
        inspectorRefreshTimer = setInterval(refreshInspectorPanel, 350);
        window.debugSocialInspectorRadiiOverlay = true;
      }
      if (name === 'features') {
        refreshFeaturesPanel();
      }
    }
  }

  berriesToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('berries');
  });
  treesToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('trees');
  });

  function syncTreesPopoverUi() {
    const windEnabled = window.disableTreeCanopyAnimation !== true;
    const fpsRaw = Number(window.treeCanopyAnimationFps);
    const fps = Number.isFinite(fpsRaw) ? Math.max(0, fpsRaw) : 0.2;
    treesAnimToggleBtn?.setAttribute('aria-pressed', windEnabled ? 'true' : 'false');
    if (treesAnimToggleBtn) treesAnimToggleBtn.textContent = `Tree wind: ${windEnabled ? 'ON' : 'OFF'}`;
    if (treesFpsRange) {
      treesFpsRange.value = String(Math.max(0, Math.min(4, fps)));
      treesFpsRange.disabled = !windEnabled;
    }
    if (treesFpsReadout) {
      treesFpsReadout.textContent = fps > 0 ? `${fps.toFixed(1)} FPS` : 'Continuous';
    }
  }

  treesAnimToggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.disableTreeCanopyAnimation = window.disableTreeCanopyAnimation === true ? false : true;
    syncTreesPopoverUi();
  });

  treesFpsRange?.addEventListener('input', (e) => {
    e.stopPropagation();
    const next = Number(treesFpsRange.value);
    window.treeCanopyAnimationFps = Number.isFinite(next) ? Math.max(0, next) : 0.2;
    syncTreesPopoverUi();
  });

  inspectorToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('inspector');
  });

  inspectorTriggerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const scenarioId = inspectorScenarioSelect?.value;
    if (!scenarioId) return;
    const ok = triggerScenarioOnNearestGroup(scenarioId);
    if (inspectorTriggerBtn) {
      inspectorTriggerBtn.textContent = ok ? '✓ Started!' : '✗ No group';
      setTimeout(() => {
        if (inspectorTriggerBtn.isConnected) inspectorTriggerBtn.textContent = '▶ Go';
      }, 1200);
    }
  });

  groupsToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('groups');
  });

  featuresToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('features');
  });

  groupsLeaderTargetToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    showLeaderRoamTarget = !showLeaderRoamTarget;
    setWildLeaderRoamTargetVisible(showLeaderRoamTarget);
    syncGroupsLeaderTargetToggleUi();
    refreshGroupsPanel();
  });

  groupsFarCryTriggerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const ok = triggerNextFarCryNow(player, getCurrentData());
    groupsFarCryTriggerBtn.textContent = ok ? t('play.farCryNow') : t('play.noTarget');
    setTimeout(() => {
      if (!groupsFarCryTriggerBtn.isConnected) return;
      groupsFarCryTriggerBtn.textContent = t('play.nextFarCry');
    }, 900);
  });

  timeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('time');
  });

  weatherToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('weather');
  });

  socialToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('social');
  });

  languageToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('language');
  });

  // Audio toggle is handled by minimap-audio-ui.js, but we should close others when it opens.
  // We'll add a listener to the audio toggle to close our popovers.
  audioToggle?.addEventListener('click', () => {
    // If audio pop is about to open (it's currently hidden), close others.
    // Note: minimap-audio-ui.js also toggles its own state, so we just ensure mutual exclusivity.
    if (audioPop?.classList.contains('hidden')) {
      closeAllExcept('audio');
    }
  });

  // Global click handler to close popovers when clicking outside
  syncTranslatableButtons();
  syncTreesPopoverUi();
  const unlistenLocale = onLocaleChanged(() => {
    syncTranslatableButtons();
    refreshGroupsPanel();
  });
  syncGroupsLeaderTargetToggleUi();
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const isInsideAnyPopover = popovers.some(p => p.pop?.contains(target) || p.toggle?.contains(target));
    if (!isInsideAnyPopover) {
      closeAllExcept(null);
    }
  });

  function syncScreenGridManualUi(on) {
    cameraEnableToggle?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function syncCameraConfigUi() {
    const cfg = getScreenGridCameraConfig();
    if (cameraScrollRange) cameraScrollRange.value = String(cfg.scrollDurationS);
    if (cameraBlendInRange) cameraBlendInRange.value = String(cfg.blendInS);
    if (cameraBlendOutRange) cameraBlendOutRange.value = String(cfg.blendOutS);
    if (cameraScrollReadout) cameraScrollReadout.textContent = `${cfg.scrollDurationS.toFixed(2)}s`;
    if (cameraBlendInReadout) cameraBlendInReadout.textContent = `${cfg.blendInS.toFixed(2)}s`;
    if (cameraBlendOutReadout) cameraBlendOutReadout.textContent = `${cfg.blendOutS.toFixed(2)}s`;
    cameraAllowOtherScreensToggle?.setAttribute('aria-pressed', cfg.allowManualRoomTransitions ? 'true' : 'false');
  }
  syncScreenGridManualUi(isScreenGridCameraManualOn());
  syncCameraConfigUi();
  const unlistenScreenGrid = onScreenGridCameraChange(() => {
    syncScreenGridManualUi(isScreenGridCameraManualOn());
  });
  screenGridToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('camera');
  });
  debugToolsToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('debugTools');
  });
  cameraEnableToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    setScreenGridCameraOn(!isScreenGridCameraManualOn());
    syncScreenGridManualUi(isScreenGridCameraManualOn());
  });
  cameraAllowOtherScreensToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cfg = getScreenGridCameraConfig();
    setScreenGridCameraConfig({ allowManualRoomTransitions: !cfg.allowManualRoomTransitions });
    syncCameraConfigUi();
  });
  cameraScrollRange?.addEventListener('input', () => {
    setScreenGridCameraConfig({ scrollDurationS: Number(cameraScrollRange.value) || 0.75 });
    syncCameraConfigUi();
  });
  cameraBlendInRange?.addEventListener('input', () => {
    setScreenGridCameraConfig({ blendInS: Number(cameraBlendInRange.value) || 0.4 });
    syncCameraConfigUi();
  });
  cameraBlendOutRange?.addEventListener('input', () => {
    setScreenGridCameraConfig({ blendOutS: Number(cameraBlendOutRange.value) || 0.45 });
    syncCameraConfigUi();
  });

  return {
    forceCloseAllPopovers: () => {
      stopGroupsRefresh();
      stopInspectorRefresh();
      window.debugSocialInspectorRadiiOverlay = false;
      clearHoveredWildGroupEntityKey();
      closeAllExcept(null);
    },
    destroy: () => {
      clearHoveredWildGroupEntityKey();
      stopInspectorRefresh();
      window.debugSocialInspectorRadiiOverlay = false;
      unlistenLocale();
      unlistenScreenGrid();
    }
  };
}
