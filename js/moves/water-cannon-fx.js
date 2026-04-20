/**
 * Hold-stream FX for Water Cannon — white foam bubbles at the beam tip (waterfall impact).
 * @typedef {(p: object) => void} PushParticleFn
 */

/**
 * @param {PushParticleFn} pushParticle
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} z
 */
export function spawnWaterCannonStreamFx(pushParticle, _originX, _originY, targetX, targetY, z) {
  const z0 = Math.max(0, Number(z) || 0) + 0.06;
  const n = 7 + Math.floor(Math.random() * 6);
  for (let i = 0; i < n; i++) {
    const life = 0.32 + Math.random() * 0.38;
    const r0 = 0.06 + Math.random() * 0.14;
    pushParticle({
      type: 'waterCannonBubble',
      x: targetX + (Math.random() - 0.5) * 0.42,
      y: targetY + (Math.random() - 0.5) * 0.42,
      z: z0 + Math.random() * 0.1,
      vx: (Math.random() - 0.5) * 0.55,
      vy: (Math.random() - 0.5) * 0.55,
      vz: 0.35 + Math.random() * 0.55,
      life,
      maxLife: life,
      bubbleR: r0,
      phase: Math.random() * Math.PI * 2
    });
  }
}
