import { renderWildGroupsPopoverList } from './minimap-wild-groups-popover.js';
import {
  isWildLeaderRoamTargetVisible,
  setWildLeaderRoamTargetVisible
} from './wild-groups-visual-toggle-state.js';
import { player } from '../player.js';
import { triggerNextFarCryNow } from './far-cry-system.js';

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
  const timeToggle = document.getElementById('minimap-time-toggle');
  const timePop = document.getElementById('minimap-time-popover');
  const weatherToggle = document.getElementById('minimap-weather-toggle');
  const weatherPop = document.getElementById('minimap-weather-popover');
  const socialToggle = document.getElementById('minimap-social-toggle');
  const socialPop = document.getElementById('minimap-social-popover');
  const audioToggle = document.getElementById('minimap-audio-toggle');
  const audioPop = document.getElementById('minimap-audio-popover');

  if (!timeToggle || !timePop || !weatherToggle || !weatherPop || !socialToggle || !socialPop) {
    return { forceCloseAllPopovers: () => {} };
  }

  /** @type {ReturnType<typeof setInterval> | null} */
  let groupsRefreshTimer = null;
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

  function refreshGroupsPanel() {
    if (!groupsList || !imageCache) return;
    renderWildGroupsPopoverList(groupsList, imageCache, { showLeaderRoamTarget });
  }

  const popovers = [
    ...(groupsToggle && groupsPop ? [{ toggle: groupsToggle, pop: groupsPop, name: 'groups' }] : []),
    { toggle: timeToggle, pop: timePop, name: 'time' },
    { toggle: weatherToggle, pop: weatherPop, name: 'weather' },
    { toggle: socialToggle, pop: socialPop, name: 'social' },
    ...(audioToggle && audioPop ? [{ toggle: audioToggle, pop: audioPop, name: 'audio' }] : [])
  ];

  function closeAllExcept(activeName) {
    if (activeName !== 'groups') stopGroupsRefresh();
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
      if (name === 'groups') stopGroupsRefresh();
    } else {
      closeAllExcept(name);
      p.pop.classList.remove('hidden');
      p.toggle?.setAttribute('aria-pressed', 'true');
      if (name === 'groups') {
        refreshGroupsPanel();
        stopGroupsRefresh();
        groupsRefreshTimer = setInterval(refreshGroupsPanel, 380);
      }
    }
  }

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
    groupsFarCryTriggerBtn.textContent = ok ? 'Far Cry!' : 'Sem alvo';
    setTimeout(() => {
      if (!groupsFarCryTriggerBtn.isConnected) return;
      groupsFarCryTriggerBtn.textContent = 'Next Far Cry';
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
  syncGroupsLeaderTargetToggleUi();
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const isInsideAnyPopover = popovers.some(p => p.pop?.contains(target) || p.toggle?.contains(target));
    if (!isInsideAnyPopover) {
      closeAllExcept(null);
    }
  });

  return {
    forceCloseAllPopovers: () => {
      stopGroupsRefresh();
      closeAllExcept(null);
    }
  };
}
