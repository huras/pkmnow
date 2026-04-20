import { playPokemonCry } from '../pokemon/pokemon-cries.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';
import { markWildFarCryMinimapIntroduced } from '../wild-pokemon/wild-minimap-species-known.js';
import { MACRO_TILE_STRIDE } from '../chunking.js';

/** Time until the first auto Far Cry attempt after `resetFarCrySystem`. */
const FAR_CRY_GAP_BEFORE_1ST_SEC = 3;
/** After 1st successful cry, wait this long before the 2nd attempt. */
const FAR_CRY_GAP_AFTER_1ST_SEC = 15;
/** After 2nd successful cry, wait this long before the 3rd attempt. */
const FAR_CRY_GAP_AFTER_2ND_SEC = 20;
/** From 4th cry onward: 15s, 30s, 15s, 30s, … (4th uses 15s). */
const FAR_CRY_ALT_SHORT_SEC = 15;
const FAR_CRY_ALT_LONG_SEC = 30;

const FAR_CRY_WAVE_MAX_AGE_SEC = 2.2;
const FAR_CRY_MINIMAP_ECHO_MAX_AGE_SEC = 2.6;
/** Same cap as minimap portrait markers — pick among nearest unknowns. */
const FAR_CRY_CANDIDATE_POOL = 24;

/**
 * Tweak in devtools without rebuild, e.g. `import { farCryRevealTuning } from '...'; farCryRevealTuning.perRevealedQuestionMarkMult = 0.65`.
 * When there is no `?` yet on the minimap (no unknown has `minimapFarCryIntroduced`), new reveals always roll success.
 * Otherwise chance of picking a **new** intro this tick is:
 * `newRevealBaseChanceWhenMarksOnMap * perRevealedQuestionMarkMult ** (count of revealed ? on map)`.
 */
export const farCryRevealTuning = {
  newRevealBaseChanceWhenMarksOnMap: 0.75,
  perRevealedQuestionMarkMult: 0.5
};

/** @type {Array<{ x: number, y: number, age: number, maxAge: number }>} */
const activeFarCryMinimapEchoes = [];
/** @type {Array<{ dirX: number, dirY: number, age: number, maxAge: number, seed: number }>} */
const activeFarCryScreenWaves = [];

let farCryNextTriggerSec = 0;
/** Successful Far Cry emissions since last reset; drives interval schedule and first-three guaranteed new intros. */
let farCrySuccessCount = 0;
/** Seconds until the next auto attempt; on failure we retry after this same gap. */
let farCryPendingIntervalSec = FAR_CRY_GAP_BEFORE_1ST_SEC;
/** Rotates through pending (not yet on minimap) picks in compass order. */
let farCryPendingCycleIndex = 0;
/** Rotates through already-introduced `?` picks when a new intro is rolled off. */
let farCryDoneCycleIndex = 0;

/**
 * After a successful emission, `successCount` is already incremented (1 = just finished 1st cry).
 * @param {number} successCount
 */
function getDelayAfterEmission(successCount) {
  if (successCount === 1) return FAR_CRY_GAP_AFTER_1ST_SEC;
  if (successCount === 2) return FAR_CRY_GAP_AFTER_2ND_SEC;
  if (successCount === 3) return FAR_CRY_ALT_SHORT_SEC;
  if (successCount >= 4) return (successCount - 4) % 2 === 0 ? FAR_CRY_ALT_LONG_SEC : FAR_CRY_ALT_SHORT_SEC;
  return FAR_CRY_GAP_BEFORE_1ST_SEC;
}

function applyNextFarCryTimerAfterAttempt(success) {
  if (success) {
    farCryPendingIntervalSec = getDelayAfterEmission(farCrySuccessCount);
  }
  farCryNextTriggerSec = farCryPendingIntervalSec;
}

function normalize2(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Unknown + already shown as `?` on minimap (matches render-minimap gate). */
function countRevealedMinimapQuestionMarks() {
  let n = 0;
  for (const e of entitiesByKey.values()) {
    if (!e || e.isDespawning || e.deadState) continue;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
    if (e.minimapSpeciesKnown === true) continue;
    if (e.minimapFarCryIntroduced) n++;
  }
  return n;
}

function probabilityNewMinimapIntroThisTick(revealedQuestionMarkCount) {
  if (revealedQuestionMarkCount <= 0) return 1;
  const t = farCryRevealTuning;
  const rawB = Number(t.newRevealBaseChanceWhenMarksOnMap);
  const rawM = Number(t.perRevealedQuestionMarkMult);
  const base = Number.isFinite(rawB) ? rawB : 0.75;
  const mult = Number.isFinite(rawM) ? rawM : 0.5;
  return Math.max(0, Math.min(1, base * mult ** revealedQuestionMarkCount));
}

/**
 * Unknown-only pool (minimap “?” rule). Cycles in compass order.
 * New minimap intros are gated by {@link farCryRevealTuning}; on miss, picks an already-introduced `?` in range if any.
 * @param {number} playerX
 * @param {number} playerY
 * @param {boolean} [forceGuaranteedNewReveal] first three schedule slots: always pick pending when any exist in pool
 */
function pickFarCryCandidate(playerX, playerY, forceGuaranteedNewReveal = false) {
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
  if (!pending.length && !done.length) return null;
  if (!pending.length) {
    const idx = farCryDoneCycleIndex % done.length;
    farCryDoneCycleIndex++;
    return done[idx].entity;
  }
  if (!done.length) {
    if (forceGuaranteedNewReveal) {
      const idx = farCryPendingCycleIndex % pending.length;
      farCryPendingCycleIndex++;
      return pending[idx].entity;
    }
    const revealedQm = countRevealedMinimapQuestionMarks();
    const pNew = probabilityNewMinimapIntroThisTick(revealedQm);
    if (Math.random() >= pNew) return null;
    const idx = farCryPendingCycleIndex % pending.length;
    farCryPendingCycleIndex++;
    return pending[idx].entity;
  }
  if (forceGuaranteedNewReveal) {
    const idx = farCryPendingCycleIndex % pending.length;
    farCryPendingCycleIndex++;
    return pending[idx].entity;
  }
  const revealedQm = countRevealedMinimapQuestionMarks();
  const pNew = probabilityNewMinimapIntroThisTick(revealedQm);
  if (Math.random() < pNew) {
    const idx = farCryPendingCycleIndex % pending.length;
    farCryPendingCycleIndex++;
    return pending[idx].entity;
  }
  const idx = farCryDoneCycleIndex % done.length;
  farCryDoneCycleIndex++;
  return done[idx].entity;
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
 * @param {{ forceGuaranteedNewReveal?: boolean } | undefined} [opts]
 * @returns {boolean}
 */
function tryEmitFarCry(player, opts = {}) {
  if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  const force = !!opts.forceGuaranteedNewReveal;
  const candidate = pickFarCryCandidate(px, py, force);
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
  farCryPendingCycleIndex = 0;
  farCryDoneCycleIndex = 0;
  farCrySuccessCount = 0;
  farCryPendingIntervalSec = FAR_CRY_GAP_BEFORE_1ST_SEC;
  farCryNextTriggerSec = FAR_CRY_GAP_BEFORE_1ST_SEC;
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
  const forceNew = farCrySuccessCount < 3;
  const ok = tryEmitFarCry(player, { forceGuaranteedNewReveal: forceNew });
  if (ok) farCrySuccessCount++;
  applyNextFarCryTimerAfterAttempt(ok);
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
  const forceNew = farCrySuccessCount < 3;
  const ok = tryEmitFarCry(player, { forceGuaranteedNewReveal: forceNew });
  if (ok) {
    farCrySuccessCount++;
    applyNextFarCryTimerAfterAttempt(true);
  }
  return ok;
}

export function getActiveFarCryScreenWaves() {
  return activeFarCryScreenWaves;
}

export function getActiveFarCryMinimapEchoes() {
  return activeFarCryMinimapEchoes;
}

resetFarCrySystem();
