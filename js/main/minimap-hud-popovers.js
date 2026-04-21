import { renderWildGroupsPopoverList } from './minimap-wild-groups-popover.js';
import { renderBerriesPopoverList } from './minimap-berries-popover.js';
import {
  renderSocialInspectorList,
  populateScenarioSelect,
  triggerScenarioOnNearestGroup
} from './social-inspector-popover.js';
import {
  isWildLeaderRoamTargetVisible,
  setWildLeaderRoamTargetVisible
} from './wild-groups-visual-toggle-state.js';
import { clearHoveredWildGroupEntityKey } from './wild-groups-hover-state.js';
import { player } from '../player.js';
import { triggerNextFarCryNow } from './far-cry-system.js';
import { onLocaleChanged, t } from '../i18n/index.js';
import {
  isScreenGridCameraOn,
  toggleScreenGridCamera,
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

  if (!timeToggle || !timePop || !weatherToggle || !weatherPop || !socialToggle || !socialPop) {
    return { forceCloseAllPopovers: () => {} };
  }

  /** @type {ReturnType<typeof setInterval> | null} */
  let groupsRefreshTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let inspectorRefreshTimer = null;
  let showLeaderRoamTarget = isWildLeaderRoamTargetVisible();

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

  function syncTranslatableButtons() {
    if (groupsFarCryTriggerBtn) groupsFarCryTriggerBtn.textContent = t('play.nextFarCry');
    if (groupsLeaderTargetToggle) groupsLeaderTargetToggle.textContent = t('play.leaderTarget');
  }

  const popovers = [
    ...(groupsToggle && groupsPop ? [{ toggle: groupsToggle, pop: groupsPop, name: 'groups' }] : []),
    ...(berriesToggle && berriesPop ? [{ toggle: berriesToggle, pop: berriesPop, name: 'berries' }] : []),
    { toggle: timeToggle, pop: timePop, name: 'time' },
    { toggle: weatherToggle, pop: weatherPop, name: 'weather' },
    { toggle: socialToggle, pop: socialPop, name: 'social' },
    ...(inspectorToggle && inspectorPop ? [{ toggle: inspectorToggle, pop: inspectorPop, name: 'inspector' }] : []),
    ...(languageToggle && languagePop ? [{ toggle: languageToggle, pop: languagePop, name: 'language' }] : []),
    ...(audioToggle && audioPop ? [{ toggle: audioToggle, pop: audioPop, name: 'audio' }] : [])
  ];

  function closeAllExcept(activeName) {
    if (activeName !== 'groups') {
      stopGroupsRefresh();
      clearHoveredWildGroupEntityKey();
    }
    if (activeName !== 'inspector') {
      stopInspectorRefresh();
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
      if (name === 'inspector') {
        populateScenarioSelect(inspectorScenarioSelect);
        refreshInspectorPanel();
        stopInspectorRefresh();
        inspectorRefreshTimer = setInterval(refreshInspectorPanel, 350);
      }
    }
  }

  berriesToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('berries');
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

  /* ── Screen-grid camera toggle (no popover, just a state toggle) ──── */
  const screenGridToggle = document.getElementById('minimap-screen-grid-cam-toggle');
  function syncScreenGridToggleUi(on) {
    screenGridToggle?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  syncScreenGridToggleUi(isScreenGridCameraOn());
  const unlistenScreenGrid = onScreenGridCameraChange(syncScreenGridToggleUi);
  screenGridToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleScreenGridCamera();
  });

  return {
    forceCloseAllPopovers: () => {
      stopGroupsRefresh();
      stopInspectorRefresh();
      clearHoveredWildGroupEntityKey();
      closeAllExcept(null);
    },
    destroy: () => {
      clearHoveredWildGroupEntityKey();
      stopInspectorRefresh();
      unlistenLocale();
      unlistenScreenGrid();
    }
  };
}
