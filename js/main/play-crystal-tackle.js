import { clearScatterSolidBlockCache } from '../scatter-pass2-debug.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape, seededHash } from '../tessellation-logic.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';
import { playChunkMap } from '../render/play-chunk-cache.js';
import { PLAY_CHUNK_SIZE } from '../render/render-constants.js';
import { scatterPhysicsCircleAtOrigin } from '../walkability.js';

/** Scatter micro-origins `(ox,oy)` whose crystal base was broken by tackle (persist for this play session). */
const destroyedCrystalScatterOrigins = new Set();

/** @typedef {{ x: number, y: number, vx: number, vy: number, tileId: number, cols: number, imgPath: string | null, age: number, maxAge: number }} CrystalShard */

/** @type {CrystalShard[]} */
export const activeCrystalShards = [];
/** Hit probe is slightly inside the peak lunge to avoid edge jitter exactly on tile borders. */
const TACKLE_HIT_PROBE_BACKOFF_TILES = 0.05;
/** Player tackle uses a capsule-like sweep (segment + this radius), not per-tile checks. */
const TACKLE_SWEEP_RADIUS_TILES = 0.32;
/** Sampling only drives candidate origin lookup window; collision is exact segment-vs-circle. */
const TACKLE_ORIGIN_SCAN_STEP_TILES = 0.2;
/** Spawned "small crystal" chunks that remain on ground after a large crystal breaks. */
export const activeSpawnedSmallCrystals = [];
/** Pickable drops created after breaking a small crystal chunk. */
export const activeCrystalDrops = [];
let crystalLootCount = 0;
let crystalDynIdSeq = 1;

export function isPlayCrystalScatterOriginDestroyed(ox, oy) {
  return destroyedCrystalScatterOrigins.has(`${ox},${oy}`);
}

export function clearPlayCrystalTackleState() {
  destroyedCrystalScatterOrigins.clear();
  activeCrystalShards.length = 0;
  activeSpawnedSmallCrystals.length = 0;
  activeCrystalDrops.length = 0;
  crystalLootCount = 0;
  crystalDynIdSeq = 1;
}

function registerDestroyedCrystalOrigin(rootOx, rootOy) {
  destroyedCrystalScatterOrigins.add(`${rootOx},${rootOy}`);
  clearScatterSolidBlockCache();
}

function invalidateChunksOverlappingFootprint(rootOx, rootOy, cols, rows) {
  const keys = new Set();
  for (let dy = 0; dy < rows; dy++) {
    for (let dx = 0; dx < cols; dx++) {
      const mx = rootOx + dx;
      const my = rootOy + dy;
      keys.add(`${Math.floor(mx / PLAY_CHUNK_SIZE)},${Math.floor(my / PLAY_CHUNK_SIZE)}`);
    }
  }
  for (const k of keys) playChunkMap.delete(k);
}

function segmentCircleFirstHitT(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (a <= 1e-8) return c <= 0 ? 0 : null;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sd = Math.sqrt(disc);
  const t0 = (-b - sd) / (2 * a);
  const t1 = (-b + sd) / (2 * a);
  if (t0 >= 0 && t0 <= 1) return t0;
  if (t1 >= 0 && t1 <= 1) return t1;
  return null;
}

function crystalColorTokenFromKey(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  const tokens = ['light-blue', 'blue', 'yellow', 'red', 'green', 'purple', 'pink'];
  for (const t of tokens) {
    if (k.includes(`${t}-crystal`) || k.includes(`${t} crystal`) || k.includes(t)) return t;
  }
  return 'blue';
}

function smallCrystalKeyForColor(colorToken) {
  const key = `small-${colorToken}-crystal [1x1]`;
  return OBJECT_SETS[key] ? key : 'small-blue-crystal [1x1]';
}

function crystalVisualFromItemKey(itemKey) {
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return null;
  const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return null;
  const path = TessellationEngine.getImagePath(objSet.file);
  const cols = path && path.includes('caves') ? 50 : 57;
  return {
    itemKey,
    tileId: base.ids[0],
    cols,
    imgPath: path || null
  };
}

function spawnSmallCrystalChunksFromLarge(rootOx, rootOy, itemKey) {
  const color = crystalColorTokenFromKey(itemKey);
  const smallKey = smallCrystalKeyForColor(color);
  const visual = crystalVisualFromItemKey(smallKey);
  const largeObj = OBJECT_SETS[itemKey];
  const shape = largeObj ? parseShape(largeObj.shape) : { rows: 2, cols: 2 };
  if (!visual) return;
  const cx = rootOx + shape.cols * 0.5;
  const cy = rootOy + shape.rows * 0.5;
  const offs = [
    [-0.38, -0.28],
    [0.38, -0.25],
    [-0.35, 0.3],
    [0.36, 0.33]
  ];
  for (const [ox, oy] of offs) {
    activeSpawnedSmallCrystals.push({
      id: crystalDynIdSeq++,
      x: cx + ox,
      y: cy + oy,
      radius: 0.3,
      ...visual
    });
  }
}

function spawnPickableCrystalDropAt(x, y, itemKey) {
  const visual = crystalVisualFromItemKey(itemKey) || crystalVisualFromItemKey('small-blue-crystal [1x1]');
  if (!visual) return;
  activeCrystalDrops.push({
    id: crystalDynIdSeq++,
    x,
    y,
    pickRadius: 0.5,
    age: 0,
    bobSeed: seededHash(Math.floor(x * 10), Math.floor(y * 10), 13291),
    ...visual
  });
}

function spawnCrystalShards(rootOx, rootOy, itemKey, data) {
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return;
  const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return;
  const { rows, cols } = parseShape(objSet.shape);
  const path = TessellationEngine.getImagePath(objSet.file);
  const imgPath = path || null;
  const atlasCols = path && path.includes('caves') ? 50 : 57;
  const tid = base.ids[0];
  const cx = rootOx + cols * 0.5;
  const cy = rootOy + rows * 0.5;
  const seed = data.seed ?? 0;
  for (let i = 0; i < 4; i++) {
    const h1 = seededHash(rootOx + i * 3, rootOy, seed + 91011);
    const h2 = seededHash(rootOx, rootOy + i * 5, seed + 91019);
    const ang = i * (Math.PI * 0.5) + (h1 - 0.5) * 0.55;
    const sp = 1.35 + h2 * 1.85;
    activeCrystalShards.push({
      x: cx + (h1 - 0.5) * 0.08,
      y: cy + (h2 - 0.5) * 0.08,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 0.55,
      tileId: tid,
      cols: atlasCols,
      imgPath,
      age: 0,
      maxAge: 1.15 + h2 * 0.45
    });
  }
}

/**
 * If the tackled cell holds a crystal scatter, remove it and spawn shard particles.
 * @param {import('../player.js').player} player
 * @param {object | null | undefined} data
 */
export function tryBreakCrystalOnPlayerTackle(player, data) {
  if (!player || !data) return;
  let nx = Number(player.tackleDirNx);
  let ny = Number(player.tackleDirNy);
  let len = Math.hypot(nx, ny);
  if (!Number.isFinite(len) || len < 1e-4) {
    nx = 0;
    ny = 1;
    len = 1;
  }
  nx /= len;
  ny /= len;
  const px = player.x ?? 0;
  const py = player.y ?? 0;
  const reach = Math.max(0.2, Number(player._tackleReachTiles) || 2);
  const probeReach = Math.max(0.2, reach - TACKLE_HIT_PROBE_BACKOFF_TILES);
  const ex = px + nx * probeReach;
  const ey = py + ny * probeReach;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  let hit = null;
  let bestT = Infinity;
  const steps = Math.max(2, Math.ceil(probeReach / TACKLE_ORIGIN_SCAN_STEP_TILES));
  const sampledOriginKeys = new Set();
  const originMemo = new Map();
  for (const sc of activeSpawnedSmallCrystals) {
    const ht = segmentCircleFirstHitT(px, py, ex, ey, sc.x, sc.y, Math.max(0.01, sc.radius + TACKLE_SWEEP_RADIUS_TILES));
    if (ht == null) continue;
    if (ht < bestT) {
      bestT = ht;
      hit = { type: 'spawnedSmall', id: sc.id, itemKey: sc.itemKey, x: sc.x, y: sc.y };
    }
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = px + (ex - px) * t;
    const sy = py + (ey - py) * t;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    for (let oy = Math.max(0, iy - 5); oy <= Math.min(microH - 1, iy + 2); oy++) {
      for (let ox = Math.max(0, ix - 8); ox <= Math.min(microW - 1, ix + 2); ox++) {
        const key = `${ox},${oy}`;
        if (sampledOriginKeys.has(key)) continue;
        sampledOriginKeys.add(key);
        const p = scatterPhysicsCircleAtOrigin(ox, oy, data, originMemo);
        if (!p || !String(p.itemKey || '').toLowerCase().includes('crystal')) continue;
        if (isPlayCrystalScatterOriginDestroyed(ox, oy)) continue;
        const rr = Math.max(0.01, p.radius + TACKLE_SWEEP_RADIUS_TILES);
        const ht = segmentCircleFirstHitT(px, py, ex, ey, p.cx, p.cy, rr);
        if (ht == null) continue;
        if (ht < bestT) {
          bestT = ht;
          hit = { type: 'worldCrystal', rootOx: ox, rootOy: oy, itemKey: String(p.itemKey), cx: p.cx, cy: p.cy };
        }
      }
    }
  }
  if (!hit) return;

  if (hit.type === 'spawnedSmall') {
    const idx = activeSpawnedSmallCrystals.findIndex((c) => c.id === hit.id);
    if (idx >= 0) {
      const c = activeSpawnedSmallCrystals[idx];
      activeSpawnedSmallCrystals.splice(idx, 1);
      spawnPickableCrystalDropAt(c.x, c.y, c.itemKey);
      spawnCrystalShards(Math.floor(c.x), Math.floor(c.y), c.itemKey, data);
    }
    return;
  }

  const objSet = OBJECT_SETS[hit.itemKey];
  const shape = objSet ? parseShape(objSet.shape) : { rows: 1, cols: 1 };

  registerDestroyedCrystalOrigin(hit.rootOx, hit.rootOy);
  invalidateChunksOverlappingFootprint(hit.rootOx, hit.rootOy, shape.cols, shape.rows);
  const isLargeCrystal = shape.cols >= 2 && shape.rows >= 2;
  if (isLargeCrystal) {
    spawnSmallCrystalChunksFromLarge(hit.rootOx, hit.rootOy, hit.itemKey);
  } else {
    spawnPickableCrystalDropAt(hit.cx ?? hit.rootOx + 0.5, hit.cy ?? hit.rootOy + 0.5, hit.itemKey);
  }
  spawnCrystalShards(hit.rootOx, hit.rootOy, hit.itemKey, data);
}

/**
 * @param {number} dt
 */
export function updateCrystalShardParticles(dt) {
  if (activeCrystalShards.length === 0) return;
  const g = 9.2;
  const drag = 2.15;
  for (let i = activeCrystalShards.length - 1; i >= 0; i--) {
    const s = activeCrystalShards[i];
    s.age += dt;
    if (s.age >= s.maxAge) {
      activeCrystalShards.splice(i, 1);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += g * dt;
    const damp = Math.exp(-drag * dt);
    s.vx *= damp;
    s.vy *= damp;
  }
}

/**
 * Pick-up update for drops created from broken small crystals.
 * @param {number} dt
 * @param {{ x?: number, y?: number } | null | undefined} player
 */
export function updateCrystalDropsAndPickup(dt, player) {
  const px = Number(player?.x);
  const py = Number(player?.y);
  for (let i = activeCrystalDrops.length - 1; i >= 0; i--) {
    const d = activeCrystalDrops[i];
    d.age = (d.age || 0) + dt;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const dx = px - d.x;
    const dy = py - d.y;
    if (dx * dx + dy * dy <= (d.pickRadius || 0.5) * (d.pickRadius || 0.5)) {
      crystalLootCount += 1;
      activeCrystalDrops.splice(i, 1);
    }
  }
}

export function getCrystalLootCount() {
  return crystalLootCount;
}
