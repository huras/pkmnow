/**
 * @fileoverview Play-mode chunk renderer: bakes/blits the finite window world
 * around the player, then layers the PMD-sprited player + canopy tops + HP /
 * stamina / EXP bars over the world.
 *
 * The window is provided by the caller; whenever it gets rebuilt, call
 * `clearChunkCache()` to drop stale bakes. Player position is expressed in
 * *world micro tile* coords (inside the finite window), matching
 * `region-walkability.canWalkMicroTile`.
 */

import { MACRO_TILE_STRIDE } from 'region-map-gen/chunking.js';
import { bakeChunk } from 'region-render-2d/play-chunk-bake.js';
import { drawChunkFormalTreeCanopies } from 'region-render-2d/play-chunk-canopy.js';
import { PLAY_CHUNK_SIZE, PLAY_BAKE_TILE_PX } from 'region-render-2d/render-constants.js';
import { drawSpriteAt, pickFrame } from './pokemon-sprite.js';
import { WALK_DISTANCE_CYCLE } from './player.js';

const TILE_PX = PLAY_BAKE_TILE_PX;
const CHUNK_PX = TILE_PX * PLAY_CHUNK_SIZE;

/** Vertical size of the PMD sprite in world tiles. ~2 micro tiles tall feels right vs. main game. */
const SPRITE_HEIGHT_TILES = 2.0;

const cache = new Map();

function chunkKey(cx, cy) { return `${cx},${cy}`; }

function getOrBakeChunk(cx, cy, world) {
  const key = chunkKey(cx, cy);
  let entry = cache.get(key);
  if (entry) return entry;
  entry = bakeChunk(cx, cy, world, TILE_PX, TILE_PX, null);
  cache.set(key, entry);
  return entry;
}

export function clearChunkCache() { cache.clear(); }

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} world
 * @param {{
 *   x: number, y: number, facing: string,
 *   dexId?: number, sprite?: import('./pokemon-sprite.js').PokemonSprite,
 *   distMoved?: number, idleTimer?: number, moving?: boolean,
 *   hp?: number, maxHp?: number, stamina?: number, maxStamina?: number,
 *   exp?: number, expToNext?: number, level?: number
 * }} player  world micro-tile coords
 * @param {{ width: number, height: number }} viewport
 */
export function renderFrame(ctx, world, player, viewport) {
  const { width: vw, height: vh } = viewport;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);

  const camPxX = player.x * TILE_PX;
  const camPxY = player.y * TILE_PX;
  const offsetX = Math.floor(vw / 2 - camPxX);
  const offsetY = Math.floor(vh / 2 - camPxY);

  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const chunksX = Math.ceil(microW / PLAY_CHUNK_SIZE);
  const chunksY = Math.ceil(microH / PLAY_CHUNK_SIZE);

  const minCx = Math.max(0, Math.floor(-offsetX / CHUNK_PX) - 1);
  const minCy = Math.max(0, Math.floor(-offsetY / CHUNK_PX) - 1);
  const maxCx = Math.min(chunksX - 1, Math.floor((vw - offsetX) / CHUNK_PX) + 1);
  const maxCy = Math.min(chunksY - 1, Math.floor((vh - offsetY) / CHUNK_PX) + 1);

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const entry = getOrBakeChunk(cx, cy, world);
      const px = offsetX + cx * CHUNK_PX;
      const py = offsetY + cy * CHUNK_PX;
      ctx.drawImage(entry.canvas, px, py);
    }
  }

  const screenCx = vw / 2;
  const screenCy = vh / 2;
  drawPlayer(ctx, screenCx, screenCy, player);

  // Canopies drawn AFTER the player so they sort in front (matches the main
  // game's render-play-shadow-canopy pass).
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const px = offsetX + cx * CHUNK_PX;
      const py = offsetY + cy * CHUNK_PX;
      drawChunkFormalTreeCanopies(ctx, cx, cy, world, TILE_PX, TILE_PX, px, py, 1);
    }
  }

  drawFloatingBars(ctx, screenCx, screenCy, player);
}

function drawPlayer(ctx, cx, cy, player) {
  drawShadow(ctx, cx, cy);
  if (player.sprite) {
    drawPlayerSprite(ctx, cx, cy, player);
  } else {
    drawPlayerFallback(ctx, cx, cy, player.facing || 'down');
  }
}

function drawShadow(ctx, cx, cy) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4, TILE_PX * 0.55, TILE_PX * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayerSprite(ctx, cx, cy, player) {
  const sprite = player.sprite;
  const sheet = player.moving ? sprite.walk : sprite.idle;
  if (!sheet || !sheet.img) {
    drawPlayerFallback(ctx, cx, cy, player.facing || 'down');
    return;
  }
  let frame;
  if (player.moving) {
    const dist = Number(player.distMoved) || 0;
    const cycleT = (dist % WALK_DISTANCE_CYCLE) / WALK_DISTANCE_CYCLE;
    frame = pickFrame(sheet, cycleT * sheet.totalTicks);
  } else {
    frame = pickFrame(sheet, Number(player.idleTimer) || 0);
  }
  const dstH = TILE_PX * SPRITE_HEIGHT_TILES;
  drawSpriteAt(ctx, sheet, player.facing || 'down', frame, cx, cy + 6, dstH);
}

function drawPlayerFallback(ctx, cx, cy, facing) {
  ctx.save();
  ctx.fillStyle = '#ff3b3b';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  const r = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  let dx = 0;
  let dy = 0;
  if (facing === 'up') dy = -r * 0.65;
  else if (facing === 'down') dy = r * 0.65;
  else if (facing === 'left') dx = -r * 0.65;
  else if (facing === 'right') dx = r * 0.65;
  else if (facing === 'up-left') { dx = -r * 0.5; dy = -r * 0.5; }
  else if (facing === 'up-right') { dx = r * 0.5; dy = -r * 0.5; }
  else if (facing === 'down-left') { dx = -r * 0.5; dy = r * 0.5; }
  else if (facing === 'down-right') { dx = r * 0.5; dy = r * 0.5; }
  ctx.beginPath();
  ctx.arc(cx + dx, cy + dy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFloatingBars(ctx, cx, cy, player) {
  const spriteH = player.sprite ? TILE_PX * SPRITE_HEIGHT_TILES : 28;
  const top = cy + 6 - spriteH;
  const barW = 64;
  const barH = 5;
  const gap = 2;
  let y = top - 6;

  // EXP (bottom of the stack — closest to sprite).
  if (player.expToNext != null) {
    const exp01 = clamp01((Number(player.exp) || 0) / Math.max(1, Number(player.expToNext) || 1));
    y -= barH;
    drawBar(ctx, cx - barW / 2, y, barW, barH, exp01, '#6ca1ff', 'rgba(0,0,0,0.55)');
    y -= gap;
  }

  // Stamina.
  if (player.maxStamina != null) {
    const s01 = clamp01((Number(player.stamina) || 0) / Math.max(1, Number(player.maxStamina) || 1));
    y -= barH;
    drawBar(ctx, cx - barW / 2, y, barW, barH, s01, s01 > 0.35 ? '#59e36e' : '#b8e050', 'rgba(0,0,0,0.55)');
    y -= gap;
  }

  // HP (on top).
  if (player.maxHp != null) {
    const hp01 = clamp01((Number(player.hp) || 0) / Math.max(1, Number(player.maxHp) || 1));
    const color = hp01 > 0.5 ? '#52e070' : hp01 > 0.22 ? '#f0c23a' : '#f05555';
    y -= barH;
    drawBar(ctx, cx - barW / 2, y, barW, barH, hp01, color, 'rgba(0,0,0,0.55)');
  }
}

function drawBar(ctx, x, y, w, h, fillRatio01, fillColor, bgColor) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, Math.max(0, Math.floor(w * fillRatio01)), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
