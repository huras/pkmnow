import { getMicroTile } from './chunking.js';
import { getPlayAnimatedGrassLayers } from './play-grass-eligibility.js';
import { playChunkMap } from './render/play-chunk-cache.js';
import { getRainFireSnuffSeconds } from './main/weather-state.js';

/** Seconds active burn (orange fire look) before switching to charred black. */
export const GRASS_FIRE_BURN_PHASE_SEC = 10;
/** Grass-fire particle lifetime (slightly longer than burn so flames don’t vanish first). */
export const GRASS_FIRE_PARTICLE_SEC = GRASS_FIRE_BURN_PHASE_SEC + 0.85;
/** Full black charred look before regrowth blend begins. */
export const GRASS_FIRE_CHARRED_SOLID_SEC = 2.5;
/** Seconds to blend charred → normal grass (not instant). */
export const GRASS_FIRE_REGROW_BLEND_SEC = 12;
/** How often burning grass attempts to ignite each cardinal neighbor (tile). */
export const GRASS_FIRE_SPREAD_INTERVAL_SEC = 3.5;
/** Base chance to spread to a neighbor from depth-0 (direct projectile) burning grass: 50%. Each transfer hop halves it. */
export const GRASS_FIRE_SPREAD_BASE_CHANCE = 0.5;
/** Max |z| (tiles) for projectile end to count as ground impact. */
const GROUND_Z_MAX = 0.55;

/** Grass fire “health” while burning — water and rain reduce it before the tile goes out. */
export const GRASS_FIRE_HP_MAX = 100;

const FIRE_PROJECTILE_TYPES = new Set([
  'ember',
  'flamethrowerShot',
  'incinerateShard',
  'incinerateCore',
  'lightningStrike',
  /** Beams ground like rain lightning — same grass cycle + rain immunity when flagged lightning-ignited. */
  'thunderShockBeam',
  'thunderBoltArc',
  'fireBlastCore',
  'fireBlastShard',
  'fireSpinBurst'
]);
const WATER_PROJECTILE_TYPES = new Set([
  'waterShot',
  'waterGunShot',
  'waterGunBall',
  'bubbleShot',
  'bubbleBeamShot',
  'waterBurstShot'
]);

/**
 * @typedef {{
 *   phase: 'burning',
 *   phaseEndAt: number,
 *   startedAtMs: number,
 *   ignitedByLightning: boolean,
 *   fireSpreadDepth: number,
 *   fireHp: number,
 *   fireHpMax: number
 * } | { phase: 'charred', startedAtMs: number }} GrassFireTileState
 *
 * `ignitedByLightning` tiles ignore rain and run the full burn → char → regrow cycle,
 * so storm strikes always leave visible scorch marks on grass.
 *
 * `fireSpreadDepth`: 0 = ignited by projectile/lightning; each neighbor transfer adds 1.
 * Spread roll from a tile uses {@link GRASS_FIRE_SPREAD_BASE_CHANCE} * 0.5^depth.
 */

/** @type {Map<string, GrassFireTileState>} */
const tileStates = new Map();

let throttleAccSec = 0;
let spreadAccSec = 0;
const UPDATE_INTERVAL_SEC = 0.12;

/** Cardinal offsets for grass → grass fire spread. */
const GRASS_FIRE_NEIGHBOR_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

function grassFireSpreadChance01(sourceSpreadDepth) {
  const d = Math.max(0, Math.floor(Number(sourceSpreadDepth)) || 0);
  return GRASS_FIRE_SPREAD_BASE_CHANCE * Math.pow(0.5, d);
}

export function clearGrassFireStateForNewMap() {
  tileStates.clear();
  throttleAccSec = 0;
  spreadAccSec = 0;
}

/**
 * While burning or charred, animated grass for this cell is skipped (replaced by scorched overlay).
 */
export function grassFireSuppressesAnimatedGrassAt(mx, my) {
  return tileStates.has(tileKey(mx, my));
}

/** @returns {'burning' | 'charred' | null} */
export function grassFireVisualPhaseAt(mx, my) {
  return tileStates.get(tileKey(mx, my))?.phase ?? null;
}

/**
 * Lists every grass tile currently in the 'burning' phase with its world-center position and
 * the timestamp when it was ignited. Used by the looped fire SFX to assign audio voices.
 * Cheap: O(tileStates.size). `tileStates` is bounded by active fires, so this stays small.
 * @returns {Array<{ id: string, x: number, y: number, startedAtMs: number }>}
 */
export function listActiveGrassFireSources() {
  const out = [];
  for (const [k, st] of tileStates) {
    if (st.phase !== 'burning') continue;
    const c = k.indexOf(',');
    const mx = Number(k.slice(0, c));
    const my = Number(k.slice(c + 1));
    if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;
    out.push({ id: `grass:${k}`, x: mx + 0.5, y: my + 0.5, startedAtMs: st.startedAtMs });
  }
  return out;
}

/**
 * During `charred`: 0 = solid black window, (0,1) = regrowth blend, 1 = fully restored (tile cleared next tick).
 * @returns {number | null} null if not charred
 */
export function grassFireCharredRegrowth01(mx, my) {
  const st = tileStates.get(tileKey(mx, my));
  if (!st || st.phase !== 'charred') return null;
  const elapsed = (performance.now() - st.startedAtMs) / 1000;
  if (elapsed < GRASS_FIRE_CHARRED_SOLID_SEC) return 0;
  const blendT = elapsed - GRASS_FIRE_CHARRED_SOLID_SEC;
  if (blendT >= GRASS_FIRE_REGROW_BLEND_SEC) return 1;
  return blendT / GRASS_FIRE_REGROW_BLEND_SEC;
}

function tileKey(mx, my) {
  return `${mx},${my}`;
}

/** @param {GrassFireTileState} st */
function ensureBurningHp(st) {
  if (st.phase !== 'burning') return;
  const maxHp = GRASS_FIRE_HP_MAX;
  if (!Number.isFinite(st.fireHp) || !Number.isFinite(st.fireHpMax)) {
    st.fireHp = maxHp;
    st.fireHpMax = maxHp;
    return;
  }
  if (st.fireHpMax !== maxHp) {
    const r = st.fireHp / Math.max(1e-6, st.fireHpMax);
    st.fireHpMax = maxHp;
    st.fireHp = Math.min(maxHp, Math.max(0, r * maxHp));
  }
}

/**
 * Maps combat `damage` (when present on the projectile) to grass-fire HP loss.
 * Stronger moves (higher combat numbers, charge tiers) reach or exceed {@link GRASS_FIRE_HP_MAX} in one hit.
 */
function waterExtinguishDamageFromCombatDamage(combatDamage) {
  const d = Number(combatDamage);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.round(10 + d * 9.2);
}

function waterExtinguishDamage(projType, projRef) {
  const fromDmg = waterExtinguishDamageFromCombatDamage(projRef?.damage);

  switch (projType) {
    case 'waterGunBall': {
      const t = Math.max(1, Math.min(3, Number(projRef?.wgTier) || 1));
      const tierFloor = t >= 3 ? GRASS_FIRE_HP_MAX + 120 : t === 2 ? 96 : 52;
      const splash = Number(projRef?.splashDamage);
      const fromSplash =
        Number.isFinite(splash) && splash > 0 ? Math.round(8 + splash * 5.5) : 0;
      return Math.max(tierFloor, fromDmg, fromSplash);
    }
    case 'waterBurstShot':
      return Math.max(44, fromDmg);
    case 'waterShot':
      // Water Burst volley + ultimate ring droplets — scale tightly with per-droplet combat damage.
      return Math.max(28, fromDmg);
    case 'waterGunShot':
      // Hydro Pump stream droplets (low combat damage per hit, but “heavy” water).
      return Math.max(36, fromDmg > 0 ? Math.round(12 + (Number(projRef?.damage) || 0) * 12) : 40);
    case 'bubbleBeamShot':
      return Math.max(22, fromDmg > 0 ? Math.round(8 + (Number(projRef?.damage) || 0) * 8.5) : 34);
    case 'bubbleShot':
      return Math.max(18, fromDmg);
    default:
      return Math.max(22, fromDmg);
  }
}

function tryIgnite(mx, my, data, opts = {}) {
  const getTile = (x, y) => getMicroTile(x, y, data);
  if (!isPlayGrassFlammableInner(mx, my, data, getTile, playChunkMap)) return false;

  const now = performance.now();
  const k = tileKey(mx, my);
  const burnEnd = now + GRASS_FIRE_BURN_PHASE_SEC * 1000;
  const ignitedByLightning = !!opts.ignitedByLightning;
  const incomingDepth = Math.max(0, Math.floor(Number(opts.fireSpreadDepth)) || 0);
  const existing = tileStates.get(k);
  if (existing?.phase === 'burning' && existing.phaseEndAt > now) {
    // Preserve the original ignition time so rain's snuff window stays honest on re-ignite.
    // Lightning immunity is sticky: once a tile is lightning-ignited it stays immune to rain.
    const mergedDepth = Math.min(existing.fireSpreadDepth ?? 0, incomingDepth);
    tileStates.set(k, {
      phase: 'burning',
      phaseEndAt: Math.max(existing.phaseEndAt, burnEnd),
      startedAtMs: existing.startedAtMs,
      ignitedByLightning: !!existing.ignitedByLightning || ignitedByLightning,
      fireSpreadDepth: mergedDepth,
      fireHp: GRASS_FIRE_HP_MAX,
      fireHpMax: GRASS_FIRE_HP_MAX
    });
    return false;
  }
  tileStates.set(k, {
    phase: 'burning',
    phaseEndAt: burnEnd,
    startedAtMs: now,
    ignitedByLightning,
    fireSpreadDepth: incomingDepth,
    fireHp: GRASS_FIRE_HP_MAX,
    fireHpMax: GRASS_FIRE_HP_MAX
  });
  return true;
}

function isPlayGrassFlammableInner(mx, my, data, getTile, playChunkMap) {
  const { base, top } = getPlayAnimatedGrassLayers(mx, my, data, getTile, playChunkMap);
  return base || top;
}

/**
 * @param {object} data map macro data
 * @returns {boolean} true if grass caught fire (caller may spawn FX).
 */
export function grassFireTryIgniteAt(worldX, worldY, projZ, projType, data) {
  if (!data || !FIRE_PROJECTILE_TYPES.has(projType)) return false;
  if (Math.abs(Number(projZ) || 0) > GROUND_Z_MAX) return false;
  const mx = Math.floor(worldX);
  const my = Math.floor(worldY);
  const lightningLike =
    projType === 'lightningStrike' || projType === 'thunderShockBeam' || projType === 'thunderBoltArc';
  return tryIgnite(mx, my, data, { ignitedByLightning: lightningLike, fireSpreadDepth: 0 });
}

/**
 * Apply water damage to grass fire HP (removes tile when HP reaches 0).
 * @param {object | null} [projRef] optional projectile for tiered damage (e.g. Water Gun ball).
 */
export function grassFireTryExtinguishAt(worldX, worldY, projZ, projType, data, projRef = null) {
  if (!data || !WATER_PROJECTILE_TYPES.has(projType)) return false;
  if (Math.abs(Number(projZ) || 0) > GROUND_Z_MAX) return false;
  const mx = Math.floor(worldX);
  const my = Math.floor(worldY);
  const getTile = (x, y) => getMicroTile(x, y, data);
  if (!isPlayGrassFlammableInner(mx, my, data, getTile, playChunkMap)) return false;
  const k = tileKey(mx, my);
  const st = tileStates.get(k);
  if (!st) return false;
  if (st.phase === 'charred') {
    tileStates.delete(k);
    return true;
  }
  if (st.phase !== 'burning') return false;
  ensureBurningHp(st);
  const dmg = waterExtinguishDamage(projType, projRef);
  st.fireHp -= dmg;
  if (st.fireHp <= 0) {
    tileStates.delete(k);
    return true;
  }
  return true;
}

/**
 * @returns {{ hp: number, maxHp: number } | null}
 */
export function grassFireBurningHpAt(mx, my) {
  const st = tileStates.get(tileKey(mx, my));
  if (!st || st.phase !== 'burning') return null;
  ensureBurningHp(st);
  return { hp: st.fireHp, maxHp: st.fireHpMax };
}

/**
 * True while burning and HP is below max (rain or water is “winning”).
 * Lightning-ignited grass ignores rain HP damage — the bar would read like normal weather-snuff
 * fire, so we never show it for those tiles (water still removes the fire when HP hits 0).
 */
export function grassFireExtinguishBarVisibleAt(mx, my) {
  const st = tileStates.get(tileKey(mx, my));
  if (!st || st.phase !== 'burning') return false;
  if (st.ignitedByLightning) return false;
  const v = grassFireBurningHpAt(mx, my);
  if (!v) return false;
  return v.hp < v.maxHp - 0.5;
}

/**
 * Throttled phase transitions (burn uses `phaseEndAt`; charred uses `startedAtMs` + solid + blend duration).
 * @param {number} dt
 * @param {object | null} data map macro data (required for neighbor flammability checks)
 * @param {number} [_playerX]
 * @param {number} [_playerY]
 * @param {(worldX: number, worldY: number) => void} [onNewSpreadIgnite] optional — e.g. spawn `grassFire` particle when a neighbor catches from spread
 */
export function updateGrassFire(dt, data, _playerX, _playerY, onNewSpreadIgnite) {
  const now = performance.now();

  // Rain damages grass fire HP every frame (same time scale as legacy snuff: ~weak..strong sec to kill from full HP).
  // Rain-snuffed tiles skip charred when deleted by HP; natural burn timeout still goes to charred below.
  if (tileStates.size > 0) {
    const snuffSec = getRainFireSnuffSeconds();
    if (Number.isFinite(snuffSec) && snuffSec > 1e-4) {
      const dps = GRASS_FIRE_HP_MAX / snuffSec;
      for (const [k, st] of tileStates) {
        if (st.phase !== 'burning') continue;
        if (st.ignitedByLightning) continue;
        ensureBurningHp(st);
        st.fireHp -= dps * dt;
        if (st.fireHp <= 0) tileStates.delete(k);
      }
    }
  }

  throttleAccSec += dt;
  spreadAccSec += dt;

  if (spreadAccSec >= GRASS_FIRE_SPREAD_INTERVAL_SEC && data && tileStates.size > 0) {
    spreadAccSec = 0;
    const getTile = (x, y) => getMicroTile(x, y, data);
    for (const [k, st] of tileStates) {
      if (st.phase !== 'burning' || now >= st.phaseEndAt) continue;
      const depth = st.fireSpreadDepth ?? 0;
      const p = grassFireSpreadChance01(depth);
      const c = k.indexOf(',');
      const mx = Number(k.slice(0, c));
      const my = Number(k.slice(c + 1));
      if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;
      for (let ni = 0; ni < GRASS_FIRE_NEIGHBOR_DIRS.length; ni++) {
        const nx = mx + GRASS_FIRE_NEIGHBOR_DIRS[ni][0];
        const ny = my + GRASS_FIRE_NEIGHBOR_DIRS[ni][1];
        if (Math.random() >= p) continue;
        const ignited = tryIgnite(nx, ny, data, { fireSpreadDepth: depth + 1, ignitedByLightning: false });
        if (ignited && typeof onNewSpreadIgnite === 'function') {
          onNewSpreadIgnite(nx + 0.5, ny + 0.5);
        }
      }
    }
  }

  if (throttleAccSec < UPDATE_INTERVAL_SEC) return;
  throttleAccSec = 0;

  const charredTotalSec = GRASS_FIRE_CHARRED_SOLID_SEC + GRASS_FIRE_REGROW_BLEND_SEC;
  const entries = [...tileStates.entries()];
  for (const [k, st] of entries) {
    if (st.phase === 'burning') {
      if (now < st.phaseEndAt) continue;
      ensureBurningHp(st);
      if (st.fireHp < st.fireHpMax - 0.5) {
        tileStates.delete(k);
        continue;
      }
      tileStates.set(k, { phase: 'charred', startedAtMs: now });
      continue;
    }
    if (st.phase === 'charred') {
      const elapsed = (now - st.startedAtMs) / 1000;
      if (elapsed >= charredTotalSec) tileStates.delete(k);
    }
  }
}
