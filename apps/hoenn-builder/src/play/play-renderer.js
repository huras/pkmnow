/**
 * @fileoverview Play-mode chunk renderer: bakes/blits the finite window world
 * around the player. The window is provided by the caller; whenever it gets
 * rebuilt, call `clearChunkCache()` to drop stale bakes.
 *
 * Player position is expressed in *world micro tile* coords (i.e. inside the
 * finite window), matching what `region-walkability.canWalkMicroTile` expects.
 */

import { MACRO_TILE_STRIDE } from 'region-map-gen/chunking.js';
import { bakeChunk } from 'region-render-2d/play-chunk-bake.js';
import { drawChunkFormalTreeCanopies } from 'region-render-2d/play-chunk-canopy.js';
import { PLAY_CHUNK_SIZE, PLAY_BAKE_TILE_PX } from 'region-render-2d/render-constants.js';

const TILE_PX = PLAY_BAKE_TILE_PX;
const CHUNK_PX = TILE_PX * PLAY_CHUNK_SIZE;

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
 * @param {{ x: number, y: number, facing: string }} player  world micro-tile coords
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

  drawPlayer(ctx, vw / 2, vh / 2, player.facing);

  // Canopies drawn AFTER the player so they sort in front (matches the main
  // game's render-play-shadow-canopy pass: trunk baked, player drawn, then
  // top leaves on top so you walk "under" them).
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const px = offsetX + cx * CHUNK_PX;
      const py = offsetY + cy * CHUNK_PX;
      drawChunkFormalTreeCanopies(ctx, cx, cy, world, TILE_PX, TILE_PX, px, py, 1);
    }
  }
}

function drawPlayer(ctx, cx, cy, facing) {
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
  ctx.beginPath();
  ctx.arc(cx + dx, cy + dy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
