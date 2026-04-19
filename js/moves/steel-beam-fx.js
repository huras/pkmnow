/**
 * Hold-stream FX for Steel Beam — silver wind arcs + sparks (Cyclops-style optic blast palette).
 * @typedef {(p: object) => void} PushParticleFn
 */

const ORIGIN_ARC_SPAWN_RATE = 0.32;
const TARGET_ARC_SPAWN_RATE = 0.72;
const ORIGIN_ARC_SPEED_MIN = 2.0;
const ORIGIN_ARC_SPEED_MAX = 3.9;
const TARGET_ARC_SPEED_MIN = 2.9;
const TARGET_ARC_SPEED_MAX = 5.8;
const ORIGIN_ARC_LENGTH_MIN = 0.5;
const ORIGIN_ARC_LENGTH_MAX = 0.78;
const TARGET_ARC_LENGTH_MIN = 0.82;
const TARGET_ARC_LENGTH_MAX = 1.22;
const ORIGIN_ARC_LIFETIME_MIN = 0.28;
const ORIGIN_ARC_LIFETIME_MAX = 0.55;
const TARGET_ARC_LIFETIME_MIN = 0.48;
const TARGET_ARC_LIFETIME_MAX = 0.78;

const STEEL_SPARK_TINTS = ['#e8eef5', '#c5d0de', '#9fb0c4', '#ffffff', '#b8c8d8', '#dce6f0'];

/**
 * @param {PushParticleFn} pushParticle
 * @param {number} originX
 * @param {number} originY
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} z
 */
export function spawnSteelBeamStreamFx(pushParticle, originX, originY, targetX, targetY, z) {
  const z0 = Math.max(0, Number(z) || 0) + 0.06;
  tryPushSteelWindArc(pushParticle, originX, originY, z0, 'origin');
  tryPushSteelWindArc(pushParticle, targetX, targetY, z0, 'target');
  if (Math.random() < 0.38) tryPushSteelWindArc(pushParticle, targetX, targetY, z0, 'target');
  if (Math.random() < 0.5) {
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.6;
      const life = 0.18 + Math.random() * 0.26;
      pushParticle({
        type: 'steelLaserSpark',
        x: targetX + Math.cos(a) * 0.05,
        y: targetY + Math.sin(a) * 0.05,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        z: z0 + 0.1,
        vz: 0.9 + Math.random() * 1.4,
        life,
        maxLife: life,
        tint: STEEL_SPARK_TINTS[(Math.random() * STEEL_SPARK_TINTS.length) | 0]
      });
    }
  }
}

/**
 * @param {PushParticleFn} pushParticle
 * @param {number} cx
 * @param {number} cy
 * @param {number} z0
 * @param {'origin' | 'target'} kind
 */
function tryPushSteelWindArc(pushParticle, cx, cy, z0, kind) {
  const isOrigin = kind === 'origin';
  const rate = isOrigin ? ORIGIN_ARC_SPAWN_RATE : TARGET_ARC_SPAWN_RATE;
  if (Math.random() >= rate) return;

  const maxRot = (5 * Math.PI) / 180;
  const angle = -Math.PI / 2 + (Math.random() * 2 - 1) * maxRot;
  const smin = isOrigin ? ORIGIN_ARC_SPEED_MIN : TARGET_ARC_SPEED_MIN;
  const smax = isOrigin ? ORIGIN_ARC_SPEED_MAX : TARGET_ARC_SPEED_MAX;
  const speed = smin + Math.random() * (smax - smin);
  const lmin = isOrigin ? ORIGIN_ARC_LENGTH_MIN : TARGET_ARC_LENGTH_MIN;
  const lmax = isOrigin ? ORIGIN_ARC_LENGTH_MAX : TARGET_ARC_LENGTH_MAX;
  const length = lmin + Math.random() * (lmax - lmin);
  const tmin = isOrigin ? ORIGIN_ARC_LIFETIME_MIN : TARGET_ARC_LIFETIME_MIN;
  const tmax = isOrigin ? ORIGIN_ARC_LIFETIME_MAX : TARGET_ARC_LIFETIME_MAX;
  const life = tmin + Math.random() * (tmax - tmin);
  const baseC = isOrigin ? 0.22 : 0.62;
  const curveVariation = (0.5 - Math.random()) * 4;
  const curveIntensity = baseC * curveVariation;

  pushParticle({
    type: 'steelWindArc',
    x: cx,
    y: cy,
    z: z0,
    vx: 0,
    vy: 0,
    vz: 0,
    life,
    maxLife: life,
    centerX: cx,
    centerY: cy,
    arcAngle: angle,
    arcSpeed: speed,
    arcLength: length,
    curveIntensity,
    lineWidth: isOrigin ? 4.8 : 10,
    lineAlphaMul: isOrigin ? 0.62 : 0.88,
    ellipseAlpha: isOrigin ? 0.48 : 0.72,
    ellipseRPx: isOrigin ? 6.5 : 6
  });
}
