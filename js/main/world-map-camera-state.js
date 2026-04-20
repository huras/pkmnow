const WORLD_MAP_ZOOM_MIN = 1;
const WORLD_MAP_ZOOM_MAX = 48;
const WORLD_MAP_SMOOTH_LAMBDA = 18;

const state = {
  worldW: 1,
  worldH: 1,
  viewW: 1,
  viewH: 1,
  zoom: 1,
  targetZoom: 1,
  cx: 0.5,
  cy: 0.5,
  targetCx: 0.5,
  targetCy: 0.5,
  lastTickMs: 0
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fitScale() {
  return Math.min(
    state.viewW / Math.max(1, state.worldW),
    state.viewH / Math.max(1, state.worldH)
  );
}

function scaleForZoom(zoom) {
  return fitScale() * clamp(zoom, WORLD_MAP_ZOOM_MIN, WORLD_MAP_ZOOM_MAX);
}

function clampCenter(cx, cy, zoom) {
  const scale = Math.max(1e-6, scaleForZoom(zoom));
  const halfW = state.viewW / (2 * scale);
  const halfH = state.viewH / (2 * scale);
  const minCx = halfW > state.worldW * 0.5 ? state.worldW * 0.5 : halfW;
  const maxCx = halfW > state.worldW * 0.5 ? state.worldW * 0.5 : state.worldW - halfW;
  const minCy = halfH > state.worldH * 0.5 ? state.worldH * 0.5 : halfH;
  const maxCy = halfH > state.worldH * 0.5 ? state.worldH * 0.5 : state.worldH - halfH;
  return {
    cx: clamp(cx, minCx, maxCx),
    cy: clamp(cy, minCy, maxCy)
  };
}

function setTargetCenter(cx, cy) {
  const clamped = clampCenter(cx, cy, state.targetZoom);
  state.targetCx = clamped.cx;
  state.targetCy = clamped.cy;
}

function worldAtScreenPx(screenX, screenY, useTarget = true) {
  const cx = useTarget ? state.targetCx : state.cx;
  const cy = useTarget ? state.targetCy : state.cy;
  const zoom = useTarget ? state.targetZoom : state.zoom;
  const scale = Math.max(1e-6, scaleForZoom(zoom));
  return {
    x: cx + (screenX - state.viewW * 0.5) / scale,
    y: cy + (screenY - state.viewH * 0.5) / scale
  };
}

function resolveCameraSnapshot(cx, cy, zoom) {
  const scale = Math.max(1e-6, scaleForZoom(zoom));
  return {
    zoom,
    scale,
    cx,
    cy,
    ox: cx - state.viewW / (2 * scale),
    oy: cy - state.viewH / (2 * scale),
    worldW: state.worldW,
    worldH: state.worldH,
    viewW: state.viewW,
    viewH: state.viewH
  };
}

export function resetWorldMapCamera() {
  state.zoom = 1;
  state.targetZoom = 1;
  state.cx = state.worldW * 0.5;
  state.cy = state.worldH * 0.5;
  state.targetCx = state.cx;
  state.targetCy = state.cy;
  state.lastTickMs = 0;
}

export function configureWorldMapCamera(worldW, worldH, viewW, viewH) {
  state.worldW = Math.max(1, Number(worldW) || 1);
  state.worldH = Math.max(1, Number(worldH) || 1);
  state.viewW = Math.max(1, Number(viewW) || 1);
  state.viewH = Math.max(1, Number(viewH) || 1);
  const clampedTarget = clampCenter(state.targetCx, state.targetCy, state.targetZoom);
  state.targetCx = clampedTarget.cx;
  state.targetCy = clampedTarget.cy;
  const clampedNow = clampCenter(state.cx, state.cy, state.zoom);
  state.cx = clampedNow.cx;
  state.cy = clampedNow.cy;
}

export function tickWorldMapCamera(nowMs = performance.now()) {
  const now = Number(nowMs) || performance.now();
  if (state.lastTickMs <= 0) {
    state.lastTickMs = now;
    return false;
  }
  const dt = Math.max(0, Math.min(0.05, (now - state.lastTickMs) / 1000));
  state.lastTickMs = now;
  const t = 1 - Math.exp(-WORLD_MAP_SMOOTH_LAMBDA * dt);

  state.zoom += (state.targetZoom - state.zoom) * t;
  const clampedNow = clampCenter(state.cx, state.cy, state.zoom);
  state.cx = clampedNow.cx + (state.targetCx - clampedNow.cx) * t;
  state.cy = clampedNow.cy + (state.targetCy - clampedNow.cy) * t;
  const finalNow = clampCenter(state.cx, state.cy, state.zoom);
  state.cx = finalNow.cx;
  state.cy = finalNow.cy;

  const zoomSettled = Math.abs(state.zoom - state.targetZoom) < 0.0005;
  const cxSettled = Math.abs(state.cx - state.targetCx) < 0.0005;
  const cySettled = Math.abs(state.cy - state.targetCy) < 0.0005;
  if (zoomSettled && cxSettled && cySettled) {
    state.zoom = state.targetZoom;
    state.cx = state.targetCx;
    state.cy = state.targetCy;
    return false;
  }
  return true;
}

export function zoomWorldMapAtScreenPoint(nextZoom, screenX, screenY) {
  const z = clamp(Number(nextZoom) || 1, WORLD_MAP_ZOOM_MIN, WORLD_MAP_ZOOM_MAX);
  const anchor = worldAtScreenPx(screenX, screenY, true);
  state.targetZoom = z;
  const nextScale = Math.max(1e-6, scaleForZoom(state.targetZoom));
  const nextCx = anchor.x - (screenX - state.viewW * 0.5) / nextScale;
  const nextCy = anchor.y - (screenY - state.viewH * 0.5) / nextScale;
  setTargetCenter(nextCx, nextCy);
}

export function zoomWorldMapByFactorAtScreenPoint(factor, screenX, screenY) {
  const mul = Number(factor);
  if (!Number.isFinite(mul) || Math.abs(mul) < 1e-6) return;
  zoomWorldMapAtScreenPoint(state.targetZoom * mul, screenX, screenY);
}

export function panWorldMapByScreenDelta(deltaScreenX, deltaScreenY) {
  const scale = Math.max(1e-6, scaleForZoom(state.targetZoom));
  const nextCx = state.targetCx - (Number(deltaScreenX) || 0) / scale;
  const nextCy = state.targetCy - (Number(deltaScreenY) || 0) / scale;
  setTargetCenter(nextCx, nextCy);
}

export function screenPxToWorldMacro(screenX, screenY) {
  return worldAtScreenPx(screenX, screenY, false);
}

export function getWorldMapCamera() {
  return resolveCameraSnapshot(state.cx, state.cy, state.zoom);
}
