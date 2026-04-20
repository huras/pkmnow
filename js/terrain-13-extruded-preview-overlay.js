/**
 * “Extrusão” só em arte: o mesmo autotile repetido N vezes, deslocado só no eixo Y
 * (empilhado para cima), sem faces 3D nem malha real.
 */
import { getRoleForCell } from './tessellation-logic.js';
import { TERRAIN_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { drawTerrainCellFromSheet, getConcConvATerrainTileSpec } from './render/conc-conv-a-terrain-blit.js';

const SET_NAME = 'Palette base — rock';
const TILE_SRC = 16;
const VIEW_SCALE = 2;
const TILE = TILE_SRC * VIEW_SCALE;
/** Número de cópias do mesmo tile (cada uma um TILE mais acima no ecrã). */
const EXTRUDE_LAYERS = 3;
const STEP_Y = TILE;
const STACK_RISE = (EXTRUDE_LAYERS - 1) * STEP_Y;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

function blitTile(ctx, img, tileId, sheetCols, dx, dy, flipX = false) {
  drawTerrainCellFromSheet(ctx, img, sheetCols, TILE_SRC, tileId, dx, dy, TILE, TILE, flipX);
}

/**
 * @param {Uint8Array} landGrid row-major, 1 = terra
 * @param {number} gridW
 * @param {number} gridH
 */
export function openExtrudedTerrainOverlay(landGrid, gridW, gridH) {
  const terrainSet = TERRAIN_SETS[SET_NAME];
  if (!terrainSet) return Promise.reject(new Error(`Missing ${SET_NAME}`));

  const existing = document.getElementById('t13ExtrudeOverlayRoot');
  if (existing) existing.remove();

  return new Promise((resolve, reject) => {
    const root = document.createElement('div');
    root.id = 't13ExtrudeOverlayRoot';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
    <div class="t13-ex-backdrop" data-close="1"></div>
    <div class="t13-ex-panel">
      <header class="t13-ex-header">
        <span class="t13-ex-title">Relevo em Y · ${EXTRUDE_LAYERS}× mesmo tile · ${SET_NAME}</span>
        <button type="button" class="t13-ex-close" aria-label="Fechar">✕</button>
      </header>
      <p class="t13-ex-note">Cada célula com máscara 1 desenha o mesmo autotile (<code>getRoleForCell</code>) várias vezes em Y — <strong>sem</strong> o fundo <code>CENTER</code> extra do conc-conv (só o tile do papel).</p>
      <div class="t13-ex-canvas-wrap">
        <canvas class="t13-ex-canvas" width="64" height="64" aria-label="Terreno repetido em Y"></canvas>
      </div>
      <p class="t13-ex-hint">ESC ou clique fora / ✕ para fechar.</p>
    </div>
  `;

    const style = document.createElement('style');
    style.textContent = `
    #t13ExtrudeOverlayRoot {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Inter, system-ui, sans-serif;
    }
    #t13ExtrudeOverlayRoot .t13-ex-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      cursor: pointer;
    }
    #t13ExtrudeOverlayRoot .t13-ex-panel {
      position: relative;
      z-index: 1;
      max-width: calc(100vw - 1.5rem);
      max-height: calc(100vh - 1.5rem);
      overflow: auto;
      background: #141820;
      border: 1px solid #2a3140;
      border-radius: 10px;
      padding: 0.75rem 1rem 1rem;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    }
    #t13ExtrudeOverlayRoot .t13-ex-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.35rem;
    }
    #t13ExtrudeOverlayRoot .t13-ex-title {
      font-size: 0.82rem;
      color: #e8ecf4;
      font-weight: 600;
    }
    #t13ExtrudeOverlayRoot .t13-ex-title code,
    #t13ExtrudeOverlayRoot .t13-ex-note code {
      font-size: 0.78em;
      font-family: "JetBrains Mono", monospace;
    }
    #t13ExtrudeOverlayRoot .t13-ex-close {
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
    #t13ExtrudeOverlayRoot .t13-ex-close:hover {
      border-color: #e60012;
      color: #fff;
    }
    #t13ExtrudeOverlayRoot .t13-ex-note,
    #t13ExtrudeOverlayRoot .t13-ex-hint {
      margin: 0.25rem 0 0.5rem;
      font-size: 0.72rem;
      color: #8b95a8;
      line-height: 1.4;
    }
    #t13ExtrudeOverlayRoot .t13-ex-canvas-wrap {
      display: inline-block;
      margin: 0.25rem 0;
      border-radius: 6px;
      overflow: auto;
      max-width: 100%;
      border: 1px solid #2a3140;
    }
    #t13ExtrudeOverlayRoot .t13-ex-canvas {
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
  `;
    document.head.appendChild(style);
    root._t13ExStyleEl = style;
    document.body.appendChild(root);

    const canvas = root.querySelector('.t13-ex-canvas');
    const ctx = canvas.getContext('2d');
    const btnClose = root.querySelector('.t13-ex-close');
    const backdrop = root.querySelector('.t13-ex-backdrop');

    const OFFX = 8;
    const OFFY = STACK_RISE + 8;
    const cw = OFFX + gridW * TILE + 8;
    const ch = OFFY + gridH * TILE + 8;

    function cleanup() {
      root._t13ExStyleEl?.remove();
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

    const landAt = (rr, cc) => {
      if (rr < 0 || cc < 0 || rr >= gridH || cc >= gridW) return false;
      return landGrid[rr * gridW + cc] === 1;
    };

    const setType = terrainSet.type;
    const sheetCols = TessellationEngine.getTerrainSheetCols(terrainSet);
    const imgPath = TessellationEngine.getImagePath(terrainSet.file);
    const centerId = getConcConvATerrainTileSpec(terrainSet, 'CENTER').tileId;

    function blitStackedLandTile(img, px, py, tileId, flipX) {
      for (let k = EXTRUDE_LAYERS - 1; k >= 0; k--) {
        const dy = py - k * STEP_Y;
        blitTile(ctx, img, tileId, sheetCols, px, dy, flipX);
      }
    }

    function paintExtruded(img) {
      canvas.width = cw;
      canvas.height = ch;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#0a0c10';
      ctx.fillRect(0, 0, cw, ch);

      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          const px = OFFX + x * TILE;
          const py = OFFY + y * TILE;
          blitTile(ctx, img, centerId, sheetCols, px, py);
        }
      }

      for (let s = 0; s <= gridW + gridH - 2; s++) {
        for (let x = 0; x < gridW; x++) {
          const y = s - x;
          if (y < 0 || y >= gridH) continue;
          if (!landAt(y, x)) continue;
          const px = OFFX + x * TILE;
          const py = OFFY + y * TILE;
          const role = getRoleForCell(y, x, gridH, gridW, landAt, setType);
          const spec = getConcConvATerrainTileSpec(terrainSet, role);
          blitStackedLandTile(img, px, py, spec.tileId, spec.flipX);
        }
      }
    }

    loadImage(imgPath)
      .then((img) => {
        paintExtruded(img);
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
