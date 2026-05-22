/**
 * @fileoverview Reusable play-mode controller. Wraps the window adapter,
 * spawn search, input attachment, sprite loading, and the render loop into a
 * `{ start, stop, setDex }` object that can drive either:
 *   - the dedicated `play.html` page (via `play/main.js`), or
 *   - an embedded play mode inside the editor (via `editor/main.js`).
 *
 * Lifecycle:
 *   const pm = createPlayMode({ canvas, store, onHud, onStatus });
 *   await pm.start();    // tilesets, spawn, attach input, loop
 *   pm.setDex(25);       // hot-swap species; sprite reloads transparently
 *   pm.stop();           // cancel raf, detach input, clear bake cache
 *
 * Notes:
 *  - Player position is stored in *painter-space micro tile* coords so it
 *    survives window rebuilds; the renderer/walkability see the world-space
 *    translation rooted at `origin`.
 *  - `clearChunkCache()` is called on every rebuild to avoid bleed across
 *    different window origins.
 */

import { BIOMES } from 'region-map-gen/biomes.js';
import { MACRO_TILE_STRIDE, getMicroTile } from 'region-map-gen/chunking.js';
import { canWalkMicroTile } from 'region-walkability/walkability.js';
import { loadTilesetImages } from 'region-render-2d/load-tileset-images.js';
import {
  buildWindowWorld,
  needsRebuild,
  DEFAULT_WINDOW_SIZE,
} from '../editor/window-world.js';
import { createPlayer } from './player.js';
import { renderFrame, clearChunkCache } from './play-renderer.js';
import { loadPokemonSprite } from './pokemon-sprite.js';
import { DEFAULT_PLAYER_DEX_ID, getPokemonName } from './pokemon-names.js';

const BIOME_BY_ID = new Map(Object.values(BIOMES).map((b) => [b.id, b]));

const WINDOW_SIZE = DEFAULT_WINDOW_SIZE;
const REBUILD_MARGIN_MACRO = 16;

/**
 * @typedef {object} HudData
 * @property {number} x          painter micro X
 * @property {number} y          painter micro Y
 * @property {number} mx         painter macro X
 * @property {number} my         painter macro Y
 * @property {string} biome      display name of current biome
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} stamina
 * @property {number} maxStamina
 * @property {number} level
 * @property {number} exp
 * @property {number} expToNext
 * @property {number} dexId
 * @property {string} speciesName
 * @property {boolean} sprinting
 * @property {number} fps
 * @property {string} source     human label of map source ("editor", "preset", ...)
 */

/**
 * @typedef {object} CreatePlayModeOpts
 * @property {HTMLCanvasElement} canvas
 * @property {import('../editor/editor-store.js').EditorStore} store
 * @property {string} [tilesetBaseUrl] URL prefix where `tilesets/...` lives.
 * @property {number} [dexId]
 * @property {string} [source]
 * @property {(data: HudData) => void} [onHud]
 * @property {(text: string) => void} [onStatus]
 */

/**
 * @param {CreatePlayModeOpts} opts
 */
export function createPlayMode(opts) {
  const {
    canvas,
    store,
    tilesetBaseUrl = new URL('../../../../', import.meta.url).href,
    onHud = () => {},
    onStatus = () => {},
    source = 'editor',
  } = opts;

  let dexId = Number(opts.dexId) || DEFAULT_PLAYER_DEX_ID;
  const ctx = canvas.getContext('2d');

  let player = null;
  let adapter = null;
  /** Painter-space micro tile coords (stable across window rebuilds). */
  const playerPainter = { x: 0, y: 0 };
  let rafId = 0;
  let running = false;
  let lastTime = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsLastUpdate = 0;
  let lastFps = 0;
  let tilesetsLoaded = false;

  function setStatus(text) {
    try { onStatus(text); } catch (e) { console.error(e); }
  }

  function findSpawnPainter() {
    const b = store.bounds();
    const cx = b ? Math.floor((b.minX + b.maxX) / 2) : 0;
    const cy = b ? Math.floor((b.minY + b.maxY) / 2) : 0;
    return spawnAroundPainter(cx, cy);
  }

  function spawnAroundPainter(cxMacro, cyMacro) {
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
          return {
            painterMicroX: wx + origin.mx * MACRO_TILE_STRIDE + 0.5,
            painterMicroY: wy + origin.my * MACRO_TILE_STRIDE + 0.5,
          };
        }
      }
    }
    return {
      painterMicroX: cxMacro * MACRO_TILE_STRIDE + 0.5,
      painterMicroY: cyMacro * MACRO_TILE_STRIDE + 0.5,
    };
  }

  function createWindowAdapter(px, py) {
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

    function painterToWorldMicro(px2, py2) {
      return {
        x: px2 - origin.mx * MACRO_TILE_STRIDE,
        y: py2 - origin.my * MACRO_TILE_STRIDE,
      };
    }

    rebuild(px, py);

    return {
      get world() { return world; },
      get origin() { return origin; },
      get size() { return size; },
      ensureContains,
      painterToWorldMicro,
    };
  }

  async function loadSpriteFor(dex) {
    try {
      const sprite = await loadPokemonSprite(dex, tilesetBaseUrl);
      if (player && player.state.dexId === dex) {
        player.state.sprite = sprite;
      }
    } catch (e) {
      console.warn('Failed to load pokémon sprite for dex', dex, e);
    }
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.1, (lastTime ? (now - lastTime) / 1000 : 0));
    lastTime = now;

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

    renderFrame(ctx, adapter.world, player.state, {
      width: canvas.width,
      height: canvas.height,
    });

    // FPS smoothing.
    fpsAccum += dt;
    fpsFrames += 1;
    if (now - fpsLastUpdate > 500) {
      lastFps = fpsAccum > 0 ? fpsFrames / fpsAccum : 0;
      fpsAccum = 0;
      fpsFrames = 0;
      fpsLastUpdate = now;
    }

    // Push HUD snapshot.
    const macroX = Math.floor(playerPainter.x / MACRO_TILE_STRIDE);
    const macroY = Math.floor(playerPainter.y / MACRO_TILE_STRIDE);
    const tile = getMicroTile(local.x | 0, local.y | 0, adapter.world);
    const biome = tile ? BIOME_BY_ID.get(tile.biomeId) : null;
    try {
      onHud({
        x: playerPainter.x,
        y: playerPainter.y,
        mx: macroX,
        my: macroY,
        biome: biome ? biome.name : '—',
        hp: player.state.hp,
        maxHp: player.state.maxHp,
        stamina: player.state.stamina,
        maxStamina: player.state.maxStamina,
        level: player.state.level,
        exp: player.state.exp,
        expToNext: player.state.expToNext,
        dexId: player.state.dexId,
        speciesName: getPokemonName(player.state.dexId),
        sprinting: !!player.state.sprinting,
        fps: lastFps,
        source,
      });
    } catch (e) {
      console.error(e);
    }

    rafId = requestAnimationFrame(loop);
  }

  async function start() {
    if (running) return;
    setStatus('Carregando tilesets…');
    if (!tilesetsLoaded) {
      await loadTilesetImages(() => {}, tilesetBaseUrl);
      tilesetsLoaded = true;
    }

    setStatus('Procurando spawn…');
    const spawn = findSpawnPainter();
    playerPainter.x = spawn.painterMicroX;
    playerPainter.y = spawn.painterMicroY;
    adapter = createWindowAdapter(playerPainter.x, playerPainter.y);

    const localStart = adapter.painterToWorldMicro(playerPainter.x, playerPainter.y);
    player = createPlayer({
      x: localStart.x,
      y: localStart.y,
      world: adapter.world,
      dexId,
    });
    player.attachInput(window);

    // Try to focus the canvas so keyboard input feels responsive even when
    // the editor's sidebar inputs had focus a moment ago.
    try { canvas.focus({ preventScroll: true }); } catch { /* noop */ }

    // Background sprite load — game keeps running with fallback until ready.
    loadSpriteFor(dexId);

    running = true;
    lastTime = 0;
    fpsAccum = 0;
    fpsFrames = 0;
    fpsLastUpdate = performance.now();
    setStatus(`Em jogo (${source})`);
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (player) player.detachInput(window);
    player = null;
    adapter = null;
    clearChunkCache();
    setStatus('Editor');
  }

  function setDex(newDexId) {
    const d = Math.max(1, Math.floor(Number(newDexId) || DEFAULT_PLAYER_DEX_ID));
    dexId = d;
    if (player) {
      player.setDex(d);
      // Drop old sprite while the new one loads (fallback bolinha bridges the gap).
      player.state.sprite = null;
    }
    loadSpriteFor(d);
  }

  return { start, stop, setDex, get running() { return running; } };
}
