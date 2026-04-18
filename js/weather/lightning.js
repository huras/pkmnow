/**
 * Lightning & thunder system — two flavors:
 *   1. In-cloud flashes: bright pulse painted on top of a specific cloud slot (no bolt).
 *   2. Ground strikes: jagged world-space bolt + screen flash; ignites grass / trees at impact.
 *
 * Both are cheap: at most a handful of entries at any time, drawn as a few line segments each.
 *
 * During rain, strikes auto-spawn at a rate that scales with rain intensity. A debug helper
 * (`forceTriggerLightningNearPlayer`) fires one on demand.
 */

import { grassFireTryIgniteAt } from '../play-grass-fire.js';
import { tryApplyFireHitToFormalTreesAt } from '../main/play-crystal-tackle.js';

/** Must match CLOUD_SLOT_STEP_WORLD_TILES in render-debug-world.js (duplicated to avoid import cycles). */
const CLOUD_SLOT_STEP_WORLD_TILES = 10;

const GROUND_BOLT_DURATION_MS = 280;
const CLOUD_FLASH_DURATION_MS = 220;
const SCREEN_FLASH_DURATION_MS = 150;

/** Move-summoned storm cell lifetimes (ms). Short on purpose — “boom and dissipate”. */
const SUMMONED_CLOUD_DURATION_MS = 260;
/** Delay from summoning until the bolt drops (covers the cloud’s grow-in). */
const SUMMONED_CLOUD_BOLT_DELAY_MS = 150;

/** @typedef {'default' | 'yellow'} BoltColorId */

/** @type {Array<{
 *   path: Array<{x:number,y:number}>,
 *   startedAtMs: number,
 *   impactWorldX: number,
 *   impactWorldY: number,
 *   color: BoltColorId
 * }>} */
const groundBolts = [];

/**
 * Transient dark cloud summoned by the Thunder move, sitting above the target for a blink
 * before the yellow bolt drops. Rendered in world-pixel space (camera transform applied)
 * so it reads as a localized storm cell rather than a screen-space overlay.
 * `scale` multiplies the cloud radius (charge level: 0.7 weak, 1.0 mid, 1.55 mega).
 * @type {Array<{
 *   worldX: number,
 *   worldY: number,
 *   createdAtMs: number,
 *   durationMs: number,
 *   color: BoltColorId,
 *   scale: number
 * }>}
 */
const summonedStormCells = [];

/** slotKey `sx,sy` -> startedAtMs */
const cloudFlashes = new Map();

let screenFlashStartMs = 0;
let screenFlashUntilMs = 0;

/** Time until next auto-spawn (seconds). Negative = fire now. */
let autoSpawnCooldownSec = 3;

/** Cheap deterministic PRNG for bolt generation (keeps bolts pixel-stable per frame). */
function boltRand() {
  return Math.random();
}

function clampSlot(n) {
  return Math.round(Number(n) || 0);
}

function pruneExpired(now) {
  // Ground bolts (oldest first — push at end, shift at head).
  while (groundBolts.length > 0 && now - groundBolts[0].startedAtMs > GROUND_BOLT_DURATION_MS) {
    groundBolts.shift();
  }
  if (cloudFlashes.size > 0) {
    for (const [k, startedAt] of cloudFlashes) {
      if (now - startedAt > CLOUD_FLASH_DURATION_MS) cloudFlashes.delete(k);
    }
  }
  while (
    summonedStormCells.length > 0 &&
    now - summonedStormCells[0].createdAtMs > summonedStormCells[0].durationMs
  ) {
    summonedStormCells.shift();
  }
}

/**
 * Spawn an in-cloud flash on a slot near the player. Pure visual — no ignition.
 */
export function spawnInCloudFlashNearPlayer(playerWorldX, playerWorldY) {
  const step = CLOUD_SLOT_STEP_WORLD_TILES;
  const sxCenter = clampSlot((playerWorldX || 0) / step);
  const syCenter = clampSlot((playerWorldY || 0) / step);
  const rx = Math.floor((boltRand() - 0.5) * 6);
  const ry = Math.floor((boltRand() - 0.5) * 6);
  cloudFlashes.set(`${sxCenter + rx},${syCenter + ry}`, performance.now());
}

/**
 * Spawn a full ground strike at an explicit world coord. Triggers ignition on grass + trees.
 * @param {number} worldX
 * @param {number} worldY
 * @param {object | null | undefined} data
 * @param {{ color?: BoltColorId, flashCloudSlot?: boolean }} [opts]
 *   - `color`: palette for the bolt (default = rain-whitish; `'yellow'` for Thunder).
 *   - `flashCloudSlot`: when false, skips the ambient cloud-slot flash — use when the bolt is
 *     coming from a move-summoned storm cell that has its own visible puff and doesn't live
 *     on the procedural cloud grid.
 */
export function spawnGroundStrikeAt(worldX, worldY, data, opts = {}) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;
  const now = performance.now();
  const color = opts.color === 'yellow' ? 'yellow' : 'default';
  const flashCloudSlot = opts.flashCloudSlot !== false;

  // Jagged path from ~22 tiles above impact (always off-screen top) down to the ground point.
  const driftX = (boltRand() - 0.5) * 2.6;
  const startWorldX = worldX + driftX;
  const startWorldY = worldY - 22;
  const segs = 8;
  const path = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const straightX = startWorldX * (1 - t) + worldX * t;
    const straightY = startWorldY * (1 - t) + worldY * t;
    const jitterX = i === 0 || i === segs ? 0 : (boltRand() - 0.5) * 1.1;
    const jitterY = i === 0 || i === segs ? 0 : (boltRand() - 0.5) * 0.4;
    path.push({ x: straightX + jitterX, y: straightY + jitterY });
  }

  groundBolts.push({ path, startedAtMs: now, impactWorldX: worldX, impactWorldY: worldY, color });
  screenFlashStartMs = now;
  screenFlashUntilMs = now + SCREEN_FLASH_DURATION_MS;

  // Also flash the nearest cloud slot so the bolt visually "leaves" a cloud. Skipped for
  // move-summoned strikes (those supply their own transient cloud at the target tile).
  if (flashCloudSlot) {
    const step = CLOUD_SLOT_STEP_WORLD_TILES;
    const sxTop = clampSlot(startWorldX / step);
    const syTop = clampSlot(startWorldY / step);
    cloudFlashes.set(`${sxTop},${syTop}`, now);
  }

  // Ignition. Both helpers short-circuit when projType isn't recognized,
  // so they are safe to call unconditionally — the project-type set opts us in.
  if (data) {
    grassFireTryIgniteAt(worldX, worldY, 0, 'lightningStrike', data);
    tryApplyFireHitToFormalTreesAt(worldX, worldY, 0, 'lightningStrike', data);
  }
}

/**
 * Summon a transient dark cloud at the target tile. Pure visual — it does NOT fire a bolt
 * or damage anything; the caller (moves-manager Thunder move) schedules the bolt + damage
 * separately via `spawnGroundStrikeAt(..., { color: 'yellow', flashCloudSlot: false })`.
 * @param {number} worldX
 * @param {number} worldY
 * @param {{ color?: BoltColorId, durationMs?: number, scale?: number }} [opts]
 *   - `scale`: visual size multiplier for the cloud puff (charge tiers use 0.7 / 1.0 / 1.55).
 */
export function spawnSummonedThunderCloudAt(worldX, worldY, opts = {}) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;
  const scale = Number.isFinite(opts.scale) ? Math.max(0.3, Math.min(2.5, Number(opts.scale))) : 1;
  summonedStormCells.push({
    worldX,
    worldY,
    createdAtMs: performance.now(),
    durationMs: Math.max(80, Number(opts.durationMs) || SUMMONED_CLOUD_DURATION_MS),
    color: opts.color === 'yellow' ? 'yellow' : 'default',
    scale
  });
}

/** Exported so move-side code (e.g. Thunder) keeps its bolt delay in sync with the cloud visual. */
export const SUMMONED_THUNDER_BOLT_DELAY_MS = SUMMONED_CLOUD_BOLT_DELAY_MS;

/**
 * Pick a target near the player and ground-strike it.
 * Keeps the impact in a ring so the player usually sees it without it landing on them.
 */
export function spawnGroundStrikeNearPlayer(playerWorldX, playerWorldY, data) {
  const distTiles = 3 + boltRand() * 6;
  const angle = boltRand() * Math.PI * 2;
  const wx = (playerWorldX || 0) + Math.cos(angle) * distTiles;
  const wy = (playerWorldY || 0) + Math.sin(angle) * distTiles * 0.75;
  spawnGroundStrikeAt(wx, wy, data);
}

/**
 * Debug / UI-triggered strike. Identical to an auto-spawned one but always fires.
 */
export function forceTriggerLightningNearPlayer(playerWorldX, playerWorldY, data) {
  spawnGroundStrikeNearPlayer(playerWorldX, playerWorldY, data);
}

/**
 * Called every frame from the game loop. Handles auto-spawn cadence and expiry.
 * @param {number} dt seconds
 * @param {{rainIntensity:number, playerWorldX:number, playerWorldY:number, data:object|null}} opts
 */
export function tickLightning(dt, opts) {
  const now = performance.now();
  pruneExpired(now);

  const rain = Math.max(0, Math.min(1, Number(opts?.rainIntensity) || 0));

  if (rain >= 0.28) {
    autoSpawnCooldownSec -= dt;
    if (autoSpawnCooldownSec <= 0) {
      // Mean interval: gentle at light rain, dense at max storm. 0.28 → ~9s, 1.0 → ~2.4s.
      const mean = 10 - 7.6 * rain;
      autoSpawnCooldownSec = Math.max(0.8, mean * (0.55 + boltRand() * 0.9));

      // 65% in-cloud flash (mostly ambient), 35% ground strike (rarer, dramatic).
      if (boltRand() < 0.65) {
        spawnInCloudFlashNearPlayer(opts.playerWorldX, opts.playerWorldY);
      } else {
        spawnGroundStrikeNearPlayer(opts.playerWorldX, opts.playerWorldY, opts.data);
      }
    }
  } else {
    autoSpawnCooldownSec = 3;
  }
}

/**
 * Glow multiplier (0..1) to brighten a specific cloud slot if it is currently flashing.
 * Uses a double-peak shape so the flash feels thundery, not just a fade.
 */
export function getCloudSlotGlow(sx, sy) {
  const startedAt = cloudFlashes.get(`${sx | 0},${sy | 0}`);
  if (startedAt == null) return 0;
  const age = performance.now() - startedAt;
  if (age < 0 || age >= CLOUD_FLASH_DURATION_MS) return 0;
  const t = age / CLOUD_FLASH_DURATION_MS;
  // Two-lobe: strong first peak, quick dip, smaller second peak.
  const primary = Math.sin(Math.min(1, t * 3.0) * Math.PI);
  const secondary = t > 0.45 ? Math.sin((t - 0.45) / 0.55 * Math.PI) * 0.55 : 0;
  return Math.max(0, Math.min(1, primary + secondary));
}

/**
 * Palette per bolt color. `outer` = blurred outer stroke, `core` = bright inner line,
 * `shadow` = CanvasRenderingContext2D `shadowColor` for the halo, `impact0..2` = radial
 * gradient stops for the ground-glow disc.
 */
const BOLT_PALETTES = {
  default: {
    outer: '#f6f4ff',
    core: '#ffffff',
    shadow: '#b8c8ff',
    impact0: 'rgba(255,255,235,',
    impact1: 'rgba(200,210,255,',
    impact2: 'rgba(180,190,255,'
  },
  yellow: {
    outer: '#fff79b',
    core: '#fffde0',
    shadow: '#ffd54a',
    impact0: 'rgba(255,247,170,',
    impact1: 'rgba(255,216,60,',
    impact2: 'rgba(255,186,40,'
  }
};

/**
 * Dark, fast-growing puff drawn in world pixels above the impact tile. Rendered with
 * overlapping low-alpha ellipses so no sprite asset is needed.
 */
function drawSummonedStormCell(ctx, cell, now, tileW, tileH) {
  const age = now - cell.createdAtMs;
  if (age < 0 || age >= cell.durationMs) return;
  const t = age / cell.durationMs;
  // Grow-in for the first 22%, hold, then quick fade-out in the last 35%.
  const growIn = Math.min(1, t / 0.22);
  const fadeOut = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
  const alpha = Math.max(0, Math.min(1, growIn * fadeOut));
  if (alpha < 0.01) return;

  const scale = Number.isFinite(cell.scale) ? cell.scale : 1;
  const baseRadiusPx = Math.max(10, tileW * 0.95) * scale;
  const puffs = 5;
  // Cloud hovers ~0.8 tile above the impact so the bolt visibly drops from it.
  const cx = cell.worldX * tileW;
  const cy = (cell.worldY - 0.8) * tileH;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < puffs; i++) {
    const ang = (i / puffs) * Math.PI * 2 + t * 0.8;
    const ox = Math.cos(ang) * baseRadiusPx * 0.55;
    const oy = Math.sin(ang) * baseRadiusPx * 0.28 - baseRadiusPx * 0.04;
    const r = baseRadiusPx * (0.55 + 0.18 * Math.sin(ang * 1.7 + t * 4));
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = '#1a1f2a';
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, r, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dim highlight rim so the puff reads as a storm cell, not a shadow.
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle = '#3c4458';
  ctx.beginPath();
  ctx.ellipse(cx, cy - baseRadiusPx * 0.1, baseRadiusPx * 0.9, baseRadiusPx * 0.42, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw all active lightning: bolts in world pixels, screen flash in screen pixels.
 * Call with the same ctx used for env effects (camera transform already applied).
 */
export function drawLightning(ctx, opts) {
  const { cw, ch, tileW, tileH } = opts;
  const now = performance.now();

  for (const cell of summonedStormCells) {
    drawSummonedStormCell(ctx, cell, now, tileW, tileH);
  }

  for (const bolt of groundBolts) {
    const age = now - bolt.startedAtMs;
    if (age >= GROUND_BOLT_DURATION_MS) continue;
    const t = age / GROUND_BOLT_DURATION_MS;
    // Fast-in, fast-out flicker with double intensity dip.
    const flicker = 1 - t;
    const alpha = Math.max(0, flicker * (0.55 + 0.45 * Math.abs(Math.cos(t * 16))));
    const lineW = Math.max(1.6, Math.min(4.5, tileW * 0.14 * flicker));
    const pal = BOLT_PALETTES[bolt.color] || BOLT_PALETTES.default;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = pal.outer;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lineW;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = pal.shadow;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let i = 0; i < bolt.path.length; i++) {
      const p = bolt.path[i];
      const px = p.x * tileW;
      const py = p.y * tileH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Bright inner core.
    ctx.lineWidth = Math.max(0.8, lineW * 0.4);
    ctx.strokeStyle = pal.core;
    ctx.globalAlpha = alpha * 0.95;
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Impact ground-glow disc.
    const ix = bolt.impactWorldX * tileW;
    const iy = bolt.impactWorldY * tileH;
    const rad = (10 + t * 14) * Math.max(1, tileW / 16);
    const grad = ctx.createRadialGradient(ix, iy, 0, ix, iy, rad);
    grad.addColorStop(0, `${pal.impact0}${0.9 * flicker})`);
    grad.addColorStop(0.6, `${pal.impact1}${0.3 * flicker})`);
    grad.addColorStop(1, `${pal.impact2}0)`);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ix, iy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (now < screenFlashUntilMs) {
    const age = now - screenFlashStartMs;
    const t = Math.max(0, Math.min(1, age / SCREEN_FLASH_DURATION_MS));
    // Quick peak at t≈0.15 then fade.
    const env = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
    const a = 0.55 * env;
    if (a > 0.002) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 255, 245, 1)';
      ctx.globalAlpha = a;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
  }
}

/** Nuke all active effects (for map transitions / reset). */
export function clearLightningState() {
  groundBolts.length = 0;
  cloudFlashes.clear();
  summonedStormCells.length = 0;
  screenFlashStartMs = 0;
  screenFlashUntilMs = 0;
  autoSpawnCooldownSec = 3;
}
