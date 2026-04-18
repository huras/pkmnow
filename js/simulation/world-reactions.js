import { BIOMES } from '../biomes.js';
import { getMicroTile } from '../chunking.js';
import { getFoliageOverlayTileId, getLakeLotusFoliageWalkRole } from '../walkability.js';

export const EXPERIMENT_WORLD_REACTIONS_V1 = true;

const CELL_SIZE_TILES = 2;
const UPDATE_HZ = 8;
const UPDATE_STEP_SEC = 1 / UPDATE_HZ;
const MAX_TRACK_DIST_TILES = 140;
const CELL_PRUNE_EPS = 0.025;

const HEAT_DECAY_PER_SEC = 0.52;
const WET_DECAY_PER_SEC = 0.34;
const SHOCK_DECAY_PER_SEC = 0.68;
const SHOCK_IN_WATER_BOOST = 0.32;
const HEAT_IN_GRASS_BOOST = 0.22;

const worldCells = new Map();
let updateAccum = 0;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function cellKey(cx, cy) {
  return `${cx},${cy}`;
}

function worldToCell(x, y) {
  const wx = Number(x) || 0;
  const wy = Number(y) || 0;
  return {
    cx: Math.floor(wx / CELL_SIZE_TILES),
    cy: Math.floor(wy / CELL_SIZE_TILES)
  };
}

function cellCenterWorld(cx, cy) {
  return {
    x: (cx + 0.5) * CELL_SIZE_TILES,
    y: (cy + 0.5) * CELL_SIZE_TILES
  };
}

function ensureCell(cx, cy) {
  const k = cellKey(cx, cy);
  let c = worldCells.get(k);
  if (!c) {
    c = { cx, cy, heat: 0, wet: 0, shock: 0 };
    worldCells.set(k, c);
  }
  return c;
}

function isBurnableGrass(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return false;
  if (tile.isRoad || tile.isCity) return false;
  if (tile.biomeId === BIOMES.OCEAN.id) return false;
  return getFoliageOverlayTileId(mx, my, data) !== null;
}

function isShallowOrSurfaceWater(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  if (!tile) return false;
  if (tile.biomeId === BIOMES.OCEAN.id) return true;
  if (getLakeLotusFoliageWalkRole(mx, my, data) != null) return true;
  if (tile.elevation < 0.47) return true;
  return false;
}

function emitPulse(kind, x, y, amount, radiusTiles, data) {
  if (!EXPERIMENT_WORLD_REACTIONS_V1 || !data) return;
  const baseAmount = Math.max(0, Number(amount) || 0);
  if (baseAmount <= 0) return;
  const radius = Math.max(0.8, Number(radiusTiles) || 1.5);
  const radiusCells = Math.ceil(radius / CELL_SIZE_TILES);
  const c0 = worldToCell(x, y);
  for (let dcy = -radiusCells; dcy <= radiusCells; dcy++) {
    for (let dcx = -radiusCells; dcx <= radiusCells; dcx++) {
      const cx = c0.cx + dcx;
      const cy = c0.cy + dcy;
      const wp = cellCenterWorld(cx, cy);
      const dx = wp.x - (Number(x) || 0);
      const dy = wp.y - (Number(y) || 0);
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      if (falloff <= 0) continue;
      const c = ensureCell(cx, cy);
      const mx = Math.floor(wp.x);
      const my = Math.floor(wp.y);
      if (kind === 'heat') {
        let gain = baseAmount * falloff;
        if (isBurnableGrass(mx, my, data)) gain *= 1.2;
        c.heat = clamp01(c.heat + gain);
      } else if (kind === 'wet') {
        c.wet = clamp01(c.wet + baseAmount * falloff);
      } else if (kind === 'shock') {
        let gain = baseAmount * falloff;
        if (isShallowOrSurfaceWater(mx, my, data)) gain *= 1.25;
        c.shock = clamp01(c.shock + gain);
      }
    }
  }
}

export function addHeatPulse(x, y, amount = 0.5, radiusTiles = 1.7, data) {
  emitPulse('heat', x, y, amount, radiusTiles, data);
}

export function addWetPulse(x, y, amount = 0.5, radiusTiles = 1.8, data) {
  emitPulse('wet', x, y, amount, radiusTiles, data);
}

export function addShockPulse(x, y, amount = 0.5, radiusTiles = 1.9, data) {
  emitPulse('shock', x, y, amount, radiusTiles, data);
}

export function updateWorldReactions(dt, data, focusX, focusY) {
  if (!EXPERIMENT_WORLD_REACTIONS_V1 || !data || worldCells.size <= 0) return;
  updateAccum += Math.max(0, Number(dt) || 0);
  while (updateAccum >= UPDATE_STEP_SEC) {
    updateAccum -= UPDATE_STEP_SEC;
    const fx = Number(focusX) || 0;
    const fy = Number(focusY) || 0;
    for (const [k, c] of worldCells.entries()) {
      const wp = cellCenterWorld(c.cx, c.cy);
      const mx = Math.floor(wp.x);
      const my = Math.floor(wp.y);
      const isWater = isShallowOrSurfaceWater(mx, my, data);
      const isGrass = isBurnableGrass(mx, my, data);

      c.heat = Math.max(0, c.heat - HEAT_DECAY_PER_SEC * UPDATE_STEP_SEC);
      c.wet = Math.max(0, c.wet - WET_DECAY_PER_SEC * UPDATE_STEP_SEC);
      c.shock = Math.max(0, c.shock - SHOCK_DECAY_PER_SEC * UPDATE_STEP_SEC);

      if (isWater && c.shock > 0.02) {
        c.shock = clamp01(c.shock + c.wet * SHOCK_IN_WATER_BOOST * UPDATE_STEP_SEC);
      }
      if (isGrass && c.heat > 0.04 && c.wet < 0.45) {
        c.heat = clamp01(c.heat + HEAT_IN_GRASS_BOOST * UPDATE_STEP_SEC);
      }

      const distToFocus = Math.hypot(wp.x - fx, wp.y - fy);
      if (distToFocus > MAX_TRACK_DIST_TILES) {
        worldCells.delete(k);
        continue;
      }
      if (c.heat < CELL_PRUNE_EPS && c.wet < CELL_PRUNE_EPS && c.shock < CELL_PRUNE_EPS) {
        worldCells.delete(k);
      }
    }
  }
}

function getCellSafe(cx, cy) {
  return worldCells.get(cellKey(cx, cy)) || null;
}

export function sampleWorldDangerScore(x, y, data) {
  if (!EXPERIMENT_WORLD_REACTIONS_V1 || !data || worldCells.size <= 0) return 0;
  const c0 = worldToCell(x, y);
  let total = 0;
  let wsum = 0;
  for (let dcy = -1; dcy <= 1; dcy++) {
    for (let dcx = -1; dcx <= 1; dcx++) {
      const c = getCellSafe(c0.cx + dcx, c0.cy + dcy);
      if (!c) continue;
      const w = dcx === 0 && dcy === 0 ? 1 : 0.5;
      const localDanger = clamp01(c.heat * 0.85 + c.shock * 1.05 - c.wet * 0.22);
      total += localDanger * w;
      wsum += w;
    }
  }
  if (wsum <= 1e-6) return 0;
  return clamp01(total / wsum);
}

export function sampleWorldDangerEscapeAngle(x, y, data) {
  if (!EXPERIMENT_WORLD_REACTIONS_V1 || !data || worldCells.size <= 0) return null;
  const c0 = worldToCell(x, y);
  let vx = 0;
  let vy = 0;
  for (let dcy = -2; dcy <= 2; dcy++) {
    for (let dcx = -2; dcx <= 2; dcx++) {
      const c = getCellSafe(c0.cx + dcx, c0.cy + dcy);
      if (!c) continue;
      const danger = clamp01(c.heat + c.shock * 1.2);
      if (danger <= 0.05) continue;
      const wp = cellCenterWorld(c.cx, c.cy);
      const dx = (Number(x) || 0) - wp.x;
      const dy = (Number(y) || 0) - wp.y;
      const d = Math.hypot(dx, dy) || 1;
      vx += (dx / d) * danger;
      vy += (dy / d) * danger;
    }
  }
  if (Math.hypot(vx, vy) < 1e-6) return null;
  return Math.atan2(vy, vx);
}

const FIRE_PROJECTILES = new Set([
  'ember',
  'flamethrowerShot',
  'fireSpinBurst',
  'incinerateCore',
  'incinerateShard',
  'fireBlastCore',
  'fireBlastShard'
]);
const WATER_PROJECTILES = new Set(['waterShot', 'waterGunShot', 'bubbleShot', 'bubbleBeamShot', 'waterBurstShot']);
const ELECTRIC_PROJECTILES = new Set(['prismaticShot', 'thunderBoltArc']);

export function emitWorldReactionFromProjectile(proj, data, x, y) {
  if (!EXPERIMENT_WORLD_REACTIONS_V1 || !proj || !data) return;
  const px = Number.isFinite(x) ? Number(x) : Number(proj.x) || 0;
  const py = Number.isFinite(y) ? Number(y) : Number(proj.y) || 0;
  const pType = String(proj.type || '');
  if (FIRE_PROJECTILES.has(pType)) {
    addHeatPulse(px, py, 0.55, 1.8, data);
  } else if (WATER_PROJECTILES.has(pType)) {
    addWetPulse(px, py, 0.62, 2.1, data);
  } else if (ELECTRIC_PROJECTILES.has(pType)) {
    addShockPulse(px, py, 0.52, 2.0, data);
  }
}

export function resetWorldReactionState() {
  worldCells.clear();
  updateAccum = 0;
}

export function getWorldReactionOverlayCells(minX, minY, maxX, maxY) {
  if (!EXPERIMENT_WORLD_REACTIONS_V1 || worldCells.size <= 0) return [];
  const out = [];
  const x0 = Number(minX);
  const y0 = Number(minY);
  const x1 = Number(maxX);
  const y1 = Number(maxY);
  const hasBounds = Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1);
  for (const c of worldCells.values()) {
    const wp = cellCenterWorld(c.cx, c.cy);
    if (hasBounds && (wp.x < x0 || wp.x >= x1 || wp.y < y0 || wp.y >= y1)) continue;
    const danger = clamp01(c.heat * 0.85 + c.shock * 1.05 - c.wet * 0.22);
    out.push({
      cx: c.cx,
      cy: c.cy,
      x: wp.x,
      y: wp.y,
      cellSizeTiles: CELL_SIZE_TILES,
      heat: c.heat,
      wet: c.wet,
      shock: c.shock,
      danger
    });
  }
  return out;
}
