import { MACRO_TILE_STRIDE } from '../chunking.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { seededHashInt } from '../tessellation-logic.js';
import { bindStandardWildTakeDamage } from '../wild-pokemon/wild-entity-factory.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';
import { getSpeciesBehavior } from '../wild-pokemon/pokemon-behavior.js';
import { rollWildSex } from '../pokemon/pokemon-sex.js';
import { rollNature } from '../wild-pokemon/wild-natures.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import { probeSpriteCollabPortraitPrefix } from '../pokemon/spritecollab-portraits.js';
import { preloadPokemonCry } from '../pokemon/pokemon-cries.js';
import { imageCache } from '../image-cache.js';
import { isWildPokemonFainted } from '../wild-pokemon/wild-pokemon-persistence.js';
import { GAMEPLAY_CONFIG } from '../gameplay-config.js';
import { releaseWildGroupFollowersFromLeader } from '../wild-pokemon/wild-group-behavior.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';
import { DUNGEON_TILE_TYPES } from './tile-map.js';

export const DUNGEON_WILD_KEY_PREFIX = 'dng:';

const FALLBACK_DEX_POOL = [1, 4, 7, 10, 13, 16, 19, 21, 23, 25, 27, 29, 32, 41, 43, 46, 48, 50, 52, 54];

const DUNGEON_WILD_DEFAULT_LEVEL = 1;

function dungeonEntityKey(dungeonId, slotIndex) {
  return `${DUNGEON_WILD_KEY_PREFIX}${dungeonId}:${slotIndex}`;
}

function isWalkableDungeonTileType(t) {
  return (
    t === DUNGEON_TILE_TYPES.FLOOR ||
    t === DUNGEON_TILE_TYPES.CORRIDOR ||
    t === DUNGEON_TILE_TYPES.STAIRS_DOWN ||
    t === DUNGEON_TILE_TYPES.STAIRS_UP
  );
}

function nearestWalkableCell(cells, x, y, maxRadius = 6) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const tx = Math.floor(Number(x) || 0);
  const ty = Math.floor(Number(y) || 0);
  let best = null;
  let bestD2 = Infinity;
  for (const c of cells) {
    const dx = Number(c.x) - tx;
    const dy = Number(c.y) - ty;
    if (Math.abs(dx) > maxRadius || Math.abs(dy) > maxRadius) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
  }
  return best || cells[0] || null;
}

/**
 * Augments world `data` with `width`/`height` and `__dungeonWalk` so {@link canWildPokemonWalkMicroTile}
 * and wild motion resolve against the procedural dungeon grid instead of chunk tiles.
 */
export function buildDungeonWildDataProxy(worldData, dungeonState) {
  if (!worldData || !dungeonState?.map) return worldData;
  const map = dungeonState.map;
  const mapW = map.width;
  const mapH = map.height;
  const macroW = Math.max(1, Math.ceil(mapW / MACRO_TILE_STRIDE));
  const macroH = Math.max(1, Math.ceil(mapH / MACRO_TILE_STRIDE));
  const isWalkable = (mx, my) => {
    if (mx < 0 || my < 0 || mx >= mapW || my >= mapH) return false;
    return isWalkableDungeonTileType(map.get(mx, my));
  };
  const isWalkableWithClearance = (x, y) => {
    if (!isWalkable(x, y)) return false;
    const ring = [
      [0.22, 0],
      [-0.22, 0],
      [0, 0.22],
      [0, -0.22],
      [0.16, 0.16],
      [0.16, -0.16],
      [-0.16, 0.16],
      [-0.16, -0.16]
    ];
    for (const [ox, oy] of ring) {
      if (!isWalkable(Math.floor(x + ox), Math.floor(y + oy))) return false;
    }
    return true;
  };
  return {
    ...worldData,
    width: macroW,
    height: macroH,
    __dungeonWalk: { mapW, mapH, isWalkable, isWalkableWithClearance }
  };
}

export function clearDungeonWildEntities() {
  for (const k of [...entitiesByKey.keys()]) {
    if (!k.startsWith(DUNGEON_WILD_KEY_PREFIX)) continue;
    const ent = entitiesByKey.get(k);
    if (ent) releaseWildGroupFollowersFromLeader(ent, entitiesByKey);
    entitiesByKey.delete(k);
  }
}

/** Clears all wild slots (overworld + dungeon). Next play `syncWildPokemonWindow` repopulates the open world. */
export function prepareDungeonWildOnEnter(worldData, dungeonState) {
  entitiesByKey.clear();
  syncDungeonWildWindow(worldData, dungeonState);
}

function createDungeonWildEntity({ key, biomeId, dexId, x, y, seed, slotIndex }) {
  const spawnSleep = seededHashInt(slotIndex * 701, seed, 11) % 1000 < 150;
  const sexSalt = (seed ^ dexId * 1009 ^ slotIndex * 97) | 0;
  const sex = rollWildSex(dexId, sexSalt >>> 0);
  const entity = {
    key,
    macroX: Math.floor(x / MACRO_TILE_STRIDE),
    macroY: Math.floor(y / MACRO_TILE_STRIDE),
    subX: 0,
    subY: 0,
    biomeId,
    pickIndex: -1,
    centerX: x,
    centerY: y,
    x,
    y,
    vx: 0,
    vy: 0,
    dexId,
    level: DUNGEON_WILD_DEFAULT_LEVEL,
    nature: rollNature(key, seed),
    sex,
    provoked01: 0,
    wildTempAggressiveSec: 0,
    animMeta: getDexAnimMeta(dexId),
    facing: 'down',
    animRow: 0,
    animFrame: 0,
    idleTimer: 0,
    _walkPhase: 0,
    wanderTimer: 0,
    idlePauseTimer: 0,
    animMoving: false,
    behavior: getSpeciesBehavior(dexId),
    aiState: spawnSleep ? 'sleep' : 'wander',
    alertTimer: 0,
    emotionType: spawnSleep ? 9 : null,
    emotionPortraitSlug: spawnSleep ? 'Normal' : null,
    emotionAge: 0,
    emotionPersist: spawnSleep,
    speechBubble: null,
    spawnPhase: 0,
    isDespawning: false,
    spawnType: 'land',
    targetX: null,
    targetY: null,
    z: 0,
    vz: 0,
    grounded: true,
    jumping: false,
    jumpCooldown: 0,
    jumpsUsed: 0,
    _blockedMoveFrames: 0,
    isBoss: false,
    hp: 50,
    maxHp: 50,
    deadState: null,
    deadTimer: 0,
    deadAnimTimer: 0,
    hurtTimer: 0,
    hurtAnimTimer: 0,
    hitFlashTimer: 0,
    socialMemory: {
      affinity: 0,
      threat: 0,
      curiosity: 0,
      approachSignal: 0,
      retreatSignal: 0,
      reactionCooldown: 0
    },
    recentNearbyEvents: [],
    lastPlayerDist: null,
    lastProximitySignalAt: 999,
    groupId: null,
    groupLeaderKey: null,
    groupMemberIndex: 0,
    groupSize: 1,
    groupCohesionSec: 0,
    groupHomeX: x,
    groupHomeY: y,
    _lodDtAccum: 0,
    _lodOffset: seededHashInt(slotIndex * 211, seed ^ 0x6e6d) % 4,
    isDungeonWild: true
  };
  bindStandardWildTakeDamage(entity);
  const wasFainted = isWildPokemonFainted(key);
  if (wasFainted) {
    entity.hp = 0;
    entity.deadState = entity.animMeta?.faint ? 'faint' : 'sleep';
    entity.deadTimer = 0;
    entity.deadAnimTimer = 9999;
    entity.aiState = 'sleep';
    entity.animMoving = false;
    entity.emotionType = null;
    entity.emotionPersist = false;
    entity.spawnPhase = 1;
  }
  return entity;
}

/**
 * Keeps up to {@link GAMEPLAY_CONFIG.dungeonWildMaxSlots} deterministic wild spawns for the active dungeon.
 */
export function syncDungeonWildWindow(worldData, dungeonState) {
  if (!worldData || !dungeonState?.active || !dungeonState.map) return;
  const maxSlots = Math.max(0, Math.floor(Number(GAMEPLAY_CONFIG.dungeonWildMaxSlots) || 8));
  if (maxSlots <= 0) return;

  const dungeonId = String(dungeonState.dungeonId || 'dungeon');
  const map = dungeonState.map;
  const cacheKey = `${dungeonState.worldSeed}:${dungeonId}`;

  if (!dungeonState._walkableCells || dungeonState._walkableCacheKey !== cacheKey) {
    const list = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (isWalkableDungeonTileType(map.get(x, y))) list.push({ x, y });
      }
    }
    dungeonState._walkableCells = list;
    dungeonState._walkableCacheKey = cacheKey;
  }

  const walkable = dungeonState._walkableCells;
  if (walkable.length === 0) return;

  const seed =
    (Number(worldData.seed) || 0) ^
    seededHashInt(dungeonId.length * 47, dungeonId.charCodeAt(0) || 0, 0x64756e67);
  const biomeId = Number(dungeonState.biomeId) || 0;
  const poolNames = getEncounters(biomeId);

  for (let i = 0; i < maxSlots; i++) {
    const key = dungeonEntityKey(dungeonId, i);
    const existing = entitiesByKey.get(key);
    if (existing && !existing.isDespawning) {
      const ex = Math.floor(Number(existing.x) || 0);
      const ey = Math.floor(Number(existing.y) || 0);
      if (!isWalkableDungeonTileType(map.get(ex, ey))) {
        const n = nearestWalkableCell(walkable, existing.x, existing.y);
        if (n) {
          existing.x = n.x + 0.5;
          existing.y = n.y + 0.5;
          existing.centerX = n.x + 0.5;
          existing.centerY = n.y + 0.5;
          existing.vx = 0;
          existing.vy = 0;
          existing.targetX = null;
          existing.targetY = null;
        }
      }
      continue;
    }
    if (existing && existing.isDespawning) continue;

    const h = seededHashInt(i * 2654435761, seed, i * 9973);
    const cell = walkable[h % walkable.length];
    let spawnX = cell.x + 0.5;
    let spawnY = cell.y + 0.5;
    spawnX = Math.max(0.2, Math.min(map.width - 0.2, spawnX));
    spawnY = Math.max(0.2, Math.min(map.height - 0.2, spawnY));

    let dex = null;
    if (Array.isArray(poolNames) && poolNames.length) {
      const pi = seededHashInt(i * 31, seed ^ 0x706f6f6c, 0) % poolNames.length;
      dex = encounterNameToDex(poolNames[pi]);
    }
    if (dex == null || !getPokemonConfig(dex)) {
      dex = FALLBACK_DEX_POOL[Math.abs(seededHashInt(i, seed, 1)) % FALLBACK_DEX_POOL.length];
    }

    const entity = createDungeonWildEntity({
      key,
      biomeId,
      dexId: dex,
      x: spawnX,
      y: spawnY,
      seed,
      slotIndex: i
    });
    entitiesByKey.set(key, entity);
    ensurePokemonSheetsLoaded(imageCache, dex);
    probeSpriteCollabPortraitPrefix(dex).catch(() => {});
    void preloadPokemonCry(dex);
  }
}
