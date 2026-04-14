/**
 * city-layout.js — Pre-computed city layouts for the procedural region generator.
 *
 * Ported from pixel-map-generation-noised/js/game/GlobeTileDetailMapData.js.
 * Generates deterministic building placements (Pokémon Center, PokéMart, houses),
 * inner-city paths, terracing data, and ground skin info for each graph-node city.
 *
 * Called once in generator.js; results are attached to macroData and consumed
 * by chunking.js (height/biome overrides) and render.js (building sprites).
 */

import { MACRO_TILE_STRIDE, elevationToStep, getHeightStepAt } from './chunking.js';
import { seededHash } from './tessellation-logic.js';

/* ── Building dimensions (in micro-tiles, 16×16 px each) ── */
const POKE_W = 5, POKE_H = 6;
const MART_W = 4, MART_H = 5;
const HOUSE_W = 4, HOUSE_H = 5;
const GAP_X = 2, GAP_Y = 2;
const MARGIN = 2;

/* Red-house grid (tileset_ver_3__free___by_magiscarf_dbf3bkq.png) */
const RED_HOUSE_COLS = 4;
const RED_HOUSE_ROWS = 5;
const RED_HOUSE_ROOF_ROWS = 2;
const RED_HOUSE_BODY_ROWS = 3;
const RED_HOUSE_DOOR_COL = 1;
/* Base IDs for red-house variants in the PokemonCenter.tsx tileset (15 cols) */
const RED_HOUSE_BASE_IDS = [90, 94, 98, 165, 169];

/** City radius in micro-tiles from the node centre. */
const CITY_RADIUS = 45;
/** Terracing clamping: every 6 tiles of distance → ±1 elevation step. */
const TERRACE_SLOPE = 6;
/** Corner rounding radius for terracing (softer edges). */
const TERRACE_CORNER_R = 5;

/**
 * Deterministic pseudo-random for layout placement (matches source).
 */
function seededLayout(sx, sy, i, seed) {
  const t = Math.sin(sx * 12.9898 + sy * 78.233 + i * 137.5453 + seed * 1000) * 43758.5453;
  return t - Math.floor(t);
}

/**
 * Build city layout data for every node in the graph.
 *
 * @param {{ nodes: Array, edges: Array }} graph
 * @param {{ width: number, height: number, cells: Float32Array, seed: number, config: Object }} macroData
 * @param {number} seed
 * @returns {{
 *   layouts: Array<Object>,
 *   footprintSet: Set<string>,
 *   pathTilesSet: Set<string>,
 *   buildingFootprintSet: Set<string>,
 *   cityHeightMap: Map<string, number>,
 *   cityBiomeMap: Map<string, number>
 * }}
 */
export function buildCityLayouts(graph, macroData, seed) {
  const { width, height } = macroData;
  const microW = width * MACRO_TILE_STRIDE;
  const microH = height * MACRO_TILE_STRIDE;

  const layouts = [];
  const footprintSet = new Set();       // all tiles inside the city circle
  const pathTilesSet = new Set();       // inner-city road tiles
  const buildingFootprintSet = new Set(); // tiles occupied by buildings

  // Per-tile overrides computed from terracing
  const cityHeightMap = new Map();   // "mx,my" → forced heightStep
  const cityBiomeMap = new Map();    // "mx,my" → biomeId override (unused for now, reserved)

  for (const node of graph.nodes) {
    const cx = node.x * MACRO_TILE_STRIDE + Math.floor(MACRO_TILE_STRIDE / 2);
    const cy = node.y * MACRO_TILE_STRIDE + Math.floor(MACRO_TILE_STRIDE / 2);

    // Determine importance-based sizing
    const importance = node.importance ?? seededHash(node.x, node.y, seed + 888) * 10;
    const isTown = importance < 4;
    const numHouses = isTown
      ? 3 + Math.floor(seededLayout(cx, cy, 0, seed) * 3)
      : 5 + Math.floor(seededLayout(cx, cy, 0, seed) * 4);
    const citySize = CITY_RADIUS;

    // ── Dominant height ──────────────────────────────────────
    // Sample a cross pattern (+) inside the city to find the most common land height.
    const heightCounts = {};
    const sampleRadius = Math.min(15, citySize);
    for (let dy = -sampleRadius; dy <= sampleRadius; dy += 3) {
      for (let dx = -sampleRadius; dx <= sampleRadius; dx += 3) {
        const sx = cx + dx, sy = cy + dy;
        if (sx < 0 || sx >= microW || sy < 0 || sy >= microH) continue;
        const h = getHeightStepAt(sx, sy, macroData);
        if (h >= 1) {
          heightCounts[h] = (heightCounts[h] || 0) + 1;
        }
      }
    }
    let dominantHeight = 1;
    let maxCount = 0;
    for (const key in heightCounts) {
      const h = parseInt(key, 10);
      if (heightCounts[key] > maxCount && h >= 1) {
        maxCount = heightCounts[key];
        dominantHeight = h;
      }
    }

    // ── Building placement (relative to city center) ────────
    // PokéCenter and PokéMart get fixed slots; houses scatter deterministically.
    const pokeRelX = isTown ? 6 : 10;
    const pokeRelY = -12;
    const martRelX = pokeRelX + POKE_W + 2;
    const martRelY = -12;

    const buildings = [
      { x: pokeRelX, y: pokeRelY, w: POKE_W, h: POKE_H, type: 'pokecenter' },
      { x: martRelX, y: martRelY, w: MART_W, h: MART_H, type: 'pokemart' },
    ];

    const houses = [];
    let failures = 0, houseCount = 0;
    while (houseCount < numHouses && failures < 120) {
      const maxX = citySize - HOUSE_W - MARGIN;
      const maxY = citySize - HOUSE_H - MARGIN;
      const hx = -maxX + Math.floor(seededLayout(cx, cy, houseCount * 100 + failures + 2, seed) * (2 * maxX));
      const hy = -maxY + Math.floor(seededLayout(cx, cy, houseCount * 100 + failures + 3, seed) * (2 * maxY));

      let overlaps = false;
      for (const b of buildings) {
        if (
          hx - GAP_X < b.x + b.w &&
          hx + HOUSE_W + GAP_X > b.x &&
          hy - GAP_Y < b.y + b.h &&
          hy + HOUSE_H + GAP_Y > b.y
        ) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        buildings.push({ x: hx, y: hy, w: HOUSE_W, h: HOUSE_H, type: 'house' });
        houses.push({ dx: hx, dy: hy });
        houseCount++;
        failures = 0;
      } else {
        failures++;
      }
    }

    // Shuffle houses for visual variant assignment
    for (let si = houses.length - 1; si >= 1; si--) {
      const j = Math.floor(seededLayout(cx, cy, 5000 + si, seed) * (si + 1));
      const tmp = houses[si];
      houses[si] = houses[j];
      houses[j] = tmp;
    }

    // ── Absolute positions ─────────────────────────────────
    const pokeAbs = { ox: cx + pokeRelX, oy: cy + pokeRelY };
    const martAbs = { ox: cx + martRelX, oy: cy + martRelY };
    const housesAbs = houses.map((h, i) => ({
      ox: cx + h.dx,
      oy: cy + h.dy,
      variantIndex: i % RED_HOUSE_BASE_IDS.length,
    }));

    // ── Register building footprints ────────────────────────
    const registerFootprint = (ox, oy, w, h) => {
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const fx = ox + dx, fy = oy + dy;
          if (fx >= 0 && fx < microW && fy >= 0 && fy < microH) {
            buildingFootprintSet.add(`${fx},${fy}`);
          }
        }
      }
    };
    registerFootprint(pokeAbs.ox, pokeAbs.oy, POKE_W, POKE_H);
    registerFootprint(martAbs.ox, martAbs.oy, MART_W, MART_H);
    for (const house of housesAbs) {
      registerFootprint(house.ox, house.oy, HOUSE_W, HOUSE_H);
    }

    // ── Inner-city paths (L-shaped: horizontal first, then vertical) ──
    const addPathLine = (x0, y0, x1, y1) => {
      let x = x0, y = y0;
      while (x !== x1 || y !== y1) {
        if (x >= 0 && x < microW && y >= 0 && y < microH) {
          pathTilesSet.add(`${x},${y}`);
        }
        // Widen path: add neighbor perpendicular to travel direction
        const nextX = x < x1 ? x + 1 : x > x1 ? x - 1 : x;
        const nextY = y < y1 ? y + 1 : y > y1 ? y - 1 : y;
        if (nextX !== x) {
          // moving horizontally → widen vertically
          if (y - 1 >= 0) pathTilesSet.add(`${x},${y - 1}`);
          if (y + 1 < microH) pathTilesSet.add(`${x},${y + 1}`);
        } else if (nextY !== y) {
          // moving vertically → widen horizontally
          if (x - 1 >= 0) pathTilesSet.add(`${x - 1},${y}`);
          if (x + 1 < microW) pathTilesSet.add(`${x + 1},${y}`);
        }
        if (x < x1) x++;
        else if (x > x1) x--;
        else if (y < y1) y++;
        else if (y > y1) y--;
      }
      if (x >= 0 && x < microW && y >= 0 && y < microH) {
        pathTilesSet.add(`${x},${y}`);
      }
    };

    // Door positions → paths to city center
    const doorPoints = [
      { x: pokeAbs.ox + 2, y: pokeAbs.oy + POKE_H },     // pokecenter door
      { x: martAbs.ox + 1, y: martAbs.oy + MART_H },      // mart door
    ];
    for (const house of housesAbs) {
      doorPoints.push({ x: house.ox + RED_HOUSE_DOOR_COL, y: house.oy + RED_HOUSE_ROWS });
    }
    for (const d of doorPoints) {
      addPathLine(d.x, d.y, cx, cy);
    }

    // Apron tiles in front of each building (3-wide patch below each door)
    const addBuildingApron = (ox, oy, w, h) => {
      for (let dx = 0; dx < w; dx++) {
        for (let apronY = 0; apronY < 3; apronY++) {
          const px = ox + dx, py = oy + h + apronY;
          if (px >= 0 && px < microW && py >= 0 && py < microH) {
            pathTilesSet.add(`${px},${py}`);
          }
        }
      }
    };
    addBuildingApron(pokeAbs.ox, pokeAbs.oy, POKE_W, POKE_H);
    addBuildingApron(martAbs.ox, martAbs.oy, MART_W, MART_H);
    for (const house of housesAbs) {
      addBuildingApron(house.ox, house.oy, RED_HOUSE_COLS, RED_HOUSE_ROWS);
    }

    // ── City footprint (circular) ──────────────────────────
    const cityFootprint = new Set();
    for (let dy = -citySize; dy <= citySize; dy++) {
      for (let dx = -citySize; dx <= citySize; dx++) {
        if (dx * dx + dy * dy > citySize * citySize) continue;
        const fx = cx + dx, fy = cy + dy;
        if (fx < 0 || fx >= microW || fy < 0 || fy >= microH) continue;
        const key = `${fx},${fy}`;
        footprintSet.add(key);
        cityFootprint.add(key);
      }
    }

    // ── Terracing: force flat height inside city, smooth ramp around edges ──
    for (const key of cityFootprint) {
      cityHeightMap.set(key, dominantHeight);
    }
    // Extended terracing: tiles just outside the footprint get clamped heights
    const terraceExtent = citySize + 20;
    for (let dy = -terraceExtent; dy <= terraceExtent; dy++) {
      for (let dx = -terraceExtent; dx <= terraceExtent; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= citySize) continue; // already handled
        if (dist > terraceExtent) continue;
        const fx = cx + dx, fy = cy + dy;
        if (fx < 0 || fx >= microW || fy < 0 || fy >= microH) continue;
        const key = `${fx},${fy}`;
        if (cityHeightMap.has(key)) continue; // don't override inner city
        const distFromEdge = dist - citySize;
        const maxDelta = Math.floor(distFromEdge / TERRACE_SLOPE);
        // Store the allowed range; chunking.js will clamp to this
        // For simplicity, store as {center, maxDelta} via encoding
        // We just won't store the terrace — let chunking.js handle the smooth clamping
        // by checking distance from city centers at runtime (cheaper than pre-computing the whole map).
      }
    }

    // ── Layout object ──────────────────────────────────────
    const layout = {
      nodeId: node.id,
      cx, cy,
      radius: citySize,
      isTown,
      dominantHeight,
      importance,
      poke: pokeAbs,
      mart: martAbs,
      houses: housesAbs,
      footprint: cityFootprint,
    };
    layouts.push(layout);
  }

  return {
    layouts,
    footprintSet,
    pathTilesSet,
    buildingFootprintSet,
    cityHeightMap,
    cityBiomeMap,
  };
}

/* Re-export constants for use in chunking.js and render.js */
export {
  CITY_RADIUS,
  TERRACE_SLOPE,
  RED_HOUSE_BASE_IDS,
  RED_HOUSE_COLS,
  RED_HOUSE_ROWS,
  RED_HOUSE_ROOF_ROWS,
  RED_HOUSE_BODY_ROWS,
  RED_HOUSE_DOOR_COL,
  POKE_W,
  POKE_H,
  MART_W,
  MART_H,
  HOUSE_W,
  HOUSE_H,
};
