/**
 * Preview montagem 13-peças com autotile real (Palette base — rock) sobre a máscara micro.
 */
import { getRoleForCell } from './tessellation-logic.js';
import { TERRAIN_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';

const SET_NAME = 'Palette base — rock';
const TILE_SRC = 16;
const VIEW_SCALE = 2;
const TILE = TILE_SRC * VIEW_SCALE;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

function blitTile(ctx, img, tileId, sheetCols, dx, dy) {
  if (!img || tileId == null || tileId < 0) return;
  const sx = (tileId % sheetCols) * TILE_SRC;
  const sy = Math.floor(tileId / sheetCols) * TILE_SRC;
  ctx.drawImage(img, sx, sy, TILE_SRC, TILE_SRC, dx, dy, TILE, TILE);
}

function roleToTileId(terrainSet, role) {
  return terrainSet.roles[role] ?? terrainSet.centerId;
}

/**
 * @param {Uint8Array} landGrid row-major: landGrid[y * w + x] === 1
 * @param {number} gridW
 * @param {number} gridH
 * @returns {Promise<void>} resolve quando o utilizador fecha o overlay
 */
export function openSpriteOverlay(landGrid, gridW, gridH) {
  const terrainSet = TERRAIN_SETS[SET_NAME];
  if (!terrainSet) return Promise.reject(new Error(`Missing ${SET_NAME}`));

  const existing = document.getElementById('t13SpriteOverlayRoot');
  if (existing) existing.remove();

  return new Promise((resolve, reject) => {
    const root = document.createElement('div');
    root.id = 't13SpriteOverlayRoot';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
    <div class="t13-overlay-backdrop" data-close="1"></div>
    <div class="t13-overlay-panel">
      <header class="t13-overlay-header">
        <span class="t13-overlay-title">Sprites · ${SET_NAME} · <code>conc-conv-a</code></span>
        <button type="button" class="t13-overlay-close" aria-label="Fechar">✕</button>
      </header>
      <p class="t13-overlay-note">Máscara = células verdes da grelha. Canvas a 80% opacidade; fundo escuro 45%.</p>
      <div class="t13-overlay-canvas-outer">
        <canvas class="t13-overlay-canvas" width="64" height="64" aria-label="Pré-visualização de terreno"></canvas>
      </div>
      <p class="t13-overlay-hint">ESC ou clique fora / ✕ para fechar.</p>
    </div>
  `;

    const style = document.createElement('style');
    style.textContent = `
    #t13SpriteOverlayRoot {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Inter, system-ui, sans-serif;
    }
    #t13SpriteOverlayRoot .t13-overlay-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      cursor: pointer;
    }
    #t13SpriteOverlayRoot .t13-overlay-panel {
      position: relative;
      z-index: 1;
      max-width: calc(100vw - 2rem);
      max-height: calc(100vh - 2rem);
      overflow: auto;
      background: #141820;
      border: 1px solid #2a3140;
      border-radius: 10px;
      padding: 0.75rem 1rem 1rem;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    }
    #t13SpriteOverlayRoot .t13-overlay-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.35rem;
    }
    #t13SpriteOverlayRoot .t13-overlay-title {
      font-size: 0.85rem;
      color: #e8ecf4;
      font-weight: 600;
    }
    #t13SpriteOverlayRoot .t13-overlay-title code {
      font-size: 0.78em;
      font-family: "JetBrains Mono", monospace;
    }
    #t13SpriteOverlayRoot .t13-overlay-close {
      flex: 0 0 auto;
      border: 1px solid #2a3140;
      background: #1c2230;
      color: #e8ecf4;
      border-radius: 6px;
      width: 2rem;
      height: 2rem;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
    }
    #t13SpriteOverlayRoot .t13-overlay-close:hover {
      border-color: #e60012;
      color: #fff;
    }
    #t13SpriteOverlayRoot .t13-overlay-note,
    #t13SpriteOverlayRoot .t13-overlay-hint {
      margin: 0.25rem 0 0.5rem;
      font-size: 0.72rem;
      color: #8b95a8;
      line-height: 1.4;
    }
    #t13SpriteOverlayRoot .t13-overlay-canvas-outer {
      display: inline-block;
      margin: 0.25rem 0;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #2a3140;
    }
    #t13SpriteOverlayRoot .t13-overlay-canvas {
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      opacity: 0.8;
    }
  `;
    document.head.appendChild(style);
    root._t13StyleEl = style;

    document.body.appendChild(root);

    const canvas = root.querySelector('.t13-overlay-canvas');
    const ctx = canvas.getContext('2d');
    const btnClose = root.querySelector('.t13-overlay-close');
    const backdrop = root.querySelector('.t13-overlay-backdrop');

    const landAt = (rr, cc) => {
      if (rr < 0 || cc < 0 || rr >= gridH || cc >= gridW) return false;
      return landGrid[rr * gridW + cc] === 1;
    };

    const setType = terrainSet.type;
    const sheetCols = TessellationEngine.getTerrainSheetCols(terrainSet);
    const imgPath = TessellationEngine.getImagePath(terrainSet.file);

    function cleanup() {
      root._t13StyleEl?.remove();
      root.remove();
      document.removeEventListener('keydown', onKey);
    }

    function close() {
      cleanup();
      resolve();
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    loadImage(imgPath)
      .then((img) => {
        const centerId = roleToTileId(terrainSet, 'CENTER');
        const concConvAbc =
          setType === 'conc-conv-a' || setType === 'conc-conv-b' || setType === 'conc-conv-c';

        const cw = gridW * TILE;
        const ch = gridH * TILE;
        canvas.width = cw;
        canvas.height = ch;
        ctx.imageSmoothingEnabled = false;

        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, cw, ch);

        for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            blitTile(ctx, img, centerId, sheetCols, x * TILE, y * TILE);
          }
        }

        for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            if (!landAt(y, x)) continue;
            const role = getRoleForCell(y, x, gridH, gridW, landAt, setType);
            const tileId = roleToTileId(terrainSet, role);
            const px = x * TILE;
            const py = y * TILE;
            if (concConvAbc && role && role !== 'CENTER' && centerId != null && tileId !== centerId) {
              blitTile(ctx, img, centerId, sheetCols, px, py);
            }
            blitTile(ctx, img, tileId, sheetCols, px, py);
          }
        }

        document.addEventListener('keydown', onKey);
        btnClose.addEventListener('click', close);
        backdrop.addEventListener('click', close);
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}
