import { CHUNK_SIZE } from '../chunking.js';
import { seededHashInt } from '../tessellation-logic.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { imageCache } from '../image-cache.js';
import { PMD_DEFAULT_MON_ANIMS } from '../pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';

/** Janela 3×3 de overview tiles (macro) em torno do player. */
export const WILD_WINDOW_RADIUS = 1;

const SALT_SPAWN = 0x574c4450;

/** Raio de vagueio em coordenadas micro (~meio overview tile). */
const WANDER_RADIUS = CHUNK_SIZE * 0.42;
const WANDER_REPICK_MIN = 0.35;
const WANDER_REPICK_EXTRA = 1.1;
const MAX_SPEED = 1.65;

const DIRECTION_ROW_MAP = {
  down: 0,
  right: 2,
  up: 4,
  left: 6
};

/** @type {Map<string, object>} */
const entitiesByKey = new Map();

export function resetWildPokemonManager() {
  entitiesByKey.clear();
}

function pickAnimFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return 0;
}

function advanceWildPokemonAnim(entity, dt) {
  const ticks = dt * 60;
  entity.animRow = DIRECTION_ROW_MAP[entity.facing] ?? 0;
  const meta = entity.animMeta || null;

  if (entity.animMoving) {
    entity._walkPhase = (entity._walkPhase || 0) + ticks;
    const seq = meta?.walk?.durations?.length ? meta.walk.durations : PMD_DEFAULT_MON_ANIMS.Walk;
    const total = seq.reduce((a, b) => a + b, 0);
    const loopTick = entity._walkPhase % total;
    entity.animFrame = pickAnimFrame(seq, loopTick);
    entity.idleTimer = 0;
  } else {
    entity.idleTimer = (entity.idleTimer || 0) + ticks;
    const seq = meta?.idle?.durations?.length ? meta.idle.durations : PMD_DEFAULT_MON_ANIMS.Idle;
    const total = seq.reduce((a, b) => a + b, 0);
    const loopTick = entity.idleTimer % total;
    entity.animFrame = pickAnimFrame(seq, loopTick);
  }
}

function updateWildMotion(entity, dt) {
  entity.wanderTimer -= dt;
  if (entity.wanderTimer <= 0) {
    entity.wanderTimer = WANDER_REPICK_MIN + Math.random() * WANDER_REPICK_EXTRA;
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.25 + Math.random() * MAX_SPEED * 0.85;
    entity.vx = Math.cos(ang) * sp;
    entity.vy = Math.sin(ang) * sp;
  }

  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;

  const dx = entity.x - entity.centerX;
  const dy = entity.y - entity.centerY;
  const dist = Math.hypot(dx, dy);
  if (dist > WANDER_RADIUS && dist > 1e-6) {
    const nx = dx / dist;
    const ny = dy / dist;
    entity.x = entity.centerX + nx * WANDER_RADIUS;
    entity.y = entity.centerY + ny * WANDER_RADIUS;
    const dot = entity.vx * nx + entity.vy * ny;
    if (dot > 0) {
      entity.vx -= nx * dot * 1.75;
      entity.vy -= ny * dot * 1.75;
    }
  }

  const spd = Math.hypot(entity.vx, entity.vy);
  entity.animMoving = spd > 0.1;
  if (spd > 0.06) {
    if (Math.abs(entity.vx) > Math.abs(entity.vy)) {
      entity.facing = entity.vx > 0 ? 'right' : 'left';
    } else {
      entity.facing = entity.vy > 0 ? 'down' : 'up';
    }
  }
}

/**
 * Mantém no máximo (2r+1)² overview tiles; só spawns novos ao entrar na janela.
 * @param {object} data mapa gerado
 * @param {number} playerMicroX tile micro X
 * @param {number} playerMicroY tile micro Y
 */
export function syncWildPokemonWindow(data, playerMicroX, playerMicroY) {
  if (!data) return;

  const w = data.width;
  const h = data.height;
  const pmx = Math.floor(playerMicroX / CHUNK_SIZE);
  const pmy = Math.floor(playerMicroY / CHUNK_SIZE);

  const needed = new Set();
  for (let dy = -WILD_WINDOW_RADIUS; dy <= WILD_WINDOW_RADIUS; dy++) {
    for (let dx = -WILD_WINDOW_RADIUS; dx <= WILD_WINDOW_RADIUS; dx++) {
      const mx = pmx + dx;
      const my = pmy + dy;
      if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
      needed.add(`${mx},${my}`);
    }
  }

  for (const k of entitiesByKey.keys()) {
    if (!needed.has(k)) entitiesByKey.delete(k);
  }

  for (const k of needed) {
    if (entitiesByKey.has(k)) continue;

    const [mx, my] = k.split(',').map(Number);
    const biomeId = data.biomes[my * w + mx];
    const pool = getEncounters(biomeId);
    const pick = seededHashInt(mx, my, data.seed ^ SALT_SPAWN) % pool.length;
    const dex = encounterNameToDex(pool[pick]);
    if (dex == null) continue;

    const centerX = (mx + 0.5) * CHUNK_SIZE;
    const centerY = (my + 0.5) * CHUNK_SIZE;
    const jx = (seededHashInt(mx + 31, my + 11, data.seed) % 1000) / 1000 - 0.5;
    const jy = (seededHashInt(mx + 71, my + 3, data.seed) % 1000) / 1000 - 0.5;

    const entity = {
      key: k,
      macroX: mx,
      macroY: my,
      centerX,
      centerY,
      x: centerX + jx * 5,
      y: centerY + jy * 5,
      vx: 0,
      vy: 0,
      dexId: dex,
      animMeta: getDexAnimMeta(dex),
      facing: 'down',
      animRow: 0,
      animFrame: 0,
      idleTimer: 0,
      _walkPhase: 0,
      wanderTimer: 0,
      animMoving: false
    };
    entitiesByKey.set(k, entity);
    ensurePokemonSheetsLoaded(imageCache, dex);
  }
}

export function updateWildPokemon(dt, data) {
  if (!data) return;
  for (const e of entitiesByKey.values()) {
    updateWildMotion(e, dt);
    advanceWildPokemonAnim(e, dt);
  }
}

export function getWildPokemonEntities() {
  return Array.from(entitiesByKey.values());
}
