import { getPlayHelpArticles, onLocaleChanged } from '../i18n/index.js';
import { imageCache } from '../image-cache.js';
import {
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { TERRAIN_SETS } from '../tessellation-data.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { atlasFromObjectSet } from '../render/render-utils-internal.js';
import { BERRY_TREE_TILES } from './berry-tree-system.js';
import { getRoleForCell } from '../tessellation-logic.js';
import { drawTerrainCellFromSheet, getConcConvATerrainTileSpec } from '../render/conc-conv-a-terrain-blit.js';

const BERRY_TYPES_BY_LOWER = Object.freeze(
  Object.fromEntries(Object.keys(BERRY_TREE_TILES).map((name) => [name.toLowerCase(), name]))
);

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
    hydrateBiomePokemonFaces();
    hydrateBiomeObjectSprites();
    hydrateBiomeTerrainPreviews();
  }

  function hydrateBiomePokemonFaces() {
    const imgs = Array.from(articleEl.querySelectorAll('.play-help-biomes__pokemon-face'));
    for (const img of imgs) {
      if (!(img instanceof HTMLImageElement)) continue;
      const dex = Math.floor(Number(img.dataset.dex) || 0);
      const slug = String(img.dataset.portraitSlug || 'Normal').replace(/[^\w.-]/g, '') || 'Normal';
      if (dex <= 0) continue;

      const cached = getSpriteCollabPortraitImage(imageCache, dex, slug);
      if (cached?.src) {
        if (img.src !== cached.src) img.src = cached.src;
        continue;
      }

      if (img.dataset.loadingPortrait === '1') continue;
      img.dataset.loadingPortrait = '1';
      void ensureSpriteCollabPortraitLoaded(imageCache, dex, slug).then(() => {
        img.dataset.loadingPortrait = '0';
        const tex = getSpriteCollabPortraitImage(imageCache, dex, slug);
        if (tex?.src && img.isConnected) img.src = tex.src;
      });
    }
  }

  function ensureObjectSpriteSheetCached(path, onReady) {
    if (!path) return;
    const cached = imageCache.get(path);
    if (cached) {
      onReady();
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageCache.set(path, img);
      onReady();
    };
    img.onerror = () => {};
    img.src = path;
  }

  function ensureImageCached(path, onReady) {
    if (!path) return;
    const cached = imageCache.get(path);
    if (cached) {
      onReady();
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageCache.set(path, img);
      onReady();
    };
    img.onerror = () => {};
    img.src = path;
  }

  function drawObjectSpritePreview(canvas, itemKey) {
    const objSet = OBJECT_SETS[itemKey];
    if (!objSet) return;
    const grid = TessellationEngine.getObjectGrid(itemKey);
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0]) || grid[0].length === 0) return;

    const path = TessellationEngine.getImagePath(objSet.file);
    const paint = () => {
      const { img, cols: sheetCols } = atlasFromObjectSet(objSet, imageCache);
      if (!img) return;
    const berryType = resolveBerryTypeForPreview(itemKey);
    const berryPreviewStageIds = berryType
      ? getBerryPreviewStageIds(BERRY_TREE_TILES[berryType]?.[2]) ||
        getBerryPreviewStageIds(BERRY_TREE_TILES[berryType]?.[1]) ||
        getBerryPreviewStageIds(BERRY_TREE_TILES[berryType]?.[0])
      : null;
    const rows = berryPreviewStageIds ? berryPreviewStageIds.length : grid.length;
    const colsInGrid = berryPreviewStageIds ? 1 : grid[0].length;
      const maxDim = Math.max(rows, colsInGrid);
      const cellPx = Math.max(8, Math.floor(28 / Math.max(1, maxDim)));
      const outSize = 32;

      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, outSize, outSize);
      ctx.imageSmoothingEnabled = false;

      const totalW = colsInGrid * cellPx;
      const totalH = rows * cellPx;
      const ox = Math.floor((outSize - totalW) / 2);
      const oy = Math.floor((outSize - totalH) / 2);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < colsInGrid; c++) {
          const tileId = berryPreviewStageIds ? berryPreviewStageIds[r] : grid[r][c];
          if (!Number.isFinite(tileId) || tileId < 0) continue;
          ctx.drawImage(
            img,
            (tileId % sheetCols) * 16,
            Math.floor(tileId / sheetCols) * 16,
            16,
            16,
            ox + c * cellPx,
            oy + r * cellPx,
            cellPx,
            cellPx
          );
        }
      }
      canvas.dataset.rendered = '1';
    };

    ensureImageCached(path, paint);
    paint();
  }

  function hydrateBiomeObjectSprites() {
    const nodes = Array.from(articleEl.querySelectorAll('.play-help-biomes__object-sprite'));
    for (const node of nodes) {
      if (!(node instanceof HTMLCanvasElement)) continue;
      if (node.dataset.rendered === '1') continue;
      const itemKey = String(node.dataset.objectKey || '').trim();
      if (!itemKey) continue;
      drawObjectSpritePreview(node, itemKey);
    }
  }

  function drawTerrainPreview(canvas, setName) {
    const safeSet = String(setName || '').trim();
    if (!safeSet) return;
    const set = TERRAIN_SETS[safeSet];
    if (!set) return;
    const path = TessellationEngine.getImagePath(set.file);

    const paint = () => {
      const img = imageCache.get(path);
      if (!img) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const sheetCols = TessellationEngine.getTerrainSheetCols(set);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;

      const landMask = [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 1, 1, 1, 0, 0],
        [0, 1, 1, 1, 1, 1, 0],
        [0, 1, 1, 1, 1, 1, 0],
        [0, 1, 1, 1, 1, 1, 0],
        [0, 0, 1, 1, 1, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
      ];

      const isLandAt = (r, c) => {
        if (r < 0 || r >= 7 || c < 0 || c >= 7) return false;
        return landMask[r][c] === 1;
      };

      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          if (!isLandAt(r, c)) continue;
          const role = getRoleForCell(r, c, 7, 7, isLandAt, set.type);
          const spec = getConcConvATerrainTileSpec(set, role);
          drawTerrainCellFromSheet(
            ctx,
            img,
            sheetCols,
            16,
            spec.tileId,
            c * 16,
            r * 16,
            16,
            16,
            spec.flipX
          );
        }
      }
      canvas.dataset.rendered = '1';
    };

    ensureImageCached(path, paint);
    paint();
  }

  function hydrateBiomeTerrainPreviews() {
    const canvases = Array.from(articleEl.querySelectorAll('.play-help-biomes__terrain-preview-canvas'));
    for (const node of canvases) {
      if (!(node instanceof HTMLCanvasElement)) continue;
      if (node.dataset.rendered === '1') continue;
      const setName = String(node.dataset.terrainSet || '').trim();
      if (!setName) continue;
      drawTerrainPreview(node, setName);
    }
  }

  function resolveBerryTypeForPreview(itemKey) {
    const raw = String(itemKey || '').toLowerCase();
    if (!raw.includes('berry-tree-')) return null;
    const compact = raw.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const token of compact.split(/[^a-z0-9]+/g)) {
      if (!token) continue;
      const hit = BERRY_TYPES_BY_LOWER[token];
      if (hit) return hit;
    }
    return null;
  }

  function getBerryPreviewStageIds(maturityFrames) {
    if (!Array.isArray(maturityFrames) || maturityFrames.length === 0) return null;
    const frames = maturityFrames
      .filter((row) => Array.isArray(row))
      .map((row) => row.filter((id) => Number.isFinite(id)))
      .filter((row) => row.length > 0)
      .sort((a, b) => b.length - a.length);
    if (!frames.length) return null;
    return frames[0].slice(0, 2);
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
