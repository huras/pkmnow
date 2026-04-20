import { playPokemonCry } from '../pokemon/pokemon-cries.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';
import { markWildFarCryMinimapIntroduced } from '../wild-pokemon/wild-minimap-species-known.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';

/** Seconds between automatic Far Cry attempts (still skips if no eligible unknown). */
const FAR_CRY_TRIGGER_INTERVAL_SEC = 12;
const FAR_CRY_WAVE_MAX_AGE_SEC = 2.2;
const FAR_CRY_MINIMAP_ECHO_MAX_AGE_SEC = 2.6;
/** Same cap as minimap portrait markers — pick among nearest unknowns. */
const FAR_CRY_CANDIDATE_POOL = 24;

/** @type {Array<{ x: number, y: number, age: number, maxAge: number }>} */
const activeFarCryMinimapEchoes = [];
/** @type {Array<{ dirX: number, dirY: number, age: number, maxAge: number, seed: number }>} */
const activeFarCryScreenWaves = [];

let farCryNextTriggerSec = 0;
/** Rotates through eligible unknowns (angle-ordered) so auto Far Cry “scans” around the player. */
let farCryCycleIndex = 0;

function scheduleNextFarCry() {
  farCryNextTriggerSec = FAR_CRY_TRIGGER_INTERVAL_SEC;
}

function normalize2(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/**
 * Unknown-only pool (minimap “?” rule). Cycles in compass order, preferring wilds not yet
 * introduced on the minimap via Far Cry (`entity.minimapFarCryIntroduced`).
 * @param {number} playerX
 * @param {number} playerY
 */
function pickFarCryCandidate(playerX, playerY) {
  const px = Number(playerX) || 0;
  const py = Number(playerY) || 0;
  const pxMacro = px / MACRO_TILE_STRIDE;
  const pyMacro = py / MACRO_TILE_STRIDE;
  /** @type {Array<{ entity: any, d: number, angle: number }>} */
  const pool = [];
  for (const e of entitiesByKey.values()) {
    if (!e || e.isDespawning || e.deadState) continue;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
    if (e.minimapSpeciesKnown === true) continue;
    const ex = Number(e.x) || 0;
    const ey = Number(e.y) || 0;
    const mx = ex / MACRO_TILE_STRIDE;
    const my = ey / MACRO_TILE_STRIDE;
    const distSqMacro = (mx - pxMacro) ** 2 + (my - pyMacro) ** 2;
    const angle = Math.atan2(ey - py, ex - px);
    pool.push({ entity: e, d: distSqMacro, angle });
  }
  if (!pool.length) return null;
  pool.sort((a, b) => a.d - b.d);
  const top = pool.slice(0, Math.min(FAR_CRY_CANDIDATE_POOL, pool.length));
  const pending = top.filter((p) => !p.entity.minimapFarCryIntroduced);
  const done = top.filter((p) => !!p.entity.minimapFarCryIntroduced);
  pending.sort((a, b) => a.angle - b.angle);
  done.sort((a, b) => a.angle - b.angle);
  const ordered = pending.length ? [...pending, ...done] : done;
  if (!ordered.length) return null;
  const idx = farCryCycleIndex % ordered.length;
  farCryCycleIndex++;
  return ordered[idx]?.entity || null;
}

/**
 * @param {any} entity
 * @param {number} playerX
 * @param {number} playerY
 */
function triggerFarCryFromEntity(entity, playerX, playerY) {
  const ex = Number(entity?.x) || 0;
  const ey = Number(entity?.y) || 0;
  const dx = ex - playerX;
  const dy = ey - playerY;
  const dir = normalize2(dx, dy);
  markWildFarCryMinimapIntroduced(entity);
  playPokemonCry(entity?.dexId ?? 1, {
    lane: 'emotion',
    minGapSec: 0.01,
    envelope: {
      volumeFrom: 0.48,
      volumeTo: 0.56,
      rateFrom: 0.97,
      rateTo: 1.02,
      fallbackDurationSec: 1.0
    }
  });
  activeFarCryScreenWaves.push({
    dirX: dir.x,
    dirY: dir.y,
    age: 0,
    maxAge: FAR_CRY_WAVE_MAX_AGE_SEC,
    seed: ((ex * 0.173 + ey * 0.289) % 1 + 1) % 1
  });
  activeFarCryMinimapEchoes.push({
    x: ex / MACRO_TILE_STRIDE,
    y: ey / MACRO_TILE_STRIDE,
    age: 0,
    maxAge: FAR_CRY_MINIMAP_ECHO_MAX_AGE_SEC
  });
}

/**
 * Single emission path: HUD button and auto timer both use this.
 * @param {{ x: number, y: number } | null | undefined} player
 * @returns {boolean}
 */
function tryEmitFarCry(player) {
  if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  const candidate = pickFarCryCandidate(px, py);
  if (!candidate) return false;
  triggerFarCryFromEntity(candidate, px, py);
  return true;
}

/**
 * @param {number} dt
 */
function ageFarCryEffects(dt) {
  const d = Math.max(0, Number(dt) || 0);
  for (let i = activeFarCryScreenWaves.length - 1; i >= 0; i--) {
    const fx = activeFarCryScreenWaves[i];
    fx.age += d;
    if (fx.age >= fx.maxAge) activeFarCryScreenWaves.splice(i, 1);
  }
  for (let i = activeFarCryMinimapEchoes.length - 1; i >= 0; i--) {
    const fx = activeFarCryMinimapEchoes[i];
    fx.age += d;
    if (fx.age >= fx.maxAge) activeFarCryMinimapEchoes.splice(i, 1);
  }
}

export function resetFarCrySystem() {
  activeFarCryScreenWaves.length = 0;
  activeFarCryMinimapEchoes.length = 0;
  farCryCycleIndex = 0;
  scheduleNextFarCry();
}

/**
 * @param {number} dt
 * @param {{ x: number, y: number } | null | undefined} player
 * @param {object | null | undefined} data
 */
export function updateFarCrySystem(dt, player, data) {
  ageFarCryEffects(dt);
  if (!data || !player) return;
  if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return;
  const d = Math.max(0, Number(dt) || 0);
  farCryNextTriggerSec -= d;
  if (farCryNextTriggerSec > 0) return;
  tryEmitFarCry(player);
  scheduleNextFarCry();
}

/**
 * Manual trigger (HUD) — same pick + emit as {@link updateFarCrySystem}.
 * @param {{ x: number, y: number } | null | undefined} player
 * @param {object | null | undefined} data
 * @returns {boolean} true when a far cry was emitted
 */
export function triggerNextFarCryNow(player, data) {
  if (!data || !player) return false;
  if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
  const ok = tryEmitFarCry(player);
  if (!ok) scheduleNextFarCry();
  return ok;
}

export function getActiveFarCryScreenWaves() {
  return activeFarCryScreenWaves;
}

export function getActiveFarCryMinimapEchoes() {
  return activeFarCryMinimapEchoes;
}

resetFarCrySystem();
