const PHASE_IDLE = 'idle';
const PHASE_FADE_OUT = 'fade-out';
const PHASE_FADE_IN = 'fade-in';
const FADE_OUT_SEC = 0.3;
const FADE_IN_SEC = 0.32;

const state = {
  phase: PHASE_IDLE,
  kind: null,
  t: 0,
  alpha: 0,
  midpointDone: false,
  onMidpoint: null
};

export function startDungeonTransition(kind, onMidpoint) {
  state.phase = PHASE_FADE_OUT;
  state.kind = kind || 'enter';
  state.t = 0;
  state.alpha = 0;
  state.midpointDone = false;
  state.onMidpoint = typeof onMidpoint === 'function' ? onMidpoint : null;
}

export function updateDungeonTransition(dt) {
  if (state.phase === PHASE_IDLE) return;
  state.t += Math.max(0, Number(dt) || 0);
  if (state.phase === PHASE_FADE_OUT) {
    state.alpha = Math.min(1, state.t / FADE_OUT_SEC);
    if (state.alpha >= 1 && !state.midpointDone) {
      state.midpointDone = true;
      state.onMidpoint?.();
      state.onMidpoint = null;
      state.phase = PHASE_FADE_IN;
      state.t = 0;
    }
    return;
  }
  if (state.phase === PHASE_FADE_IN) {
    const p = Math.min(1, state.t / FADE_IN_SEC);
    state.alpha = 1 - p;
    if (p >= 1) {
      state.phase = PHASE_IDLE;
      state.kind = null;
      state.t = 0;
      state.alpha = 0;
    }
  }
}

export function isDungeonTransitionBlocking() {
  return state.phase !== PHASE_IDLE;
}

export function drawDungeonTransitionOverlay(ctx, cw, ch) {
  if (!(state.alpha > 0.001)) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, state.alpha));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}
