import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape, seededHash } from '../tessellation-logic.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { playItemPickupSfx } from '../audio/item-pickup-sfx.js';
import { playRockSmashingSfx } from '../audio/rock-smashing-sfx.js';
import { setPlayerSpeechBubbleForDetailPickup } from '../social/speech-bubble-state.js';

/** Ground pickup radius for dropped crystal items (tiles). */
const CRYSTAL_DROP_PICK_RADIUS_TILES = 1.35;
const CRYSTAL_DROP_SUCTION_SPEED_TILES = 11.5;
const CRYSTAL_DROP_SUCTION_ACCEL = 26;
const CRYSTAL_DROP_SUCTION_FINISH_RADIUS = 0.18;

/** @typedef {{ x: number, y: number, vx: number, vy: number, tileId: number, cols: number, imgPath: string | null, age: number, maxAge: number }} CrystalShard */

/** @type {CrystalShard[]} */
export const activeCrystalShards = [];
/** Spawned "small crystal" chunks that remain on ground after a large crystal breaks. */
export const activeSpawnedSmallCrystals = [];
/** Pickable drops created after breaking a small crystal chunk. */
export const activeCrystalDrops = [];

let crystalLootCount = 0;
let crystalDynIdSeq = 1;
/** @type {Map<string, number>} */
const collectedDetailInventory = new Map();

export function clearCrystalDropPickupState() {
  activeCrystalShards.length = 0;
  activeSpawnedSmallCrystals.length = 0;
  activeCrystalDrops.length = 0;
  collectedDetailInventory.clear();
  crystalLootCount = 0;
  crystalDynIdSeq = 1;
}

export function isCrystalItemKey(itemKey) {
  return String(itemKey || '').toLowerCase().includes('crystal');
}

export function countSpritesInObjectSet(objSet) {
  if (!objSet?.parts?.length) return 1;
  let n = 0;
  for (const part of objSet.parts) n += Array.isArray(part.ids) ? part.ids.length : 0;
  return Math.max(1, n);
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

function crystalDropVisualFromItemKey(itemKey) {
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet) return null;
  const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  if (!base?.ids?.length) return null;
  const shape = parseShape(objSet.shape);
  const shapeCols = Math.max(1, shape.cols);
  const shapeRows = Math.max(1, shape.rows);
  const shapeCells = shapeCols * shapeRows;
  const allPartIds = [];
  let shapeMatchedPartIds = null;
  if (Array.isArray(objSet.parts)) {
    for (const part of objSet.parts) {
      if (!Array.isArray(part?.ids) || part.ids.length === 0) continue;
      if (!shapeMatchedPartIds && part.ids.length === shapeCells) {
        shapeMatchedPartIds = [...part.ids];
      }
      for (const id of part.ids) allPartIds.push(id);
    }
  }
  const crystalOnly = isCrystalItemKey(itemKey);
  const dropTileIds = crystalOnly
    ? shapeMatchedPartIds || (allPartIds.length === shapeCells ? allPartIds : [...base.ids])
    : allPartIds.length
      ? allPartIds
      : [...base.ids];
  const dropShapeRows = crystalOnly
    ? shapeRows
    : Math.max(shapeRows, Math.ceil(dropTileIds.length / shapeCols));
  const path = TessellationEngine.getImagePath(objSet.file);
  const cols = path && path.includes('caves') ? 50 : 57;
  return {
    itemKey,
    tileId: dropTileIds[0] ?? base.ids[0],
    tileIds: dropTileIds,
    shapeCols,
    shapeRows: dropShapeRows,
    cols,
    imgPath: path || null
  };
}

export function spawnSmallCrystalChunksFromLarge(rootOx, rootOy, itemKey) {
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

export function spawnPickableCrystalDropAt(x, y, itemKey, stackCount = null) {
  const resolvedItemKey = String(itemKey || 'unknown');
  const visual =
    crystalDropVisualFromItemKey(resolvedItemKey) ||
    crystalDropVisualFromItemKey('small-blue-crystal [1x1]') ||
    crystalVisualFromItemKey('small-blue-crystal [1x1]');
  if (!visual) return;
  const objSet = OBJECT_SETS[resolvedItemKey];
  const resolvedStackCount =
    stackCount == null ? countSpritesInObjectSet(objSet) : Math.max(1, Number(stackCount) || 1);
  activeCrystalDrops.push({
    id: crystalDynIdSeq++,
    x,
    y,
    vx: 0,
    vy: 0,
    pickRadius: CRYSTAL_DROP_PICK_RADIUS_TILES,
    stackCount: resolvedStackCount,
    age: 0,
    bobSeed: seededHash(Math.floor(x * 10), Math.floor(y * 10), 13291),
    maxAge: 90,
    collecting: false,
    collectShrink: 0,
    ...visual,
    itemKey: resolvedItemKey
  });
}

/**
 * Break visible crystal pickups in a world-tile radius (Earthquake etc.).
 * @param {number} cx
 * @param {number} cy
 * @param {number} radiusTiles
 * @param {object | null} data
 */
export function shatterCrystalDropsInRadius(cx, cy, radiusTiles, data) {
  if (!data) return;
  const px = Number(cx);
  const py = Number(cy);
  const r = Math.max(0.05, Number(radiusTiles) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  const r2 = r * r;
  for (let i = activeCrystalDrops.length - 1; i >= 0; i--) {
    const d = activeCrystalDrops[i];
    const dx = Number(d.x) - px;
    const dy = Number(d.y) - py;
    if (dx * dx + dy * dy > r2) continue;
    playRockSmashingSfx({ x: d.x, y: d.y });
    spawnCrystalShards(Math.floor(d.x), Math.floor(d.y), String(d.itemKey || 'small-blue-crystal [1x1]'), data);
    activeCrystalDrops.splice(i, 1);
  }
}

export function spawnCrystalShards(rootOx, rootOy, itemKey, data) {
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
 * @param {number} dt
 * @param {{ x?: number, y?: number } | null | undefined} player
 */
export function updateCrystalDropsAndPickup(dt, player) {
  const px = Number(player?.x);
  const py = Number(player?.y);
  for (let i = activeCrystalDrops.length - 1; i >= 0; i--) {
    const d = activeCrystalDrops[i];
    d.age = (d.age || 0) + dt;
    if (d.maxAge && d.age >= d.maxAge) {
      activeCrystalDrops.splice(i, 1);
      continue;
    }
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const dx = px - d.x;
    const dy = py - d.y;
    if (d.collecting) {
      const dist = Math.hypot(dx, dy);
      const nx = dist > 1e-4 ? dx / dist : 0;
      const ny = dist > 1e-4 ? dy / dist : 0;
      const targetSp = Math.min(CRYSTAL_DROP_SUCTION_SPEED_TILES, 3.8 + dist * 7.5);
      const curVx = Number(d.vx) || 0;
      const curVy = Number(d.vy) || 0;
      d.vx = curVx + (nx * targetSp - curVx) * Math.min(1, dt * CRYSTAL_DROP_SUCTION_ACCEL);
      d.vy = curVy + (ny * targetSp - curVy) * Math.min(1, dt * CRYSTAL_DROP_SUCTION_ACCEL);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.collectShrink = Math.min(1, (d.collectShrink || 0) + dt * 5.5);
      if (dist <= CRYSTAL_DROP_SUCTION_FINISH_RADIUS) {
        const stack = Math.max(1, Number(d.stackCount) || 1);
        const key = String(d.itemKey || 'unknown');
        collectedDetailInventory.set(key, (collectedDetailInventory.get(key) || 0) + stack);
        if (isCrystalItemKey(key)) crystalLootCount += stack;
        playItemPickupSfx(player);
        setPlayerSpeechBubbleForDetailPickup(player, key, stack);
        activeCrystalDrops.splice(i, 1);
      }
      continue;
    }
    if (dx * dx + dy * dy <= (d.pickRadius || 1.1) * (d.pickRadius || 1.1)) {
      d.collecting = true;
      d.vx = Number(d.vx) || 0;
      d.vy = Number(d.vy) || 0;
      d.collectShrink = 0;
      continue;
    }
    if (Number(d.vx) || Number(d.vy)) {
      d.vx = (Number(d.vx) || 0) * Math.max(0, 1 - dt * 8);
      d.vy = (Number(d.vy) || 0) * Math.max(0, 1 - dt * 8);
    }
  }
}

export function getCrystalLootCount() {
  return crystalLootCount;
}

/**
 * Collected pickup totals in current play session.
 * @returns {Array<{ itemKey: string, count: number }>}
 */
export function getCollectedDetailInventorySnapshot() {
  const out = [];
  for (const [itemKey, count] of collectedDetailInventory.entries()) {
    out.push({ itemKey, count: Math.max(0, count | 0) });
  }
  out.sort((a, b) => b.count - a.count || a.itemKey.localeCompare(b.itemKey));
  return out;
}

/** `data-inventory-drag` value for the aggregated “Crystal Shards” HUD row. */
export const PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE = '__pkmn_crystal_shards__';

function spendOneUnitForItemKey(itemKey) {
  const key = String(itemKey || '');
  const prev = collectedDetailInventory.get(key) ?? 0;
  if (prev <= 0) return false;
  const next = prev - 1;
  if (next <= 0) collectedDetailInventory.delete(key);
  else collectedDetailInventory.set(key, next);
  if (isCrystalItemKey(key)) crystalLootCount = Math.max(0, (crystalLootCount | 0) - 1);
  return true;
}

/**
 * Removes one inventory unit so it can be spawned as a ground pickup. Crystal HUD uses
 * {@link PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE}: picks a concrete crystal `itemKey` with stock.
 * @param {string} tokenOrItemKey
 * @returns {{ itemKey: string } | null}
 */
export function trySpendOneInventoryUnitForGroundDrop(tokenOrItemKey) {
  const raw = String(tokenOrItemKey || '');
  if (raw === PLAY_INVENTORY_DRAG_CRYSTAL_AGGREGATE) {
    if ((crystalLootCount | 0) <= 0) return null;
    const keys = [];
    for (const [k, c] of collectedDetailInventory.entries()) {
      if ((c | 0) > 0 && isCrystalItemKey(k)) keys.push(String(k));
    }
    keys.sort();
    for (const k of keys) {
      if (spendOneUnitForItemKey(k)) return { itemKey: k };
    }
    return null;
  }
  if (!spendOneUnitForItemKey(raw)) return null;
  return { itemKey: raw };
}
