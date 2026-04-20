import { getPlayHelpArticles, onLocaleChanged } from '../i18n/index.js';

/**
 * @param {{ forceCloseMinimapAudioPopover?: () => void }} [deps]
 */
export function installPlayHelpWikiModal(deps = {}) {
  const forceCloseMinimapAudioPopover =
    typeof deps.forceCloseMinimapAudioPopover === 'function' ? deps.forceCloseMinimapAudioPopover : () => {};

  const root = document.getElementById('play-help-wiki-modal');
  const toggleBtn = document.getElementById('minimap-help-toggle');
  const navEl = document.getElementById('play-help-wiki-nav');
  const articleEl = document.getElementById('play-help-wiki-article');
  const closeBtn = document.getElementById('play-help-wiki-close');
  const backdrop = root?.querySelector('.play-help-wiki__backdrop');

  if (!root || !toggleBtn || !navEl || !articleEl || !closeBtn) {
    return { isOpen: () => false, open: () => {}, close: () => {} };
  }

  let open = false;
  /** @type {string} */
  let activeId = '';

  function getArticles() {
    return getPlayHelpArticles();
  }

  function setNavActive() {
    for (const btn of navEl.querySelectorAll('.play-help-wiki__toc-link')) {
      if (!(btn instanceof HTMLButtonElement)) continue;
      const id = btn.dataset.article || '';
      btn.classList.toggle('is-active', id === activeId);
    }
  }

  function renderArticle() {
    const articles = getArticles();
    const fallback = articles[0] || { html: '' };
    const art = articles.find((a) => a.id === activeId) ?? fallback;
    articleEl.innerHTML = art.html;
  }

  function buildNav() {
    navEl.textContent = '';
    const articles = getArticles();
    if (!activeId && articles.length) activeId = articles[0].id;
    for (const a of articles) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'play-help-wiki__toc-link';
      b.dataset.article = a.id;
      b.textContent = a.title;
      navEl.appendChild(b);
    }
    setNavActive();
  }

  function setOpen(next) {
    open = next;
    root.classList.toggle('hidden', !open);
    root.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    document.body.classList.toggle('play-help-wiki-open', open);
    if (open) {
      forceCloseMinimapAudioPopover();
      renderArticle();
      setNavActive();
      window.requestAnimationFrame(() => {
        closeBtn.focus();
      });
    } else {
      toggleBtn.focus();
    }
  }

  function close() {
    setOpen(false);
  }

  function openModal() {
    setOpen(true);
  }

  function toggle() {
    setOpen(!open);
  }

  buildNav();
  renderArticle();

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  closeBtn.addEventListener('click', () => close());
  backdrop?.addEventListener('click', () => close());

  navEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest('.play-help-wiki__toc-link');
    if (!(btn instanceof HTMLButtonElement)) return;
    const id = btn.dataset.article;
    if (!id) return;
    activeId = id;
    renderArticle();
    setNavActive();
    articleEl.scrollTop = 0;
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (!open || e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    },
    true
  );

  const unlistenLocale = onLocaleChanged(() => {
    const prevId = activeId;
    const articles = getArticles();
    if (!articles.some((x) => x.id === prevId)) {
      activeId = articles[0]?.id || '';
    }
    buildNav();
    renderArticle();
  });

  return {
    isOpen: () => open,
    open: openModal,
    close,
    destroy: () => unlistenLocale()
  };
}
