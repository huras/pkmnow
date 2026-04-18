/**
 * Web Audio spatialization for short media (cries): horizontal pan + distance via PannerNode,
 * vertical separation reinforced with a gentle low-pass (cheap “height” cue).
 */
import { getEffectiveCriesMix01 } from './play-audio-mix-settings.js';

/** @type {AudioContext | null} */
let sharedCtx = null;
/** @type {GainNode | null} */
let spatialMasterGain = null;

/** Last listener pose in world space (for vertical filter vs cry source). */
let lastLx = 0;
let lastLy = 0;
let lastLz = 0;

/**
 * @returns {AudioContext}
 */
export function getSpatialAudioContext() {
  if (!sharedCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedCtx = new Ctx();
    spatialMasterGain = sharedCtx.createGain();
    spatialMasterGain.connect(sharedCtx.destination);
    applySpatialAudioMuteFromStorage();
  }
  return sharedCtx;
}

/**
 * Applies minimap mute + SFX mix slider to the shared spatial graph (all short spatial SFX + cries).
 */
export function applySpatialAudioMuteFromStorage() {
  const ctx = getSpatialAudioContext();
  const gainNode = spatialMasterGain || ctx.createGain();
  if (!spatialMasterGain) {
    spatialMasterGain = gainNode;
    gainNode.connect(ctx.destination);
  }
  const t = ctx.currentTime;
  const g = getEffectiveCriesMix01();
  try {
    gainNode.gain.setValueAtTime(g, t);
  } catch {
    gainNode.gain.value = g;
  }
}

/**
 * @param {import('../player.js').player} player
 */
export function syncSpatialListenerFromPlayer(player) {
  if (!player) return;
  const ctx = getSpatialAudioContext();
  lastLx = Number(player.visualX ?? player.x) || 0;
  lastLy = Number(player.visualY ?? player.y) || 0;
  lastLz = Math.max(0, Number(player.z) || 0);
  const t = ctx.currentTime;
  try {
    ctx.listener.positionX.setValueAtTime(lastLx, t);
    ctx.listener.positionY.setValueAtTime(lastLz, t);
    ctx.listener.positionZ.setValueAtTime(-lastLy, t);
  } catch {
    ctx.listener.positionX.value = lastLx;
    ctx.listener.positionY.value = lastLz;
    ctx.listener.positionZ.value = -lastLy;
  }
}

/**
 * @returns {Promise<void>}
 */
export function resumeSpatialAudioContext() {
  const ctx = getSpatialAudioContext();
  if (ctx.state === 'suspended') return ctx.resume().catch(() => {});
  return Promise.resolve();
}

/**
 * @typedef {{ panner: PannerNode, filter: BiquadFilterNode, fadeGain?: GainNode }} SpatialMediaGraph
 */

/** @type {WeakMap<HTMLMediaElement, SpatialMediaGraph>} */
const mediaGraphs = new WeakMap();

/**
 * One MediaElementSource per element — idempotent.
 * @param {HTMLMediaElement} audio
 * @returns {SpatialMediaGraph}
 */
export function wireSpatialMediaElement(audio) {
  const existing = mediaGraphs.get(audio);
  if (existing) return existing;

  const ctx = getSpatialAudioContext();
  const source = ctx.createMediaElementSource(audio);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 20000;
  filter.Q.value = 0.65;

  const panner = ctx.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  /**
   * Cry audibility tuning:
   * - higher `refDistance` keeps near/mid cries louder before attenuation starts.
   * - lower `rolloffFactor` slows spatial decay so distant cries remain audible.
   */
  panner.refDistance = 2.4;
  panner.maxDistance = 1400;
  panner.rolloffFactor = 0.24;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;

  source.connect(filter);
  filter.connect(panner);
  panner.connect(spatialMasterGain || ctx.destination);

  const g = { panner, filter };
  mediaGraphs.set(audio, g);
  return g;
}

/**
 * Like {@link wireSpatialMediaElement}, but inserts a fade `GainNode` between filter and panner
 * so callers can cross-fade looping sources (e.g. `Fire.ogg` burning loops) without touching
 * `audio.volume` (which is per-element and non-rampable in Web Audio). Idempotent per element.
 * @param {HTMLMediaElement} audio
 * @returns {SpatialMediaGraph & { fadeGain: GainNode }}
 */
export function wireLoopingSpatialMediaElement(audio) {
  const existing = /** @type {SpatialMediaGraph & { fadeGain?: GainNode }} */ (mediaGraphs.get(audio));
  if (existing?.fadeGain) return /** @type {SpatialMediaGraph & { fadeGain: GainNode }} */ (existing);

  const ctx = getSpatialAudioContext();
  const source = ctx.createMediaElementSource(audio);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 20000;
  filter.Q.value = 0.65;

  const fadeGain = ctx.createGain();
  fadeGain.gain.value = 0;

  const panner = ctx.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = 2.4;
  panner.maxDistance = 1400;
  panner.rolloffFactor = 0.24;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;

  source.connect(filter);
  filter.connect(fadeGain);
  fadeGain.connect(panner);
  panner.connect(spatialMasterGain || ctx.destination);

  const g = { panner, filter, fadeGain };
  mediaGraphs.set(audio, g);
  return g;
}

/** When a cry has no world anchor, keep it centered on the listener (no pan / nominal distance). */
export function centerSpatialSourceOnListener(g) {
  setSpatialSourceWorldPosition(g, lastLx, lastLy, lastLz);
}

/**
 * World: x, y floor tiles; z height in tiles. Matches listener mapping in {@link syncSpatialListenerFromPlayer}.
 * @param {SpatialMediaGraph} g
 * @param {number} wx
 * @param {number} wy
 * @param {number} wz
 */
export function setSpatialSourceWorldPosition(g, wx, wy, wz) {
  const ctx = getSpatialAudioContext();
  const t = ctx.currentTime;
  const sx = Number(wx) || 0;
  const sy = Number(wy) || 0;
  const sz = Math.max(0, Number(wz) || 0);
  try {
    g.panner.positionX.setValueAtTime(sx, t);
    g.panner.positionY.setValueAtTime(sz, t);
    g.panner.positionZ.setValueAtTime(-sy, t);
  } catch {
    g.panner.positionX.value = sx;
    g.panner.positionY.value = sz;
    g.panner.positionZ.value = -sy;
  }

  const dz = Math.abs(sz - lastLz);
  const cutoff = 20000 * Math.exp(-dz * 0.38) + 720;
  const f = Math.min(20000, Math.max(680, cutoff));
  try {
    g.filter.frequency.setValueAtTime(f, t);
  } catch {
    g.filter.frequency.value = f;
  }
}
