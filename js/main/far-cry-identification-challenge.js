import { MACRO_TILE_STRIDE } from '../chunking.js';
import { player } from '../player.js';
import { isDexCryIdentified, markDexCryIdentified } from '../wild-pokemon/cry-identification-progress.js';
import { markWildMinimapSpeciesKnown } from '../wild-pokemon/wild-minimap-species-known.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';
import { t } from '../i18n/index.js';
import { imageCache } from '../image-cache.js';
import {
  defaultPortraitSlugForBalloon,
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';
import { playPlayerLevelUpFanfareSfx } from '../audio/player-level-up-fanfare-sfx.js';

/**
 * Max distance (micro tiles) from the **crying wild** for a natural cry to count toward minimap ID
 * (same units as `player.x` / wild `x`). Far Cry audio does not use this path.
 * Set to `Infinity` to count from anywhere.
 */
export const FAR_CRY_IDENTIFICATION_LISTEN_MAX_DIST_MICRO_TILES = MACRO_TILE_STRIDE * 0.5;

/** In-range natural wild cries (emotion / attack / hurt) needed to mark that dex “heard” on the minimap. */
export const FAR_CRY_IDENTIFICATION_CRIES_REQUIRED = 7;

/**
 * Max simultaneous cry-learn rows in the stack (anchored above the minimap canvas, grows upward from that seam).
 * Extra species in progress get a “+N” chip (priority: higher fill %, then most recent cry, then closer wild).
 */
export const FAR_CRY_IDENTIFICATION_STACK_MAX_ROWS = 4;

/** @type {Map<number, number>} dexId → cries heard in range (0 .. CRIES_REQUIRED-1) */
const wildCryHearCountByDex = new Map();
/** @type {Map<number, number>} dexId → last qualifying cry (performance.now()) */
const lastCryMsByDex = new Map();

/** Minimap cry-learn portrait (screen px); keep in sync with `.minimap-panel__far-cry-id-portrait` in CSS. */
const CRY_ID_STACK_PORTRAIT_PX = 44;

/** Must match `.minimap-panel__far-cry-id-row--complete` animation duration (3s) + small buffer before finalize */
const CRY_ID_COMPLETE_FX_MS = 3100;

/** Wrapper for FLIP when rows reorder / a slot is removed (keep in sync with CSS if tuned). */
const CRY_STACK_FLIP_MS = 320;
/** Recently-heard already-identified rows stay visible in the top stack for this long. */
const CRY_ID_IDENTIFIED_ROW_VISIBLE_MS = 6500;

const CRY_ROW_SHELL_CLS = 'minimap-panel__far-cry-id-row-shell';
const CRY_ROW_INNER_CLS = 'minimap-panel__far-cry-id-row';

let stackEl = /** @type {HTMLElement | null} */ (null);
let cryStackRenderFlushScheduled = false;
/** Dex ids currently playing the “learned cry” completion FX (avoids double-fire). */
const cryIdCompleteFxInFlight = new Set();
/** @type {Map<number, number>} dexId -> last heard ms for already-identified dexes (recent spotlight in stack) */
const lastKnownCryMsByDex = new Map();

function effectiveListenMaxDistMicro() {
  const v = Number(FAR_CRY_IDENTIFICATION_LISTEN_MAX_DIST_MICRO_TILES);
  if (!Number.isFinite(v) || v <= 0) return Infinity;
  return v;
}

function isWildEntityRegistered(entity) {
  const k = String(entity?.key || '');
  if (!k) return false;
  return entitiesByKey.get(k) === entity;
}

function isPlayerInHearRangeOfEntity(entity) {
  const maxR = effectiveListenMaxDistMicro();
  const px = Number(player?.x);
  const py = Number(player?.y);
  const ex = Number(entity?.x);
  const ey = Number(entity?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
    return false;
  }
  if (!Number.isFinite(maxR) || maxR >= 1e15) return true;
  return Math.hypot(px - ex, py - ey) <= maxR;
}

function minPlayerDistSqToDexWild(dexId) {
  const d = Math.floor(Number(dexId) || 0);
  const px = Number(player?.x);
  const py = Number(player?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const e of entitiesByKey.values()) {
    if (!e || e.isDespawning) continue;
    if (Math.floor(Number(e.dexId) || 0) !== d) continue;
    const ex = Number(e.x);
    const ey = Number(e.y);
    if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
    const dx = ex - px;
    const dy = ey - py;
    best = Math.min(best, dx * dx + dy * dy);
  }
  return best;
}

function cryLearnLabelText() {
  try {
    return t('play.farCryCryLearnLabel');
  } catch {
    return 'Getting used to Pokémon cry…';
  }
}

function cryKnownLabelText() {
  return 'Cry already identified';
}

function ensureStackEl() {
  if (stackEl) return;
  stackEl = document.getElementById('minimap-far-cry-id-stack');
}

function scheduleCryStackRender() {
  if (cryStackRenderFlushScheduled) return;
  cryStackRenderFlushScheduled = true;
  queueMicrotask(() => {
    cryStackRenderFlushScheduled = false;
    renderCryIdentificationStack();
  });
}

function wirePortraitForDex(imgEl, dexId) {
  const d = Math.floor(Number(dexId) || 0) || 1;
  const slug = defaultPortraitSlugForBalloon(9);
  const cached = getSpriteCollabPortraitImage(imageCache, d, slug);
  if (cached?.naturalWidth) {
    imgEl.src = cached.src;
    return;
  }
  imgEl.removeAttribute('src');
  void ensureSpriteCollabPortraitLoaded(imageCache, d, slug)
    .then(() => scheduleCryStackRender())
    .catch(() => {});
}

/**
 * @param {HTMLElement} container
 * @param {Map<number, DOMRect>} rectsBeforeByDex
 */
function applyCryStackRowReorderFlip(container, rectsBeforeByDex) {
  if (!rectsBeforeByDex.size) return;
  const shells = /** @type {HTMLElement[]} */ ([
    ...container.querySelectorAll(`.${CRY_ROW_SHELL_CLS}`)
  ]);
  if (!shells.length) return;

  /** @type {HTMLElement[]} */
  const moved = [];
  for (const el of shells) {
    const dex = Math.floor(Number(el.dataset.dex) || 0) || 0;
    const before = rectsBeforeByDex.get(dex);
    if (!before) continue;
    const after = el.getBoundingClientRect();
    const dy = before.top - after.top;
    if (Math.abs(dy) < 0.6) continue;
    el.style.transition = '';
    el.style.transform = `translateY(${dy}px)`;
    moved.push(el);
  }
  if (!moved.length) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
      for (const el of moved) {
        el.style.transition = `transform ${CRY_STACK_FLIP_MS}ms ${ease}`;
        el.style.transform = 'translateY(0)';
      }
      for (const el of moved) {
        const onEnd = (ev) => {
          if (ev.propertyName !== 'transform') return;
          el.style.transition = '';
          el.style.transform = '';
          el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd);
      }
    });
  });
}

/**
 * @param {{ dex: number, count: number, progress: number, distSq: number, lastMs: number, isKnown: boolean }} entry
 */
function createCryStackRowInner(entry) {
  const wrap = document.createElement('div');
  wrap.className = CRY_ROW_INNER_CLS;
  wrap.dataset.dex = String(entry.dex);
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', `Dex ${entry.dex}`);

  const img = document.createElement('img');
  img.className = 'minimap-panel__far-cry-id-portrait';
  img.alt = '';
  img.width = CRY_ID_STACK_PORTRAIT_PX;
  img.height = CRY_ID_STACK_PORTRAIT_PX;
  img.decoding = 'async';
  img.dataset.dexCry = String(entry.dex);
  wirePortraitForDex(img, entry.dex);

  const mid = document.createElement('div');
  mid.className = 'minimap-panel__far-cry-id-row-mid';

  const label = document.createElement('span');
  label.className = 'minimap-panel__far-cry-id-row-label';

  const slotsWrap = document.createElement('div');
  slotsWrap.className = 'minimap-panel__far-cry-id-slots';
  slotsWrap.setAttribute('role', 'progressbar');

  mid.append(label, slotsWrap);
  wrap.append(img, mid);
  syncCryStackRowInnerContent(wrap, entry);
  return wrap;
}

/**
 * @param {HTMLElement} inner
 * @param {{ dex: number, count: number, progress: number, distSq: number, lastMs: number, isKnown: boolean }} entry
 */
function syncCryStackRowInnerContent(inner, entry) {
  inner.classList.toggle('minimap-panel__far-cry-id-row--known', !!entry.isKnown);
  const label = inner.querySelector('.minimap-panel__far-cry-id-row-label');
  if (label) {
    label.textContent = entry.isKnown ? cryKnownLabelText() : cryLearnLabelText();
  }

  const slotsWrap = inner.querySelector('.minimap-panel__far-cry-id-slots');
  if (!slotsWrap) return;
  const req = Math.max(1, Math.floor(Number(FAR_CRY_IDENTIFICATION_CRIES_REQUIRED) || 3));
  slotsWrap.setAttribute('aria-valuemax', String(req));
  slotsWrap.setAttribute('aria-valuenow', String(Math.min(req, Math.max(0, entry.count))));

  const slots = [...slotsWrap.querySelectorAll('.minimap-panel__far-cry-id-slot')];
  for (let i = 0; i < req; i++) {
    let slot = slots[i];
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'minimap-panel__far-cry-id-slot';
      slotsWrap.appendChild(slot);
    }
    slot.classList.toggle('minimap-panel__far-cry-id-slot--on', i < entry.count);
  }
  while (slotsWrap.children.length > req) {
    slotsWrap.removeChild(slotsWrap.lastElementChild);
  }

  const img = /** @type {HTMLImageElement | null} */ (inner.querySelector('.minimap-panel__far-cry-id-portrait'));
  if (img) {
    const wantDex = entry.dex;
    const cur = Math.floor(Number(img.dataset.dexCry) || 0) || 0;
    if (cur !== wantDex) {
      img.dataset.dexCry = String(wantDex);
      wirePortraitForDex(img, wantDex);
    } else if (!img.getAttribute('src')) {
      wirePortraitForDex(img, wantDex);
    }
  }
}

/**
 * @param {{ dex: number, count: number, progress: number, distSq: number, lastMs: number, isKnown: boolean }} entry
 */
function createCryStackRowShell(entry) {
  const shell = document.createElement('div');
  shell.className = CRY_ROW_SHELL_CLS;
  shell.dataset.dex = String(entry.dex);
  shell.appendChild(createCryStackRowInner(entry));
  return shell;
}

function buildSortedProgressEntries() {
  /** @type {{ dex: number, count: number, progress: number, distSq: number, lastMs: number, isKnown: boolean }[]} */
  const rows = [];
  const now = performance.now();
  const req = Math.max(1, Math.floor(Number(FAR_CRY_IDENTIFICATION_CRIES_REQUIRED) || 1));
  for (const [dexRaw, nRaw] of wildCryHearCountByDex) {
    const dex = Math.floor(Number(dexRaw) || 0);
    const count = Math.max(0, Math.floor(Number(nRaw) || 0));
    if (dex < 1 || count <= 0 || isDexCryIdentified(dex)) continue;
    rows.push({
      dex,
      count,
      progress: count / req,
      distSq: minPlayerDistSqToDexWild(dex),
      lastMs: Number(lastCryMsByDex.get(dex)) || 0,
      isKnown: false
    });
  }
  for (const [dexRaw, heardMsRaw] of [...lastKnownCryMsByDex]) {
    const dex = Math.floor(Number(dexRaw) || 0);
    const heardMs = Number(heardMsRaw) || 0;
    if (dex < 1 || !isDexCryIdentified(dex)) {
      lastKnownCryMsByDex.delete(dex);
      continue;
    }
    if (now - heardMs > CRY_ID_IDENTIFIED_ROW_VISIBLE_MS) {
      lastKnownCryMsByDex.delete(dex);
      continue;
    }
    rows.push({
      dex,
      count: req,
      progress: 1,
      distSq: minPlayerDistSqToDexWild(dex),
      lastMs: heardMs,
      isKnown: true
    });
  }
  rows.sort((a, b) => {
    if (a.isKnown !== b.isKnown) return a.isKnown ? 1 : -1;
    if (b.progress !== a.progress) return b.progress - a.progress;
    if (b.lastMs !== a.lastMs) return b.lastMs - a.lastMs;
    return a.distSq - b.distSq;
  });
  return rows;
}

function renderCryIdentificationStack() {
  ensureStackEl();
  if (!stackEl) return;

  const entries = buildSortedProgressEntries();
  if (entries.length === 0) {
    stackEl.hidden = true;
    stackEl.replaceChildren();
    return;
  }

  const maxR = Math.max(1, Math.floor(Number(FAR_CRY_IDENTIFICATION_STACK_MAX_ROWS) || 4));
  const visible = entries.slice(0, maxR);
  const overflow = Math.max(0, entries.length - visible.length);
  const desiredDexes = visible.map((r) => r.dex);

  /** @type {Map<number, DOMRect>} */
  const rectsBefore = new Map();
  for (const el of stackEl.querySelectorAll(`.${CRY_ROW_SHELL_CLS}`)) {
    const shell = /** @type {HTMLElement} */ (el);
    const d = Math.floor(Number(shell.dataset.dex) || 0) || 0;
    if (d) rectsBefore.set(d, shell.getBoundingClientRect());
  }

  stackEl.hidden = false;

  for (const el of [...stackEl.querySelectorAll(`.${CRY_ROW_SHELL_CLS}`)]) {
    const d = Math.floor(Number(el.dataset.dex) || 0) || 0;
    if (!desiredDexes.includes(d)) el.remove();
  }

  /** @type {Map<number, HTMLElement>} */
  const shellByDex = new Map();
  for (const el of stackEl.querySelectorAll(`.${CRY_ROW_SHELL_CLS}`)) {
    const shell = /** @type {HTMLElement} */ (el);
    const d = Math.floor(Number(shell.dataset.dex) || 0) || 0;
    if (d) shellByDex.set(d, shell);
  }

  for (const entry of visible) {
    let shell = shellByDex.get(entry.dex);
    if (!shell) {
      shell = createCryStackRowShell(entry);
      shellByDex.set(entry.dex, shell);
    } else {
      let inner = shell.querySelector(`.${CRY_ROW_INNER_CLS}`);
      if (!inner) {
        inner = createCryStackRowInner(entry);
        shell.appendChild(inner);
      } else {
        syncCryStackRowInnerContent(/** @type {HTMLElement} */ (inner), entry);
      }
    }
    stackEl.appendChild(shell);
  }

  let moreEl = stackEl.querySelector('.minimap-panel__far-cry-id-stack-more');
  if (overflow > 0) {
    if (!moreEl) {
      moreEl = document.createElement('div');
      moreEl.className = 'minimap-panel__far-cry-id-stack-more';
      stackEl.appendChild(moreEl);
    } else {
      stackEl.appendChild(moreEl);
    }
    try {
      moreEl.textContent = t('play.farCryCryStackMore', { n: overflow });
    } catch {
      moreEl.textContent = `+${overflow}`;
    }
    moreEl.hidden = false;
  } else {
    moreEl?.remove();
  }

  if (rectsBefore.size > 0) {
    requestAnimationFrame(() => applyCryStackRowReorderFlip(stackEl, rectsBefore));
  }
}

/** Kept for `onLocaleChanged` in main.js */
export function setFarCryIdentificationHintLocale() {
  if (wildCryHearCountByDex.size > 0 || lastKnownCryMsByDex.size > 0) scheduleCryStackRender();
}

function refreshBarAfterPartialChange() {
  scheduleCryStackRender();
}

function finalizeDexWildCryIdentification(dexId) {
  wildCryHearCountByDex.delete(dexId);
  lastCryMsByDex.delete(dexId);
  markDexCryIdentified(dexId);
  for (const e of entitiesByKey.values()) {
    if (!e || e.isDespawning) continue;
    if (Math.floor(Number(e.dexId) || 0) !== dexId) continue;
    markWildMinimapSpeciesKnown(e);
  }
  refreshBarAfterPartialChange();
}

/**
 * Flash / ring / glint on the row, short ME stinger, then apply dex “heard” state (matches CSS stall).
 * @param {number} dexId
 */
function queueCryIdentificationCompleteFx(dexId) {
  const d = Math.floor(Number(dexId) || 0) || 1;
  if (cryIdCompleteFxInFlight.has(d)) return;
  cryIdCompleteFxInFlight.add(d);

  scheduleCryStackRender();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ensureStackEl();
      const row = stackEl?.querySelector(`.minimap-panel__far-cry-id-row[data-dex="${d}"]`);
      if (row) {
        row.classList.add('minimap-panel__far-cry-id-row--complete');
        try {
          playPlayerLevelUpFanfareSfx(player);
        } catch {
          /* ignore */
        }
        window.setTimeout(() => {
          row.classList.remove('minimap-panel__far-cry-id-row--complete');
          finalizeDexWildCryIdentification(d);
          cryIdCompleteFxInFlight.delete(d);
        }, CRY_ID_COMPLETE_FX_MS);
      } else {
        finalizeDexWildCryIdentification(d);
        cryIdCompleteFxInFlight.delete(d);
      }
    });
  });
}

/**
 * Call when a **natural** wild cry actually starts (emotion / attack `playPokemonCry`, or hurt tail).
 * @param {object | null | undefined} entity
 */
export function tryRegisterWildNaturalCryForIdentification(entity) {
  if (!entity || !isWildEntityRegistered(entity)) return;
  const dexId = Math.floor(Number(entity.dexId) || 0) || 1;
  if (!isPlayerInHearRangeOfEntity(entity)) return;
  if (isDexCryIdentified(dexId)) {
    lastKnownCryMsByDex.set(dexId, performance.now());
    scheduleCryStackRender();
    return;
  }

  const prev = Math.max(0, Math.floor(Number(wildCryHearCountByDex.get(dexId)) || 0));
  const next = prev + 1;
  wildCryHearCountByDex.set(dexId, next);
  lastCryMsByDex.set(dexId, performance.now());

  if (next >= FAR_CRY_IDENTIFICATION_CRIES_REQUIRED) {
    scheduleCryStackRender();
    queueCryIdentificationCompleteFx(dexId);
  } else {
    scheduleCryStackRender();
  }
}

export function cancelFarCryIdentificationChallenge() {
  wildCryHearCountByDex.clear();
  lastCryMsByDex.clear();
  lastKnownCryMsByDex.clear();
  cryIdCompleteFxInFlight.clear();
  ensureStackEl();
  if (stackEl) {
    stackEl.hidden = true;
    stackEl.replaceChildren();
  }
}

export function pruneWildCryHearCountsForAlreadyIdentifiedDexes() {
  for (const d of [...wildCryHearCountByDex.keys()]) {
    if (isDexCryIdentified(d)) {
      wildCryHearCountByDex.delete(d);
      lastCryMsByDex.delete(d);
    }
  }
  for (const d of [...lastKnownCryMsByDex.keys()]) {
    if (!isDexCryIdentified(d)) lastKnownCryMsByDex.delete(d);
  }
  refreshBarAfterPartialChange();
}

/**
 * Snapshot of in-progress heard-cry counts for Pokeradar / UI consumers.
 * @returns {{ dexId: number, criesHeard: number }[]}
 */
export function getCryIdentificationHearCountsSnapshot() {
  const out = [];
  for (const [dexRaw, nRaw] of wildCryHearCountByDex) {
    const dexId = Math.floor(Number(dexRaw) || 0);
    const criesHeard = Math.max(0, Math.floor(Number(nRaw) || 0));
    if (dexId < 1 || criesHeard <= 0) continue;
    out.push({ dexId, criesHeard });
  }
  out.sort((a, b) => a.dexId - b.dexId);
  return out;
}
