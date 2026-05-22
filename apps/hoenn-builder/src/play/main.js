/**
 * @fileoverview Standalone play-mode page bootstrap. Loads the editor
 * snapshot from localStorage (falls back to the bundled Hoenn preset),
 * spins up the same `createPlayMode` controller the editor uses, and
 * routes HUD updates into the simple text-only HUD that lives in
 * `play.html`.
 *
 * For the rich (bars + species picker) HUD, use `index.html`'s embedded
 * play mode (toggle "Jogar" / `P`).
 */

import {
  editorStore,
  readFromLocalStorage,
} from '../editor/editor-store.js';
import { loadHoennPreset } from '../world/load-painted-world.js';
import { createPlayMode } from './play-mode.js';
import { DEFAULT_PLAYER_DEX_ID } from './pokemon-names.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('play-canvas'));
const statusEl = document.getElementById('play-status');
const coordsEl = document.getElementById('play-coords');
const biomeEl = document.getElementById('play-biome');
const fpsEl = document.getElementById('play-fps');

async function loadIntoStore() {
  const persisted = readFromLocalStorage();
  if (persisted) {
    editorStore.fromJSON(persisted);
    return 'editor (localStorage)';
  }
  const preset = await loadHoennPreset();
  editorStore.fromJSON(preset);
  return 'preset Hoenn';
}

async function init() {
  try {
    statusEl.textContent = 'Carregando mapa…';
    const source = await loadIntoStore();
    statusEl.textContent = `Carregando tilesets… (${source})`;

    const playMode = createPlayMode({
      canvas,
      store: editorStore,
      dexId: DEFAULT_PLAYER_DEX_ID,
      source,
      onStatus: (txt) => { statusEl.textContent = txt; },
      onHud: (data) => {
        if (coordsEl) {
          coordsEl.textContent = `pos: (${Math.floor(data.x)}, ${Math.floor(data.y)}) · macro (${data.mx}, ${data.my})`;
        }
        if (biomeEl) {
          biomeEl.textContent = `bioma: ${data.biome}  ·  ${data.speciesName}`;
        }
        if (fpsEl) {
          fpsEl.textContent = `${data.fps.toFixed(0)} fps  ·  ${data.sprinting ? 'correndo' : 'andando'}`;
        }
      },
    });
    await playMode.start();
    canvas.focus();
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Erro: ${e.message}`;
  }
}

init();
