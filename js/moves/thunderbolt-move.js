/**
 * Thunderbolt — charge-tiered yellow lightning that arcs from the caster toward the aim
 * point. Tiers map to the global 4-segment charge meter (`play-charge-levels.js`):
 *   - **L1 (tap / quick release):** one short, shallow arc — a quick jab.
 *   - **L2 (first full bar+):** standard single arc — full range, classic Thunderbolt feel.
 *   - **L3 (third bar+):** *split path* — two sequential arcs (caster → elbow → target)
 *     so the bolt visibly “hops” farther through the air before grounding.
 *   - **L4 (fourth bar / max):** same primary as L3, then **chain jumps** on a short delay:
 *     up to two extra arcs leap from the previous endpoint toward the nearest wild Pokémon
 *     or tree trunk within search radius (trees read as “lightning seeks height”).
 *
 * Collision for every segment remains chord-based (same as psybeam / Thundershock). L3–L4
 * share one `Set` across primary segments so the same wild isn’t tagged twice by the
 * elbow split; chain hops reuse that set plus an exclusion list per hop.
 *
 * @see {@link module:main/play-charge-levels} for `CHARGE_LEVEL_BAR_COUNT` and segment layout.
 */

import {
  clampFloorAimToMaxRange,
  spawnAlongHypotTowardGround
} from './projectile-ground-hypot.js';
import { getPokemonHurtboxCenterWorldXY } from '../pokemon/pokemon-combat-hurtbox.js';
import { formalTreeTrunkBlocksWorldPoint, scatterTreeTrunkBlocksWorldPoint } from '../walkability.js';

/** @typedef {1 | 2 | 3 | 4} ThunderboltLevel */

/** Max world-tile reach at level 2 baseline (L1 scales down; L3+ scale up). */
export const THUNDERBOLT_MAX_RANGE_TILES = 9;

/** Baseline per-segment lifetime (seconds); scaled slightly per tier in config. */
export const THUNDERBOLT_TTL_SEC = 0.22;

export const THUNDERBOLT_ARC_PEAK_FACTOR = 0.3;
export const THUNDERBOLT_ARC_PEAK_MIN_TILES = 0.9;

/** Cooldown (seconds) after a player Thunderbolt, by cast tier. */
export const PLAYER_THUNDERBOLT_COOLDOWN_BY_LEVEL = {
  1: 0.48,
  2: 0.7,
  3: 0.88,
  4: 1.05
};

const CHAIN_HOP_DELAY_MS = 155;
const CHAIN_SEARCH_RADIUS_TILES = 4.2;

/**
 * @type {Record<ThunderboltLevel, {
 *   maxRangeMul: number,
 *   peakFactor: number,
 *   peakMin: number,
 *   damage: number,
 *   ttlMul: number,
 *   halfWidth: number,
 *   splitAtT: number | null,
 *   chainHops: number
 * }>}
 */
const THUNDERBOLT_LEVEL_CONFIG = {
  1: {
    maxRangeMul: 0.78,
    peakFactor: 0.2,
    peakMin: 0.55,
    damage: 12,
    ttlMul: 0.92,
    halfWidth: 0.3,
    splitAtT: null,
    chainHops: 0
  },
  2: {
    maxRangeMul: 1,
    peakFactor: THUNDERBOLT_ARC_PEAK_FACTOR,
    peakMin: THUNDERBOLT_ARC_PEAK_MIN_TILES,
    damage: 20,
    ttlMul: 1,
    halfWidth: 0.35,
    splitAtT: null,
    chainHops: 0
  },
  3: {
    maxRangeMul: 1.12,
    peakFactor: 0.44,
    peakMin: 1.05,
    damage: 26,
    ttlMul: 1.06,
    halfWidth: 0.38,
    splitAtT: 0.52,
    chainHops: 0
  },
  4: {
    maxRangeMul: 1.12,
    peakFactor: 0.48,
    peakMin: 1.08,
    damage: 28,
    ttlMul: 1.08,
    halfWidth: 0.4,
    splitAtT: 0.52,
    chainHops: 2
  }
};

/** Geometry for short chain hops (damage comes from the pending job). */
const CHAIN_SEGMENT_CFG = {
  maxRangeMul: 1,
  peakFactor: 0.36,
  peakMin: 0.82,
  damage: 10,
  ttlMul: 0.94,
  halfWidth: 0.34,
  splitAtT: null,
  chainHops: 0
};

/** @type {Array<{
 *   fireAtMs: number,
 *   fromX: number,
 *   fromY: number,
 *   hopsLeft: number,
 *   chainDamage: number,
 *   excludedWild: Set<object>,
 *   sourceEntity: object | null,
 *   fromWild: boolean,
 *   pushProjectile: (p: object) => void,
 *   sharedHitWild: Set<object>,
 *   maxRangePerHop: number
 * }>} */
const pendingChains = [];

function clampThunderboltLevel(n) {
  const v = Math.floor(Number(n) || 1);
  if (v <= 1) return 1;
  if (v >= 4) return 4;
  return /** @type {ThunderboltLevel} */ (v);
}

/**
 * @param {number} fromX
 * @param {number} fromY
 * @param {Iterable<object> | null | undefined} wildList
 * @param {object | null} data
 * @param {Set<object>} excludedWild
 * @param {object | null} sourceEntity
 * @param {number} maxR
 * @returns {{ x: number, y: number, wild: object | null } | null}
 */
function findNearestChainJumpTarget(fromX, fromY, wildList, data, excludedWild, sourceEntity, maxR) {
  let bestX = 0;
  let bestY = 0;
  let bestWild = /** @type {object | null} */ (null);
  let bestD = maxR;
  const list = wildList ? (Array.isArray(wildList) ? wildList : [...wildList]) : [];
  for (const wild of list) {
    if (!wild || wild === sourceEntity) continue;
    if (excludedWild.has(wild)) continue;
    const px = wild.visualX ?? wild.x;
    const py = wild.visualY ?? wild.y;
    const dex = wild.dexId ?? 1;
    const { hx, hy } = getPokemonHurtboxCenterWorldXY(px, py, dex);
    const d = Math.hypot(hx - fromX, hy - fromY);
    if (d < bestD) {
      bestD = d;
      bestX = hx;
      bestY = hy;
      bestWild = wild;
    }
  }
  if (data) {
    const ix = Math.floor(fromX);
    const iy = Math.floor(fromY);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const tx = ix + dx + 0.5;
        const ty = iy + dy + 0.5;
        if (
          formalTreeTrunkBlocksWorldPoint(tx, ty, data, 1) ||
          scatterTreeTrunkBlocksWorldPoint(tx, ty, data, 1)
        ) {
          const d = Math.hypot(tx - fromX, ty - fromY);
          if (d < bestD) {
            bestD = d;
            bestX = tx;
            bestY = ty;
            bestWild = null;
          }
        }
      }
    }
  }
  if (bestD >= maxR - 1e-4) return null;
  return { x: bestX, y: bestY, wild: bestWild };
}

/**
 * @param {object} cfg row from THUNDERBOLT_LEVEL_CONFIG or chain shape
 */
function pushThunderBoltArcSegment(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild, pushProjectile, cfg, maxRangeTiles, damage, sharedHitWild } = opts;
  const dmg = damage != null ? damage : cfg.damage;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.04;
  const { dirX, dirY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxRangeTiles);
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, sourceX + dirX * dist0, sourceY + dirY * dist0, 0.44);
  const beamEndX = sourceX + dirX * dist0;
  const beamEndY = sourceY + dirY * dist0;
  const chordLen = Math.max(0.01, dist0);
  const arcPeakZ = Math.max(cfg.peakMin, chordLen * cfg.peakFactor);
  const ttl = THUNDERBOLT_TTL_SEC * cfg.ttlMul;
  const hitSet = sharedHitWild || new Set();
  pushProjectile({
    type: 'thunderBoltArc',
    x: (sp.startX + beamEndX) * 0.5,
    y: (sp.startY + beamEndY) * 0.5,
    vx: 0,
    vy: 0,
    vz: 0,
    z: sp.startZ,
    radius: 0.3,
    beamStartX: sp.startX,
    beamStartY: sp.startY,
    beamStartZ: sp.startZ,
    beamEndX,
    beamEndY,
    arcPeakZ,
    beamHalfWidth: cfg.halfWidth,
    timeToLive: ttl,
    beamTtlMax: ttl,
    damage: dmg,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    hasTackleTrait: false,
    trailAcc: null,
    psyHitWild: hitSet,
    psyHitDetails: new Set(),
    playerBeamHitDone: false,
    jagSeed: (Math.random() * 0xffffff) | 0
  });
  return { endX: beamEndX, endY: beamEndY };
}

/**
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} targetX
 * @param {number} targetY
 * @param {object|null} sourceEntity
 * @param {{ level: number, fromWild?: boolean, pushProjectile: (p: object) => void, data?: object | null }} opts
 */
export function castThunderboltAtLevel(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile, level: levelIn, data = null } = opts;
  const level = fromWild ? 2 : clampThunderboltLevel(levelIn);
  const cfg = THUNDERBOLT_LEVEL_CONFIG[level];
  const baseMax = fromWild ? 7 : THUNDERBOLT_MAX_RANGE_TILES;
  const maxRangeTiles = baseMax * cfg.maxRangeMul;

  const { dirX, dirY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxRangeTiles);
  const ex = sourceX + dirX * dist0;
  const ey = sourceY + dirY * dist0;

  const sharedSet = new Set();

  if (cfg.splitAtT != null && cfg.splitAtT > 0 && cfg.splitAtT < 1) {
    const t = cfg.splitAtT;
    const mx = sourceX + (ex - sourceX) * t;
    const my = sourceY + (ey - sourceY) * t;
    const len1 = Math.hypot(mx - sourceX, my - sourceY) + 0.08;
    const len2 = Math.hypot(ex - mx, ey - my) + 0.08;
    pushThunderBoltArcSegment(sourceX, sourceY, mx, my, sourceEntity, {
      fromWild,
      pushProjectile,
      cfg,
      maxRangeTiles: len1,
      damage: cfg.damage,
      sharedHitWild: sharedSet
    });
    pushThunderBoltArcSegment(mx, my, ex, ey, sourceEntity, {
      fromWild,
      pushProjectile,
      cfg,
      maxRangeTiles: len2,
      damage: cfg.damage,
      sharedHitWild: sharedSet
    });
  } else {
    pushThunderBoltArcSegment(sourceX, sourceY, ex, ey, sourceEntity, {
      fromWild,
      pushProjectile,
      cfg,
      maxRangeTiles,
      damage: cfg.damage,
      sharedHitWild: sharedSet
    });
  }

  if (!fromWild && cfg.chainHops > 0) {
    const chainDamage = Math.max(4, Math.round(cfg.damage * 0.52));
    const maxRangePerHop = Math.min(6.5, baseMax * 0.92);
    pendingChains.push({
      fireAtMs: performance.now() + CHAIN_HOP_DELAY_MS,
      fromX: ex,
      fromY: ey,
      hopsLeft: cfg.chainHops,
      chainDamage,
      excludedWild: new Set(),
      sourceEntity,
      fromWild: false,
      pushProjectile,
      sharedHitWild: sharedSet,
      maxRangePerHop,
      data
    });
  }
}

/**
 * Resolve queued chain hops (call each frame from moves-manager with the live wild list).
 * @param {Iterable<object>} wildPokemonList
 * @param {object | null} data
 * @param {object | null} sourceEntity  player ref for chain segments
 */
export function tickThunderboltChains(wildPokemonList, data, sourceEntity) {
  if (pendingChains.length === 0) return;
  const now = performance.now();
  const wildList = Array.isArray(wildPokemonList) ? wildPokemonList : wildPokemonList ? [...wildPokemonList] : [];
  for (let i = pendingChains.length - 1; i >= 0; i--) {
    const job = pendingChains[i];
    if (now < job.fireAtMs) continue;

    const tgt = findNearestChainJumpTarget(
      job.fromX,
      job.fromY,
      wildList,
      job.data ?? data,
      job.excludedWild,
      sourceEntity,
      CHAIN_SEARCH_RADIUS_TILES
    );
    if (!tgt) {
      pendingChains.splice(i, 1);
      continue;
    }
    if (tgt.wild) job.excludedWild.add(tgt.wild);

    const chainCfg = { ...CHAIN_SEGMENT_CFG, damage: job.chainDamage };
    pushThunderBoltArcSegment(job.fromX, job.fromY, tgt.x, tgt.y, sourceEntity, {
      fromWild: job.fromWild,
      pushProjectile: job.pushProjectile,
      cfg: chainCfg,
      maxRangeTiles: job.maxRangePerHop,
      damage: job.chainDamage,
      sharedHitWild: job.sharedHitWild
    });

    job.hopsLeft -= 1;
    if (job.hopsLeft <= 0) {
      pendingChains.splice(i, 1);
    } else {
      job.fromX = tgt.x;
      job.fromY = tgt.y;
      job.fireAtMs = now + CHAIN_HOP_DELAY_MS;
    }
  }
}

/** Clear pending chain hops (map unload / debug resets). */
export function clearThunderboltChains() {
  pendingChains.length = 0;
}
