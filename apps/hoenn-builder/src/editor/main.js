/**
 * @fileoverview Editor bootstrap: wires the EditorStore, finite-window world,
 * renderer, and input handler into a single requestAnimationFrame loop.
 *
 * The painter store is the source of truth (infinite). Every frame we:
 *  1) check whether the camera drifted near the current window edge → if so
 *     rebuild the finite world centered on the camera and drop the bake cache;
 *  2) refresh the window biomes if any chunks the store reports as dirty
 *     overlap the current window, and invalidate just those bake chunks;
 *  3) render the world + overlays;
 *  4) update HUD + debounce-save to localStorage.
 */

import { BIOMES } from 'region-map-gen/biomes.js';
import { loadTilesetImages } from 'region-render-2d/load-tileset-images.js';
import {
  EditorStore,
  editorStore,
  persistToLocalStorage,
  readFromLocalStorage,
  CHUNK_SIZE,
} from './editor-store.js';
import {
  buildWindowWorld,
  refreshWindowBiomes,
  needsRebuild,
  DEFAULT_WINDOW_SIZE,
} from './window-world.js';
import { EditorRenderer, PAINTER_PX_PER_MACRO } from './editor-renderer.js';
import { EditorInput } from './editor-input.js';
import { loadHoennPreset } from '../world/load-painted-world.js';
import { createPlayMode } from '../play/play-mode.js';
import {
  DEFAULT_PLAYER_DEX_ID,
  FEATURED_DEX_IDS,
  POKEMON_NAMES,
  getPokemonName,
} from '../play/pokemon-names.js';

const $ = (sel) => document.querySelector(sel);
const canvas = /** @type {HTMLCanvasElement} */ ($('#editor-canvas'));
const ctx = canvas.getContext('2d');
const paletteEl = $('#biome-palette');
const brushSizeInput = $('#brush-size');
const brushSizeLabel = $('#brush-size-label');
const modeButtons = document.querySelectorAll('[data-mode]');
const zoomLabel = $('#zoom-label');
const hudCoords = $('#hud-coords');
const hudBiome = $('#hud-biome');
const hudBounds = $('#hud-bounds');
const seedInput = $('#seed');
const statusEl = $('#editor-status');
const body = document.body;
const appModeButtons = document.querySelectorAll('[data-app-mode-btn]');

// Play-mode HUD elements (created in HTML; populated by createPlayMode's onHud callback).
const playSpeciesEl = $('#play-species');
const playLevelEl = $('#play-level');
const playBiomeEl = $('#play-biome');
const playCoordsEl = $('#play-coords');
const playFpsEl = $('#play-fps');
const playHudSpecies = $('#play-hud-species');
const playHudLevel = $('#play-hud-level');
const playHudHpFill = $('#play-hud-hp-fill');
const playHudHpText = $('#play-hud-hp-text');
const playHudStaminaFill = $('#play-hud-stamina-fill');
const playHudStaminaText = $('#play-hud-stamina-text');
const playHudExpFill = $('#play-hud-exp-fill');
const playHudExpText = $('#play-hud-exp-text');
const playDexSelect = /** @type {HTMLSelectElement} */ ($('#play-dex-select'));
const playDexInput = /** @type {HTMLInputElement} */ ($('#play-dex-input'));

const BIOME_BY_ID = new Map(Object.values(BIOMES).map((b) => [b.id, b]));

const camera = { x: 0, y: 0, zoom: 1 };
const renderer = new EditorRenderer();
const state = {
  activeBiomeId: BIOMES.GRASSLAND.id,
  brushSize: 1,
  mode: /** @type {'brush'|'rect'} */ ('brush'),
  window: /** @type {ReturnType<typeof buildWindowWorld> | null} */ (null),
  dirtyRedraw: true,
  appMode: /** @type {'edit'|'play'} */ ('edit'),
  playerDexId: DEFAULT_PLAYER_DEX_ID,
};
/** @type {ReturnType<typeof createPlayMode> | null} */
let playMode = null;

function setStatus(text) { if (statusEl) statusEl.textContent = text; }

function buildPalette() {
  const order = [
    'OCEAN', 'BEACH', 'GRASSLAND', 'FOREST', 'JUNGLE', 'SAVANNA',
    'DESERT', 'TUNDRA', 'TAIGA', 'SNOW', 'ICE',
    'MOUNTAIN', 'PEAK', 'VOLCANO',
    'GHOST_WOODS', 'ARCANE', 'FLOWER_FIELDS',
    'CITY', 'CITY_STREET', 'TOWN', 'TOWN_STREET',
  ];
  for (const key of order) {
    const b = BIOMES[key];
    if (!b) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'biome-swatch';
    btn.dataset.biomeId = String(b.id);
    btn.innerHTML = `<span class="biome-swatch-color" style="background:${b.color}"></span><span>${b.name}</span>`;
    btn.addEventListener('click', () => selectBiome(b.id));
    paletteEl.appendChild(btn);
  }
  selectBiome(state.activeBiomeId);
}

function selectBiome(id) {
  state.activeBiomeId = id | 0;
  for (const el of paletteEl.querySelectorAll('.biome-swatch')) {
    el.classList.toggle('active', Number(el.dataset.biomeId) === id);
  }
}

function setMode(mode) {
  state.mode = mode;
  for (const btn of modeButtons) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  }
  canvas.style.cursor = mode === 'rect' ? 'crosshair' : 'pointer';
}

function setBrushSize(n) {
  const v = Math.max(1, Math.min(15, Number(n) | 0));
  state.brushSize = v % 2 === 0 ? v + 1 : v;
  brushSizeInput.value = String(state.brushSize);
  brushSizeLabel.textContent = `${state.brushSize}×${state.brushSize}`;
}

function rebuildWindowIfNeeded(force = false) {
  const w = state.window;
  const cx = camera.x / PAINTER_PX_PER_MACRO;
  const cy = camera.y / PAINTER_PX_PER_MACRO;
  if (!force && w && !needsRebuild(w.origin, cx, cy, w.size)) return;
  const built = buildWindowWorld(editorStore, cx, cy, DEFAULT_WINDOW_SIZE);
  state.window = built;
  renderer.clearCache();
}

function onStoreDirty(dirtyKeys) {
  if (!state.window) return;
  let touched = false;
  for (const key of dirtyKeys) {
    const [cxStr, cyStr] = key.split(',');
    const cx = Number(cxStr);
    const cy = Number(cyStr);
    const minMX = cx * CHUNK_SIZE;
    const minMY = cy * CHUNK_SIZE;
    const maxMX = minMX + CHUNK_SIZE - 1;
    const maxMY = minMY + CHUNK_SIZE - 1;
    const { origin, size } = state.window;
    if (maxMX < origin.mx || maxMY < origin.my || minMX >= origin.mx + size || minMY >= origin.my + size) continue;
    renderer.invalidateMacroRect(minMX, minMY, maxMX, maxMY, origin, size);
    touched = true;
  }
  if (touched) {
    refreshWindowBiomes(state.window.world, editorStore, state.window.origin, state.window.size);
  }
  schedulePersist();
  state.dirtyRedraw = true;
}

let persistTimer = 0;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = 0;
    editorStore.seed = seedInput.value || 'hoenn-editor';
    persistToLocalStorage();
    updateBoundsHud();
  }, 500);
}

function updateBoundsHud() {
  const b = editorStore.bounds();
  if (!b) {
    hudBounds.textContent = 'mapa vazio';
  } else {
    hudBounds.textContent = `bounds (${b.minX},${b.minY}) → (${b.maxX},${b.maxY})  ·  ${editorStore.chunkCount()} chunks`;
  }
}

const input = new EditorInput({
  canvas,
  store: editorStore,
  camera,
  getActiveBiomeId: () => state.activeBiomeId,
  getBrushSize: () => state.brushSize,
  getMode: () => state.mode,
  onChange: () => {
    if (input.hover) {
      hudCoords.textContent = `(${input.hover.macroX}, ${input.hover.macroY})`;
      const id = editorStore.getBiome(input.hover.macroX, input.hover.macroY);
      hudBiome.textContent = BIOME_BY_ID.get(id)?.name ?? '—';
    } else {
      hudCoords.textContent = '—';
      hudBiome.textContent = '—';
    }
    state.dirtyRedraw = true;
  },
  onRequestRedraw: () => { state.dirtyRedraw = true; },
});

function loop() {
  if (state.appMode !== 'edit') {
    // Editor RAF is paused while the play-mode controller drives the canvas.
    requestAnimationFrame(loop);
    return;
  }
  rebuildWindowIfNeeded();
  if (state.dirtyRedraw && state.window) {
    state.dirtyRedraw = false;
    const pct = camera.zoom * 100;
    zoomLabel.textContent = `${pct < 1 ? pct.toFixed(2) : pct.toFixed(0)}%`;
    const overlays = {};
    if (input.hover && state.mode === 'brush') {
      overlays.brush = { macroX: input.hover.macroX, macroY: input.hover.macroY, size: state.brushSize };
    }
    if (input.marqueeStart && input.marqueeEnd) {
      overlays.rect = {
        macroX0: input.marqueeStart.macroX,
        macroY0: input.marqueeStart.macroY,
        macroX1: input.marqueeEnd.macroX,
        macroY1: input.marqueeEnd.macroY,
      };
    }
    const b = editorStore.bounds();
    if (b) overlays.paintedBounds = b;
    renderer.renderFrame(
      ctx,
      state.window.world,
      state.window.origin,
      state.window.size,
      camera,
      { width: canvas.width, height: canvas.height },
      overlays,
    );
  } else if (state.window) {
    // Even without input changes, keep redrawing so async bakes show up.
    if (renderer._bakeCache.size === 0) state.dirtyRedraw = true;
  }
  requestAnimationFrame(loop);
}

function exportJson() {
  editorStore.seed = seedInput.value || 'hoenn-editor';
  const snap = editorStore.toJSON();
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${snap.seed.replace(/\W+/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJsonFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(String(reader.result));
      editorStore.fromJSON(obj);
      seedInput.value = editorStore.seed;
      camera.x = 0;
      camera.y = 0;
      const b = editorStore.bounds();
      if (b) {
        const midX = (b.minX + b.maxX) / 2;
        const midY = (b.minY + b.maxY) / 2;
        camera.x = midX * PAINTER_PX_PER_MACRO;
        camera.y = midY * PAINTER_PX_PER_MACRO;
      }
      rebuildWindowIfNeeded(true);
      state.dirtyRedraw = true;
      updateBoundsHud();
      setStatus(`Importado: ${editorStore.chunkCount()} chunks`);
    } catch (e) {
      alert(`Falha ao importar: ${e.message}`);
    }
  };
  reader.readAsText(file);
}

async function loadHoennClick() {
  try {
    setStatus('Carregando preset Hoenn…');
    const obj = await loadHoennPreset();
    editorStore.fromJSON(obj);
    seedInput.value = editorStore.seed;
    camera.x = 0;
    camera.y = 0;
    const b = editorStore.bounds();
    if (b) {
      camera.x = ((b.minX + b.maxX) / 2) * PAINTER_PX_PER_MACRO;
      camera.y = ((b.minY + b.maxY) / 2) * PAINTER_PX_PER_MACRO;
    }
    rebuildWindowIfNeeded(true);
    state.dirtyRedraw = true;
    updateBoundsHud();
    setStatus('Preset Hoenn carregado.');
  } catch (e) {
    setStatus(`Erro: ${e.message}`);
  }
}

function clearMap() {
  if (!confirm('Apagar todo o mapa pintado?')) return;
  editorStore.clear();
  schedulePersist();
  rebuildWindowIfNeeded(true);
  state.dirtyRedraw = true;
  updateBoundsHud();
}

function setAppMode(mode) {
  if (mode !== 'edit' && mode !== 'play') return;
  if (state.appMode === mode) return;
  state.appMode = mode;
  body.setAttribute('data-app-mode', mode);
  for (const btn of appModeButtons) {
    btn.classList.toggle('active', btn.dataset.appModeBtn === mode);
  }

  if (mode === 'play') {
    if (!playMode) {
      playMode = createPlayMode({
        canvas,
        store: editorStore,
        dexId: state.playerDexId,
        source: 'editor',
        onHud: updatePlayHud,
        onStatus: (txt) => setStatus(txt),
      });
    }
    playMode.start();
  } else {
    if (playMode) playMode.stop();
    // Force a redraw of the editor view; bake cache is dropped by play mode's
    // clearChunkCache, but the editor uses its own cache (kept across modes).
    state.dirtyRedraw = true;
  }
}

function updatePlayHud(data) {
  if (!data) return;
  if (playHudSpecies) playHudSpecies.textContent = data.speciesName;
  if (playHudLevel) playHudLevel.textContent = String(data.level);
  if (playSpeciesEl) playSpeciesEl.textContent = `${data.speciesName} (#${String(data.dexId).padStart(3, '0')})`;
  if (playLevelEl) playLevelEl.textContent = String(data.level);
  if (playBiomeEl) playBiomeEl.textContent = data.biome;
  if (playCoordsEl) {
    playCoordsEl.textContent = `(${Math.floor(data.x)}, ${Math.floor(data.y)}) · macro (${data.mx}, ${data.my})`;
  }
  if (playFpsEl) playFpsEl.textContent = `${data.fps.toFixed(0)} fps`;

  setBarFill(playHudHpFill, data.hp, data.maxHp);
  if (playHudHpText) playHudHpText.textContent = `${Math.round(data.hp)} / ${data.maxHp}`;

  setBarFill(playHudStaminaFill, data.stamina, data.maxStamina);
  if (playHudStaminaText) playHudStaminaText.textContent = `${Math.round(data.stamina)} / ${data.maxStamina}`;

  setBarFill(playHudExpFill, data.exp, data.expToNext);
  if (playHudExpText) playHudExpText.textContent = `${Math.round(data.exp)} / ${data.expToNext}`;
}

function setBarFill(el, value, max) {
  if (!el) return;
  const m = Math.max(1, Number(max) || 1);
  const v = Math.max(0, Math.min(m, Number(value) || 0));
  el.style.width = `${((v / m) * 100).toFixed(1)}%`;
}

function buildDexSelect() {
  if (!playDexSelect) return;
  playDexSelect.innerHTML = '';
  for (const dex of FEATURED_DEX_IDS) {
    const opt = document.createElement('option');
    opt.value = String(dex);
    opt.textContent = `#${String(dex).padStart(3, '0')} ${POKEMON_NAMES[dex]}`;
    if (dex === state.playerDexId) opt.selected = true;
    playDexSelect.appendChild(opt);
  }
  playDexSelect.addEventListener('change', () => {
    const id = Number(playDexSelect.value) || DEFAULT_PLAYER_DEX_ID;
    state.playerDexId = id;
    if (playDexInput) playDexInput.value = String(id);
    if (playMode) playMode.setDex(id);
  });
  if (playDexInput) {
    playDexInput.value = String(state.playerDexId);
    playDexInput.addEventListener('change', () => {
      const id = Math.max(1, Math.min(493, Math.floor(Number(playDexInput.value) || DEFAULT_PLAYER_DEX_ID)));
      state.playerDexId = id;
      playDexInput.value = String(id);
      // Keep the select in sync when the typed dex happens to be featured.
      if (POKEMON_NAMES[id]) playDexSelect.value = String(id);
      if (playMode) playMode.setDex(id);
    });
  }
}

async function init() {
  buildPalette();
  setMode('brush');
  setBrushSize(1);
  buildDexSelect();

  brushSizeInput.addEventListener('input', (e) => {
    setBrushSize(e.target.value);
    state.dirtyRedraw = true;
  });
  for (const btn of modeButtons) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  }
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // App mode toggles work from either side.
    if (e.key === 'p' || e.key === 'P') {
      setAppMode(state.appMode === 'play' ? 'edit' : 'play');
      return;
    }
    if (e.key === 'Escape' && state.appMode === 'play') {
      setAppMode('edit');
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      if (state.appMode !== 'edit') setAppMode('edit');
      return;
    }
    // Edit-only shortcuts.
    if (state.appMode !== 'edit') return;
    if (e.key === 'b' || e.key === 'B') setMode('brush');
    else if (e.key === 'r' || e.key === 'R') setMode('rect');
    else if (e.key === '[') setBrushSize(state.brushSize - 2);
    else if (e.key === ']') setBrushSize(state.brushSize + 2);
  });

  for (const btn of appModeButtons) {
    btn.addEventListener('click', () => setAppMode(btn.dataset.appModeBtn));
  }

  seedInput.addEventListener('change', () => {
    editorStore.seed = seedInput.value || 'hoenn-editor';
    schedulePersist();
  });

  $('#load-hoenn').addEventListener('click', loadHoennClick);
  $('#clear-map').addEventListener('click', clearMap);
  $('#save-json').addEventListener('click', exportJson);
  $('#import-json-btn').addEventListener('click', () => $('#import-json').click());
  $('#import-json').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importJsonFromFile(f);
    e.target.value = '';
  });
  $('#play-link').addEventListener('click', () => {
    editorStore.seed = seedInput.value || 'hoenn-editor';
    persistToLocalStorage();
  });

  editorStore.onChunksDirty(onStoreDirty);

  const persisted = readFromLocalStorage();
  if (persisted) {
    try {
      editorStore.fromJSON(persisted);
      seedInput.value = editorStore.seed;
      const b = editorStore.bounds();
      if (b) {
        camera.x = ((b.minX + b.maxX) / 2) * PAINTER_PX_PER_MACRO;
        camera.y = ((b.minY + b.maxY) / 2) * PAINTER_PX_PER_MACRO;
      }
      setStatus(`Carregado do navegador: ${editorStore.chunkCount()} chunks`);
    } catch (e) {
      console.warn('Falha ao restaurar do localStorage:', e);
    }
  } else {
    setStatus('Mapa vazio — pinte algo ou carregue o preset Hoenn.');
  }

  const tilesetBaseUrl = new URL('../../../../', import.meta.url).href;
  setStatus(`${statusEl.textContent}  ·  carregando tilesets…`);
  await loadTilesetImages(() => {}, tilesetBaseUrl);
  setStatus(statusEl.textContent.replace(/\s+·\s+carregando tilesets…$/, ''));

  rebuildWindowIfNeeded(true);
  updateBoundsHud();
  state.dirtyRedraw = true;
  requestAnimationFrame(loop);
}

init().catch((e) => {
  console.error(e);
  setStatus(`Erro fatal: ${e.message}`);
});
