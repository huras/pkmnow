import {
  WALL_ROLES,
  getMicroTileRole,
  isPropBlocking
} from '../walkability.js';
import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';

const DEFAULTS = {
  enabled: false,
  radiusTiles: 16,
  recomputeEveryMs: 180,
  rayCount: 64,
  rayStepTiles: 0.5,
  unseenAlpha: 0.98,
  exploredAlpha: 0.58,
  preciseOccluders: false,
  downsampleCellSize: 2
};

const fogState = {
  fingerprint: '',
  fineW: 0,
  fineH: 0,
  coarseW: 0,
  coarseH: 0,
  coarseCellSize: 2,
  visible: /** @type {Uint8Array | null} */ (null),
  discovered: /** @type {Uint8Array | null} */ (null),
  lastPlayerCx: -1,
  lastPlayerCy: -1,
  lastComputedAtMs: 0
};

function fingerprintForMap(data) {
  const w = Math.max(0, Math.floor(Number(data?.width) || 0));
  const h = Math.max(0, Math.floor(Number(data?.height) || 0));
  const seed = Number.isFinite(Number(data?.seed)) ? Number(data.seed) : 0;
  return `${w}x${h}@${seed}`;
}

function getNowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function idx(mx, my, w) {
  return my * w + mx;
}

function inBounds(mx, my, w, h) {
  return mx >= 0 && my >= 0 && mx < w && my < h;
}

function ensureFogBuffers(data) {
  const fp = fingerprintForMap(data);
  const fineW = Math.max(1, Math.floor(Number(data?.width) || 0) * MACRO_TILE_STRIDE);
  const fineH = Math.max(1, Math.floor(Number(data?.height) || 0) * MACRO_TILE_STRIDE);
  const coarseCellSize = Math.max(1, Math.floor(Number(DEFAULTS.downsampleCellSize) || 2));
  const coarseW = Math.max(1, Math.ceil(fineW / coarseCellSize));
  const coarseH = Math.max(1, Math.ceil(fineH / coarseCellSize));
  const size = coarseW * coarseH;
  if (
    fogState.fingerprint === fp &&
    fogState.fineW === fineW &&
    fogState.fineH === fineH &&
    fogState.coarseW === coarseW &&
    fogState.coarseH === coarseH &&
    fogState.visible &&
    fogState.discovered
  ) {
    return;
  }
  fogState.fingerprint = fp;
  fogState.fineW = fineW;
  fogState.fineH = fineH;
  fogState.coarseW = coarseW;
  fogState.coarseH = coarseH;
  fogState.coarseCellSize = coarseCellSize;
  fogState.visible = new Uint8Array(size);
  fogState.discovered = new Uint8Array(size);
  fogState.lastPlayerCx = -1;
  fogState.lastPlayerCy = -1;
  fogState.lastComputedAtMs = 0;
}

function blocksVisionAtFineCell(mx, my, data, playerHeightStep) {
  if (!inBounds(mx, my, fogState.fineW, fogState.fineH)) return true;
  if (WALL_ROLES.has(getMicroTileRole(mx, my, data))) {
    const t = getMicroTile(mx, my, data);
    const th = Number(t?.heightStep) || 0;
    // Cliffs occlude mainly from the lower side. If the wall cell isn't higher than
    // the observer plateau, don't treat it as a hard LOS blocker.
    if (th > playerHeightStep) return true;
  }
  if (isPropBlocking(mx, my, data)) return true;
  return false;
}

function blocksVisionAtCoarseCell(cx, cy, data, playerHeightStep) {
  const cell = fogState.coarseCellSize;
  const fx = cx * cell;
  const fy = cy * cell;
  // Sample center + corners for robust occlusion while staying cheap.
  const samples = [
    [fx + Math.floor(cell * 0.5), fy + Math.floor(cell * 0.5)],
    [fx, fy],
    [fx + cell - 1, fy],
    [fx, fy + cell - 1],
    [fx + cell - 1, fy + cell - 1]
  ];
  for (const [mx, my] of samples) {
    if (blocksVisionAtFineCell(mx, my, data, playerHeightStep)) return true;
  }
  return false;
}

/**
 * Recomputes currently visible cells (and merges into discovered cells) by casting rays.
 * Writes into the provided `targetVisible` buffer (or `fogState.visible` if null).
 * @returns {{ px: number, py: number }} player coarse cell used
 */
function recomputeVisibilityInto(data, player, cfg, targetVisible) {
  ensureFogBuffers(data);
  const { coarseW, coarseH, coarseCellSize, discovered } = fogState;
  const vis = targetVisible || fogState.visible;
  if (!vis) return { px: -1, py: -1 };
  vis.fill(0);

  const playerMx = Math.floor(Number(player?.visualX ?? player?.x) || 0);
  const playerMy = Math.floor(Number(player?.visualY ?? player?.y) || 0);
  const playerHeightStep = Number(getMicroTile(playerMx, playerMy, data)?.heightStep) || 0;
  const px = Math.floor(playerMx / coarseCellSize);
  const py = Math.floor(playerMy / coarseCellSize);
  const radius = Math.max(4, Math.floor(Number(cfg.radiusTiles) || DEFAULTS.radiusTiles));
  const coarseRadius = Math.max(2, Math.ceil(radius / coarseCellSize));
  const r2 = coarseRadius * coarseRadius;
  const rays = Math.max(32, Math.floor(Number(cfg.rayCount) || DEFAULTS.rayCount));
  const step = Math.max(0.1, Number(cfg.rayStepTiles) || DEFAULTS.rayStepTiles);
  const coarseStep = Math.max(0.25, step / coarseCellSize);
  const maxSteps = Math.ceil(coarseRadius / coarseStep) + 2;

  if (!inBounds(px, py, coarseW, coarseH)) return { px, py };

  // Always reveal a small neighborhood around the player.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx * dx + dy * dy > 2) continue;
      const cx2 = px + dx, cy2 = py + dy;
      if (inBounds(cx2, cy2, coarseW, coarseH)) {
        const k = idx(cx2, cy2, coarseW);
        vis[k] = 1;
        if (discovered) discovered[k] = 1;
      }
    }
  }

  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const ax = Math.cos(a) * coarseStep;
    const ay = Math.sin(a) * coarseStep;
    let sx = px + 0.5;
    let sy = py + 0.5;
    let lastCx = px;
    let lastCy = py;

    for (let s = 0; s < maxSteps; s++) {
      sx += ax;
      sy += ay;
      const cx = Math.floor(sx);
      const cy = Math.floor(sy);
      if (cx === lastCx && cy === lastCy) continue;
      lastCx = cx;
      lastCy = cy;
      if (!inBounds(cx, cy, coarseW, coarseH)) break;
      const ddx = cx - px;
      const ddy = cy - py;
      if (ddx * ddx + ddy * ddy > r2) break;
      const k = idx(cx, cy, coarseW);
      vis[k] = 1;
      if (discovered) discovered[k] = 1;
      if (blocksVisionAtCoarseCell(cx, cy, data, playerHeightStep)) break;
    }
  }

  return { px, py };
}

// --- Deferred (async) fog recomputation state ---
const _deferred = {
  scheduled: false,
  ready: false,
  buffer: /** @type {Uint8Array | null} */ (null),
  resultPx: -1,
  resultPy: -1,
  resultAtMs: 0
};

/** Commit a completed deferred computation into fogState. */
function commitDeferred() {
  if (!_deferred.ready || !_deferred.buffer || !fogState.visible) return;
  const src = _deferred.buffer;
  const dst = fogState.visible;
  const len = Math.min(src.length, dst.length);
  // Hot copy — typed array set is faster than manual loop.
  dst.set(src.length === len ? src : src.subarray(0, len));
  fogState.lastPlayerCx = _deferred.resultPx;
  fogState.lastPlayerCy = _deferred.resultPy;
  fogState.lastComputedAtMs = _deferred.resultAtMs;
  _deferred.ready = false;
  _deferred.scheduled = false;
}

/** Schedule raycast to run between frames (setTimeout(0) or requestIdleCallback). */
function scheduleDeferredRecompute(data, player, cfg) {
  if (_deferred.scheduled) return;
  _deferred.scheduled = true;
  _deferred.ready = false;
  const size = fogState.coarseW * fogState.coarseH;
  if (!_deferred.buffer || _deferred.buffer.length !== size) {
    _deferred.buffer = new Uint8Array(size);
  }
  const buf = _deferred.buffer;
  // Capture reference — data is a long-lived object, safe to read asynchronously.
  const capturedData = data;
  const capturedPlayer = { visualX: player?.visualX, x: player?.x, visualY: player?.visualY, y: player?.y };
  const capturedCfg = { ...cfg };

  const doWork = () => {
    const { px, py } = recomputeVisibilityInto(capturedData, capturedPlayer, capturedCfg, buf);
    _deferred.resultPx = px;
    _deferred.resultPy = py;
    _deferred.resultAtMs = getNowMs();
    _deferred.ready = true;
  };
  // requestIdleCallback with a tight deadline keeps us off the render frame
  // but ensures the result lands before the next few frames.
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(doWork, { timeout: 33 });
  } else {
    setTimeout(doWork, 0);
  }
}

/**
 * @param {object} data
 * @param {object} player
 * @param {{
 *   enabled?: boolean,
 *   radiusTiles?: number,
 *   recomputeEveryMs?: number,
 *   rayCount?: number,
 *   rayStepTiles?: number,
 *   unseenAlpha?: number,
 *   exploredAlpha?: number,
 *   preciseOccluders?: boolean
 * }} [opts]
 */
export function getPlayVisionFogState(data, player, opts = {}) {
  const cfgIn = opts && typeof opts === 'object' ? opts : {};
  const cfg = {
    ...DEFAULTS,
    ...cfgIn
  };
  if (Number.isFinite(Number(cfg.downsampleCellSize))) {
    const nextCell = Math.max(1, Math.floor(Number(cfg.downsampleCellSize)));
    if (nextCell !== fogState.coarseCellSize) {
      DEFAULTS.downsampleCellSize = nextCell;
      fogState.fingerprint = '';
    }
  }
  ensureFogBuffers(data);
  if (!cfg.enabled) {
    return {
      enabled: false,
      radiusTiles: cfg.radiusTiles,
      unseenAlpha: cfg.unseenAlpha,
      exploredAlpha: cfg.exploredAlpha,
      isVisible: () => true,
      isDiscovered: () => true
    };
  }

  const now = getNowMs();
  const playerMx = Math.floor(Number(player?.visualX ?? player?.x) || 0);
  const playerMy = Math.floor(Number(player?.visualY ?? player?.y) || 0);
  const playerCx = Math.floor(playerMx / Math.max(1, fogState.coarseCellSize));
  const playerCy = Math.floor(playerMy / Math.max(1, fogState.coarseCellSize));

  // Commit any previously-deferred result before checking staleness.
  commitDeferred();

  const needsRecompute =
    fogState.lastPlayerCx !== playerCx ||
    fogState.lastPlayerCy !== playerCy ||
    now - fogState.lastComputedAtMs >= Math.max(30, Number(cfg.recomputeEveryMs) || DEFAULTS.recomputeEveryMs);
  if (needsRecompute) {
    const isFirstCompute = fogState.lastComputedAtMs === 0;
    if (isFirstCompute) {
      // First frame: compute synchronously so the screen isn't all-black.
      const { px, py } = recomputeVisibilityInto(data, player, cfg, null);
      fogState.lastPlayerCx = px;
      fogState.lastPlayerCy = py;
      fogState.lastComputedAtMs = getNowMs();
    } else {
      // Subsequent: defer to avoid blocking the render frame.
      scheduleDeferredRecompute(data, player, cfg);
    }
  }

  return {
    enabled: true,
    radiusTiles: cfg.radiusTiles,
    unseenAlpha: Math.max(0, Math.min(1, Number(cfg.unseenAlpha))),
    exploredAlpha: Math.max(0, Math.min(1, Number(cfg.exploredAlpha))),
    isVisible: (mx, my) => {
      if (!fogState.visible) return false;
      const cx = Math.floor(mx / Math.max(1, fogState.coarseCellSize));
      const cy = Math.floor(my / Math.max(1, fogState.coarseCellSize));
      if (!inBounds(cx, cy, fogState.coarseW, fogState.coarseH)) return false;
      return fogState.visible[idx(cx, cy, fogState.coarseW)] === 1;
    },
    isDiscovered: (mx, my) => {
      if (!fogState.discovered) return false;
      const cx = Math.floor(mx / Math.max(1, fogState.coarseCellSize));
      const cy = Math.floor(my / Math.max(1, fogState.coarseCellSize));
      if (!inBounds(cx, cy, fogState.coarseW, fogState.coarseH)) return false;
      return fogState.discovered[idx(cx, cy, fogState.coarseW)] === 1;
    }
  };
}

/**
 * Draws black unexplored + dim explored fog overlay in play mode.
 * Batches into two fill passes (unseen / explored) to minimise fillStyle switches.
 */
export function drawPlayVisionFogOverlay(ctx, vision, startX, startY, endX, endY, tileW, tileH) {
  if (!vision?.enabled) return;
  const unseenAlpha = vision.unseenAlpha ?? DEFAULTS.unseenAlpha;
  const exploredAlpha = vision.exploredAlpha ?? DEFAULTS.exploredAlpha;
  const cell = Math.max(1, fogState.coarseCellSize || 1);
  const x0 = Math.floor((Number(startX) || 0) / cell);
  const y0 = Math.floor((Number(startY) || 0) / cell);
  const x1 = Math.ceil((Number(endX) || 0) / cell);
  const y1 = Math.ceil((Number(endY) || 0) / cell);
  const cellW = tileW * cell + 1;
  const cellH = tileH * cell + 1;
  ctx.save();
  // Pass 1: unseen (full black)
  ctx.fillStyle = `rgba(0,0,0,${unseenAlpha})`;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      const mx = cx * cell;
      const my = cy * cell;
      if (!vision.isDiscovered(mx, my)) {
        ctx.fillRect(mx * tileW, my * tileH, cellW, cellH);
      }
    }
  }
  // Pass 2: discovered-but-not-visible (dim)
  ctx.fillStyle = `rgba(0,0,0,${exploredAlpha})`;
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      const mx = cx * cell;
      const my = cy * cell;
      if (vision.isDiscovered(mx, my) && !vision.isVisible(mx, my)) {
        ctx.fillRect(mx * tileW, my * tileH, cellW, cellH);
      }
    }
  }
  ctx.restore();
}
