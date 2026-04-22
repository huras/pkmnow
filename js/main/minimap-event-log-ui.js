import {
  getPlayEventLogSnapshot,
  onPlayEventLogChanged
} from './play-event-log-state.js';
import { imageCache } from '../image-cache.js';
import {
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';
import {
  clearHoveredWildGroupEntityKey,
  setHoveredWildGroupEntityKey
} from './wild-groups-hover-state.js';

const OPAQUE_AFTER_EVENT_MS = 4500;
const EVENT_LOG_PORTRAIT_SLUG = 'Normal';
const EVENT_LOG_LIST_HEIGHT_LS_KEY = 'pkmn_minimap_event_log_list_height';
const EVENT_LOG_FLOAT_LEFT_LS_KEY = 'pkmn_minimap_event_log_float_left';
const EVENT_LOG_FLOAT_TOP_LS_KEY = 'pkmn_minimap_event_log_float_top';
const EVENT_LOG_COLLAPSED_LS_KEY = 'pkmn_minimap_event_log_collapsed';
const EVENT_LOG_LIST_MIN_HEIGHT_PX = 96;
const EVENT_LOG_LIST_MAX_HEIGHT_PX = 520;
const EVENT_LOG_LIST_DEFAULT_HEIGHT_PX = 164;

export function installMinimapEventLogUi() {
  const root = document.getElementById('play-event-log-hud');
  const list = document.getElementById('play-event-log-list');
  const dragHandle = root instanceof HTMLElement ? root.querySelector('.play-event-log-hud__drag-handle') : null;
  const resizeHandle = root instanceof HTMLElement ? root.querySelector('.play-event-log-hud__resize-handle') : null;
  const minimizeBtn = root instanceof HTMLElement ? root.querySelector('[data-play-event-log-toggle-collapse]') : null;
  const tabs = Array.from(document.querySelectorAll('[data-play-event-log-filter]'));
  if (!(root instanceof HTMLElement) || !(list instanceof HTMLElement)) {
    return {
      syncPlayEventLogHud: () => {},
      clearPlayEventLogHudEngaged: () => {},
      destroy: () => {}
    };
  }

  /** @type {'all'|'local'|'global'|'social'|'system'} */
  let activeFilter = 'all';
  let pointerInside = false;
  let opaqueUntil = 0;
  let currentEvents = getPlayEventLogSnapshot();
  let visible = true;
  const portraitRequests = new Set();
  let hoveredPortraitEntityKey = null;
  let resizePointerId = null;
  let resizeStartY = 0;
  let resizeStartHeight = EVENT_LOG_LIST_DEFAULT_HEIGHT_PX;
  let dragPointerId = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;
  let collapsed = false;

  function clampFloatingPosition(left, top) {
    const margin = 6;
    const maxLeft = Math.max(margin, window.innerWidth - root.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - root.offsetHeight - margin);
    return {
      left: Math.max(margin, Math.min(maxLeft, Math.round(Number(left) || 0))),
      top: Math.max(margin, Math.min(maxTop, Math.round(Number(top) || 0)))
    };
  }

  function setFloatingPosition(left, top, persist = true) {
    root.classList.add('play-event-log-hud--floating');
    const p = clampFloatingPosition(left, top);
    root.style.left = `${p.left}px`;
    root.style.top = `${p.top}px`;
    root.style.bottom = 'auto';
    root.style.transform = 'none';
    if (!persist) return;
    try {
      localStorage.setItem(EVENT_LOG_FLOAT_LEFT_LS_KEY, String(p.left));
      localStorage.setItem(EVENT_LOG_FLOAT_TOP_LS_KEY, String(p.top));
    } catch {
      // Ignore persistence failures (private mode / quota).
    }
  }

  function promoteAnchoredLayoutToFloating() {
    const rect = root.getBoundingClientRect();
    setFloatingPosition(rect.left, rect.top, false);
  }

  function restoreFloatingPosition() {
    let storedLeft = null;
    let storedTop = null;
    try {
      storedLeft = localStorage.getItem(EVENT_LOG_FLOAT_LEFT_LS_KEY);
      storedTop = localStorage.getItem(EVENT_LOG_FLOAT_TOP_LS_KEY);
    } catch {
      storedLeft = null;
      storedTop = null;
    }
    const left = Number(storedLeft);
    const top = Number(storedTop);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    if (root.offsetWidth <= 1 || root.offsetHeight <= 1) {
      requestAnimationFrame(() => setFloatingPosition(left, top));
      return;
    }
    setFloatingPosition(left, top);
  }

  function applyListHeight(nextHeight) {
    const h = clampInt(nextHeight, EVENT_LOG_LIST_MIN_HEIGHT_PX, EVENT_LOG_LIST_MAX_HEIGHT_PX, EVENT_LOG_LIST_DEFAULT_HEIGHT_PX);
    root.style.setProperty('--play-event-log-list-max-height', `${h}px`);
    try {
      localStorage.setItem(EVENT_LOG_LIST_HEIGHT_LS_KEY, String(h));
    } catch {
      // Ignore persistence failures (private mode / quota).
    }
  }

  function restoreListHeight() {
    let stored = null;
    try {
      stored = localStorage.getItem(EVENT_LOG_LIST_HEIGHT_LS_KEY);
    } catch {
      stored = null;
    }
    const parsed = Number(stored);
    if (Number.isFinite(parsed)) {
      applyListHeight(parsed);
      return;
    }
    root.style.setProperty('--play-event-log-list-max-height', `${EVENT_LOG_LIST_DEFAULT_HEIGHT_PX}px`);
  }

  function syncVisibility() {
    root.classList.toggle('play-event-log-hud--hidden', !visible);
    if (!visible) {
      pointerInside = false;
      opaqueUntil = 0;
      root.classList.remove('play-event-log-hud--engaged');
      if (hoveredPortraitEntityKey) {
        hoveredPortraitEntityKey = null;
        clearHoveredWildGroupEntityKey();
      }
    }
  }

  function setCollapsed(next, persist = true) {
    collapsed = !!next;
    root.classList.toggle('play-event-log-hud--collapsed', collapsed);
    if (minimizeBtn instanceof HTMLButtonElement) {
      minimizeBtn.textContent = collapsed ? '+' : '−';
      minimizeBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      minimizeBtn.setAttribute('aria-label', collapsed ? 'Restore event log' : 'Minimize event log');
      minimizeBtn.title = collapsed ? 'Restore event log' : 'Minimize event log';
    }
    if (!persist) return;
    try {
      localStorage.setItem(EVENT_LOG_COLLAPSED_LS_KEY, collapsed ? '1' : '0');
    } catch {
      // Ignore persistence failures (private mode / quota).
    }
  }

  function restoreCollapsedState() {
    let stored = null;
    try {
      stored = localStorage.getItem(EVENT_LOG_COLLAPSED_LS_KEY);
    } catch {
      stored = null;
    }
    setCollapsed(stored === '1', false);
  }

  /**
   * @param {string | null} key
   */
  function setHoveredEntityKey(key) {
    const next = key && key.length ? key : null;
    if (hoveredPortraitEntityKey === next) return;
    hoveredPortraitEntityKey = next;
    if (hoveredPortraitEntityKey) setHoveredWildGroupEntityKey(hoveredPortraitEntityKey);
    else clearHoveredWildGroupEntityKey();
  }

  function syncOpacity() {
    if (!visible) {
      root.classList.remove('play-event-log-hud--engaged');
      return;
    }
    const engaged = pointerInside || performance.now() < opaqueUntil;
    root.classList.toggle('play-event-log-hud--engaged', engaged);
  }

  function onResizePointerMove(ev) {
    if (resizePointerId == null) return;
    if (ev.pointerId !== resizePointerId) return;
    const deltaY = resizeStartY - ev.clientY;
    applyListHeight(resizeStartHeight + deltaY);
  }

  function stopResize(pointerId) {
    if (resizePointerId == null) return;
    if (pointerId != null && pointerId !== resizePointerId) return;
    resizePointerId = null;
    window.removeEventListener('pointermove', onResizePointerMove);
    window.removeEventListener('pointerup', onResizePointerUp);
    window.removeEventListener('pointercancel', onResizePointerCancel);
  }

  function onResizePointerUp(ev) {
    stopResize(ev.pointerId);
  }

  function onResizePointerCancel(ev) {
    stopResize(ev.pointerId);
  }

  function onDragPointerMove(ev) {
    if (dragPointerId == null) return;
    if (ev.pointerId !== dragPointerId) return;
    const dx = ev.clientX - dragStartClientX;
    const dy = ev.clientY - dragStartClientY;
    setFloatingPosition(dragStartLeft + dx, dragStartTop + dy, false);
  }

  function stopDrag(pointerId, persist = true) {
    if (dragPointerId == null) return;
    if (pointerId != null && pointerId !== dragPointerId) return;
    dragPointerId = null;
    window.removeEventListener('pointermove', onDragPointerMove);
    window.removeEventListener('pointerup', onDragPointerUp);
    window.removeEventListener('pointercancel', onDragPointerCancel);
    if (!persist) return;
    const left = Number.parseFloat(root.style.left || '');
    const top = Number.parseFloat(root.style.top || '');
    if (Number.isFinite(left) && Number.isFinite(top)) {
      setFloatingPosition(left, top, true);
    }
  }

  function onDragPointerUp(ev) {
    stopDrag(ev.pointerId, true);
  }

  function onDragPointerCancel(ev) {
    stopDrag(ev.pointerId, false);
  }

  function onWindowResizeClampFloating() {
    if (!root.classList.contains('play-event-log-hud--floating')) return;
    const left = Number.parseFloat(root.style.left || '');
    const top = Number.parseFloat(root.style.top || '');
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    setFloatingPosition(left, top, true);
  }

  function applyFilterUi() {
    for (const btn of tabs) {
      const isOn = String(btn.getAttribute('data-play-event-log-filter') || '') === activeFilter;
      btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    }
  }

  /** Coalesce rapid `pushPlayEventLog` bursts into one DOM rebuild per animation frame. */
  let eventLogRenderRafId = 0;
  let eventLogRenderPreserveScroll = false;

  function cancelCoalescedEventLogRender() {
    if (eventLogRenderRafId) {
      cancelAnimationFrame(eventLogRenderRafId);
      eventLogRenderRafId = 0;
    }
    eventLogRenderPreserveScroll = false;
  }

  function flushCoalescedEventLogRender() {
    eventLogRenderRafId = 0;
    const preserveScroll = eventLogRenderPreserveScroll;
    eventLogRenderPreserveScroll = false;
    renderRows({ preserveScroll });
  }

  function scheduleCoalescedEventLogRender(preserveScroll) {
    eventLogRenderPreserveScroll = eventLogRenderPreserveScroll || !!preserveScroll;
    if (eventLogRenderRafId) return;
    eventLogRenderRafId = requestAnimationFrame(flushCoalescedEventLogRender);
  }

  /**
   * @param {{ preserveScroll?: boolean }} [opts]
   */
  function renderRows(opts = {}) {
    const preserveScroll = !!opts.preserveScroll;
    const prevScrollTop = list.scrollTop;
    const prevScrollHeight = list.scrollHeight;
    const canPreserve = preserveScroll && prevScrollTop > 0;
    /** @type {typeof currentEvents} */
    const filtered =
      activeFilter === 'all'
        ? currentEvents
        : currentEvents.filter((e) => e.channel === activeFilter);
    if (!filtered.length) {
      list.innerHTML = '<div class="play-event-log-hud__empty">No events yet.</div>';
      return;
    }
    list.innerHTML = filtered
      .slice()
      .reverse()
      .map(
        (e) => {
          const stamp = formatEventDateTime(e.ts);
          const stampSafe = escapeHtml(stamp);
          const portraitHtml = buildEventPortraitHtml(e, portraitRequests, () =>
            scheduleCoalescedEventLogRender(true)
          );
          const pendingClass = e.pending ? ' play-event-log-hud__row--pending' : '';
          const pendingLabel = e.pending ? '<span class="play-event-log-hud__pending-pill">PENDING</span>' : '';
          return (
          `<div class="play-event-log-hud__row play-event-log-hud__row--${e.channel}${pendingClass}">` +
          `<span class="play-event-log-hud__time" title="${stampSafe}">${stampSafe}</span>` +
          portraitHtml +
          `<span class="play-event-log-hud__tag">${String(e.channel).toUpperCase()}</span>` +
          pendingLabel +
          `<span class="play-event-log-hud__text">${escapeHtml(e.text)}</span>` +
          '</div>'
          );
        }
      )
      .join('');
    if (canPreserve) {
      const delta = list.scrollHeight - prevScrollHeight;
      list.scrollTop = Math.max(0, prevScrollTop + delta);
    }
  }

  const unlisten = onPlayEventLogChanged((events) => {
    currentEvents = events.slice();
    opaqueUntil = performance.now() + OPAQUE_AFTER_EVENT_MS;
    scheduleCoalescedEventLogRender(true);
    syncOpacity();
  });

  for (const btn of tabs) {
    btn.addEventListener('click', () => {
      const next = String(btn.getAttribute('data-play-event-log-filter') || 'all');
      if (
        next === 'all' ||
        next === 'local' ||
        next === 'global' ||
        next === 'social' ||
        next === 'system'
      ) {
        activeFilter = next;
        applyFilterUi();
        cancelCoalescedEventLogRender();
        renderRows();
      }
    });
  }

  root.addEventListener('pointerenter', () => {
    pointerInside = true;
    syncOpacity();
  });
  root.addEventListener('pointerleave', () => {
    pointerInside = false;
    syncOpacity();
  });
  list.addEventListener('pointerover', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('.play-event-log-hud__portrait-wrap') : null;
    if (!(target instanceof HTMLElement) || !list.contains(target)) return;
    setHoveredEntityKey(String(target.dataset.hoverEntityKey || ''));
  });
  list.addEventListener('pointerout', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('.play-event-log-hud__portrait-wrap') : null;
    if (!(target instanceof HTMLElement) || !list.contains(target)) return;
    const related = ev.relatedTarget instanceof Element ? ev.relatedTarget.closest('.play-event-log-hud__portrait-wrap') : null;
    if (related === target) return;
    setHoveredEntityKey(null);
  });
  list.addEventListener('focusin', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('.play-event-log-hud__portrait-wrap') : null;
    if (!(target instanceof HTMLElement) || !list.contains(target)) return;
    setHoveredEntityKey(String(target.dataset.hoverEntityKey || ''));
  });
  list.addEventListener('focusout', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('.play-event-log-hud__portrait-wrap') : null;
    if (!(target instanceof HTMLElement) || !list.contains(target)) return;
    const related = ev.relatedTarget instanceof Element ? ev.relatedTarget.closest('.play-event-log-hud__portrait-wrap') : null;
    if (related && list.contains(related)) return;
    setHoveredEntityKey(null);
  });
  if (resizeHandle instanceof HTMLElement) {
    resizeHandle.addEventListener('pointerdown', (ev) => {
      resizePointerId = ev.pointerId;
      resizeStartY = ev.clientY;
      resizeStartHeight = list.clientHeight || EVENT_LOG_LIST_DEFAULT_HEIGHT_PX;
      resizeHandle.setPointerCapture(ev.pointerId);
      window.addEventListener('pointermove', onResizePointerMove);
      window.addEventListener('pointerup', onResizePointerUp);
      window.addEventListener('pointercancel', onResizePointerCancel);
      ev.preventDefault();
    });
    resizeHandle.title = 'Drag up/down to resize event log';
  }
  if (dragHandle instanceof HTMLElement) {
    dragHandle.addEventListener('pointerdown', (ev) => {
      const targetEl = ev.target instanceof Element ? ev.target : null;
      if (targetEl?.closest('[data-play-event-log-toggle-collapse]')) return;
      dragPointerId = ev.pointerId;
      dragStartClientX = ev.clientX;
      dragStartClientY = ev.clientY;
      if (!root.classList.contains('play-event-log-hud--floating')) {
        promoteAnchoredLayoutToFloating();
      }
      dragStartLeft = Number.parseFloat(root.style.left || '0');
      dragStartTop = Number.parseFloat(root.style.top || '0');
      dragHandle.setPointerCapture(ev.pointerId);
      window.addEventListener('pointermove', onDragPointerMove);
      window.addEventListener('pointerup', onDragPointerUp);
      window.addEventListener('pointercancel', onDragPointerCancel);
      ev.preventDefault();
    });
    dragHandle.title = 'Drag to move event log window';
  }
  if (minimizeBtn instanceof HTMLButtonElement) {
    minimizeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setCollapsed(!collapsed, true);
    });
  }
  window.addEventListener('resize', onWindowResizeClampFloating);

  restoreListHeight();
  restoreFloatingPosition();
  restoreCollapsedState();
  applyFilterUi();
  cancelCoalescedEventLogRender();
  renderRows();
  syncVisibility();
  syncOpacity();

  return {
    syncPlayEventLogHud: () => {
      currentEvents = getPlayEventLogSnapshot();
      cancelCoalescedEventLogRender();
      renderRows();
      syncOpacity();
    },
    setPlayEventLogVisible: (next) => {
      visible = !!next;
      syncVisibility();
      if (visible) {
        currentEvents = getPlayEventLogSnapshot();
        cancelCoalescedEventLogRender();
        renderRows();
        syncOpacity();
      }
    },
    isPlayEventLogVisible: () => visible,
    clearPlayEventLogHudEngaged: () => {
      pointerInside = false;
      opaqueUntil = 0;
      syncOpacity();
    },
    destroy: () => {
      stopResize();
      stopDrag(null, false);
      cancelCoalescedEventLogRender();
      window.removeEventListener('resize', onWindowResizeClampFloating);
      setHoveredEntityKey(null);
      unlisten();
    }
  };
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatEventDateTime(ts) {
  const time = Number(ts);
  if (!Number.isFinite(time) || time <= 0) return '--';
  return new Date(time).toLocaleString();
}

function buildEventPortraitHtml(eventRow, portraitRequests, rerender) {
  const dexIds = Array.isArray(eventRow?.portraitDexIds) && eventRow.portraitDexIds.length > 1
    ? eventRow.portraitDexIds
    : null;

  // Multiple portraits for group entries
  if (dexIds) {
    const slug = String(eventRow?.portraitSlug || EVENT_LOG_PORTRAIT_SLUG).replace(/[^\w.-]/g, '') || EVENT_LOG_PORTRAIT_SLUG;
    const hoverEntityKeyRaw = String(eventRow?.hoverEntityKey || '').trim();
    const hoverEntityKey = hoverEntityKeyRaw.length ? hoverEntityKeyRaw : '';
    const hoverAttr = hoverEntityKey ? ` data-hover-entity-key="${escapeHtml(hoverEntityKey)}" tabindex="0"` : '';
    const imgs = dexIds.map((d) => {
      const dex = Math.floor(Number(d) || 0);
      if (dex <= 0) return '';
      const tex = getSpriteCollabPortraitImage(imageCache, dex, slug);
      const requestKey = `${dex}:${slug}`;
      if (!tex?.src && !portraitRequests.has(requestKey)) {
        portraitRequests.add(requestKey);
        void ensureSpriteCollabPortraitLoaded(imageCache, dex, slug).then(() => {
          portraitRequests.delete(requestKey);
          rerender();
        });
      }
      const srcAttr = tex?.src ? ` src="${escapeHtml(tex.src)}"` : '';
      return (
        `<span class="play-event-log-hud__portrait-slot play-event-log-hud__portrait-slot--stack">` +
        `<img class="play-event-log-hud__portrait play-event-log-hud__portrait--stacked"${srcAttr} alt="Pokemon #${dex}" loading="lazy" decoding="async">` +
        '</span>'
      );
    }).filter(Boolean).join('');
    return `<span class="play-event-log-hud__portrait-wrap play-event-log-hud__portrait-wrap--group"${hoverAttr}>${imgs}</span>`;
  }

  // Single portrait (default)
  const dex = Math.floor(Number(eventRow?.portraitDexId) || 0);
  if (dex <= 0) return '';
  const slug = String(eventRow?.portraitSlug || EVENT_LOG_PORTRAIT_SLUG).replace(/[^\w.-]/g, '') || EVENT_LOG_PORTRAIT_SLUG;
  const tex = getSpriteCollabPortraitImage(imageCache, dex, slug);
  const requestKey = `${dex}:${slug}`;
  if (!tex?.src && !portraitRequests.has(requestKey)) {
    portraitRequests.add(requestKey);
    void ensureSpriteCollabPortraitLoaded(imageCache, dex, slug).then(() => {
      portraitRequests.delete(requestKey);
      rerender();
    });
  }
  const srcAttr = tex?.src ? ` src="${escapeHtml(tex.src)}"` : '';
  const hoverEntityKeyRaw = String(eventRow?.hoverEntityKey || '').trim();
  const hoverEntityKey = hoverEntityKeyRaw.length ? hoverEntityKeyRaw : '';
  const hoverAttr = hoverEntityKey ? ` data-hover-entity-key="${escapeHtml(hoverEntityKey)}" tabindex="0"` : '';
  const memBadge =
    eventRow?.portraitMemCleanup === true
      ? '<span class="play-event-log-hud__portrait-mem-badge" aria-hidden="true">⛔</span>'
      : '';
  return (
    `<span class="play-event-log-hud__portrait-wrap"${hoverAttr}>` +
    `<span class="play-event-log-hud__portrait-slot play-event-log-hud__portrait-slot--single">` +
    `<img class="play-event-log-hud__portrait"${srcAttr} alt="Pokemon #${dex}" loading="lazy" decoding="async">` +
    memBadge +
    '</span></span>'
  );
}

