/**
 * Thunder Shock — a continuous short-range yellow lightning arc that crackles between the
 * caster and the aimed point. Each "puff" spawns a very short-lived beam projectile; held
 * input chains puffs at a tight cadence so the player reads it as one unbroken, flickering
 * zap. Unlike {@link module:moves/thunder-move Thunder} (summons a storm cell that drops
 * a bolt from above), Thunder Shock originates *at the user* and is constrained to a much
 * shorter range, matching the classic Pokémon move's "close-range zap" identity.
 *
 * Gameplay contract:
 *  - Stream cadence (`THUNDERSHOCK_STREAM_INTERVAL_SEC`) + per-puff TTL
 *    (`THUNDERSHOCK_BEAM_TTL_SEC`) are tuned to slightly overlap → the arc never blinks.
 *  - Per-puff damage is low; DPS comes from the fast cadence. Hit detection is segment-
 *    based (identical shape to psybeam) so it handles wide-boi targets gracefully.
 *  - No physical knockback: it's an electric shock, not a tackle-style push.
 */

import {
  clampFloorAimToMaxRange,
  spawnAlongHypotTowardGround
} from './projectile-ground-hypot.js';

/** Max world-tile reach for player casts. Wild variants use a slightly shorter leash. */
export const THUNDERSHOCK_MAX_RANGE_TILES = 7;
/** Minimum gap between consecutive stream puffs (held input). */
export const THUNDERSHOCK_STREAM_INTERVAL_SEC = 0.08;
/**
 * Per-beam lifetime. A touch longer than the stream interval so two consecutive beams are
 * briefly alive at the same time — the overlap is what makes the arc look continuous.
 */
export const THUNDERSHOCK_BEAM_TTL_SEC = 0.11;

/**
 * Spawn a single thundershock beam from `(sourceX, sourceY)` toward the aimed floor point.
 * The beam is clamped to {@link THUNDERSHOCK_MAX_RANGE_TILES} (shorter for wilds) and its
 * jag is regenerated every render frame via `jagSeed`, giving the "crackling lightning"
 * feel without paying simulation cost per-segment.
 *
 * @param {number} sourceX  caster world-tile X
 * @param {number} sourceY  caster world-tile Y
 * @param {number} targetX  aim target world-tile X (un-clamped; caller passes raw cursor)
 * @param {number} targetY  aim target world-tile Y
 * @param {object|null} sourceEntity
 * @param {{ fromWild?: boolean, pushProjectile: (p: object) => void }} opts
 */
export function castThundershock(sourceX, sourceY, targetX, targetY, sourceEntity, opts) {
  const { fromWild = false, pushProjectile } = opts;
  const maxR = fromWild ? 5.5 : THUNDERSHOCK_MAX_RANGE_TILES;
  const z0 = Math.max(0, Number(sourceEntity?.z) || 0) + 0.04;
  const { dirX, dirY, dist0 } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  // The beam starts slightly in front of the caster's chest (matches psybeam's spawn rig)
  // so the first segment doesn't clip through the caster sprite.
  const sp = spawnAlongHypotTowardGround(sourceX, sourceY, z0, sourceX + dirX * dist0, sourceY + dirY * dist0, 0.44);
  const beamEndX = sourceX + dirX * dist0;
  const beamEndY = sourceY + dirY * dist0;
  const ttl = THUNDERSHOCK_BEAM_TTL_SEC;
  // Per-puff damage is deliberately small: stream cadence × puff damage = effective DPS,
  // tuned near flamethrower-stream dps (~28-38 dps vs single targets with perfect aim).
  const damage = fromWild ? 2.4 : 3.1;
  pushProjectile({
    type: 'thunderShockBeam',
    x: (sp.startX + beamEndX) * 0.5,
    y: (sp.startY + beamEndY) * 0.5,
    vx: 0,
    vy: 0,
    vz: 0,
    z: sp.startZ,
    radius: 0.26,
    beamStartX: sp.startX,
    beamStartY: sp.startY,
    beamEndX,
    beamEndY,
    beamHalfWidth: 0.3,
    timeToLive: ttl,
    beamTtlMax: ttl,
    damage,
    sourceEntity,
    fromWild,
    hitsWild: !fromWild,
    hitsPlayer: !!fromWild,
    hasTackleTrait: false,
    trailAcc: null,
    psyHitWild: new Set(),
    psyHitDetails: new Set(),
    playerBeamHitDone: false,
    // Seeds the per-frame jag. Packed small int so debug logs stay readable.
    jagSeed: (Math.random() * 0xffffff) | 0
  });
}
