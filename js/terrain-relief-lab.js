/**
 * Standalone lab: two height levels, base = all CENTER; terrace mask = tile paint + conc-conv-a autotile.
 */
import { MACRO_TILE_STRIDE } from './chunking.js';
import { TERRAIN_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell } from './tessellation-logic.js';
import { drawTerrainCellFromSheet, getConcConvATerrainTileSpec } from './render/conc-conv-a-terrain-blit.js';

const SET_NAME = 'Palette base — rock';
const TILE_SRC = 16;
const GRID_W = 36;
const GRID_H = 24;
/** Scale from 16px art to screen. */
const VIEW_SCALE = 2;
const TILE = TILE_SRC * VIEW_SCALE;
const LIFT_PX = 10;

const terrainSet = TERRAIN_SETS[SET_NAME];
if (!terrainSet) {
  throw new Error(`Missing terrain set: ${SET_NAME}`);
}

const sheetCols = TessellationEngine.getTerrainSheetCols(terrainSet);
const imgPath = TessellationEngine.getImagePath(terrainSet.file);
const setType = terrainSet.type;
const centerRole = 'CENTER';

function blitTile(ctx, img, tileId, dx, dy, flipX = false) {
  drawTerrainCellFromSheet(ctx, img, sheetCols, TILE_SRC, tileId, dx, dy, TILE, TILE, flipX);
}

function makeGrid() {
  return Array.from({ length: GRID_H }, () => new Uint8Array(GRID_W));
}

function cellFromEvent(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const x = Math.floor(mx / TILE);
  const y = Math.floor(my / TILE);
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
  return { x, y };
}

/** @param {'raise' | 'lower'} mode */
function paintCell(grid, x, y, mode) {
  grid[y][x] = mode === 'raise' ? 1 : 0;
}

/** Mouse/pointer buttons bitmask: 1 = primary, 2 = secondary. */
function modeFromPointerButtons(buttons) {
  if (buttons & 2) return 'lower';
  if (buttons & 1) return 'raise';
  return null;
}

function terraceLandAt(grid, r, c) {
  if (r < 0 || c < 0 || r >= GRID_H || c >= GRID_W) return false;
  return grid[r][c] === 1;
}

/**
 * Em `conc-conv-a`, fios de 1 tile (ex. linha vertical) fazem `getRoleForCell` cair no fallback `CENTER`
 * embora na grelha **crua** não existam os quatro vizinhos cardinais em terraço — o desenho fica sem bordas.
 * Promovemos vizinhos em 0 → 1 onde isso acontece, em passes, até estabilizar (espessura mínima para o papel).
 *
 * @returns {number} quantos tiles foram promovidos de 0 → 1
 */
function expandDegenerateReliefMask(grid) {
  let totalAdded = 0;
  const maxPasses = GRID_W * GRID_H + 8;
  for (let pass = 0; pass < maxPasses; pass++) {
    let addedThisPass = 0;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (grid[y][x] !== 1) continue;
        const n = terraceLandAt(grid, y - 1, x);
        const s = terraceLandAt(grid, y + 1, x);
        const w = terraceLandAt(grid, y, x - 1);
        const e = terraceLandAt(grid, y, x + 1);
        const role = getRoleForCell(y, x, GRID_H, GRID_W, (rr, cc) => terraceLandAt(grid, rr, cc), setType);
        if (role !== 'CENTER') continue;
        if (n && s && w && e) continue;

        if (!n && y > 0 && grid[y - 1][x] === 0) {
          grid[y - 1][x] = 1;
          addedThisPass++;
        }
        if (!s && y + 1 < GRID_H && grid[y + 1][x] === 0) {
          grid[y + 1][x] = 1;
          addedThisPass++;
        }
        if (!w && x > 0 && grid[y][x - 1] === 0) {
          grid[y][x - 1] = 1;
          addedThisPass++;
        }
        if (!e && x + 1 < GRID_W && grid[y][x + 1] === 0) {
          grid[y][x + 1] = 1;
          addedThisPass++;
        }
      }
    }
    totalAdded += addedThisPass;
    if (addedThisPass === 0) break;
  }
  return totalAdded;
}

/** Linhas a cada `MACRO_TILE_STRIDE` micro-tiles (igual ao gerador em `chunking.js`). */
function drawMacroStrideOverlay(ctx, cw, ch, show) {
  if (!show) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 170, 55, 0.82)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= GRID_W; x += MACRO_TILE_STRIDE) {
    const px = x * TILE + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, ch);
    ctx.stroke();
  }
  for (let y = 0; y <= GRID_H; y += MACRO_TILE_STRIDE) {
    const py = y * TILE + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(cw, py);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Uma célula macro = bloco `MACRO_TILE_STRIDE`×`MACRO_TILE_STRIDE` micro; verde se algum micro do bloco está em terraço.
 */
function drawMacroPreview(grid, mctx) {
  if (!mctx) return;
  const S = MACRO_TILE_STRIDE;
  const macroW = Math.ceil(GRID_W / S);
  const macroH = Math.ceil(GRID_H / S);
  const cellPx = Math.max(18, Math.min(36, Math.floor(220 / Math.max(macroW, macroH, 1))));
  mctx.canvas.width = macroW * cellPx;
  mctx.canvas.height = macroH * cellPx;
  mctx.imageSmoothingEnabled = false;

  for (let my = 0; my < macroH; my++) {
    for (let mx = 0; mx < macroW; mx++) {
      let any = false;
      const x0 = mx * S;
      const y0 = my * S;
      outer: for (let yy = y0; yy < y0 + S && yy < GRID_H; yy++) {
        for (let xx = x0; xx < x0 + S && xx < GRID_W; xx++) {
          if (grid[yy][xx] === 1) {
            any = true;
            break outer;
          }
        }
      }
      const px = mx * cellPx;
      const py = my * cellPx;
      mctx.fillStyle = any ? '#3d7a4a' : '#141820';
      mctx.fillRect(px, py, cellPx, cellPx);
      mctx.strokeStyle = 'rgba(255, 170, 55, 0.45)';
      mctx.lineWidth = 1;
      mctx.strokeRect(px + 0.5, py + 0.5, cellPx - 1, cellPx - 1);
    }
  }

  const fs = Math.max(8, Math.floor(cellPx * 0.38));
  mctx.font = `${fs}px "JetBrains Mono", monospace`;
  mctx.fillStyle = 'rgba(232, 236, 244, 0.92)';
  for (let my = 0; my < macroH; my++) {
    for (let mx = 0; mx < macroW; mx++) {
      mctx.fillText(`${mx},${my}`, mx * cellPx + 3, my * cellPx + Math.floor(cellPx * 0.58));
    }
  }
}

function draw(grid, ctx, img, liftTops, showMacroOverlay) {
  const cw = GRID_W * TILE;
  const ch = GRID_H * TILE;
  if (ctx.canvas.width !== cw || ctx.canvas.height !== ch) {
    ctx.canvas.width = cw;
    ctx.canvas.height = ch;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, cw, ch);

  const centerId = getConcConvATerrainTileSpec(terrainSet, centerRole).tileId;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const px = x * TILE;
      const py = y * TILE;
      blitTile(ctx, img, centerId, px, py);
    }
  }

  const lift = liftTops ? LIFT_PX : 0;
  if (lift > 0) {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (grid[y][x] !== 1) continue;
        const px0 = x * TILE;
        const py0 = y * TILE;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(
          px0 + TILE * 0.5,
          py0 + TILE * 0.55 + lift * 0.35,
          TILE * 0.38,
          TILE * 0.18,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (grid[y][x] !== 1) continue;
      const px = x * TILE;
      const py = y * TILE - lift;
      const role = getRoleForCell(y, x, GRID_H, GRID_W, (rr, cc) => terraceLandAt(grid, rr, cc), setType);
      const spec = getConcConvATerrainTileSpec(terrainSet, role);
      blitTile(ctx, img, spec.tileId, px, py, spec.flipX);
    }
  }

  drawMacroStrideOverlay(ctx, cw, ch, !!showMacroOverlay);
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

const RELIEF_EXPORT_KEY = 'terrainReliefLab';
const RELIEF_EXPORT_VER = 1;

function serializeGrid(grid) {
  const r = [];
  for (let y = 0; y < GRID_H; y++) {
    let line = '';
    for (let x = 0; x < GRID_W; x++) line += grid[y][x] ? '1' : '0';
    r.push(line);
  }
  return JSON.stringify({ [RELIEF_EXPORT_KEY]: RELIEF_EXPORT_VER, w: GRID_W, h: GRID_H, r });
}

/** Remove ```json … ``` se a pessoa colou do Cursor. */
function stripMarkdownCodeFence(text) {
  let t = String(text).trim();
  if (!t.startsWith('```')) return t;
  const firstNl = t.indexOf('\n');
  if (firstNl === -1) return t;
  t = t.slice(firstNl + 1);
  if (t.endsWith('```')) t = t.slice(0, -3).trimEnd();
  return t;
}

/**
 * @returns {string | null} mensagem de erro, ou null se ok
 */
function applySerializedToGrid(grid, data) {
  if (!data || typeof data !== 'object') return 'JSON inválido.';
  if (data[RELIEF_EXPORT_KEY] !== RELIEF_EXPORT_VER) {
    return `Esperado "${RELIEF_EXPORT_KEY}": ${RELIEF_EXPORT_VER}.`;
  }
  if (data.w !== GRID_W || data.h !== GRID_H) {
    return `Grelha ${data.w}×${data.h} — este lab usa ${GRID_W}×${GRID_H}.`;
  }
  if (!Array.isArray(data.r) || data.r.length !== GRID_H) {
    return `Campo "r" precisa ter ${GRID_H} strings (linhas).`;
  }
  for (let y = 0; y < GRID_H; y++) {
    const row = data.r[y];
    if (typeof row !== 'string' || row.length !== GRID_W) {
      return `Linha ${y} precisa ter ${GRID_W} caracteres 0 ou 1.`;
    }
    for (let x = 0; x < GRID_W; x++) {
      const ch = row[x];
      if (ch !== '0' && ch !== '1') return `(${x},${y}): só 0 ou 1.`;
      grid[y][x] = ch === '1' ? 1 : 0;
    }
  }
  return null;
}

function main() {
  const canvas = document.getElementById('reliefCanvas');
  const statusEl = document.getElementById('reliefStatus');
  const btnClear = document.getElementById('btnClearTerrace');
  const chkLift = document.getElementById('chkLift');
  const btnExportJson = document.getElementById('btnExportJson');
  const btnImportJson = document.getElementById('btnImportJson');
  const fileImportRelief = document.getElementById('fileImportRelief');
  const reliefExportBox = document.getElementById('reliefExportBox');
  const btnExpandMask = document.getElementById('btnExpandMask');
  const chkAutoExpand = document.getElementById('chkAutoExpand');
  const chkMacroOverlay = document.getElementById('chkMacroOverlay');
  const macroPreviewCanvas = document.getElementById('macroPreviewCanvas');
  if (!canvas || !statusEl || !btnClear || !chkLift) return;

  const ctx = canvas.getContext('2d');
  const macroCtx = macroPreviewCanvas?.getContext('2d') ?? null;
  const grid = makeGrid();

  let img = null;
  let liftTops = chkLift.checked;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function redraw() {
    if (!img) return;
    const showMacro = chkMacroOverlay ? chkMacroOverlay.checked : true;
    draw(grid, ctx, img, liftTops, showMacro);
    drawMacroPreview(grid, macroCtx);
  }

  function runExpandMask() {
    const n = expandDegenerateReliefMask(grid);
    if (img) redraw();
    return n;
  }

  loadImage(imgPath)
    .then((loaded) => {
      img = loaded;
      redraw();
      const macroW = Math.ceil(GRID_W / MACRO_TILE_STRIDE);
      const macroH = Math.ceil(GRID_H / MACRO_TILE_STRIDE);
      setStatus(
        `${SET_NAME} · Micro ${GRID_W}×${GRID_H} · Macro ${macroW}×${macroH} (stride ${MACRO_TILE_STRIDE}) · ${imgPath}`
      );
    })
    .catch((err) => {
      setStatus(String(err.message || err));
    });

  chkLift.addEventListener('change', () => {
    liftTops = chkLift.checked;
    redraw();
  });

  if (chkMacroOverlay) {
    chkMacroOverlay.addEventListener('change', () => redraw());
  }

  btnClear.addEventListener('click', () => {
    for (let y = 0; y < GRID_H; y++) grid[y].fill(0);
    redraw();
  });

  if (btnExportJson && reliefExportBox) {
    btnExportJson.addEventListener('click', async () => {
      const json = serializeGrid(grid);
      reliefExportBox.value = json;
      try {
        reliefExportBox.focus();
        reliefExportBox.select();
      } catch {
        /* ignore */
      }
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(json);
          copied = true;
        }
      } catch {
        /* file:// or permission */
      }
      setStatus(copied ? 'JSON copiado para a área de transferência.' : 'JSON no quadro abaixo — copie manualmente (Ctrl+C).');
      reliefExportBox.closest('details')?.setAttribute('open', '');
    });
  }

  if (btnImportJson && fileImportRelief) {
    btnImportJson.addEventListener('click', () => fileImportRelief.click());
    fileImportRelief.addEventListener('change', () => {
      const file = fileImportRelief.files?.[0];
      fileImportRelief.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const raw = stripMarkdownCodeFence(String(reader.result || ''));
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          setStatus('Importar: JSON ilegível.');
          return;
        }
        const err = applySerializedToGrid(grid, data);
        if (err) {
          setStatus(`Importar: ${err}`);
          return;
        }
        if (img) redraw();
        setStatus('Importado com sucesso.');
      };
      reader.onerror = () => setStatus('Importar: falha ao ler o arquivo.');
      reader.readAsText(file, 'UTF-8');
    });
  }

  if (btnExpandMask) {
    btnExpandMask.addEventListener('click', () => {
      const n = runExpandMask();
      setStatus(n > 0 ? `Corrigido: +${n} tile(s) na máscara (apoio ao autotile).` : 'Nada a corrigir (máscara já ok).');
    });
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let lastStrokeKey = '';
  /** Só auto-expandir após traço que incluiu pintura (evita tapar rasgos feitos só com o direito). */
  let strokeIncludedRaise = false;

  function tryStroke(e, buttons) {
    if (!img) return;
    const mode = modeFromPointerButtons(buttons);
    if (!mode) return;
    const cell = cellFromEvent(canvas, e);
    if (!cell) {
      lastStrokeKey = '';
      return;
    }
    const key = `${cell.x},${cell.y},${mode}`;
    if (key === lastStrokeKey) return;
    lastStrokeKey = key;
    paintCell(grid, cell.x, cell.y, mode);
    if (mode === 'raise') strokeIncludedRaise = true;
    redraw();
    setStatus(`${cell.x},${cell.y} · ${mode === 'raise' ? 'nível 1' : 'nível 0'}`);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    lastStrokeKey = '';
    strokeIncludedRaise = false;
    tryStroke(e, e.buttons);
    if (e.button === 0 || e.button === 2) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!e.buttons) {
      lastStrokeKey = '';
      return;
    }
    tryStroke(e, e.buttons);
  });

  function onStrokeEnd() {
    lastStrokeKey = '';
    if (chkAutoExpand?.checked && img && strokeIncludedRaise) {
      const n = runExpandMask();
      if (n > 0) setStatus(`Auto-corrigido: +${n} tile(s) na máscara.`);
    }
    strokeIncludedRaise = false;
  }

  canvas.addEventListener('pointerup', onStrokeEnd);

  canvas.addEventListener('pointercancel', onStrokeEnd);
}

main();
