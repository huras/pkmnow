import {
  WILD_GROUP_LEADER_ROAM_CURVE_BULGE_TILES,
  WILD_GROUP_LEADER_ROAM_SPATIAL_FREQ_RAD_PER_TILE,
  WILD_GROUP_LEADER_ROAM_WAVINESS_LATERAL_TILES,
  WILD_GROUP_LEADER_ROAM_U_LOOKAHEAD,
  WILD_GROUP_LEADER_ROAM_BEZIER_SAMPLES
} from './wild-pokemon-constants.js';

/**
 * @param {number} p0x
 * @param {number} p0y
 * @param {number} p2x
 * @param {number} p2y
 * @param {number} bulgeSign +1 or -1
 * @param {number} pathPhaseRad
 * @returns {{ p1x: number, p1y: number, L2: number } | null}
 */
export function computeLeaderRoamP1(p0x, p0y, p2x, p2y, bulgeSign, pathPhaseRad) {
  const dx = p2x - p0x;
  const dy = p2y - p0y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 0.01) return null;
  const L = Math.sqrt(L2);
  const mx = (p0x + p2x) * 0.5;
  const my = (p0y + p2y) * 0.5;
  const px = -dy / L;
  const py = dx / L;
  const base = bulgeSign * WILD_GROUP_LEADER_ROAM_CURVE_BULGE_TILES;
  const freq = WILD_GROUP_LEADER_ROAM_SPATIAL_FREQ_RAD_PER_TILE;
  const lateralExtra =
    freq !== 0 ? WILD_GROUP_LEADER_ROAM_WAVINESS_LATERAL_TILES * Math.sin(pathPhaseRad) : 0;
  return {
    p1x: mx + px * (base + lateralExtra),
    p1y: my + py * (base + lateralExtra),
    L2
  };
}

/**
 * @param {object} entity
 * @returns {boolean}
 */
export function leaderRoamCurveLegRenderable(entity) {
  if (!entity) return false;
  const p0x = Number(entity._leaderRoamP0x);
  const p0y = Number(entity._leaderRoamP0y);
  const p2x = Number(entity._leaderRoamP2x);
  const p2y = Number(entity._leaderRoamP2y);
  if (![p0x, p0y, p2x, p2y].every(Number.isFinite)) return false;
  const tx = Number(entity.targetX);
  const ty = Number(entity.targetY);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
  if (Math.abs(tx - p2x) > 1e-4 || Math.abs(ty - p2y) > 1e-4) return false;
  const dx = p2x - p0x;
  const dy = p2y - p0y;
  return dx * dx + dy * dy >= 0.01;
}

/**
 * Unit tangent for quadratic Bezier wander (leader ROAM).
 * @param {object} entity
 * @returns {{ nx: number, ny: number } | null}
 */
export function leaderRoamBezierSteerUnit(entity) {
  if (!leaderRoamCurveLegRenderable(entity)) return null;
  const p0x = Number(entity._leaderRoamP0x);
  const p0y = Number(entity._leaderRoamP0y);
  const p2x = Number(entity._leaderRoamP2x);
  const p2y = Number(entity._leaderRoamP2y);
  const bulgeSign = Number(entity._leaderRoamBulgeSign) || 1;
  const phase = Number(entity._leaderRoamPathPhaseRad) || 0;
  const p1 = computeLeaderRoamP1(p0x, p0y, p2x, p2y, bulgeSign, phase);
  if (!p1) return null;

  const ex = Number(entity.x) || 0;
  const ey = Number(entity.y) || 0;
  const dx = p2x - p0x;
  const dy = p2y - p0y;
  const L2 = p1.L2;
  let u = ((ex - p0x) * dx + (ey - p0y) * dy) / L2;
  u = Math.max(0, Math.min(1, u));
  const u2 = Math.min(1, u + WILD_GROUP_LEADER_ROAM_U_LOOKAHEAD);
  const om = 1 - u2;
  const tx = 2 * om * (p1.p1x - p0x) + 2 * u2 * (p2x - p1.p1x);
  const ty = 2 * om * (p1.p1y - p0y) + 2 * u2 * (p2y - p1.p1y);
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-5) return null;
  return { nx: tx / tl, ny: ty / tl };
}

/**
 * Tile-space points along Q(t) for debug overlay.
 * @param {object} entity
 * @returns {{ x: number, y: number }[] | null}
 */
export function sampleLeaderRoamBezierWorldPoints(entity) {
  if (!leaderRoamCurveLegRenderable(entity)) return null;
  const p0x = Number(entity._leaderRoamP0x);
  const p0y = Number(entity._leaderRoamP0y);
  const p2x = Number(entity._leaderRoamP2x);
  const p2y = Number(entity._leaderRoamP2y);
  const bulgeSign = Number(entity._leaderRoamBulgeSign) || 1;
  const phase = Number(entity._leaderRoamPathPhaseRad) || 0;
  const p1 = computeLeaderRoamP1(p0x, p0y, p2x, p2y, bulgeSign, phase);
  if (!p1) return null;
  const N = Math.max(4, Math.floor(WILD_GROUP_LEADER_ROAM_BEZIER_SAMPLES));
  /** @type {{ x: number, y: number }[]} */
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const om = 1 - t;
    const x = om * om * p0x + 2 * om * t * p1.p1x + t * t * p2x;
    const y = om * om * p0y + 2 * om * t * p1.p1y + t * t * p2y;
    pts.push({ x, y });
  }
  return pts;
}
