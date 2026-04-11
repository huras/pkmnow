import { CHUNK_SIZE } from '../chunking.js';
import { seededHashInt } from '../tessellation-logic.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { imageCache } from '../image-cache.js';
import { PMD_DEFAULT_MON_ANIMS } from '../pokemon/pmd-default-timing.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';
import { canWalkMicroTile } from '../walkability.js';
import { getSpeciesBehavior } from './pokemon-behavior.js';

/** Janela 3×3 de overview tiles (macro) em torno do player. */
export const WILD_WINDOW_RADIUS = 2;

const SALT_SPAWN = 0x574c4450;

/** Raio de vagueio em coordenadas micro (~meio overview tile). */
const WANDER_RADIUS = CHUNK_SIZE * 1.26; // ~3x
const WANDER_MOVE_MIN = 0.45;
const WANDER_MOVE_EXTRA = 1.2;
const WANDER_IDLE_MIN = 0.35;
const WANDER_IDLE_EXTRA = 1.0;
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

  // Handle emotion balloon animation timer
  if (entity.emotionType !== null) {
    entity.emotionAge += dt;
    // If not persistent, the balloon vanishes after completing its animation (1.0s to be safe)
    if (!entity.emotionPersist && entity.emotionAge > 1.2) {
      entity.emotionType = null;
    }
  }
}

function setEmotion(entity, type, persist = false) {
  // Prevent spamming the same emotion if already active
  if (entity.emotionType === type && entity.emotionAge < 2.0) return;
  entity.emotionType = type;
  entity.emotionAge = 0;
  entity.emotionPersist = persist;
}

function updateWildMotion(entity, dt, data, playerX, playerY) {
  const beh = entity.behavior;
  const dxP = entity.x - playerX;
  const dyP = entity.y - playerY;
  const distP = Math.hypot(dxP, dyP);

  const prevState = entity.aiState;

  // Wake up sleepers!
  if (entity.aiState === 'sleep') {
    if (distP < beh.alertRadius) {
      entity.aiState = 'alert';
      entity.alertTimer = 1.0;
      setEmotion(entity, 0, true); // !
      entity.animMoving = false;
    }
    return; // Don't wander while sleeping
  }

  // Player Awareness State Machine
  if (distP < beh.alertRadius) {
    if (beh.archetype === 'timid' || beh.archetype === 'skittish') {
      entity.aiState = 'flee';
      const nx = dxP / distP;
      const ny = dyP / distP;
      entity.vx = nx * beh.fleeSpeed;
      entity.vy = ny * beh.fleeSpeed;
      entity.wanderTimer = 0;
      entity.idlePauseTimer = 0;
    } else if (beh.archetype === 'aggressive') {
      entity.aiState = 'approach';
      if (distP > beh.stopDist) {
        const nx = -dxP / distP;
        const ny = -dyP / distP;
        entity.vx = nx * beh.approachSpeed;
        entity.vy = ny * beh.approachSpeed;
      } else {
        entity.vx = 0;
        entity.vy = 0;
      }
      entity.wanderTimer = 0;
      entity.idlePauseTimer = 0;
    } else if (beh.archetype === 'neutral') {
      if (entity.aiState !== 'alert') {
        entity.aiState = 'alert';
        entity.alertTimer = 1.0 + Math.random(); // stare for 1-2s
        entity.vx = 0;
        entity.vy = 0;
      }
    }
  } else if (distP >= beh.alertRadius * 1.5 && entity.aiState !== 'sleep') {
    entity.aiState = 'wander';
  }

  // Handle emotion triggers on state transition
  if (prevState !== entity.aiState) {
    if (entity.aiState === 'flee') {
      setEmotion(entity, 5, true); // Sweat drop 💧 while fully fleeing
    } else if (entity.aiState === 'approach') {
      setEmotion(entity, 4, true); // Angry 💢
    } else if (entity.aiState === 'alert') {
      setEmotion(entity, 0, true); // Exclamation ! (holds while staring)
    } else if (entity.aiState === 'wander' && prevState !== 'sleep') {
      setEmotion(entity, 1, false); // Question ? (lost track)
    }
  }

  // Check if staring too long (almost done)
  if (entity.aiState === 'alert' && entity.alertTimer < 0.3 && entity.emotionType === 0) {
    setEmotion(entity, 7, false); // Ellipsis ...
  }

  // Handle alert/stare state
  if (entity.aiState === 'alert') {
    entity.alertTimer -= dt;
    if (entity.alertTimer <= 0) {
      entity.aiState = 'wander';
    }
    // Face player
    if (Math.abs(dxP) > Math.abs(dyP)) {
      entity.facing = dxP > 0 ? 'left' : 'right';
    } else {
      entity.facing = dyP > 0 ? 'up' : 'down';
    }
    entity.animMoving = false;
    return;
  }

  // Handle wander state locomotion
  if (entity.aiState === 'wander') {
    if ((entity.idlePauseTimer || 0) > 0) {
      entity.idlePauseTimer -= dt;
      entity.vx = 0;
      entity.vy = 0;
      if (entity.idlePauseTimer < 0) entity.idlePauseTimer = 0;
    }

    if ((entity.idlePauseTimer || 0) > 0) {
      entity.animMoving = false;
      return;
    }

    entity.wanderTimer -= dt;
    if (entity.wanderTimer <= 0) {
      if (Math.random() < 0.34) {
        entity.idlePauseTimer = WANDER_IDLE_MIN + Math.random() * WANDER_IDLE_EXTRA;
        entity.wanderTimer = 0;
        entity.vx = 0;
        entity.vy = 0;
        entity.animMoving = false;
        
        // Random chance to be happy when idling!
        if (Math.random() < 0.15 && entity.emotionType === null) {
          setEmotion(entity, Math.random() < 0.5 ? 2 : 3, false); // ♪ or ♥
        }
        return;
      }

      entity.wanderTimer = WANDER_MOVE_MIN + Math.random() * WANDER_MOVE_EXTRA;
      const baseAng = Math.random() * Math.PI * 2;
      const sp = 0.18 + Math.random() * MAX_SPEED * 0.82;
      
      let bestVx = Math.cos(baseAng) * sp;
      let bestVy = Math.sin(baseAng) * sp;
      
      // Try 4 orthogonal directions from base angle to find walkable path
      for (let i = 0; i < 4; i++) {
        const a = baseAng + (Math.PI / 2) * i;
        const tvx = Math.cos(a) * sp;
        const tvy = Math.sin(a) * sp;
        if (canWalkMicroTile(entity.x + tvx * 0.5, entity.y + tvy * 0.5, data)) {
          bestVx = tvx;
          bestVy = tvy;
          break;
        }
      }
      entity.vx = bestVx;
      entity.vy = bestVy;
    }
  }

  // Apply velocity speculatively with terrain bounds checking
  const nx = entity.x + entity.vx * dt;
  const ny = entity.y + entity.vy * dt;
  
  if (!canWalkMicroTile(nx, ny, data)) {
    entity.vx = 0;
    entity.vy = 0;
    entity.wanderTimer = 0; // rethink next frame
    
    // Path blocked during locomotion -> Frustration/scribbles
    if (entity.aiState === 'wander' || entity.aiState === 'flee') {
      setEmotion(entity, 6, false); // 💬
    }
  } else {
    entity.x = nx;
    entity.y = ny;
  }

  // Clamp wander radius
  const dx = entity.x - entity.centerX;
  const dy = entity.y - entity.centerY;
  const dist = Math.hypot(dx, dy);
  if (dist > WANDER_RADIUS && dist > 1e-6) {
    const nxc = dx / dist;
    const nyc = dy / dist;
    const clampedX = entity.centerX + nxc * WANDER_RADIUS;
    const clampedY = entity.centerY + nyc * WANDER_RADIUS;
    
    if (canWalkMicroTile(clampedX, clampedY, data)) {
      entity.x = clampedX;
      entity.y = clampedY;
    }
    
    const dot = entity.vx * nxc + entity.vy * nyc;
    if (dot > 0) {
      entity.vx -= nxc * dot * 1.75;
      entity.vy -= nyc * dot * 1.75;
    }
  }

  // Update facing and animation state
  const spd = Math.hypot(entity.vx, entity.vy);
  entity.animMoving = spd > 0.1;

  if (entity.aiState === 'approach' && distP <= beh.stopDist) {
    if (Math.abs(dxP) > Math.abs(dyP)) {
      entity.facing = dxP > 0 ? 'left' : 'right';
    } else {
      entity.facing = dyP > 0 ? 'up' : 'down';
    }
  } else if (spd > 0.06) {
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

  /** @type {Map<number, Set<number>>} biomeId -> used encounter indexes in current window */
  const usedPickIndexesByBiome = new Map();
  for (const ent of entitiesByKey.values()) {
    if (typeof ent.biomeId !== 'number' || typeof ent.pickIndex !== 'number') continue;
    let set = usedPickIndexesByBiome.get(ent.biomeId);
    if (!set) {
      set = new Set();
      usedPickIndexesByBiome.set(ent.biomeId, set);
    }
    set.add(ent.pickIndex);
  }

  for (const k of needed) {
    if (entitiesByKey.has(k)) continue;

    const [mx, my] = k.split(',').map(Number);
    const biomeId = data.biomes[my * w + mx];
    const pool = getEncounters(biomeId);
    const basePick = seededHashInt(mx, my, data.seed ^ SALT_SPAWN) % pool.length;
    let pick = basePick;
    if (pool.length > 1) {
      let used = usedPickIndexesByBiome.get(biomeId);
      if (!used) {
        used = new Set();
        usedPickIndexesByBiome.set(biomeId, used);
      }
      if (used.has(pick)) {
        for (let i = 0; i < pool.length; i++) {
          if (!used.has(i)) {
            pick = i;
            break;
          }
        }
      }
      used.add(pick);
    }

    const dex = encounterNameToDex(pool[pick]);
    if (dex == null) continue;

    const centerX = (mx + 0.5) * CHUNK_SIZE;
    const centerY = (my + 0.5) * CHUNK_SIZE;
    const jx = (seededHashInt(mx + 31, my + 11, data.seed) % 1000) / 1000 - 0.5;
    const jy = (seededHashInt(mx + 71, my + 3, data.seed) % 1000) / 1000 - 0.5;

    let spawnX = centerX + jx * 5;
    let spawnY = centerY + jy * 5;
    
    // Attempt to snap to nearest walkable tile if initial spawn is blocked
    if (!canWalkMicroTile(spawnX, spawnY, data)) {
      let found = false;
      for (let r = 1; r <= 3; r++) {
        for (let a = 0; a < 8; a++) {
          const cx = spawnX + Math.cos((a * Math.PI) / 4) * r;
          const cy = spawnY + Math.sin((a * Math.PI) / 4) * r;
          if (canWalkMicroTile(cx, cy, data)) {
            spawnX = cx;
            spawnY = cy;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    // 15% chance to spawn sleeping (if they don't immediately wake up)
    const spawnSleep = Math.random() < 0.15;

    const entity = {
      key: k,
      macroX: mx,
      macroY: my,
      biomeId,
      pickIndex: pick,
      centerX,
      centerY,
      x: spawnX,
      y: spawnY,
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
      idlePauseTimer: 0,
      animMoving: false,
      behavior: getSpeciesBehavior(dex),
      aiState: spawnSleep ? 'sleep' : 'wander',
      alertTimer: 0,
      emotionType: spawnSleep ? 9 : null, // 9 = Zzz
      emotionAge: 0,
      emotionPersist: spawnSleep // Sleep persists until woken
    };
    entitiesByKey.set(k, entity);
    ensurePokemonSheetsLoaded(imageCache, dex);
  }
}

export function updateWildPokemon(dt, data, playerX, playerY) {
  if (!data) return;
  for (const e of entitiesByKey.values()) {
    updateWildMotion(e, dt, data, playerX, playerY);
    advanceWildPokemonAnim(e, dt);
  }
}

export function getWildPokemonEntities() {
  return Array.from(entitiesByKey.values());
}
