/**
 * @fileoverview Play-mode bootstrap. Loads the editor snapshot from
 * localStorage (or the bundled Hoenn preset as a fallback), builds a finite
 * `world` window around the spawn, loads tilesets, and runs the game loop.
 *
 * As the player approaches the window edge in world coords, we rebuild the
 * window centered on the player's current painter-macro position and rebase
 * the player back near the middle of the new window. Bake cache is dropped on
 * each rebuild.
 *
 * The player's authoritative position is stored in *painter-space micro tile*
 * coords so that crossing window boundaries is transparent to gameplay; the
 * renderer/walkability see only the world-space conversion of that.
 */

import { BIOMES } from 'region-map-gen/biomes.js';
import { MACRO_TILE_STRIDE, getMicroTile } from 'region-map-gen/chunking.js';
import { canWalkMicroTile } from 'region-walkability/walkability.js';
import { loadTilesetImages } from 'region-render-2d/load-tileset-images.js';
import {
  editorStore,
  readFromLocalStorage,
} from '../editor/editor-store.js';
import {
  buildWindowWorld,
  needsRebuild,
  DEFAULT_WINDOW_SIZE,
} from '../editor/window-world.js';
import { loadHoennPreset } from '../world/load-painted-world.js';
import { createPlayer } from './player.js';
import { renderFrame, clearChunkCache } from './play-renderer.js';

const canvas = document.getElementById('play-canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('play-status');
const coordsEl = document.getElementById('play-coords');
const biomeEl = document.getElementById('play-biome');
const fpsEl = document.getElementById('play-fps');

const BIOME_BY_ID = new Map(Object.values(BIOMES).map((b) => [b.id, b]));

const WINDOW_SIZE = DEFAULT_WINDOW_SIZE;
const REBUILD_MARGIN_MACRO = 16;

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

function findSpawnPainter(store) {
  const b = store.bounds();
  if (b) {
    const cxMacro = Math.floor((b.minX + b.maxX) / 2);
    const cyMacro = Math.floor((b.minY + b.maxY) / 2);
    return spawnAroundPainter(store, cxMacro, cyMacro);
  }
  return spawnAroundPainter(store, 0, 0);
}

function spawnAroundPainter(store, cxMacro, cyMacro) {
  const probe = buildWindowWorld(store, cxMacro, cyMacro, WINDOW_SIZE);
  const { world, origin, size } = probe;
  const microW = size * MACRO_TILE_STRIDE;
  const microH = size * MACRO_TILE_STRIDE;
  const startWX = Math.floor(microW / 2);
  const startWY = Math.floor(microH / 2);
  for (let r = 0; r < Math.max(microW, microH); r += 4) {
    const candidates = [
      [startWX, startWY], [startWX + r, startWY], [startWX - r, startWY],
      [startWX, startWY + r], [startWX, startWY - r],
      [startWX + r, startWY + r], [startWX - r, startWY - r],
      [startWX + r, startWY - r], [startWX - r, startWY + r],
    ];
    for (const [wx, wy] of candidates) {
      if (wx < 0 || wy < 0 || wx >= microW || wy >= microH) continue;
      const tile = getMicroTile(wx, wy, world);
      if (!tile || tile.biomeId === BIOMES.OCEAN.id) continue;
      if (canWalkMicroTile(wx + 0.5, wy + 0.5, world)) {
        const painterMicroX = wx + origin.mx * MACRO_TILE_STRIDE + 0.5;
        const painterMicroY = wy + origin.my * MACRO_TILE_STRIDE + 0.5;
        return { painterMicroX, painterMicroY };
      }
    }
  }
  return {
    painterMicroX: cxMacro * MACRO_TILE_STRIDE + 0.5,
    painterMicroY: cyMacro * MACRO_TILE_STRIDE + 0.5,
  };
}

/**
 * Maintains a finite window `world` around the player. The player keeps
 * absolute painter-space coords; the world consumed by renderer/walkability
 * always sees a translated coord system rooted at `origin`.
 */
function createWindowAdapter(store, painterMicroX, painterMicroY) {
  let origin = null;
  let size = WINDOW_SIZE;
  let world = null;

  function rebuild(painterMicroX, painterMicroY) {
    const cxMacro = painterMicroX / MACRO_TILE_STRIDE;
    const cyMacro = painterMicroY / MACRO_TILE_STRIDE;
    const built = buildWindowWorld(store, cxMacro, cyMacro, size);
    world = built.world;
    origin = built.origin;
    clearChunkCache();
  }

  function ensureContains(painterMicroX, painterMicroY) {
    const cxMacro = painterMicroX / MACRO_TILE_STRIDE;
    const cyMacro = painterMicroY / MACRO_TILE_STRIDE;
    if (!world || needsRebuild(origin, cxMacro, cyMacro, size, REBUILD_MARGIN_MACRO)) {
      rebuild(painterMicroX, painterMicroY);
    }
  }

  function painterToWorldMicro(px, py) {
    return {
      x: px - origin.mx * MACRO_TILE_STRIDE,
      y: py - origin.my * MACRO_TILE_STRIDE,
    };
  }

  rebuild(painterMicroX, painterMicroY);

  return {
    get world() { return world; },
    get origin() { return origin; },
    get size() { return size; },
    ensureContains,
    painterToWorldMicro,
  };
}

async function init() {
  try {
    statusEl.textContent = 'Carregando mapa…';
    const source = await loadIntoStore();
    statusEl.textContent = `Carregando tilesets… (${source})`;

    const tilesetBaseUrl = new URL('../../../../', import.meta.url).href;
    await loadTilesetImages(() => {}, tilesetBaseUrl);

    const spawn = findSpawnPainter(editorStore);
    const adapter = createWindowAdapter(editorStore, spawn.painterMicroX, spawn.painterMicroY);

    // Player state is in painter-space micro tile coords for stability across
    // window rebuilds. Walkability checks happen in world-space.
    const playerPainter = { x: spawn.painterMicroX, y: spawn.painterMicroY };
    const localStart = adapter.painterToWorldMicro(playerPainter.x, playerPainter.y);
    const player = createPlayer({ x: localStart.x, y: localStart.y, world: adapter.world });
    player.attachInput(window);
    canvas.focus();

    statusEl.textContent = `Mapa: ${source}`;

    let last = performance.now();
    let fpsAccum = 0;
    let fpsFrames = 0;
    let fpsLastUpdate = last;

    function loop(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const before = { x: player.state.x, y: player.state.y };
      player.update(dt);
      const movedX = player.state.x - before.x;
      const movedY = player.state.y - before.y;
      playerPainter.x += movedX;
      playerPainter.y += movedY;

      adapter.ensureContains(playerPainter.x, playerPainter.y);
      const local = adapter.painterToWorldMicro(playerPainter.x, playerPainter.y);
      player.state.x = local.x;
      player.state.y = local.y;
      player.state.world = adapter.world;

      renderFrame(ctx, adapter.world, player.state, { width: canvas.width, height: canvas.height });

      const tx = Math.floor(playerPainter.x);
      const ty = Math.floor(playerPainter.y);
      const macroX = Math.floor(playerPainter.x / MACRO_TILE_STRIDE);
      const macroY = Math.floor(playerPainter.y / MACRO_TILE_STRIDE);
      coordsEl.textContent = `pos: (${tx}, ${ty}) · macro (${macroX}, ${macroY})`;
      const worldTile = getMicroTile(local.x | 0, local.y | 0, adapter.world);
      const biome = worldTile ? BIOME_BY_ID.get(worldTile.biomeId) : null;
      biomeEl.textContent = `bioma: ${biome?.name ?? '—'}`;

      fpsAccum += dt;
      fpsFrames += 1;
      if (now - fpsLastUpdate > 500) {
        const fps = fpsFrames / fpsAccum;
        fpsEl.textContent = `${fps.toFixed(0)} fps`;
        fpsAccum = 0;
        fpsFrames = 0;
        fpsLastUpdate = now;
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Erro: ${e.message}`;
  }
}

init();
