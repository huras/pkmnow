/**
 * Autotile real (mesmo set que o overlay 13-peças) sobre cada máscara 3×3 isolada,
 * para pré-visualização na bandeja do lab.
 */
import { getRoleForCell } from './tessellation-logic.js';
import { TERRAIN_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { drawTerrainCellFromSheet, getConcConvATerrainTileSpec } from './render/conc-conv-a-terrain-blit.js';

const SET_NAME = 'Palette base — rock';
const TILE_SRC = 16;
const VIEW_SCALE = 2;
const TILE = TILE_SRC * VIEW_SCALE;
/** Margem de vazio à volta do 3×3 para o autotile ver vizinhança “oceano”. */
const PAD = 4;

/** @type {Promise<{ terrainSet: object, sheetCols: number, setType: string, img: HTMLImageElement, centerId: number | null }> | null} */
let assetsPromise = null;

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

function ensureAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const terrainSet = TERRAIN_SETS[SET_NAME];
      if (!terrainSet) throw new Error(`Missing terrain set: ${SET_NAME}`);
      const sheetCols = TessellationEngine.getTerrainSheetCols(terrainSet);
      const imgPath = TessellationEngine.getImagePath(terrainSet.file);
      const img = await loadImage(imgPath);
      const centerId = getConcConvATerrainTileSpec(terrainSet, 'CENTER').tileId;
      return { terrainSet, sheetCols, setType: terrainSet.type, img, centerId };
    })();
  }
  return assetsPromise;
}

/**
 * Desenha no canvas 3×3 tiles (sem fundo nas células vazias da máscara).
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} mat 3×3 com 0/1
 */
export async function drawPieceAutotile(canvas, mat) {
  const { terrainSet, sheetCols, setType, img, centerId } = await ensureAssets();
  const GW = 3 + PAD * 2;
  const GH = 3 + PAD * 2;
  const OX = PAD;
  const OY = PAD;
  const grid = new Uint8Array(GW * GH);
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      if (mat[dy][dx]) grid[(OY + dy) * GW + OX + dx] = 1;
    }
  }
  const landAt = (rr, cc) =>
    rr >= 0 && cc >= 0 && rr < GH && cc < GW && grid[rr * GW + cc] === 1;

  const concConvAbc =
    setType === 'conc-conv-a' || setType === 'conc-conv-b' || setType === 'conc-conv-c';

  canvas.width = 3 * TILE;
  canvas.height = 3 * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  for (let ly = 0; ly < 3; ly++) {
    for (let lx = 0; lx < 3; lx++) {
      const gy = OY + ly;
      const gx = OX + lx;
      if (!landAt(gy, gx)) continue;
      const role = getRoleForCell(gy, gx, GH, GW, landAt, setType);
      const spec = getConcConvATerrainTileSpec(terrainSet, role);
      const tileId = spec.tileId;
      const px = lx * TILE;
      const py = ly * TILE;
      if (concConvAbc && role && role !== 'CENTER' && centerId != null && tileId !== centerId) {
        blitTile(ctx, img, centerId, sheetCols, px, py, false);
      }
      blitTile(ctx, img, tileId, sheetCols, px, py, spec.flipX);
    }
  }
}

/**
 * @param {HTMLElement} containerEl — ex.: `#trayPieces`
 * @param {Record<string, number[][]>} pieces — mapa role → matriz 3×3
 */
export async function hydrateTraySpriteOverlays(containerEl, pieces) {
  await ensureAssets();
  const wraps = containerEl.querySelectorAll('.piece');
  await Promise.all(
    [...wraps].map(async (wrap) => {
      const role = wrap.dataset.role;
      const canvas = wrap.querySelector('canvas.mini-sprite');
      if (!role || !canvas) return;
      const mat = pieces[role];
      if (!mat) return;
      await drawPieceAutotile(canvas, mat);
    })
  );
}
