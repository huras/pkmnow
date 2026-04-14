import { getPokemonConfig } from './pokemon-config.js';
import { PROJECTILE_Z_HIT_TOLERANCE_TILES } from '../moves/move-constants.js';
import { PMD_MON_SHEET } from './pmd-default-timing.js';

const DEFAULT_HEIGHT_TILES = 1.1;

/** Extra world-z (tiles) below feet included in the vertical hurtbox (low shots / ground splash). */
export const POKEMON_HURTBOX_Z_PAD_FEET = 0.22;

/** Extra world-z (tiles) above `feetZ + heightTiles` (sprite top / puff overlap). */
export const POKEMON_HURTBOX_Z_PAD_HEAD = 0.32;

/** Scales {@link PROJECTILE_Z_HIT_TOLERANCE_TILES} for soft edges on the hurtbox Z interval. */
export const POKEMON_HURTBOX_Z_EDGE_MUL = 0.35;

/**
 * @param {number} dexId
 * @returns {number} `heightTiles` from species config (not the same as physics / walk collider).
 */
export function getPokemonHeightTilesForHurtbox(dexId) {
  const cfg = getPokemonConfig(dexId);
  const h = cfg?.heightTiles;
  if (Number.isFinite(h) && h > 0) return Math.max(0.35, h);
  return DEFAULT_HEIGHT_TILES;
}

/**
 * Horizontal radius (tiles) for **damage** only — scales with `heightTiles`.
 * World movement / terrain collision still use their own radii (`player.js` etc.).
 *
 * @param {number} dexId
 */
export function getPokemonHurtboxRadiusTiles(dexId) {
  const h = getPokemonHeightTilesForHurtbox(dexId);
  return Math.min(0.88, Math.max(0.34, 0.26 + h * 0.085));
}

/**
 * World XY (tiles) at the center of the drawn sprite bbox on the ground plane — uses the same pivot row as
 * `render.js` (`vx+0.5`, `vy+0.5`) and {@link PMD_MON_SHEET.pivotYFrac} + `heightTiles`, not `worldFeetFromPivotCell`
 * (walk probes). Z / altitude checks still use entity `z` + {@link getPokemonHurtboxZIntervalTiles}.
 *
 * @param {number} pivotWorldX — `player.x` / wild `x` (continuous tile cell coords)
 * @param {number} pivotWorldY — `player.y` / wild `y`
 * @param {number} dexId
 * @returns {{ hx: number, hy: number }}
 */
export function getPokemonHurtboxCenterWorldXY(pivotWorldX, pivotWorldY, dexId) {
  const h = getPokemonHeightTilesForHurtbox(dexId);
  const pyf = PMD_MON_SHEET.pivotYFrac;
  const hx = Number(pivotWorldX) + 0.5;
  const pivotCy = Number(pivotWorldY) + 0.5;
  const hy = pivotCy + h * 0.5 * (1 - 2 * pyf);
  return { hx, hy };
}

/**
 * @param {number} dexId
 * @param {number} feetZ — entity `z` (feet / pivot altitude in tiles).
 * @returns {{ zLo: number, zHi: number }} world-z interval in tiles.
 */
export function getPokemonHurtboxZIntervalTiles(dexId, feetZ) {
  const z0 = Number(feetZ) || 0;
  const h = getPokemonHeightTilesForHurtbox(dexId);
  return {
    zLo: z0 - POKEMON_HURTBOX_Z_PAD_FEET,
    zHi: z0 + h + POKEMON_HURTBOX_Z_PAD_HEAD
  };
}

/**
 * True when projectile altitude overlaps the species vertical hurtbox (heightTiles-based).
 *
 * @param {number} projZ
 * @param {number} dexId
 * @param {number} feetZ
 */
export function projectileZInPokemonHurtbox(projZ, dexId, feetZ) {
  const pz = Number(projZ) || 0;
  const { zLo, zHi } = getPokemonHurtboxZIntervalTiles(dexId, feetZ);
  const edge = PROJECTILE_Z_HIT_TOLERANCE_TILES * POKEMON_HURTBOX_Z_EDGE_MUL;
  return pz >= zLo - edge && pz <= zHi + edge;
}
