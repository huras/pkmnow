/**
 * Manages the toggling of Time/Weather and Social popovers on the minimap.
 */
export function installMinimapHudPopovers() {
  const timeToggle = document.getElementById('minimap-time-weather-toggle');
  const timePop = document.getElementById('minimap-time-weather-popover');
  const socialToggle = document.getElementById('minimap-social-toggle');
  const socialPop = document.getElementById('minimap-social-popover');
  const audioToggle = document.getElementById('minimap-audio-toggle');
  const audioPop = document.getElementById('minimap-audio-popover');

  if (!timeToggle || !timePop || !socialToggle || !socialPop) {
    return { forceCloseAllPopovers: () => {} };
  }

  const popovers = [
    { toggle: timeToggle, pop: timePop, name: 'time' },
    { toggle: socialToggle, pop: socialPop, name: 'social' },
    { toggle: audioToggle, pop: audioPop, name: 'audio' }
  ];

  function closeAllExcept(activeName) {
    popovers.forEach(p => {
      if (p.name !== activeName) {
        p.pop?.classList.add('hidden');
        p.toggle?.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function togglePopover(name) {
    const p = popovers.find(x => x.name === name);
    if (!p || !p.pop) return;

    const isOpen = !p.pop.classList.contains('hidden');
    if (isOpen) {
      p.pop.classList.add('hidden');
      p.toggle?.setAttribute('aria-pressed', 'false');
    } else {
      closeAllExcept(name);
      p.pop.classList.remove('hidden');
      p.toggle?.setAttribute('aria-pressed', 'true');
    }
  }

  timeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('time');
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
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const isInsideAnyPopover = popovers.some(p => p.pop?.contains(target) || p.toggle?.contains(target));
    if (!isInsideAnyPopover) {
      closeAllExcept(null);
    }
  });

  return {
    forceCloseAllPopovers: () => closeAllExcept(null)
  };
}
