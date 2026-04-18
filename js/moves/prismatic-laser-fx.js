/**
 * Visual FX for Prismatic Laser — ported from
 * `zelda-BOTW-map-generator-and-player/js/moves/PrismaticLaser.js`:
 *   - **Wind-arc particles** at caster (sparse) and aim (dense): white ellipse + quadratic
 *     “wind cut” strokes, upward-biased angle (–90° ± 5°), stochastic spawn rates.
 *   - Optional **beam-end sparks** (rainbow burst) matching the Phaser hit-particle tint list.
 *
 * Spawns into {@link module:moves/moves-manager `activeParticles`} via the caller-supplied
 * `pushParticle` hook so collision / projectile caps stay centralized.
 */

/** @typedef {(p: object) => void} PushParticleFn */

// —— Constants aligned with Zelda `PrismaticLaser` (lengths/speeds converted to tiles/sec) ——

/** Spawn probability per puff call (Zelda: per throttled update). */
const ORIGIN_ARC_SPAWN_RATE = 0.35;
const TARGET_ARC_SPAWN_RATE = 0.75;

/** Arc motion in world tiles / second (Zelda ~100–200 px/s at ~48px tile ≈ 2–4.2). */
const ORIGIN_ARC_SPEED_MIN = 2.1;
const ORIGIN_ARC_SPEED_MAX = 4.2;
const TARGET_ARC_SPEED_MIN = 3.1;
const TARGET_ARC_SPEED_MAX = 6.2;

/** Arc length in world tiles (Zelda 30–40 px target 45–65 px). */
const ORIGIN_ARC_LENGTH_MIN = 0.55;
const ORIGIN_ARC_LENGTH_MAX = 0.82;
const TARGET_ARC_LENGTH_MIN = 0.85;
const TARGET_ARC_LENGTH_MAX = 1.28;

/** Lifetime seconds (Zelda 300–600ms / 500–800ms). */
const ORIGIN_ARC_LIFETIME_MIN = 0.3;
const ORIGIN_ARC_LIFETIME_MAX = 0.62;
const TARGET_ARC_LIFETIME_MIN = 0.5;
const TARGET_ARC_LIFETIME_MAX = 0.82;

/** Ellipse radius in *screen* px at arc foot (Zelda 6–7 px). */
const ORIGIN_ARC_ELLIPSE_PX = 7;
const TARGET_ARC_ELLIPSE_PX = 6;

const ORIGIN_ARC_ELLIPSE_ALPHA = 0.5;
const TARGET_ARC_ELLIPSE_ALPHA = 0.8;

const ORIGIN_ARC_LINE_WIDTH = 4.2;
const TARGET_ARC_LINE_WIDTH = 9;

const ORIGIN_ARC_LINE_ALPHA_MUL = 0.7;
const TARGET_ARC_LINE_ALPHA_MUL = 0.9;

const ORIGIN_ARC_CURVE_INTENSITY = 0.25;
const TARGET_ARC_CURVE_INTENSITY = 0.74;

/** Same order as Zelda `RAINBOW_COLORS` / hit-particle tint list. */
const PRISMATIC_HIT_TINTS = [
  '#ff0000',
  '#ff7f00',
  '#ffff00',
  '#00ff00',
  '#0000ff',
  '#4b0082',
  '#9400d3',
  '#ff1493'
];

/**
 * Spawn wind-arc + optional hit sparks for one player stream puff (matches Zelda’s per-frame
 * `updateWaterArcParticles` feel when the laser is active).
 * @param {PushParticleFn} pushParticle
 * @param {number} originX
 * @param {number} originY
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} z
 */
export function spawnPrismaticLaserStreamFx(pushParticle, originX, originY, targetX, targetY, z) {
  const z0 = Math.max(0, Number(z) || 0) + 0.06;
  tryPushWindArc(pushParticle, originX, originY, z0, 'origin');
  tryPushWindArc(pushParticle, targetX, targetY, z0, 'target');
  if (Math.random() < 0.42) tryPushWindArc(pushParticle, targetX, targetY, z0, 'target');
  if (Math.random() < 0.55) {
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.8 + Math.random() * 3.2;
      const life = 0.22 + Math.random() * 0.32;
      pushParticle({
        type: 'prismaticLaserSpark',
        x: targetX + Math.cos(a) * 0.06,
        y: targetY + Math.sin(a) * 0.06,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        z: z0 + 0.12,
        vz: 1.1 + Math.random() * 1.8,
        life,
        maxLife: life,
        tint: PRISMATIC_HIT_TINTS[(Math.random() * PRISMATIC_HIT_TINTS.length) | 0]
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
function tryPushWindArc(pushParticle, cx, cy, z0, kind) {
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
  const baseC = isOrigin ? ORIGIN_ARC_CURVE_INTENSITY : TARGET_ARC_CURVE_INTENSITY;
  // Same formula as Zelda `updateArcParticles` (±2× multiplier on base intensity).
  const curveVariation = (0.5 - Math.random()) * 4;
  const curveIntensity = baseC * curveVariation;

  pushParticle({
    type: 'prismaticWindArc',
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
    windKind: kind,
    lineWidth: isOrigin ? ORIGIN_ARC_LINE_WIDTH : TARGET_ARC_LINE_WIDTH,
    ellipseRPx: isOrigin ? ORIGIN_ARC_ELLIPSE_PX : TARGET_ARC_ELLIPSE_PX,
    ellipseAlpha: isOrigin ? ORIGIN_ARC_ELLIPSE_ALPHA : TARGET_ARC_ELLIPSE_ALPHA,
    lineAlphaMul: isOrigin ? ORIGIN_ARC_LINE_ALPHA_MUL : TARGET_ARC_LINE_ALPHA_MUL
  });
}
