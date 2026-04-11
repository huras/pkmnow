/**
 * Standalone lab: edit PMD-style params + export JSON for handoff (pmd-anim-metadata / timing).
 */
import { PMD_ANIM_METADATA } from './pokemon/pmd-anim-metadata.js';
import { PMD_MON_SHEET, PMD_DEFAULT_MON_ANIMS } from './pokemon/pmd-default-timing.js';
import { padDex3, getGen1SpeciesName } from './pokemon/gen1-name-to-dex.js';
import { imageCache } from './image-cache.js';
import { ensurePokemonSheetsLoaded, getResolvedSheets } from './pokemon/pokemon-asset-loader.js';
import { BIOMES } from './biomes.js';
import { BIOME_TO_TERRAIN, BIOME_TO_FOLIAGE, TREE_TILES } from './biome-tiles.js';
import { TERRAIN_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { getRoleForCell } from './tessellation-logic.js';
import { loadTilesetImages } from './render.js';
import { POKEMON_HEIGHTS } from './pokemon/pokemon-heights.js';

const GEN1_COUNT = 151;

/** Mesmo “tile” lógico que no jogo (16px na folha). */
const LAB_TILE = 16;
/** Floresta: base + pele + árvore broadleaf (Explorador de Biomas). */
const LAB_REF_BIOME_ID = BIOMES.FOREST.id;
const LAB_GRID = 11;
/** Núcleo 7×7 igual ao `biomes-modal.js`; rodeado de água/vazio até 11×11. */
const LAB_LAND_MASK_CORE7 = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0]
];

const LAB_LAND_MASK = (() => {
  const n = LAB_GRID;
  const core = LAB_LAND_MASK_CORE7;
  const sn = core.length;
  const off = Math.floor((n - sn) / 2);
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => {
      const rr = r - off;
      const cc = c - off;
      if (rr < 0 || rr >= sn || cc < 0 || cc >= sn) return 0;
      return core[rr][cc];
    })
  );
})();

const LAB_PATCH_PX = LAB_GRID * LAB_TILE;
/** Largura do canvas do lab (patch 11×11 centrado). */
const LAB_PREVIEW_W = 224;
const LAB_PREVIEW_H = LAB_PATCH_PX + 46;
/** Centro do tile central da grelha 11×11 (meio em 5,5). */
const LAB_PATCH_CENTER_TILE_FRAC = LAB_GRID / 2;

const PLAY_TILE_PX = 40;

/**
 * Métricas do patch no canvas do lab.
 * Pokémon: pivô no centro do sprite, no centro do tile central da forma 11×11.
 * @returns {{ ox: number, oy: number, patchPx: number, playerAnchorX: number, playerAnchorY: number }}
 */
function getLabPatchLayout() {
  const patchPx = LAB_PATCH_PX;
  const ox = Math.floor((LAB_PREVIEW_W - patchPx) / 2);
  const oy = LAB_PREVIEW_H - patchPx - 2;
  const playerAnchorX = ox + LAB_PATCH_CENTER_TILE_FRAC * LAB_TILE;
  const playerAnchorY = oy + LAB_PATCH_CENTER_TILE_FRAC * LAB_TILE;
  return { ox, oy, patchPx, playerAnchorX, playerAnchorY };
}

/** Cache estático: terreno + pele + árvore (sem Pokémon). */
let labSceneBackdrop = null;

const labPreviewViewState = new WeakMap();

function getLabPreviewViewState(wrap) {
  let s = labPreviewViewState.get(wrap);
  if (!s) {
    s = { z: 1, px: 0, py: 0, pokemonLabScale: 1 };
    labPreviewViewState.set(wrap, s);
  } else if (s.pokemonLabScale == null) {
    s.pokemonLabScale = 1;
  }
  return s;
}

function applyLabPreviewTransform(wrap) {
  const inner = wrap.querySelector('.lab-preview-inner');
  if (!inner) return;
  const { z, px, py } = getLabPreviewViewState(wrap);
  inner.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
}

function resetLabPreviewView(wrap) {
  const s = getLabPreviewViewState(wrap);
  s.z = 1;
  s.px = 0;
  s.py = 0;
  s.pokemonLabScale = 1;
  applyLabPreviewTransform(wrap);
  syncLabPokemonScaleSlider(wrap);
}

const LAB_PREVIEW_ZOOM_MIN = 0.5;
const LAB_PREVIEW_ZOOM_MAX = 8;

/** Só o Pokémon na pré-visualização (não mexe no terreno/árvore). */
const LAB_PREVIEW_POKEMON_SCALE_MIN = 0.25;
const LAB_PREVIEW_POKEMON_SCALE_MAX = 4;

function syncLabPokemonScaleSlider(wrap) {
  const slider = wrap.closest('.lab-preview-stack')?.querySelector('.lab-preview-pokemon-scale');
  if (!slider) return;
  const sc = getLabPreviewViewState(wrap).pokemonLabScale;
  const cur = parseFloat(slider.value);
  if (!Number.isFinite(cur) || Math.abs(cur - sc) > 1e-4) slider.value = String(sc);
}

/**
 * @param {number} localX — coordenada X relativamente ao `.lab-preview-wrap`
 * @param {number} localY — idem Y
 */
function labPreviewSetZoomAboutLocalPoint(wrap, rawNewZ, localX, localY) {
  const s = getLabPreviewViewState(wrap);
  const oldZ = s.z;
  const newZ = Math.min(LAB_PREVIEW_ZOOM_MAX, Math.max(LAB_PREVIEW_ZOOM_MIN, rawNewZ));
  if (newZ !== oldZ) {
    s.px = localX - ((localX - s.px) * newZ) / oldZ;
    s.py = localY - ((localY - s.py) * newZ) / oldZ;
    s.z = newZ;
  }
  applyLabPreviewTransform(wrap);
}

/**
 * Zoom/pan nos `.lab-preview-wrap` (delegação em tbody — sobrevive a `buildTable`).
 */
function setupLabPreviewZoomPan() {
  const tbody = elTbody;
  if (!tbody || tbody.dataset.labZoomPan === '1') return;
  tbody.dataset.labZoomPan = '1';

  let dragWrap = null;
  let dragPointerId = -1;
  let dragLastX = 0;
  let dragLastY = 0;

  tbody.addEventListener(
    'wheel',
    (e) => {
      const wrap = e.target.closest?.('.lab-preview-wrap');
      if (!wrap || !tbody.contains(wrap)) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const s = getLabPreviewViewState(wrap);
      const factor = Math.exp(-e.deltaY * 0.0015);
      labPreviewSetZoomAboutLocalPoint(wrap, s.z * factor, mx, my);
    },
    { passive: false }
  );

  tbody.addEventListener('input', (e) => {
    const slider = e.target.closest?.('.lab-preview-pokemon-height');
    if (!slider || !tbody.contains(slider)) return;
    const dexKey = slider.dataset.dex;
    if (!dexKey) return;
    
    const val = parseFloat(slider.value);
    if (!Number.isFinite(val)) return;
    
    // Update live state height
    state.species[dexKey].tileHeight = val;
    
    // Update all sliders for this species in the row
    const row = slider.closest('tr');
    if (row) {
      row.querySelectorAll(`.lab-preview-pokemon-height[data-dex="${dexKey}"]`).forEach(s => {
        if (s !== slider) s.value = String(val);
      });
      row.querySelectorAll(`.lab-height-display[data-height-for="${dexKey}"]`).forEach(d => {
        d.textContent = `${val.toFixed(1)} Tiles`;
      });
    }
    updateScaleCell(dexKey);
  });

  const onDocPointerMove = (e) => {
    if (!dragWrap || e.pointerId !== dragPointerId) return;
    const s = getLabPreviewViewState(dragWrap);
    s.px += e.clientX - dragLastX;
    s.py += e.clientY - dragLastY;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    applyLabPreviewTransform(dragWrap);
  };

  const endDrag = (e) => {
    if (!dragWrap || e.pointerId !== dragPointerId) return;
    dragWrap.classList.remove('lab-preview-wrap--dragging');
    dragWrap = null;
    dragPointerId = -1;
  };

  document.addEventListener('pointermove', onDocPointerMove);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  tbody.addEventListener('pointerdown', (e) => {
    const wrap = e.target.closest?.('.lab-preview-wrap');
    if (!wrap || !tbody.contains(wrap) || e.button !== 0) return;
    dragWrap = wrap;
    dragPointerId = e.pointerId;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    wrap.classList.add('lab-preview-wrap--dragging');
  });

  tbody.addEventListener('dblclick', (e) => {
    const wrap = e.target.closest?.('.lab-preview-wrap');
    if (!wrap || !tbody.contains(wrap)) return;
    e.preventDefault();
    resetLabPreviewView(wrap);
  });
}

function labIsLandAt(r, c) {
  if (r < 0 || r >= LAB_GRID || c < 0 || c >= LAB_GRID) return false;
  return LAB_LAND_MASK[r][c] === 1;
}

const LAB_TREE_BASE_TILES = 2;
const LAB_TREE_VISUAL_ROWS = 3;

/**
 * Linha central da grelha: coluna mais à esquerda onde cabem 2 bases da broadleaf em terra.
 */
function getLabTreeBasePlacement() {
  const mid = Math.floor(LAB_GRID / 2);
  const tryRows = [mid, mid - 1, mid + 1, mid - 2, mid + 2].filter((r) => r >= 0 && r < LAB_GRID);
  for (const row of tryRows) {
    for (let c = 0; c <= LAB_GRID - LAB_TREE_BASE_TILES; c++) {
      let ok = true;
      for (let k = 0; k < LAB_TREE_BASE_TILES; k++) {
        if (!labIsLandAt(row, c + k)) {
          ok = false;
          break;
        }
      }
      if (ok) return { treeRow: row, treeBaseCol: c };
    }
  }
  return { treeRow: mid, treeBaseCol: 0 };
}

/**
 * Pivô: centro horizontal entre os 2 tiles de base + centro vertical dessa fila de base.
 * `drawBroadleafTree` usa `left` = borda esquerda do 1.º tile de base.
 */
function labTreeDrawTopLeftFromBasePivot(pivotX, pivotY, scale) {
  const left = pivotX - LAB_TILE * scale;
  const top =
    pivotY -
    (LAB_TREE_VISUAL_ROWS - 1) * LAB_TILE * scale -
    (LAB_TILE * scale) / 2;
  return { left, top };
}

function drawTerrainTesselation(ctx, ox, oy, setName) {
  const set = TERRAIN_SETS[setName];
  if (!set) return;
  const imgPath = TessellationEngine.getImagePath(set.file);
  const img = imageCache.get(imgPath);
  if (!img?.complete) return;
  const sheetCols = TessellationEngine.getTerrainSheetCols(set);
  for (let r = 0; r < LAB_GRID; r++) {
    for (let c = 0; c < LAB_GRID; c++) {
      if (!labIsLandAt(r, c)) continue;
      const role = getRoleForCell(r, c, LAB_GRID, LAB_GRID, labIsLandAt, set.type);
      const tileId = set.roles[role] ?? set.centerId;
      ctx.drawImage(
        img,
        (tileId % sheetCols) * LAB_TILE,
        Math.floor(tileId / sheetCols) * LAB_TILE,
        LAB_TILE,
        LAB_TILE,
        ox + c * LAB_TILE,
        oy + r * LAB_TILE,
        LAB_TILE,
        LAB_TILE
      );
    }
  }
}

function drawFoliageTesselation(ctx, ox, oy, setName) {
  const set = TERRAIN_SETS[setName];
  if (!set) return;
  const imgPath = TessellationEngine.getImagePath(set.file);
  const img = imageCache.get(imgPath);
  if (!img?.complete) return;
  const sheetCols = TessellationEngine.getTerrainSheetCols(set);
  for (let r = 0; r < LAB_GRID; r++) {
    for (let c = 0; c < LAB_GRID; c++) {
      if (!labIsLandAt(r, c)) continue;
      const role = getRoleForCell(r, c, LAB_GRID, LAB_GRID, labIsLandAt, set.type);
      const tileId = set.roles[role] ?? set.centerId;
      ctx.drawImage(
        img,
        (tileId % sheetCols) * LAB_TILE,
        Math.floor(tileId / sheetCols) * LAB_TILE,
        LAB_TILE,
        LAB_TILE,
        ox + c * LAB_TILE,
        oy + r * LAB_TILE,
        LAB_TILE,
        LAB_TILE
      );
    }
  }
}

function drawBroadleafTree(ctx, natureImg, left, top, scale) {
  const ids = TREE_TILES.broadleaf;
  if (!ids || !natureImg) return;
  const cols = 57;
  const treeH = 3;
  ids.base.forEach((tileId, i) => {
    ctx.drawImage(
      natureImg,
      (tileId % cols) * LAB_TILE,
      Math.floor(tileId / cols) * LAB_TILE,
      LAB_TILE,
      LAB_TILE,
      left + i * LAB_TILE * scale,
      top + (treeH - 1) * LAB_TILE * scale,
      LAB_TILE * scale,
      LAB_TILE * scale
    );
  });
  ids.top.forEach((tileId, i) => {
    const col = i % 2;
    const row = 1 - Math.floor(i / 2);
    ctx.drawImage(
      natureImg,
      (tileId % cols) * LAB_TILE,
      Math.floor(tileId / cols) * LAB_TILE,
      LAB_TILE,
      LAB_TILE,
      left + col * LAB_TILE * scale,
      top + row * LAB_TILE * scale,
      LAB_TILE * scale,
      LAB_TILE * scale
    );
  });
}

function buildLabSceneBackdrop() {
  const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
  if (!natureImg?.complete || natureImg.naturalWidth < 8) {
    labSceneBackdrop = null;
    return;
  }

  const terrainName = BIOME_TO_TERRAIN[LAB_REF_BIOME_ID];
  const foliageName = BIOME_TO_FOLIAGE[LAB_REF_BIOME_ID];
  if (!terrainName) {
    labSceneBackdrop = null;
    return;
  }

  const c = document.createElement('canvas');
  c.width = LAB_PREVIEW_W;
  c.height = LAB_PREVIEW_H;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, LAB_PREVIEW_W, LAB_PREVIEW_H);

  const { ox, oy } = getLabPatchLayout();

  drawTerrainTesselation(ctx, ox, oy, terrainName);
  if (foliageName) drawFoliageTesselation(ctx, ox, oy, foliageName);

  const treeScale = 1;
  const { treeRow, treeBaseCol } = getLabTreeBasePlacement();
  const treePivotX = ox + treeBaseCol * LAB_TILE + LAB_TILE;
  const treePivotY = oy + treeRow * LAB_TILE + LAB_TILE / 2;
  const { left: treeLeft, top: treeTop } = labTreeDrawTopLeftFromBasePivot(
    treePivotX,
    treePivotY,
    treeScale
  );
  drawBroadleafTree(ctx, natureImg, treeLeft, treeTop, treeScale);

  labSceneBackdrop = c;
}

function computeLabPokemonDraw(dexKey, mode) {
  const st = state.species[dexKey];
  const g = state.global;
  
  if (!st) {
    const dw = 24;
    const dh = 30;
    return { dw, dh, pivotX: dw * 0.5, pivotY: dh * 0.5 };
  }

  const spec = mode === 'walk' ? st.walk : st.idle;
  const targetHeightTiles = st.tileHeight || 1.1;
  const targetHeightPx = targetHeightTiles * PLAY_TILE_PX;

  const canonicalH = Math.max(1, st.idle?.frameHeight || st.walk?.frameHeight || spec.frameHeight);
  
  const mult = Number(st.displayScaleMultiplier);
  const m = Number.isFinite(mult) && mult > 0 ? mult : 1;
  const finalScale = (targetHeightPx / canonicalH) * m;

  const worldDw = (spec.frameWidth || 32) * finalScale;
  const worldDh = (spec.frameHeight || 32) * finalScale;
  const k = LAB_TILE / PLAY_TILE_PX;
  const dw = worldDw * k;
  const dh = worldDh * k;
  return {
    dw,
    dh,
    pivotX: dw * 0.5,
    pivotY: dh * 0.5
  };
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function parseTickCsv(s) {
  return String(s || '')
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const n = parseInt(x, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })
    .filter((x) => x != null);
}

function ticksToCsv(arr) {
  return (arr || []).join(', ');
}

function defaultSpeciesEntry(dex) {
  const key = padDex3(dex);
  const meta = PMD_ANIM_METADATA[key];
  const name = getGen1SpeciesName(dex);
  const tHeight = POKEMON_HEIGHTS[dex] || 1.1;
  if (meta?.idle && meta?.walk) {
    return {
      name,
      tileHeight: tHeight,
      displayScaleMultiplier: 1,
      idle: deepClone(meta.idle),
      walk: deepClone(meta.walk)
    };
  }
  return {
    name,
    tileHeight: tHeight,
    displayScaleMultiplier: 1,
    idle: {
      frameWidth: PMD_MON_SHEET.frameW,
      frameHeight: PMD_MON_SHEET.frameH,
      durations: [...PMD_DEFAULT_MON_ANIMS.Idle]
    },
    walk: {
      frameWidth: PMD_MON_SHEET.frameW,
      frameHeight: PMD_MON_SHEET.frameH,
      durations: [...PMD_DEFAULT_MON_ANIMS.Walk]
    }
  };
}

function buildInitialState() {
  const species = {};
  for (let d = 1; d <= GEN1_COUNT; d++) {
    species[padDex3(d)] = defaultSpeciesEntry(d);
  }
  return {
    version: 2,
    global: {
      frameW: PMD_MON_SHEET.frameW,
      frameH: PMD_MON_SHEET.frameH,
      scale: PMD_MON_SHEET.scale,
      pivotYFrac: PMD_MON_SHEET.pivotYFrac,
      defaultIdleTicks: [...PMD_DEFAULT_MON_ANIMS.Idle],
      defaultWalkTicks: [...PMD_DEFAULT_MON_ANIMS.Walk],
      referenceDex: 94,
      notes:
        'Espelho lógico de render.js (wild Pokémon). Exporta para colares em pmd-anim-metadata.js + pmd-default-timing.js.'
    },
    species
  };
}

function pickAnimFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return 0;
}

function canonicalBox(st) {
  const iw = Math.max(1, st.idle?.frameWidth || PMD_MON_SHEET.frameW);
  const ih = Math.max(1, st.idle?.frameHeight || PMD_MON_SHEET.frameH);
  const ww = Math.max(1, st.walk?.frameWidth || PMD_MON_SHEET.frameW);
  const wh = Math.max(1, st.walk?.frameHeight || PMD_MON_SHEET.frameH);
  return {
    canonicalW: iw || ww,
    canonicalH: ih || wh
  };
}

function computeDisplayedFinalScale(state, dexKey) {
  const st = state.species[dexKey];
  if (!st) return 0;
  const targetHeightTiles = st.tileHeight || 1.1;
  const targetHeightPx = targetHeightTiles * PLAY_TILE_PX;

  const { canonicalH } = canonicalBox(st);
  const ch = Math.max(1, canonicalH);
  
  const mult = Number(st.displayScaleMultiplier);
  const m = Number.isFinite(mult) && mult > 0 ? mult : 1;
  
  return (targetHeightPx / ch) * m;
}

let state = buildInitialState();

const elStatus = document.getElementById('labStatus');
const elTbody = document.getElementById('labTbody');
const elFilter = document.getElementById('labFilter');
const gScale = document.getElementById('gScale');
const gFrameW = document.getElementById('gFrameW');
const gFrameH = document.getElementById('gFrameH');
const gPivot = document.getElementById('gPivot');
const gIdleTicks = document.getElementById('gIdleTicks');
const gWalkTicks = document.getElementById('gWalkTicks');

function syncGlobalUiFromState() {
  const g = state.global;
  gScale.value = String(g.scale);
  gFrameW.value = String(g.frameW);
  gFrameH.value = String(g.frameH);
  gPivot.value = String(g.pivotYFrac);
  gIdleTicks.value = ticksToCsv(g.defaultIdleTicks);
  gWalkTicks.value = ticksToCsv(g.defaultWalkTicks);
  document.getElementById('gScaleVal').textContent = g.scale.toFixed(2);
  document.getElementById('gFrameWVal').textContent = String(g.frameW);
  document.getElementById('gFrameHVal').textContent = String(g.frameH);
  document.getElementById('gPivotVal').textContent = g.pivotYFrac.toFixed(2);
}

function readGlobalFromUi() {
  state.global.scale = parseFloat(gScale.value) || PMD_MON_SHEET.scale;
  state.global.frameW = parseInt(gFrameW.value, 10) || PMD_MON_SHEET.frameW;
  state.global.frameH = parseInt(gFrameH.value, 10) || PMD_MON_SHEET.frameH;
  state.global.pivotYFrac = parseFloat(gPivot.value) || PMD_MON_SHEET.pivotYFrac;
  const idle = parseTickCsv(gIdleTicks.value);
  const walk = parseTickCsv(gWalkTicks.value);
  if (idle.length) state.global.defaultIdleTicks = idle;
  if (walk.length) state.global.defaultWalkTicks = walk;
  syncGlobalUiFromState();
}

function updateScaleCell(dexKey) {
  const cell = document.querySelector(`[data-scale-for="${dexKey}"]`);
  if (cell) cell.textContent = computeDisplayedFinalScale(state, dexKey).toFixed(3);
}

function wireSpeciesInputs(trDetail, dexKey) {
  const mul = trDetail.querySelector('[data-field="mult"]');
  if (mul) {
    mul.addEventListener('input', () => {
      const x = parseFloat(mul.value);
      state.species[dexKey].displayScaleMultiplier = Number.isFinite(x) && x > 0 ? x : 1;
      updateScaleCell(dexKey);
    });
  }
  const bindMode = (mode) => {
    const fw = trDetail.querySelector(`[data-field="${mode}-fw"]`);
    const fh = trDetail.querySelector(`[data-field="${mode}-fh"]`);
    const dur = trDetail.querySelector(`[data-field="${mode}-dur"]`);
    if (fw) {
      fw.addEventListener('input', () => {
        const n = parseInt(fw.value, 10);
        if (Number.isFinite(n) && n > 0) state.species[dexKey][mode].frameWidth = n;
        updateScaleCell(dexKey);
      });
    }
    if (fh) {
      fh.addEventListener('input', () => {
        const n = parseInt(fh.value, 10);
        if (Number.isFinite(n) && n > 0) state.species[dexKey][mode].frameHeight = n;
        updateScaleCell(dexKey);
      });
    }
    if (dur) {
      const applyDur = () => {
        const t = parseTickCsv(dur.value);
        if (t.length) state.species[dexKey][mode].durations = t;
      };
      dur.addEventListener('change', applyDur);
      dur.addEventListener('blur', applyDur);
    }
  };
  bindMode('idle');
  bindMode('walk');
}

function buildTable() {
  elTbody.innerHTML = '';
  for (let d = 1; d <= GEN1_COUNT; d++) {
    const key = padDex3(d);
    const st = state.species[key];
    const trM = document.createElement('tr');
    trM.dataset.dex = key;
    trM.className = 'lab-main-row';
    const fScale = computeDisplayedFinalScale(state, key);
    trM.innerHTML = `
      <td class="lab-mono">${key}</td>
      <td>${escapeHtml(st.name)}</td>
      <td class="lab-preview-td">
        <div class="lab-preview-stack">
          <div class="lab-preview-wrap" tabindex="0" title="Roda: zoom da cena · Slider: escala só do Pokémon · Arrastar: pan · Duplo clique: repor" aria-label="Pré-visualização idle: zoom e pan">
            <div class="lab-preview-inner" style="width:${LAB_PREVIEW_W}px;height:${LAB_PREVIEW_H}px">
              <canvas class="lab-preview" width="${LAB_PREVIEW_W}" height="${LAB_PREVIEW_H}" data-preview="1" data-dex="${d}" data-mode="idle" aria-label="Idle ${st.name}"></canvas>
            </div>
          </div>
          <div class="lab-height-display" data-height-for="${key}">${st.tileHeight.toFixed(1)} Tiles</div>
          <input type="range" class="lab-preview-pokemon-height" min="0.5" max="15.0" step="0.1" value="${st.tileHeight}" data-dex="${key}" aria-label="Tile Height — ${escapeHtml(st.name)}" />
        </div>
      </td>
      <td class="lab-preview-td">
        <div class="lab-preview-stack">
          <div class="lab-preview-wrap" tabindex="0" title="Roda: zoom da cena · Slider: escala só do Pokémon · Arrastar: pan · Duplo clique: repor" aria-label="Pré-visualização walk: zoom e pan">
            <div class="lab-preview-inner" style="width:${LAB_PREVIEW_W}px;height:${LAB_PREVIEW_H}px">
              <canvas class="lab-preview" width="${LAB_PREVIEW_W}" height="${LAB_PREVIEW_H}" data-preview="1" data-dex="${d}" data-mode="walk" aria-label="Walk ${st.name}"></canvas>
            </div>
          </div>
          <div class="lab-height-display" data-height-for="${key}">${st.tileHeight.toFixed(1)} Tiles</div>
          <input type="range" class="lab-preview-pokemon-height" min="0.5" max="15.0" step="0.1" value="${st.tileHeight}" data-dex="${key}" aria-label="Tile Height — ${escapeHtml(st.name)}" />
        </div>
      </td>
      <td class="lab-mono" data-scale-for="${key}">${fScale.toFixed(3)}</td>
      <td><button type="button" class="lab-btn lab-toggle" data-toggle="${key}">Editar</button></td>
    `;
    const trD = document.createElement('tr');
    trD.className = 'lab-expand-row hidden';
    trD.dataset.expand = key;
    trD.innerHTML = `
      <td colspan="6">
        <div class="lab-expand-grid">
          <div>
            <label>displayScaleMultiplier (extra, 1 = padrão render)</label>
            <input type="number" data-field="mult" min="0.1" max="10" step="0.05" value="${st.displayScaleMultiplier}" />
          </div>
          <div class="lab-mode-block">
            <h4>Idle</h4>
            <label>frameWidth</label>
            <input type="number" data-field="idle-fw" min="8" max="128" step="1" value="${st.idle.frameWidth}" />
            <label>frameHeight</label>
            <input type="number" data-field="idle-fh" min="8" max="128" step="1" value="${st.idle.frameHeight}" />
            <label>durations (ticks, csv)</label>
            <input type="text" data-field="idle-dur" value="${ticksToCsv(st.idle.durations)}" spellcheck="false" />
          </div>
          <div class="lab-mode-block">
            <h4>Walk</h4>
            <label>frameWidth</label>
            <input type="number" data-field="walk-fw" min="8" max="128" step="1" value="${st.walk.frameWidth}" />
            <label>frameHeight</label>
            <input type="number" data-field="walk-fh" min="8" max="128" step="1" value="${st.walk.frameHeight}" />
            <label>durations (ticks, csv)</label>
            <input type="text" data-field="walk-dur" value="${ticksToCsv(st.walk.durations)}" spellcheck="false" />
          </div>
        </div>
      </td>
    `;
    elTbody.appendChild(trM);
    elTbody.appendChild(trD);
    wireSpeciesInputs(trD, key);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyFilter() {
  const q = elFilter.value.trim().toLowerCase();
  const rows = elTbody.querySelectorAll('tr.lab-main-row');
  rows.forEach((tr) => {
    const key = tr.dataset.dex;
    const st = state.species[key];
    const hay = `${key} ${st.name}`.toLowerCase();
    const show = !q || hay.includes(q);
    tr.classList.toggle('hidden', !show);
    const ex = elTbody.querySelector(`tr[data-expand="${key}"]`);
    if (ex) {
      if (!show) ex.classList.add('hidden');
    }
  });
}

function drawPreviewCanvas(canvas, dexNum, mode, timeSec) {
  const key = padDex3(dexNum);
  const st = state.species[key];
  const spec = mode === 'walk' ? st.walk : st.idle;
  const { walk, idle } = getResolvedSheets(imageCache, dexNum);
  const sheet = mode === 'walk' ? walk : idle;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (labSceneBackdrop) {
    ctx.drawImage(labSceneBackdrop, 0, 0);
  } else {
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!sheet || !sheet.complete || sheet.naturalWidth < 8) return;

  const fw = Math.max(1, spec.frameWidth);
  const fh = Math.max(1, spec.frameHeight);
  const fallbackTicks =
    mode === 'walk' ? state.global.defaultWalkTicks : state.global.defaultIdleTicks;
  const seq = spec.durations?.length ? spec.durations : fallbackTicks;
  const total = seq.reduce((a, b) => a + b, 0) || 1;
  const loopTick = (timeSec * 60) % total;
  const frame = pickAnimFrame(seq, loopTick);
  const row = 0;
  const sx = frame * fw;
  const sy = row * fh;

  const { playerAnchorX: pcx, playerAnchorY: pcy } = getLabPatchLayout();
  const { dw, dh, pivotX, pivotY } = computeLabPokemonDraw(key, mode);
  ctx.drawImage(
    sheet,
    sx,
    sy,
    fw,
    fh,
    Math.round(pcx - pivotX),
    Math.round(pcy - pivotY),
    Math.round(dw),
    Math.round(dh)
  );
}

let animT0 = performance.now() / 1000;
function animLoop(nowMs) {
  const t = nowMs / 1000 - animT0;
  document.querySelectorAll('canvas[data-preview="1"]').forEach((c) => {
    const d = parseInt(c.dataset.dex, 10);
    const mode = c.dataset.mode || 'idle';
    if (!c.closest('tr')?.classList.contains('hidden')) drawPreviewCanvas(c, d, mode, t);
  });
  requestAnimationFrame(animLoop);
}

function exportJson() {
  readGlobalFromUi();
  const payload = {
    version: state.version,
    exportedAt: new Date().toISOString(),
    global: deepClone(state.global),
    species: deepClone(state.species)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pokemon-pmd-lab-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('JSON inválido');
  const base = buildInitialState();
  if (obj.global && typeof obj.global === 'object') {
    const g = deepClone(obj.global);
    base.global = { ...base.global, ...g };
  }
  if (obj.species && typeof obj.species === 'object') {
    for (const k of Object.keys(base.species)) {
      const inc = obj.species[k];
      if (!inc || typeof inc !== 'object') continue;
      const cur = base.species[k];
      const idleIn = inc.idle && typeof inc.idle === 'object' ? deepClone(inc.idle) : null;
      const walkIn = inc.walk && typeof inc.walk === 'object' ? deepClone(inc.walk) : null;
      base.species[k] = {
        name: typeof inc.name === 'string' ? inc.name : cur.name,
        displayScaleMultiplier:
          Number(inc.displayScaleMultiplier) > 0 ? Number(inc.displayScaleMultiplier) : cur.displayScaleMultiplier,
        idle: {
          frameWidth: Number(idleIn?.frameWidth) > 0 ? idleIn.frameWidth : cur.idle.frameWidth,
          frameHeight: Number(idleIn?.frameHeight) > 0 ? idleIn.frameHeight : cur.idle.frameHeight,
          durations:
            Array.isArray(idleIn?.durations) && idleIn.durations.length ? idleIn.durations : cur.idle.durations
        },
        walk: {
          frameWidth: Number(walkIn?.frameWidth) > 0 ? walkIn.frameWidth : cur.walk.frameWidth,
          frameHeight: Number(walkIn?.frameHeight) > 0 ? walkIn.frameHeight : cur.walk.frameHeight,
          durations:
            Array.isArray(walkIn?.durations) && walkIn.durations.length ? walkIn.durations : cur.walk.durations
        }
      };
    }
  }
  state = { ...base, version: obj.version || base.version };
  syncGlobalUiFromState();
  buildTable();
  applyFilter();
}

async function loadAllSheets() {
  const batch = 24;
  for (let i = 1; i <= GEN1_COUNT; i += batch) {
    const slice = [];
    for (let j = i; j < i + batch && j <= GEN1_COUNT; j++) slice.push(ensurePokemonSheetsLoaded(imageCache, j));
    await Promise.all(slice);
    elStatus.textContent = `Imagens: ${Math.min(i + batch - 1, GEN1_COUNT)} / ${GEN1_COUNT}`;
  }
  elStatus.textContent = `${GEN1_COUNT} folhas carregadas (fallback Gengar onde faltar ficheiro).`;
}

function onGlobalScaleInput() {
  readGlobalFromUi();
  document.querySelectorAll('[data-scale-for]').forEach((el) => {
    const k = el.getAttribute('data-scale-for');
    el.textContent = computeDisplayedFinalScale(state, k).toFixed(3);
  });
}
gScale.addEventListener('input', onGlobalScaleInput);
gFrameW.addEventListener('input', onGlobalScaleInput);
gFrameH.addEventListener('input', onGlobalScaleInput);
gPivot.addEventListener('input', () => readGlobalFromUi());
gIdleTicks.addEventListener('change', () => readGlobalFromUi());
gWalkTicks.addEventListener('change', () => readGlobalFromUi());

elFilter.addEventListener('input', applyFilter);

elTbody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle]');
  if (!btn) return;
  const key = btn.getAttribute('data-toggle');
  const row = elTbody.querySelector(`tr[data-expand="${key}"]`);
  if (!row) return;
  row.classList.toggle('hidden');
});

document.getElementById('btnExport').addEventListener('click', exportJson);
document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
document.getElementById('fileImport').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importJson(JSON.parse(String(reader.result)));
      elStatus.textContent = 'Import OK — estado atualizado.';
    } catch (err) {
      alert(err.message || String(err));
    }
  };
  reader.readAsText(f);
  e.target.value = '';
});

syncGlobalUiFromState();
buildTable();
setupLabPreviewZoomPan();

loadTilesetImages()
  .then(() => {
    buildLabSceneBackdrop();
    return loadAllSheets();
  })
  .then(() => {
    if (!labSceneBackdrop) {
      elStatus.textContent += ' | Fundo 11×11: falta tileset nature (flurmimons…).';
    }
    requestAnimationFrame(animLoop);
  });
