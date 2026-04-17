import { SOCIAL_ACTIONS } from '../social/social-actions.js';
import { probeSpriteCollabPortraitPrefix } from '../pokemon/spritecollab-portraits.js';

const stub = () => ({
  flashAction: () => {},
  clearActive: () => {},
  refreshPortraits: () => Promise.resolve()
});

/**
 * @param {HTMLElement | null} rootEl
 */
export function createPlaySocialOverlay(rootEl) {
  if (!rootEl) {
    return stub();
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
      <span class="play-social-overlay-figure" aria-hidden="true">
        <img class="play-social-overlay-portrait" width="26" height="26" alt="" decoding="async" />
        <span class="play-social-overlay-emoji-fallback">${action.emoji}</span>
      </span>
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
   * @param {number} dexId
   */
  async function refreshPortraits(dexId) {
    const d = Math.floor(Number(dexId) || 0);
    const prefix = d >= 1 && d <= 9999 ? await probeSpriteCollabPortraitPrefix(d) : null;
    for (const action of SOCIAL_ACTIONS) {
      const row = itemByActionId.get(action.id);
      const wrap = row?.querySelector('.play-social-overlay-figure');
      const img = /** @type {HTMLImageElement | null} */ (wrap?.querySelector('.play-social-overlay-portrait') ?? null);
      const fb = wrap?.querySelector('.play-social-overlay-emoji-fallback');
      if (!img || !fb) continue;
      const slug = String(action.portraitSlug || 'Normal').replace(/[^\w.-]/g, '') || 'Normal';
      fb.classList.remove('is-hidden');
      img.onload = () => {
        fb.classList.add('is-hidden');
      };
      if (prefix) {
        let triedNormal = false;
        img.onerror = () => {
          if (!triedNormal && slug !== 'Normal') {
            triedNormal = true;
            img.src = `${prefix}Normal.png`;
          } else {
            img.removeAttribute('src');
            fb.classList.remove('is-hidden');
          }
        };
        img.src = `${prefix}${slug}.png`;
        if (img.complete && img.naturalWidth) fb.classList.add('is-hidden');
      } else {
        img.removeAttribute('src');
      }
    }
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
    if (lastEl) lastEl.textContent = `Sent ${action.label}`;

    activeTimer = window.setTimeout(() => {
      activeItem?.classList.remove('is-active');
      activeTimer = 0;
    }, 1000);
    hideTimer = window.setTimeout(() => {
      rootEl.classList.remove('is-active');
      hideTimer = 0;
    }, 1500);
  }

  return { flashAction, clearActive, refreshPortraits };
}
