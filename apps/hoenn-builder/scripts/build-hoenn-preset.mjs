#!/usr/bin/env node
/**
 * @fileoverview Generates `apps/hoenn-builder/src/world/hoenn-preset.json`
 * — a 256×256 painted Hoenn-inspired biome map. Run via:
 *
 *     node apps/hoenn-builder/scripts/build-hoenn-preset.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/world/hoenn-preset.json');

const SIZE = 256;

/** Mirrors `BIOMES` ids in `packages/region-map-gen/src/biomes.js`. */
const B = {
  OCEAN: 0,
  BEACH: 1,
  DESERT: 2,
  GRASSLAND: 3,
  FOREST: 4,
  TAIGA: 5,
  TUNDRA: 6,
  SNOW: 7,
  ICE: 8,
  SAVANNA: 9,
  JUNGLE: 10,
  MOUNTAIN: 11,
  PEAK: 12,
  VOLCANO: 13,
  GHOST_WOODS: 14,
  ARCANE: 15,
  CITY: 16,
  TOWN: 18,
};

const biomes = new Uint8Array(SIZE * SIZE);
biomes.fill(B.OCEAN);

function set(x, y, id) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  biomes[y * SIZE + x] = id;
}

function get(x, y) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
  return biomes[y * SIZE + x];
}

function paintBlob(cx, cy, rx, ry, id, jitter = 0.18) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const noise = (Math.sin(x * 0.7 + y * 0.3) + Math.sin(x * 0.21 - y * 0.55)) * 0.5;
      if (dx * dx + dy * dy + noise * jitter < 1) set(x, y, id);
    }
  }
}

function paintRect(x0, y0, w, h, id) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) set(x, y, id);
  }
}

/**
 * Hoenn shape: a wide horizontal landmass on the lower half (mainland) plus a
 * thinner upper landmass (north islands), connected by a thin isthmus. We use
 * blobs to keep the silhouette organic.
 */

paintBlob(110, 175, 95, 45, B.GRASSLAND, 0.2);
paintBlob(165, 165, 70, 40, B.GRASSLAND, 0.2);
paintBlob(60, 180, 35, 28, B.GRASSLAND, 0.2);
paintBlob(195, 178, 38, 25, B.GRASSLAND, 0.2);

paintBlob(115, 115, 60, 30, B.GRASSLAND, 0.25);
paintBlob(75, 105, 32, 22, B.GRASSLAND, 0.25);
paintBlob(160, 110, 45, 25, B.GRASSLAND, 0.25);

paintBlob(120, 145, 18, 28, B.GRASSLAND, 0.3);

paintBlob(70, 200, 25, 14, B.JUNGLE, 0.3);
paintBlob(155, 200, 30, 16, B.JUNGLE, 0.3);
paintBlob(195, 195, 18, 12, B.SAVANNA, 0.3);

paintBlob(45, 175, 22, 16, B.FOREST, 0.3);
paintBlob(140, 130, 25, 18, B.FOREST, 0.3);
paintBlob(95, 110, 22, 16, B.FOREST, 0.3);
paintBlob(180, 130, 28, 18, B.FOREST, 0.3);

paintBlob(120, 155, 16, 12, B.MOUNTAIN, 0.2);
paintBlob(135, 152, 10, 9, B.MOUNTAIN, 0.2);
set(120, 153, B.VOLCANO);
set(121, 153, B.VOLCANO);
set(120, 154, B.VOLCANO);
set(121, 154, B.VOLCANO);

paintBlob(40, 160, 12, 10, B.MOUNTAIN, 0.2);
paintBlob(200, 150, 14, 11, B.MOUNTAIN, 0.2);

paintBlob(85, 95, 18, 12, B.TUNDRA, 0.3);
paintBlob(175, 95, 16, 11, B.TUNDRA, 0.3);
set(85, 95, B.SNOW);
set(86, 95, B.SNOW);
set(175, 95, B.SNOW);

paintBlob(60, 220, 8, 6, B.GRASSLAND, 0.3);
paintBlob(180, 220, 7, 5, B.GRASSLAND, 0.3);
paintBlob(220, 200, 6, 5, B.GRASSLAND, 0.3);
paintBlob(30, 200, 6, 5, B.GRASSLAND, 0.3);

paintBlob(100, 60, 18, 12, B.GRASSLAND, 0.3);
paintBlob(155, 55, 14, 10, B.GRASSLAND, 0.3);
paintBlob(80, 40, 10, 8, B.GRASSLAND, 0.3);

paintBlob(105, 168, 4, 3, B.CITY);
paintBlob(80, 178, 3, 2, B.TOWN);
paintBlob(135, 175, 3, 2, B.TOWN);
paintBlob(165, 170, 3, 2, B.CITY);
paintBlob(190, 178, 3, 2, B.TOWN);
paintBlob(60, 200, 3, 2, B.TOWN);
paintBlob(155, 200, 3, 2, B.TOWN);
paintBlob(115, 110, 3, 2, B.CITY);
paintBlob(75, 105, 3, 2, B.TOWN);
paintBlob(160, 105, 3, 2, B.CITY);

(function paintBeaches() {
  const next = new Uint8Array(biomes);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (get(x, y) !== B.OCEAN) continue;
      let touchesLand = false;
      for (let dy = -1; dy <= 1 && !touchesLand; dy++) {
        for (let dx = -1; dx <= 1 && !touchesLand; dx++) {
          if (dx === 0 && dy === 0) continue;
          const v = get(x + dx, y + dy);
          if (v !== -1 && v !== B.OCEAN) touchesLand = true;
        }
      }
      if (touchesLand) next[y * SIZE + x] = B.BEACH;
    }
  }
  biomes.set(next);
})();

// Emit v2 chunked format (32x32 macro tiles per chunk) so the editor store can
// consume it directly. The origin (chunkCX=0, chunkCY=0) corresponds to
// painter macro (0, 0); the preset paints the original SIZE x SIZE block as
// the top-left quadrant of the infinite canvas, then we re-center the bounds
// so the user spawns near the middle of the painted region.
const CHUNK_SIZE = 32;
const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
const chunks = {};
const chunksPerSide = Math.ceil(SIZE / CHUNK_SIZE);
for (let cy = 0; cy < chunksPerSide; cy++) {
  for (let cx = 0; cx < chunksPerSide; cx++) {
    const chunk = new Uint8Array(CHUNK_AREA);
    let allDefault = true;
    for (let oy = 0; oy < CHUNK_SIZE; oy++) {
      for (let ox = 0; ox < CHUNK_SIZE; ox++) {
        const mx = cx * CHUNK_SIZE + ox;
        const my = cy * CHUNK_SIZE + oy;
        if (mx >= SIZE || my >= SIZE) continue;
        const id = biomes[my * SIZE + mx];
        chunk[oy * CHUNK_SIZE + ox] = id;
        if (id !== B.OCEAN) allDefault = false;
      }
    }
    if (!allDefault) chunks[`${cx},${cy}`] = Array.from(chunk);
  }
}

const out = {
  version: 2,
  chunkSize: CHUNK_SIZE,
  seed: 'hoenn-preset',
  chunks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

const counts = new Map();
for (const v of biomes) counts.set(v, (counts.get(v) || 0) + 1);
const summary = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([id, n]) => `${id}:${n}`)
  .join(' ');
console.log(`Wrote ${OUT}`);
console.log(`Biome distribution: ${summary}`);
console.log(`Chunked: ${Object.keys(chunks).length} non-empty chunks of ${CHUNK_SIZE}x${CHUNK_SIZE}`);
