import { SOCIAL_ACTIONS } from '../social/social-actions.js';

/**
 * @param {HTMLElement | null} rootEl
 */
export function createPlaySocialOverlay(rootEl) {
  if (!rootEl) {
    return {
      flashAction: () => {},
      clearActive: () => {}
    };
  }

  rootEl.innerHTML = `
    <div class="play-social-overlay-title">Social numpad</div>
    <div class="play-social-overlay-grid" role="list"></div>
    <div class="play-social-overlay-last" aria-live="polite"></div>
  `;

  const gridEl = rootEl.querySelector('.play-social-overlay-grid');
  const lastEl = rootEl.querySelector('.play-social-overlay-last');
  /** @type {Map<string, HTMLElement>} */
  const itemByActionId = new Map();

  for (const action of SOCIAL_ACTIONS) {
    const item = document.createElement('div');
    item.className = 'play-social-overlay-item';
    item.setAttribute('role', 'listitem');
    item.dataset.actionId = action.id;
    item.innerHTML = `
      <span class="play-social-overlay-key">${action.slot}</span>
      <span class="play-social-overlay-emoji">${action.emoji}</span>
      <span class="play-social-overlay-label">${action.label}</span>
    `;
    gridEl?.appendChild(item);
    itemByActionId.set(action.id, item);
  }

  let activeTimer = 0;
  let hideTimer = 0;

  function clearActive() {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = 0;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    rootEl.classList.remove('is-active');
    for (const item of itemByActionId.values()) item.classList.remove('is-active');
  }

  /**
   * @param {string} actionId
   */
  function flashAction(actionId) {
    const action = SOCIAL_ACTIONS.find((entry) => entry.id === actionId);
    if (!action) return;
    clearActive();
    rootEl.classList.add('is-active');
    const activeItem = itemByActionId.get(action.id);
    activeItem?.classList.add('is-active');
    if (lastEl) lastEl.textContent = `Sent ${action.emoji} ${action.label}`;

    activeTimer = window.setTimeout(() => {
      activeItem?.classList.remove('is-active');
      activeTimer = 0;
    }, 1000);
    hideTimer = window.setTimeout(() => {
      rootEl.classList.remove('is-active');
      hideTimer = 0;
    }, 1500);
  }

  return { flashAction, clearActive };
}
