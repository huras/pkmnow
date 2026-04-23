import { MACRO_TILE_STRIDE } from '../chunking.js';

const GLOBAL_MAP_TRAIL_MAX_POINTS = 9000;
const GLOBAL_MAP_TRAIL_MIN_STEP_MICRO = 2.2;
const GLOBAL_MAP_TRAIL_TELEPORT_JUMP_MICRO = 22;
const GLOBAL_MAP_TRAIL_RECENT_WINDOW_MS = 30_000;
const GLOBAL_MAP_TRAIL_RECENT_MAX_POINTS = 512;
const GLOBAL_MAP_TRAIL_STORAGE_KEY = 'pkmn_global_map_player_trail_v1';
const GLOBAL_MAP_TRAIL_PERSIST_MIN_MS = 1200;
const WORLD_MAP_PLAYER_WAVE_SPAWN_MS = 520;
const WORLD_MAP_PLAYER_WAVE_MAX_AGE_MS = 1450;
const WORLD_MAP_PLAYER_WAVE_MAX_ACTIVE = 10;

let globalMapTrailFingerprint = '';
/** @type {Array<{ x: number, y: number }>} */
let globalMapPlayerTrailMicro = [];
/** @type {Array<{ x: number, y: number, tMs: number }>} */
let globalMapPlayerTrailRecentMicro = [];
let globalMapTrailDirty = false;
let globalMapTrailLastPersistAtMs = 0;
/** @type {Array<{ gx: number, gy: number, ageMs: number, maxAgeMs: number }>} */
let worldMapPlayerWaves = [];
let worldMapPlayerWaveLastTickMs = 0;
let worldMapPlayerWaveNextSpawnAtMs = 0;
let worldMapPlayerWaveFingerprint = '';

export function getGlobalMapTrailFingerprint() {
  return globalMapTrailFingerprint;
}

export function getGlobalMapPlayerTrailMicro() {
  return globalMapPlayerTrailMicro;
}

export function getGlobalMapPlayerTrailRecentMicro() {
  return globalMapPlayerTrailRecentMicro;
}

export function mapFingerprintForTrail(data) {
  if (!data) return '';
  const w = Math.max(0, Math.floor(Number(data.width) || 0));
  const h = Math.max(0, Math.floor(Number(data.height) || 0));
  const seed = Number.isFinite(Number(data.seed)) ? Number(data.seed) : 0;
  return `${w}x${h}@${seed}`;
}

export function resetWorldMapPlayerWaves(nowMs, mapFp) {
  worldMapPlayerWaves = [];
  worldMapPlayerWaveLastTickMs = Number.isFinite(nowMs) ? nowMs : 0;
  worldMapPlayerWaveNextSpawnAtMs = Number.isFinite(nowMs) ? nowMs : 0;
  worldMapPlayerWaveFingerprint = String(mapFp || '');
}

export function resetWorldMapPlayerWaveTick() {
  worldMapPlayerWaveLastTickMs = 0;
}

export function resetWorldMapPlayerWavesIfMapChanged(nowMs, mapFp) {
  if (worldMapPlayerWaveFingerprint && worldMapPlayerWaveFingerprint !== mapFp) {
    resetWorldMapPlayerWaves(nowMs, mapFp);
  }
}

/**
 * @param {number} nowMs
 * @param {{ x: number, y: number } | null} mapPlayerMicro
 * @param {string} mapFp
 */
export function tickWorldMapPlayerWaves(nowMs, mapPlayerMicro, mapFp) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  if (worldMapPlayerWaveFingerprint !== mapFp) {
    resetWorldMapPlayerWaves(now, mapFp);
  }
  if (!Number.isFinite(worldMapPlayerWaveLastTickMs) || worldMapPlayerWaveLastTickMs <= 0) {
    worldMapPlayerWaveLastTickMs = now;
  }
  const dtMs = Math.max(0, Math.min(160, now - worldMapPlayerWaveLastTickMs));
  worldMapPlayerWaveLastTickMs = now;
  if (dtMs > 0) {
    for (let i = worldMapPlayerWaves.length - 1; i >= 0; i--) {
      const fx = worldMapPlayerWaves[i];
      fx.ageMs += dtMs;
      if (fx.ageMs >= fx.maxAgeMs) worldMapPlayerWaves.splice(i, 1);
    }
  }
  if (!mapPlayerMicro) return;
  const mx = Number(mapPlayerMicro.x);
  const my = Number(mapPlayerMicro.y);
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
  if (!Number.isFinite(worldMapPlayerWaveNextSpawnAtMs) || worldMapPlayerWaveNextSpawnAtMs <= 0) {
    worldMapPlayerWaveNextSpawnAtMs = now;
  }
  if (now < worldMapPlayerWaveNextSpawnAtMs) return;
  worldMapPlayerWaves.push({
    gx: mx / MACRO_TILE_STRIDE,
    gy: my / MACRO_TILE_STRIDE,
    ageMs: 0,
    maxAgeMs: WORLD_MAP_PLAYER_WAVE_MAX_AGE_MS
  });
  if (worldMapPlayerWaves.length > WORLD_MAP_PLAYER_WAVE_MAX_ACTIVE) {
    worldMapPlayerWaves.splice(0, worldMapPlayerWaves.length - WORLD_MAP_PLAYER_WAVE_MAX_ACTIVE);
  }
  worldMapPlayerWaveNextSpawnAtMs = now + WORLD_MAP_PLAYER_WAVE_SPAWN_MS;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 * @param {object} data
 * @param {{ scale: number, ox: number, oy: number } | null} worldMapCamera
 */
export function drawWorldMapPlayerWaves(ctx, cw, ch, data, worldMapCamera) {
  if (!worldMapPlayerWaves.length) return;
  const tileW = worldMapCamera?.scale ? worldMapCamera.scale : cw / data.width;
  const tileH = worldMapCamera?.scale ? worldMapCamera.scale : ch / data.height;
  const ox = Number(worldMapCamera?.ox) || 0;
  const oy = Number(worldMapCamera?.oy) || 0;
  const unit = Math.max(1, Math.min(tileW, tileH));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const fx of worldMapPlayerWaves) {
    const maxAge = Math.max(1, Number(fx.maxAgeMs) || 1);
    const t = Math.max(0, Math.min(1, (Number(fx.ageMs) || 0) / maxAge));
    const fade = 1 - t;
    if (fade <= 0.01) continue;
    const px = (Number(fx.gx) - ox + 0.5) * tileW;
    const py = (Number(fx.gy) - oy + 0.5) * tileH;
    if (px < -40 || py < -40 || px > cw + 40 || py > ch + 40) continue;
    const radius = Math.max(4, unit * (0.55 + t * 3.3));
    ctx.strokeStyle = `rgba(120, 235, 255, ${(0.82 * fade).toFixed(4)})`;
    ctx.lineWidth = Math.max(1.2, unit * (0.16 - t * 0.08));
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {string} fp
 */
export function loadPersistedGlobalMapTrail(fp) {
  globalMapTrailFingerprint = fp;
  globalMapPlayerTrailMicro = [];
  globalMapPlayerTrailRecentMicro = [];
  if (!fp) return;
  try {
    const raw = localStorage.getItem(GLOBAL_MAP_TRAIL_STORAGE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (!payload || payload.fingerprint !== fp || !Array.isArray(payload.points)) return;
    const kept = [];
    for (const row of payload.points) {
      const x = Number(row?.x);
      const y = Number(row?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      kept.push({ x, y });
      if (kept.length >= GLOBAL_MAP_TRAIL_MAX_POINTS) break;
    }
    globalMapPlayerTrailMicro = kept;
  } catch {}
}

/**
 * @param {boolean} force
 */
export function persistGlobalMapTrailIfNeeded(force = false) {
  if (!globalMapTrailDirty || !globalMapTrailFingerprint) return;
  const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  if (!force && nowMs - globalMapTrailLastPersistAtMs < GLOBAL_MAP_TRAIL_PERSIST_MIN_MS) return;
  try {
    localStorage.setItem(
      GLOBAL_MAP_TRAIL_STORAGE_KEY,
      JSON.stringify({
        fingerprint: globalMapTrailFingerprint,
        points: globalMapPlayerTrailMicro
      })
    );
    globalMapTrailDirty = false;
    globalMapTrailLastPersistAtMs = nowMs;
  } catch {}
}

/**
 * @param {number} x
 * @param {number} y
 * @param {object} data
 */
function clampMicroToMapBounds(x, y, data) {
  const gw = Math.max(1, Number(data.width) * MACRO_TILE_STRIDE);
  const gh = Math.max(1, Number(data.height) * MACRO_TILE_STRIDE);
  const pad = 0.51;
  return {
    x: Math.max(pad, Math.min(gw - pad, Number(x) || 0)),
    y: Math.max(pad, Math.min(gh - pad, Number(y) || 0))
  };
}

/**
 * @param {number} nowMs
 */
export function pruneRecentGlobalMapTrail(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = now - GLOBAL_MAP_TRAIL_RECENT_WINDOW_MS;
  while (globalMapPlayerTrailRecentMicro.length > 0 && globalMapPlayerTrailRecentMicro[0].tMs < cutoff) {
    globalMapPlayerTrailRecentMicro.shift();
  }
  if (globalMapPlayerTrailRecentMicro.length > GLOBAL_MAP_TRAIL_RECENT_MAX_POINTS) {
    globalMapPlayerTrailRecentMicro.splice(
      0,
      globalMapPlayerTrailRecentMicro.length - GLOBAL_MAP_TRAIL_RECENT_MAX_POINTS
    );
  }
}

/**
 * @param {object} data
 * @param {import('../player.js').player | null | undefined} playerRef
 * @param {'map' | 'play'} appMode
 */
export function recordGlobalMapTrailPoint(data, playerRef, appMode) {
  if (appMode !== 'play' || !data || !playerRef) return;
  const fp = mapFingerprintForTrail(data);
  if (!fp) return;
  if (globalMapTrailFingerprint !== fp) {
    loadPersistedGlobalMapTrail(fp);
  }
  const px = Number(playerRef.visualX ?? playerRef.x);
  const py = Number(playerRef.visualY ?? playerRef.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  const clamped = clampMicroToMapBounds(px, py, data);
  const nowMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  pruneRecentGlobalMapTrail(nowMs);
  const recentLast = globalMapPlayerTrailRecentMicro[globalMapPlayerTrailRecentMicro.length - 1];
  if (recentLast) {
    const rdx = clamped.x - recentLast.x;
    const rdy = clamped.y - recentLast.y;
    if (rdx * rdx + rdy * rdy >= GLOBAL_MAP_TRAIL_MIN_STEP_MICRO * GLOBAL_MAP_TRAIL_MIN_STEP_MICRO) {
      globalMapPlayerTrailRecentMicro.push({ x: clamped.x, y: clamped.y, tMs: nowMs });
    }
  } else {
    globalMapPlayerTrailRecentMicro.push({ x: clamped.x, y: clamped.y, tMs: nowMs });
  }
  pruneRecentGlobalMapTrail(nowMs);
  const last = globalMapPlayerTrailMicro[globalMapPlayerTrailMicro.length - 1];
  if (last) {
    const dx = clamped.x - last.x;
    const dy = clamped.y - last.y;
    if (dx * dx + dy * dy < GLOBAL_MAP_TRAIL_MIN_STEP_MICRO * GLOBAL_MAP_TRAIL_MIN_STEP_MICRO) return;
  }
  globalMapPlayerTrailMicro.push(clamped);
  if (globalMapPlayerTrailMicro.length > GLOBAL_MAP_TRAIL_MAX_POINTS) {
    globalMapPlayerTrailMicro.splice(0, globalMapPlayerTrailMicro.length - GLOBAL_MAP_TRAIL_MAX_POINTS);
  }
  globalMapTrailDirty = true;
  persistGlobalMapTrailIfNeeded(false);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ x: number, y: number }>} trailMicro
 * @param {object} data
 * @param {number} cw
 * @param {number} ch
 * @param {{ scale: number, ox: number, oy: number } | null} [mapCamera]
 */
export function drawGlobalMapPlayerTrail(ctx, trailMicro, data, cw, ch, mapCamera = null) {
  if (!Array.isArray(trailMicro) || trailMicro.length < 2 || !data?.width || !data?.height) return;
  const tileW = mapCamera?.scale ? mapCamera.scale : cw / data.width;
  const tileH = mapCamera?.scale ? mapCamera.scale : ch / data.height;
  const ox = mapCamera?.ox || 0;
  const oy = mapCamera?.oy || 0;
  const lineW = Math.max(1.3, Math.min(3.2, Math.min(tileW, tileH) * 0.2));
  const teleportJumpSq = GLOBAL_MAP_TRAIL_TELEPORT_JUMP_MICRO * GLOBAL_MAP_TRAIL_TELEPORT_JUMP_MICRO;
  const pts = [];
  for (let i = 0; i < trailMicro.length; i++) {
    const p = trailMicro[i];
    const mx = Number(p?.x);
    const my = Number(p?.y);
    if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;
    const gx = mx / MACRO_TILE_STRIDE;
    const gy = my / MACRO_TILE_STRIDE;
    pts.push({
      mx,
      my,
      px: (gx - ox + 0.5) * tileW,
      py: (gy - oy + 0.5) * tileH
    });
  }
  if (pts.length < 2) return;

  const strokeMainSegment = (startIdx, endIdx) => {
    if (endIdx - startIdx < 1) return;
    ctx.beginPath();
    for (let i = startIdx; i <= endIdx; i++) {
      const p = pts[i];
      if (i === startIdx) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    }
    ctx.strokeStyle = 'rgba(36, 178, 255, 0.9)';
    ctx.lineWidth = lineW + 1.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(176, 238, 255, 0.78)';
    ctx.lineWidth = lineW;
    ctx.stroke();
  };

  const strokeTeleportJump = (a, b) => {
    ctx.save();
    ctx.setLineDash([Math.max(4, lineW * 2.4), Math.max(3, lineW * 1.7)]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = 'rgba(176, 238, 255, 0.5)';
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.stroke();
    ctx.restore();
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'screen';
  let segStart = 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const dx = curr.mx - prev.mx;
    const dy = curr.my - prev.my;
    const isTeleportJump = dx * dx + dy * dy > teleportJumpSq;
    if (!isTeleportJump) continue;
    strokeMainSegment(segStart, i - 1);
    strokeTeleportJump(prev, curr);
    segStart = i;
  }
  strokeMainSegment(segStart, pts.length - 1);
  ctx.restore();
}
