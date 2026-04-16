import { MACRO_TILE_STRIDE } from '../chunking.js';
import { seededHashInt } from '../tessellation-logic.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { ensurePokemonSheetsLoaded } from '../pokemon/pokemon-asset-loader.js';
import {
  ensureSpriteCollabPortraitLoaded,
  probeSpriteCollabPortraitPrefix
} from '../pokemon/spritecollab-portraits.js';
import { preloadPokemonCry } from '../pokemon/pokemon-cries.js';
import { imageCache } from '../image-cache.js';
import { getDexAnimMeta } from '../pokemon/pmd-anim-metadata.js';
import {
  canWildPokemonWalkMicroTile,
  getFoliageOverlayTileId,
  getLakeLotusFoliageWalkRole
} from '../walkability.js';
import { worldFeetFromPivotCell } from '../pokemon/pmd-layout-metrics.js';
import { getSpeciesBehavior } from './pokemon-behavior.js';
import { rollWildSex } from '../pokemon/pokemon-sex.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { rollBossPromotedDex } from './wild-boss-variants.js';
import { WILD_MACRO_SUBDIVISION, WILD_MAX_SIMULTANEOUS_SLOTS } from './wild-pokemon-constants.js';
import { bindStandardWildTakeDamage } from './wild-entity-factory.js';
import {
  buildWildNeededSlotKeys,
  entitiesByKey,
  wildSubdivN
} from './wild-core-state.js';

export const SKY_SPECIES = new Set([
  6, // Charizard
  12, // Butterfree
  15, // Beedrill
  16,
  17,
  18, // Pidgey line
  21,
  22, // Spearow line
  41,
  42, // Zubat line
  49, // Venomoth
  92,
  93,
  94, // Gengar line (ghosts float)
  142, // Aerodactyl
  144,
  145,
  146, // Birds
  149 // Dragonite
]);

export const WILD_WINDOW_RADIUS = 2;

const SALT_SPAWN = 0x574c4450;

/** Keys for play-debug summons: never despawned by sync slot budget. */
export const DEBUG_SUMMON_KEY_PREFIX = 'debug:';
const DEBUG_SUMMON_MAX = 16;
let nextDebugSummonSeq = 1;

function isDebugSummonKey(k) {
  return typeof k === 'string' && k.startsWith(DEBUG_SUMMON_KEY_PREFIX);
}

export function allocateDebugSummonKey(suffix = '') {
  const seq = nextDebugSummonSeq++;
  if (!suffix) return `${DEBUG_SUMMON_KEY_PREFIX}${seq}`;
  return `${DEBUG_SUMMON_KEY_PREFIX}${suffix}:${seq}`;
}

function pruneDebugSummonsIfNeeded() {
  while ([...entitiesByKey.keys()].filter(isDebugSummonKey).length >= DEBUG_SUMMON_MAX) {
    for (const k of entitiesByKey.keys()) {
      if (isDebugSummonKey(k)) {
        entitiesByKey.delete(k);
        break;
      }
    }
  }
}

/**
 * Find a walkable pivot near (ox, oy) in micro-tile world space.
 * @returns {{ spawnX: number, spawnY: number } | null}
 */
export function findWalkableWildSpawnNear(data, dex, ox, oy) {
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const candidates = [[ox, oy]];
  for (let ring = 1; ring <= 12; ring++) {
    const steps = Math.max(8, ring * 8);
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      candidates.push([ox + Math.cos(ang) * ring * 0.65, oy + Math.sin(ang) * ring * 0.65]);
    }
  }
  for (const [tx, ty] of candidates) {
    if (tx < 0.5 || ty < 0.5 || tx >= microW - 0.5 || ty >= microH - 0.5) continue;
    const ft = worldFeetFromPivotCell(tx, ty, imageCache, dex, false);
    if (canWildPokemonWalkMicroTile(ft.x, ft.y, data)) return { spawnX: tx, spawnY: ty };
  }
  return null;
}

/**
 * Play mode: spawn a wild Pokémon by dex at a free tile near the player.
 * Persists across wild slot sync.
 */
export function summonDebugWildPokemon(dexId, data, nearWorldX, nearWorldY) {
  if (!data) return false;
  const dex = Math.floor(Number(dexId)) || 0;
  if (!getPokemonConfig(dex)) return false;

  const pos = findWalkableWildSpawnNear(data, dex, nearWorldX, nearWorldY);
  if (!pos) return false;

  void preloadPokemonCry(dex);

  pruneDebugSummonsIfNeeded();
  const key = allocateDebugSummonKey();
  const spawnX = pos.spawnX;
  const spawnY = pos.spawnY;
  const w = data.width;
  const h = data.height;
  const macroX = Math.floor(spawnX / MACRO_TILE_STRIDE);
  const macroY = Math.floor(spawnY / MACRO_TILE_STRIDE);
  const subN = wildSubdivN(WILD_MACRO_SUBDIVISION);
  const cellW = MACRO_TILE_STRIDE / subN;
  const lx = spawnX - macroX * MACRO_TILE_STRIDE;
  const ly = spawnY - macroY * MACRO_TILE_STRIDE;
  const subX = Math.max(0, Math.min(subN - 1, Math.floor(lx / cellW)));
  const subY = Math.max(0, Math.min(subN - 1, Math.floor(ly / cellW)));
  const biomeId =
    macroX >= 0 && macroY >= 0 && macroX < w && macroY < h ? data.biomes[macroY * w + macroX] : 0;
  const sexSalt = (data.seed ^ SALT_SPAWN ^ dex * 1_009 ^ summonSeq * 97) | 0;
  const sex = rollWildSex(dex, sexSalt >>> 0);

  let spawnType = 'land';
  if (SKY_SPECIES.has(dex)) {
    spawnType = 'sky';
  } else {
    const overlayId = getFoliageOverlayTileId(Math.floor(spawnX), Math.floor(spawnY), data);
    const lakeRole = getLakeLotusFoliageWalkRole(Math.floor(spawnX), Math.floor(spawnY), data);
    const isWater = overlayId !== null || lakeRole !== null;
    if (isWater) spawnType = 'water';
    else if (overlayId !== null) spawnType = 'grass';
  }

  const entity = {
    key,
    macroX,
    macroY,
    subX,
    subY,
    biomeId,
    pickIndex: -1,
    centerX: spawnX,
    centerY: spawnY,
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    dexId: dex,
    sex,
    provoked01: 0,
    wildTempAggressiveSec: 0,
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
    aiState: 'wander',
    alertTimer: 0,
    emotionType: null,
    emotionPortraitSlug: null,
    emotionAge: 0,
    emotionPersist: false,
    spawnPhase: 1,
    isDespawning: false,
    spawnType,
    targetX: null,
    targetY: null,
    z: 0,
    vz: 0,
    grounded: true,
    jumping: false,
    jumpCooldown: 0,
    _blockedMoveFrames: 0,
    hp: 50,
    maxHp: 50,
    deadState: null,
    deadTimer: 0,
    deadAnimTimer: 0,
    hurtTimer: 0,
    hurtAnimTimer: 0,
    hitFlashTimer: 0,
    isBoss: false,
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
    _lodDtAccum: 0,
    _lodOffset: seededHashInt(macroX * 211 + subX * 37, macroY * 223 + subY * 41, data.seed ^ 0x6c6f64) % 4
  };
  bindStandardWildTakeDamage(entity);
  entitiesByKey.set(key, entity);
  void ensurePokemonSheetsLoaded(imageCache, dex);
  void probeSpriteCollabPortraitPrefix(dex).catch(() => {});
  return true;
}

/**
 * Keep slots around player; if exceed budget keeps nearest ones.
 */
export function syncWildPokemonWindow(data, playerMicroX, playerMicroY) {
  if (!data) return;

  const w = data.width;
  const h = data.height;
  const pmx = Math.floor(playerMicroX / MACRO_TILE_STRIDE);
  const pmy = Math.floor(playerMicroY / MACRO_TILE_STRIDE);
  const subN = wildSubdivN(WILD_MACRO_SUBDIVISION);
  const cellW = MACRO_TILE_STRIDE / subN;

  const needed = buildWildNeededSlotKeys(
    w,
    h,
    pmx,
    pmy,
    subN,
    cellW,
    playerMicroX,
    playerMicroY,
    WILD_MAX_SIMULTANEOUS_SLOTS
  );

  for (const [k, ent] of entitiesByKey.entries()) {
    if (isDebugSummonKey(k)) continue;
    if (!needed.has(k)) {
      ent.isDespawning = true;
    }
  }

  const usedPickIndexesByMacroBiome = new Map();
  for (const ent of entitiesByKey.values()) {
    if (typeof ent.biomeId !== 'number' || typeof ent.pickIndex !== 'number') continue;
    if (ent.pickIndex < 0) continue;
    if (typeof ent.macroX !== 'number' || typeof ent.macroY !== 'number') continue;
    const scopeKey = `${ent.biomeId}|${ent.macroX}|${ent.macroY}`;
    let set = usedPickIndexesByMacroBiome.get(scopeKey);
    if (!set) {
      set = new Set();
      usedPickIndexesByMacroBiome.set(scopeKey, set);
    }
    set.add(ent.pickIndex);
  }

  for (const k of needed) {
    const existing = entitiesByKey.get(k);
    if (existing) {
      existing.isDespawning = false;
      continue;
    }

    const parts = k.split(',').map(Number);
    const mx = parts[0];
    const my = parts[1];
    const sx = parts.length >= 4 ? parts[2] : 0;
    const sy = parts.length >= 4 ? parts[3] : 0;
    const biomeId = data.biomes[my * w + mx];
    const pool = getEncounters(biomeId);
    const pickScopeKey = `${biomeId}|${mx}|${my}`;
    const basePick =
      seededHashInt(mx * 4733 + sx * 997, my * 3623 + sy * 683, data.seed ^ SALT_SPAWN ^ biomeId * 131) %
      pool.length;
    let pick = basePick;
    if (pool.length > 1) {
      let used = usedPickIndexesByMacroBiome.get(pickScopeKey);
      if (!used) {
        used = new Set();
        usedPickIndexesByMacroBiome.set(pickScopeKey, used);
      }
      if (used.has(pick)) {
        const jump =
          1 +
          (seededHashInt(mx * 181 + sx * 13, my * 191 + sy * 17, data.seed ^ pick * 499) %
            Math.max(1, pool.length - 1));
        for (let step = 0; step < pool.length; step++) {
          const tryPick = (pick + step * jump) % pool.length;
          if (!used.has(tryPick)) {
            pick = tryPick;
            break;
          }
        }
      }
      used.add(pick);
    }

    const baseDex = encounterNameToDex(pool[pick]);
    if (baseDex == null) continue;
    const bossRoll = rollBossPromotedDex(baseDex, mx, my, sx, sy, data.seed);
    const dex = bossRoll.dex;
    void preloadPokemonCry(dex);
    const spawnHp = bossRoll.hp;
    const spawnMaxHp = bossRoll.maxHp;
    const isBoss = bossRoll.isBoss;

    const centerX = mx * MACRO_TILE_STRIDE + (sx + 0.5) * cellW;
    const centerY = my * MACRO_TILE_STRIDE + (sy + 0.5) * cellW;
    const jitterR = Math.min(5, cellW * 0.42);
    const jx = (seededHashInt(mx + 31 + sx * 17, my + 11 + sy * 13, data.seed) % 1000) / 1000 - 0.5;
    const jy = (seededHashInt(mx + 71 + sx * 7, my + 3 + sy * 19, data.seed) % 1000) / 1000 - 0.5;

    let spawnX = centerX + jx * jitterR;
    let spawnY = centerY + jy * jitterR;

    const spawnFt = worldFeetFromPivotCell(spawnX, spawnY, imageCache, dex, false);
    if (!canWildPokemonWalkMicroTile(spawnFt.x, spawnFt.y, data)) {
      let found = false;
      for (let r = 1; r <= 5; r++) {
        for (let a = 0; a < 8; a++) {
          const cx = spawnX + Math.cos((a * Math.PI) / 4) * r;
          const cy = spawnY + Math.sin((a * Math.PI) / 4) * r;
          const tryFt = worldFeetFromPivotCell(cx, cy, imageCache, dex, false);
          if (canWildPokemonWalkMicroTile(tryFt.x, tryFt.y, data)) {
            spawnX = cx;
            spawnY = cy;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) continue;
    }

    let spawnType = 'land';
    if (SKY_SPECIES.has(dex)) {
      spawnType = 'sky';
    } else {
      const overlayId = getFoliageOverlayTileId(Math.floor(spawnX), Math.floor(spawnY), data);
      const lakeRole = getLakeLotusFoliageWalkRole(Math.floor(spawnX), Math.floor(spawnY), data);

      const isWater = overlayId !== null || lakeRole !== null;
      if (isWater) {
        spawnType = 'water';
      } else if (overlayId !== null) {
        spawnType = 'grass';
      }
    }

    const spawnSleep = Math.random() < 0.15;

    const sexSalt = (data.seed ^ SALT_SPAWN ^ dex * 1_009 ^ sx * 37 ^ sy * 41 ^ mx * 19 ^ my * 23) | 0;
    const sex = rollWildSex(dex, sexSalt >>> 0);

    const entity = {
      key: k,
      macroX: mx,
      macroY: my,
      subX: sx,
      subY: sy,
      biomeId,
      pickIndex: pick,
      centerX,
      centerY,
      x: spawnX,
      y: spawnY,
      vx: 0,
      vy: 0,
      dexId: dex,
      sex,
      provoked01: 0,
      wildTempAggressiveSec: 0,
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
      emotionType: spawnSleep ? 9 : null,
      emotionPortraitSlug: spawnSleep ? 'Normal' : null,
      emotionAge: 0,
      emotionPersist: spawnSleep,
      spawnPhase: 0,
      isDespawning: false,
      spawnType,
      targetX: null,
      targetY: null,
      z: 0,
      vz: 0,
      grounded: true,
      jumping: false,
      jumpCooldown: 0,
      _blockedMoveFrames: 0,
      isBoss: !!isBoss,
      hp: spawnHp,
      maxHp: spawnMaxHp,
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
      _lodDtAccum: 0,
      _lodOffset: seededHashInt(mx * 211 + sx * 37, my * 223 + sy * 41, data.seed ^ 0x6c6f64) % 4
    };
    bindStandardWildTakeDamage(entity);
    entitiesByKey.set(k, entity);
    ensurePokemonSheetsLoaded(imageCache, dex);
    probeSpriteCollabPortraitPrefix(dex).catch(() => {});
    if (spawnSleep) {
      ensureSpriteCollabPortraitLoaded(imageCache, dex, 'Normal').catch(() => {});
    }
  }
}

