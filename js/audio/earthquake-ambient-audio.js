/**
 * Procedural earthquake bed: low sine rumble + filtered noise crackle tied to shake intensity.
 * Separate from sky weather ambient (`weather-ambient-audio.js`). Uses the same BGM user gain.
 */

import { getSpatialAudioContext } from './spatial-audio.js';
import { getEffectiveBgmMix01 } from './play-audio-mix-settings.js';
import { getEarthquakeActiveIntensity01, getEarthquakeShakePx } from '../main/earthquake-layer.js';

const TUNING = {
  fadeInSec: 0.5,
  fadeOutSec: 0.55,
  frameGlideSec: 0.1,
  rumbleMasterLinearGain: 0.34,
  crackleMasterLinearGain: 0.26,
  minIntensity: 0.025,
  crackleBurstCooldownSec: 0.055,
  crackleBurstMul: 2.4
};

/** @type {{
 *   ctx: AudioContext,
 *   rumbleOsc: OscillatorNode,
 *   rumbleGain: GainNode,
 *   noiseSrc: AudioBufferSourceNode,
 *   crackleFilter: BiquadFilterNode,
 *   crackleGain: GainNode,
 *   userGain: GainNode,
 *   wantOn: boolean,
 *   lastCrackleBurstT: number,
 *   lastShakeMag: number
 * } | null} */
let graph = null;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rampTo(gainNode, to, durationSec) {
  const ctx = gainNode.context;
  const t = ctx.currentTime;
  const current = gainNode.gain.value;
  try {
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(current, t);
    if (durationSec <= 0.001) gainNode.gain.setValueAtTime(to, t);
    else gainNode.gain.linearRampToValueAtTime(to, t + durationSec);
  } catch {
    gainNode.gain.value = to;
  }
}

function makeWhiteNoiseBuffer(ctx, seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function ensureGraph() {
  if (graph) return;
  const ctx = getSpatialAudioContext();

  const rumbleOsc = ctx.createOscillator();
  rumbleOsc.type = 'sine';
  rumbleOsc.frequency.value = 52;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0;
  rumbleOsc.connect(rumbleGain);

  const noiseBuf = makeWhiteNoiseBuffer(ctx, 1.2);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;

  const crackleFilter = ctx.createBiquadFilter();
  crackleFilter.type = 'bandpass';
  crackleFilter.frequency.value = 1400;
  crackleFilter.Q.value = 1.2;
  noiseSrc.connect(crackleFilter);

  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0;
  crackleFilter.connect(crackleGain);

  const userGain = ctx.createGain();
  userGain.gain.value = getEffectiveBgmMix01();
  rumbleGain.connect(userGain);
  crackleGain.connect(userGain);
  userGain.connect(ctx.destination);

  try {
    rumbleOsc.start(0);
  } catch {
    /* ignore */
  }
  try {
    noiseSrc.start(0);
  } catch {
    /* ignore */
  }

  graph = {
    ctx,
    rumbleOsc,
    rumbleGain,
    noiseSrc,
    crackleFilter,
    crackleGain,
    userGain,
    wantOn: false,
    lastCrackleBurstT: 0,
    lastShakeMag: 0
  };
}

/**
 * Apply persisted BGM mix slider (same knob as rain/wind beds).
 */
export function applyEarthquakeAmbientUserMixFromStorage() {
  if (!graph) return;
  try {
    graph.userGain.gain.value = getEffectiveBgmMix01();
  } catch {
    /* ignore */
  }
}

/**
 * @param {number} gameTimeSec world / render time seconds (keeps crackle aligned with visible shake).
 */
export function syncEarthquakeAmbientAudio(gameTimeSec) {
  ensureGraph();
  applyEarthquakeAmbientUserMixFromStorage();

  const g = graph;
  if (!g) return;

  const timeSec = Number.isFinite(gameTimeSec) ? gameTimeSec : performance.now() * 0.001;
  const active = clamp01(getEarthquakeActiveIntensity01());
  const shake = getEarthquakeShakePx(timeSec, active, 40);
  const mag = Math.hypot(shake.x, shake.y);
  const wantOn = active > TUNING.minIntensity;

  if (wantOn && !g.wantOn) {
    g.wantOn = true;
    rampTo(g.rumbleGain, 0, 0);
    rampTo(g.crackleGain, 0, 0);
    rampTo(g.rumbleGain, active * active * TUNING.rumbleMasterLinearGain, TUNING.fadeInSec);
    rampTo(g.crackleGain, active * TUNING.crackleMasterLinearGain * 0.5, TUNING.fadeInSec);
  } else if (!wantOn && g.wantOn) {
    g.wantOn = false;
    rampTo(g.rumbleGain, 0, TUNING.fadeOutSec);
    rampTo(g.crackleGain, 0, TUNING.fadeOutSec);
  }

  if (!wantOn && active < 0.005) {
    g.lastShakeMag = 0;
    return;
  }

  const t = g.ctx.currentTime;
  const rumbleTarget =
    active * active * TUNING.rumbleMasterLinearGain * (0.55 + 0.45 * clamp01(mag / 12));
  rampTo(g.rumbleGain, rumbleTarget, TUNING.frameGlideSec);

  const slow = Math.sin(timeSec * 1.85) * 6 + Math.sin(timeSec * 0.41) * 3;
  try {
    g.rumbleOsc.frequency.cancelScheduledValues(t);
    g.rumbleOsc.frequency.setValueAtTime(g.rumbleOsc.frequency.value, t);
    g.rumbleOsc.frequency.linearRampToValueAtTime(48 + active * 16 + slow, t + TUNING.frameGlideSec);
  } catch {
    g.rumbleOsc.frequency.value = 52 + slow;
  }

  let crackleTarget = active * TUNING.crackleMasterLinearGain * (0.35 + 0.65 * clamp01(mag / 10));
  const rising = mag > g.lastShakeMag + 0.45 && timeSec - g.lastCrackleBurstT > TUNING.crackleBurstCooldownSec;
  if (rising && active > 0.08) {
    g.lastCrackleBurstT = timeSec;
    crackleTarget *= TUNING.crackleBurstMul;
  }
  g.lastShakeMag = mag;

  try {
    g.crackleFilter.frequency.cancelScheduledValues(t);
    g.crackleFilter.frequency.setValueAtTime(g.crackleFilter.frequency.value, t);
    const fq = 900 + active * 2200 + (mag % 7) * 40;
    g.crackleFilter.frequency.linearRampToValueAtTime(fq, t + TUNING.frameGlideSec);
  } catch {
    /* ignore */
  }

  rampTo(g.crackleGain, Math.min(0.95, crackleTarget), TUNING.frameGlideSec);
}

export function stopEarthquakeAmbientAudio() {
  if (!graph) return;
  graph.wantOn = false;
  rampTo(graph.rumbleGain, 0, TUNING.fadeOutSec);
  rampTo(graph.crackleGain, 0, TUNING.fadeOutSec);
}
