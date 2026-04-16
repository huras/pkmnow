/** @type {Map<string, number>} */
const jumpSerialByEntityKey = new Map();
/** @type {Array<{ x: number, y: number, age: number, maxAge: number, seed: number }>} */
const activeJumpRings = [];
let jumpRingLastTimeSec = null;
/** @type {Array<{ x: number, y: number, vx: number, vy: number, age: number, maxAge: number, seed: number }>} */
const activeRunDustPuffs = [];
/** @type {Map<string, number>} */
const runDustLastSpawnByEntityKey = new Map();
let runDustLastTimeSec = null;

export function spawnJumpRingAt(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  activeJumpRings.push({
    x,
    y,
    age: 0,
    maxAge: 0.34,
    seed: (x * 92821.11 + y * 71933.07) % 1
  });
  if (activeJumpRings.length > 72) {
    activeJumpRings.splice(0, activeJumpRings.length - 72);
  }
}

export function updateJumpRings(timeSec) {
  const t = Number(timeSec) || 0;
  const dt =
    jumpRingLastTimeSec == null ? 0 : Math.max(0, Math.min(0.08, t - jumpRingLastTimeSec));
  jumpRingLastTimeSec = t;
  if (dt <= 0) return;
  for (let i = activeJumpRings.length - 1; i >= 0; i--) {
    const fx = activeJumpRings[i];
    fx.age += dt;
    if (fx.age >= fx.maxAge) activeJumpRings.splice(i, 1);
  }
}

export function trackJumpStartRings(renderItems) {
  const seen = new Set();
  for (const item of renderItems) {
    if (item.type !== 'player' && item.type !== 'wild') continue;
    const key = item.type === 'player' ? 'player' : `wild:${item.entityKey ?? ''}`;
    if (!key || key === 'wild:') continue;
    seen.add(key);
    const serialRaw = Number(item.jumpSerial);
    const serial = Number.isFinite(serialRaw) ? Math.max(0, Math.floor(serialRaw)) : 0;
    const prevSerial = jumpSerialByEntityKey.get(key);
    if (prevSerial != null && serial > prevSerial) {
      spawnJumpRingAt((item.x ?? 0) + 0.5, (item.y ?? 0) + 0.5);
    }
    jumpSerialByEntityKey.set(key, serial);
  }
  for (const k of jumpSerialByEntityKey.keys()) {
    if (!seen.has(k)) jumpSerialByEntityKey.delete(k);
  }
}

export function spawnRunDustAt(x, y, vx, vy, seed = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  activeRunDustPuffs.push({
    x,
    y,
    vx: Number.isFinite(vx) ? vx : 0,
    vy: Number.isFinite(vy) ? vy : 0,
    age: 0,
    maxAge: 0.24,
    seed
  });
  if (activeRunDustPuffs.length > 180) {
    activeRunDustPuffs.splice(0, activeRunDustPuffs.length - 180);
  }
}

export function updateRunDustPuffs(timeSec) {
  const t = Number(timeSec) || 0;
  const dt =
    runDustLastTimeSec == null ? 0 : Math.max(0, Math.min(0.08, t - runDustLastTimeSec));
  runDustLastTimeSec = t;
  if (dt <= 0) return;
  for (let i = activeRunDustPuffs.length - 1; i >= 0; i--) {
    const puff = activeRunDustPuffs[i];
    puff.age += dt;
    puff.x += puff.vx * dt * 0.08;
    puff.y += puff.vy * dt * 0.08;
    puff.vx *= Math.max(0, 1 - dt * 9);
    puff.vy *= Math.max(0, 1 - dt * 9);
    if (puff.age >= puff.maxAge) activeRunDustPuffs.splice(i, 1);
  }
}

export function trackRunningDust(renderItems, timeSec) {
  const t = Number(timeSec) || 0;
  const seen = new Set();
  for (const item of renderItems) {
    if (item.type !== 'player' && item.type !== 'wild') continue;
    const key = item.type === 'player' ? 'player' : `wild:${item.entityKey ?? ''}`;
    if (!key || key === 'wild:') continue;
    seen.add(key);
    if (!item.grounded || !item.animMoving) continue;
    const vx = Number(item.vx) || 0;
    const vy = Number(item.vy) || 0;
    const speed = Math.hypot(vx, vy);
    if (speed < 0.1) continue;
    const spawnInterval = item.type === 'player' ? 0.06 : 0.09;
    const last = runDustLastSpawnByEntityKey.get(key) ?? -1e9;
    if (t - last < spawnInterval) continue;
    runDustLastSpawnByEntityKey.set(key, t);
    const nx = vx / speed;
    const ny = vy / speed;
    const jitter =
      ((Math.sin((item.x ?? 0) * 11.13 + (item.y ?? 0) * 7.91 + t * 31.7) + 1) * 0.5 - 0.5) *
      0.08;
    spawnRunDustAt(
      (item.x ?? 0) + 0.5 - nx * 0.24 + jitter,
      (item.y ?? 0) + 0.62 - ny * 0.18,
      -vx * 0.22,
      -vy * 0.22,
      ((item.x ?? 0) * 17.17 + (item.y ?? 0) * 29.9 + t) % 1
    );
  }
  for (const k of runDustLastSpawnByEntityKey.keys()) {
    if (!seen.has(k)) runDustLastSpawnByEntityKey.delete(k);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawRunDustPuff(ctx, puff, tileW, tileH, snapPx) {
  const t = Math.max(0, Math.min(1, puff.age / Math.max(0.001, puff.maxAge)));
  const a = 1 - t;
  const px = snapPx(puff.x * tileW);
  const py = snapPx(puff.y * tileH);
  const rx = Math.max(1.5, tileW * (0.05 + 0.085 * t));
  const ry = Math.max(1, tileH * (0.03 + 0.055 * t));
  const hue = 40 + Math.floor((puff.seed || 0) * 12);
  ctx.fillStyle = `hsla(${hue}, 30%, 74%, ${0.32 * a})`;
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawJumpRing(ctx, fx, tileW, tileH, snapPx) {
  const t = Math.max(0, Math.min(1, fx.age / Math.max(0.001, fx.maxAge)));
  const a = 1 - t;
  const px = snapPx(fx.x * tileW);
  const py = snapPx(fx.y * tileH);
  const baseR = Math.max(5, Math.min(tileW, tileH) * 0.22);
  const rx = baseR + Math.min(tileW, tileH) * 0.42 * t;
  const ry = Math.max(2, rx * 0.46);
  const hue = 188 + Math.floor((fx.seed || 0) * 20);
  ctx.strokeStyle = `hsla(${hue}, 95%, 78%, ${0.85 * a})`;
  ctx.lineWidth = Math.max(1.6, tileW * 0.05);
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export function getActiveJumpRings() { return activeJumpRings; }
export function getActiveRunDustPuffs() { return activeRunDustPuffs; }
