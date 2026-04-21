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
import { rollNature } from './wild-natures.js';
import { WILD_MACRO_SUBDIVISION, WILD_MAX_SIMULTANEOUS_SLOTS } from './wild-pokemon-constants.js';
import { bindStandardWildTakeDamage } from './wild-entity-factory.js';
import {
  buildWildNeededSlotKeys,
  entitiesByKey,
  wildSubdivN
} from './wild-core-state.js';
import { releaseWildGroupFollowersFromLeader } from './wild-group-behavior.js';

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
  149, // Dragonite
  164, // Noctowl
  169, // Crobat
  176, // Togetic
  178, // Xatu
  189, // Jumpluff
  193, // Yanma
  198, // Murkrow
  225, // Delibird
  226, // Mantine
  227, // Skarmory
  249, // Lugia
  250, // Ho-Oh
  267, // Beautifly
  276,
  277, // Taillow / Swellow
  278,
  279, // Wingull / Pelipper
  284, // Masquerain
  329,
  330, // Vibrava / Flygon
  333,
  334, // Swablu / Altaria
  357, // Tropius
  373, // Salamence
  384, // Rayquaza
  396,
  397,
  398, // Starly line
  425,
  426, // Drifloon / Drifblim
  430, // Honchkrow
  441, // Chatot
  458, // Mantyke
  468, // Togekiss
  469, // Yanmega
  472, // Gliscor
  479, // Rotom
  487 // Giratina
]);

export const WILD_WINDOW_RADIUS = 2;

const SALT_SPAWN = 0x574c4450;
const SALT_GROUP = 0x47525053;
const SALT_GROUP_ID = 0x47524944;
const GROUP_ROLL_TOTAL = 1000;
const GROUP_WEIGHT_SINGLE = 520; // 52%
const GROUP_WEIGHT_PAIR_SAME = 300; // 30%
const GROUP_WEIGHT_TRIO_SAME = 120; // 12%
const GROUP_WEIGHT_PAIR_MIXED = 60; // 6%
const GROUP_COHESION_SEC_MIN = 10.0;
const GROUP_COHESION_SEC_EXTRA = 8.0;
const GROUP_SLOT_MAX_DIST_MIN = 24.0;
const GROUP_SLOT_MAX_DIST_MAX = 72.0;
const GROUP_MEMBER_MAX_DIST_MACRO_TILES = 0.9;
const GROUP_MEMBER_MAX_SPAWN_DIST = GROUP_MEMBER_MAX_DIST_MACRO_TILES * MACRO_TILE_STRIDE;

/**
 * Inclusive bounds on **rolled** wild group size (leader + companions). After the roll, `total` is clamped here.
 * Fewer companions than desired can still shrink the spawned group; if the result would fall below `MIN`, the slot is skipped.
 * Set `MIN = 2` to disallow solo spawns from the roller (singles from weights become pairs).
 */
export const WILD_GROUP_SIZE_MIN = 3;
export const WILD_GROUP_SIZE_MAX = 5;

const GROUP_SIZE_CLAMP_LO = Math.max(1, Math.min(WILD_GROUP_SIZE_MIN, WILD_GROUP_SIZE_MAX));
const GROUP_SIZE_CLAMP_HI = Math.max(GROUP_SIZE_CLAMP_LO, Math.max(WILD_GROUP_SIZE_MIN, WILD_GROUP_SIZE_MAX));

/** @param {number} total */
function clampWildGroupTotal(total) {
  const t = Math.floor(Number(total)) || 1;
  return Math.min(GROUP_SIZE_CLAMP_HI, Math.max(GROUP_SIZE_CLAMP_LO, t));
}

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

function parseSlotKey(k) {
  const parts = String(k || '').split(',').map(Number);
  if (parts.length < 4) return null;
  return {
    key: String(k),
    mx: parts[0],
    my: parts[1],
    sx: parts[2],
    sy: parts[3]
  };
}

function slotCenter(mx, my, sx, sy, cellW) {
  return {
    x: mx * MACRO_TILE_STRIDE + (sx + 0.5) * cellW,
    y: my * MACRO_TILE_STRIDE + (sy + 0.5) * cellW
  };
}

function rollGroupPattern(mx, my, sx, sy, seed) {
  const r = seededHashInt(mx * 1291 + sx * 271, my * 1237 + sy * 313, seed ^ SALT_GROUP) % GROUP_ROLL_TOTAL;
  let total;
  let mixed;
  if (r < GROUP_WEIGHT_SINGLE) {
    total = 1;
    mixed = false;
  } else if (r < GROUP_WEIGHT_SINGLE + GROUP_WEIGHT_PAIR_SAME) {
    total = 2;
    mixed = false;
  } else if (r < GROUP_WEIGHT_SINGLE + GROUP_WEIGHT_PAIR_SAME + GROUP_WEIGHT_TRIO_SAME) {
    total = 3;
    mixed = false;
  } else {
    total = 2;
    mixed = true;
  }
  total = clampWildGroupTotal(total);
  return { total, mixed };
}

function resolveGroupId(mx, my, sx, sy, seed) {
  const h = seededHashInt(mx * 1901 + sx * 101, my * 1931 + sy * 131, seed ^ SALT_GROUP_ID) >>> 0;
  return `grp:${mx},${my},${sx},${sy}:${h.toString(36)}`;
}

function resolveSpawnTypeAt(data, dex, spawnX, spawnY) {
  if (SKY_SPECIES.has(dex)) return 'sky';
  const overlayId = getFoliageOverlayTileId(Math.floor(spawnX), Math.floor(spawnY), data);
  const lakeRole = getLakeLotusFoliageWalkRole(Math.floor(spawnX), Math.floor(spawnY), data);
  const isWater = overlayId !== null || lakeRole !== null;
  if (isWater) return 'water';
  if (overlayId !== null) return 'grass';
  return 'land';
}

function findCompanionSlotCandidates(leaderSlot, neededSlots, claimedKeys, entitiesMap, maxDistSq) {
  const out = [];
  for (const s of neededSlots) {
    if (s.key === leaderSlot.key) continue;
    if (claimedKeys.has(s.key)) continue;
    if (entitiesMap.has(s.key)) continue;
    const dx = s.centerX - leaderSlot.centerX;
    const dy = s.centerY - leaderSlot.centerY;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxDistSq) continue;
    out.push({ slot: s, d2 });
  }
  out.sort((a, b) => {
    if (a.d2 !== b.d2) return a.d2 - b.d2;
    return a.slot.key.localeCompare(b.slot.key);
  });
  return out.map((x) => x.slot);
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
  const sexSalt = (data.seed ^ SALT_SPAWN ^ dex * 1_009 ^ nextDebugSummonSeq * 97) | 0;
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
    nature: rollNature(key, data.seed),
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
    speechBubble: null,
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
    groupId: null,
    groupLeaderKey: null,
    groupMemberIndex: 0,
    groupSize: 1,
    groupCohesionSec: 0,
    groupHomeX: null,
    groupHomeY: null,
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
  const neededSlots = [];
  for (const key of needed) {
    const slot = parseSlotKey(key);
    if (!slot) continue;
    const c = slotCenter(slot.mx, slot.my, slot.sx, slot.sy, cellW);
    neededSlots.push({ ...slot, centerX: c.x, centerY: c.y });
  }

  for (const [k, ent] of entitiesByKey.entries()) {
    if (isDebugSummonKey(k)) continue;
    if (!needed.has(k)) {
      ent.isDespawning = true;
      releaseWildGroupFollowersFromLeader(ent, entitiesByKey);
    }
  }

  // Keep whole groups alive: if any member's slot is still needed, un-despawn
  // every member of that group so individual followers don't vanish mid-pack.
  const aliveGroupIds = new Set();
  for (const [k, ent] of entitiesByKey.entries()) {
    if (!ent.isDespawning && ent.groupId) aliveGroupIds.add(ent.groupId);
  }
  if (aliveGroupIds.size > 0) {
    for (const ent of entitiesByKey.values()) {
      if (ent.isDespawning && ent.groupId && aliveGroupIds.has(ent.groupId)) {
        ent.isDespawning = false;
      }
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
  const claimedKeys = new Set();

  /**
   * @param {string} scopeKey
   * @param {string[]} pool
   * @param {number} basePick
   * @param {number | null} avoidPick
   */
  function reserveEncounterPick(scopeKey, pool, basePick, avoidPick = null) {
    let pick = Math.max(0, Math.floor(basePick) || 0) % pool.length;
    if (pool.length <= 1) return pick;
    let used = usedPickIndexesByMacroBiome.get(scopeKey);
    if (!used) {
      used = new Set();
      usedPickIndexesByMacroBiome.set(scopeKey, used);
    }
    const blocked = (i) => used.has(i) || (avoidPick != null && i === avoidPick);
    if (!blocked(pick)) {
      used.add(pick);
      return pick;
    }
    const jump =
      1 +
      (seededHashInt(scopeKey.length * 67 + pick * 13, pool.length * 17 + pick * 31, data.seed ^ pick * 499) %
        Math.max(1, pool.length - 1));
    for (let step = 1; step < pool.length; step++) {
      const tryPick = (pick + step * jump) % pool.length;
      if (blocked(tryPick)) continue;
      pick = tryPick;
      used.add(pick);
      return pick;
    }
    used.add(pick);
    return pick;
  }

  function maybeFindWalkableSpawn(
    slot,
    dex,
    saltA = 0,
    saltB = 0,
    anchorX = null,
    anchorY = null,
    anchorMaxDist = null,
    groupExistingPoints = null
  ) {
    const centerX = slot.centerX;
    const centerY = slot.centerY;
    const jitterR = Math.min(5, cellW * 0.42);
    const jx = (seededHashInt(slot.mx + 31 + slot.sx * 17, slot.my + 11 + slot.sy * 13, data.seed ^ saltA) % 1000) / 1000 - 0.5;
    const jy = (seededHashInt(slot.mx + 71 + slot.sx * 7, slot.my + 3 + slot.sy * 19, data.seed ^ saltB) % 1000) / 1000 - 0.5;
    let spawnX = centerX + jx * jitterR;
    let spawnY = centerY + jy * jitterR;
    const hasAnchor = Number.isFinite(anchorX) && Number.isFinite(anchorY);
    const pointFitsGroup = (x, y, maxFromAnchor) => {
      if (hasAnchor) {
        const dAnchor = Math.hypot(x - Number(anchorX), y - Number(anchorY));
        if (dAnchor > maxFromAnchor + 1e-6) return false;
      }
      if (Array.isArray(groupExistingPoints) && groupExistingPoints.length) {
        for (const p of groupExistingPoints) {
          const dPair = Math.hypot(x - Number(p.x), y - Number(p.y));
          if (dPair > GROUP_MEMBER_MAX_SPAWN_DIST + 1e-6) return false;
        }
      }
      return true;
    };

    if (!hasAnchor) {
      const spawnFt = worldFeetFromPivotCell(spawnX, spawnY, imageCache, dex, false);
      if (canWildPokemonWalkMicroTile(spawnFt.x, spawnFt.y, data) && pointFitsGroup(spawnX, spawnY, Infinity)) {
        return { spawnX, spawnY };
      }
    }
    if (hasAnchor) {
      const maxFromAnchor = Math.max(1.5, Number(anchorMaxDist) || GROUP_MEMBER_MAX_SPAWN_DIST);
      const maxFromSlotCenter = Math.max(6.5, cellW * 1.1);
      const rings = Math.max(3, Math.ceil(maxFromAnchor * 1.8));
      for (let r = 1; r <= rings; r++) {
        const t = r / rings;
        const radius = Math.pow(t, 1.6) * maxFromAnchor;
        const steps = 8 + r * 5;
        for (let i = 0; i < steps; i++) {
          const ang = (i / steps) * Math.PI * 2;
          const cx = Number(anchorX) + Math.cos(ang) * radius;
          const cy = Number(anchorY) + Math.sin(ang) * radius;
          if (!pointFitsGroup(cx, cy, maxFromAnchor)) continue;
          const dSlot = Math.hypot(cx - centerX, cy - centerY);
          if (dSlot > maxFromSlotCenter) continue;
          const tryFt = worldFeetFromPivotCell(cx, cy, imageCache, dex, false);
          if (!canWildPokemonWalkMicroTile(tryFt.x, tryFt.y, data)) continue;
          return { spawnX: cx, spawnY: cy };
        }
      }
      return null;
    }
    for (let r = 1; r <= 5; r++) {
      for (let a = 0; a < 8; a++) {
        const cx = spawnX + Math.cos((a * Math.PI) / 4) * r;
        const cy = spawnY + Math.sin((a * Math.PI) / 4) * r;
        if (!pointFitsGroup(cx, cy, Infinity)) continue;
        const tryFt = worldFeetFromPivotCell(cx, cy, imageCache, dex, false);
        if (!canWildPokemonWalkMicroTile(tryFt.x, tryFt.y, data)) continue;
        return { spawnX: cx, spawnY: cy };
      }
    }
    return null;
  }

  /**
   * @param {{ key: string, mx: number, my: number, sx: number, sy: number, centerX: number, centerY: number }} slot
   * @param {number} biomeId
   * @param {number} dex
   * @param {{ pickIndex: number, hp: number, maxHp: number, isBoss: boolean, groupId: string | null, groupLeaderKey: string | null, groupMemberIndex: number, groupSize: number, groupCohesionSec: number, groupHomeX: number | null, groupHomeY: number | null }} meta
   */
  function spawnEntityForSlot(slot, biomeId, dex, meta) {
    const placed = maybeFindWalkableSpawn(
      slot,
      dex,
      meta.groupMemberIndex * 701,
      meta.groupMemberIndex * 997,
      meta.groupAnchorX ?? null,
      meta.groupAnchorY ?? null,
      meta.groupMaxSpawnDist ?? null,
      meta.groupExistingPoints ?? null
    );
    if (!placed) return null;
    const spawnSleep = Math.random() < 0.15;
    const sexSalt =
      (data.seed ^
        SALT_SPAWN ^
        dex * 1_009 ^
        slot.sx * 37 ^
        slot.sy * 41 ^
        slot.mx * 19 ^
        slot.my * 23 ^
        meta.groupMemberIndex * 131) |
      0;
    const sex = rollWildSex(dex, sexSalt >>> 0);
    const spawnType = resolveSpawnTypeAt(data, dex, placed.spawnX, placed.spawnY);
    const entity = {
      key: slot.key,
      macroX: slot.mx,
      macroY: slot.my,
      subX: slot.sx,
      subY: slot.sy,
      biomeId,
      pickIndex: meta.pickIndex,
      centerX: slot.centerX,
      centerY: slot.centerY,
      x: placed.spawnX,
      y: placed.spawnY,
      vx: 0,
      vy: 0,
      dexId: dex,
      nature: rollNature(slot.key, data.seed),
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
      speechBubble: null,
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
      isBoss: !!meta.isBoss,
      hp: meta.hp,
      maxHp: meta.maxHp,
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
      groupId: meta.groupId,
      groupLeaderKey: meta.groupLeaderKey,
      groupMemberIndex: meta.groupMemberIndex,
      groupSize: meta.groupSize,
      groupCohesionSec: meta.groupCohesionSec,
      groupHomeX: meta.groupHomeX,
      groupHomeY: meta.groupHomeY,
      _lodDtAccum: 0,
      _lodOffset: seededHashInt(slot.mx * 211 + slot.sx * 37, slot.my * 223 + slot.sy * 41, data.seed ^ 0x6c6f64) % 4
    };
    bindStandardWildTakeDamage(entity);
    entitiesByKey.set(slot.key, entity);
    ensurePokemonSheetsLoaded(imageCache, dex);
    probeSpriteCollabPortraitPrefix(dex).catch(() => {});
    if (spawnSleep) ensureSpriteCollabPortraitLoaded(imageCache, dex, 'Normal').catch(() => {});
    void preloadPokemonCry(dex);
    return { spawnX: placed.spawnX, spawnY: placed.spawnY };
  }

  for (const slot of neededSlots) {
    if (claimedKeys.has(slot.key)) continue;
    const existing = entitiesByKey.get(slot.key);
    if (existing) {
      existing.isDespawning = false;
      claimedKeys.add(slot.key);
      continue;
    }
    const biomeId = data.biomes[slot.my * w + slot.mx];
    const pool = getEncounters(biomeId);
    if (!Array.isArray(pool) || pool.length === 0) continue;
    const pickScopeKey = `${biomeId}|${slot.mx}|${slot.my}`;
    const basePick =
      seededHashInt(
        slot.mx * 4733 + slot.sx * 997,
        slot.my * 3623 + slot.sy * 683,
        data.seed ^ SALT_SPAWN ^ biomeId * 131
      ) % pool.length;
    const leaderPick = reserveEncounterPick(pickScopeKey, pool, basePick);
    const baseDex = encounterNameToDex(pool[leaderPick]);
    if (baseDex == null || !getPokemonConfig(baseDex)) continue;
    const bossRoll = rollBossPromotedDex(baseDex, slot.mx, slot.my, slot.sx, slot.sy, data.seed);
    const leaderDex = bossRoll.dex;
    const pattern = rollGroupPattern(slot.mx, slot.my, slot.sx, slot.sy, data.seed);
    const leaderConfig = getPokemonConfig(leaderDex);
    const leaderBeh = getSpeciesBehavior(leaderDex);
    const isFlocking = leaderConfig?.types?.includes('flying') || leaderConfig?.types?.includes('water') || leaderBeh.flocks;
    
    let desiredCompanions = Math.max(0, pattern.total - 1);
    if (isFlocking) {
      desiredCompanions = 4 + (seededHashInt(slot.mx * 31, slot.my * 37, data.seed ^ 0xf10c) % 8); // massive flock: 4 to 11 companions
    }
    
    const groupId = desiredCompanions > 0 ? resolveGroupId(slot.mx, slot.my, slot.sx, slot.sy, data.seed) : null;
    const cohesionHash = seededHashInt(
      slot.mx * 881 + slot.sx * 53,
      slot.my * 907 + slot.sy * 61,
      data.seed ^ SALT_GROUP_ID
    );
    let cohesionSec =
      desiredCompanions > 0
        ? GROUP_COHESION_SEC_MIN + ((cohesionHash % 1000) / 1000) * GROUP_COHESION_SEC_EXTRA
        : 0;
        
    if (isFlocking && desiredCompanions > 0) {
      cohesionSec = 999999;
    }
    
    const companionSlotMaxDist = isFlocking ? cellW * 4.5 : Math.max(GROUP_SLOT_MAX_DIST_MIN, Math.min(GROUP_SLOT_MAX_DIST_MAX, cellW * 1.15));
    const companionSlots = findCompanionSlotCandidates(
      slot,
      neededSlots,
      claimedKeys,
      entitiesByKey,
      companionSlotMaxDist ** 2
    );
    const actualCompanions = Math.min(desiredCompanions, companionSlots.length);
    const groupSize = 1 + actualCompanions;
    if (groupSize < GROUP_SIZE_CLAMP_LO) continue;
    /** @type {Array<{ x: number, y: number }>} */
    const groupSpawnPoints = [];

    const leaderSpawn = spawnEntityForSlot(slot, biomeId, leaderDex, {
      pickIndex: leaderPick,
      hp: bossRoll.hp,
      maxHp: bossRoll.maxHp,
      isBoss: !!bossRoll.isBoss,
      groupId,
      groupLeaderKey: groupId ? slot.key : null,
      groupMemberIndex: 0,
      groupSize,
      groupCohesionSec: cohesionSec,
      groupMaxSpawnDist: null,
      groupAnchorX: null,
      groupAnchorY: null,
      groupExistingPoints: null,
      groupHomeX: slot.centerX,
      groupHomeY: slot.centerY
    });
    if (!leaderSpawn) continue;
    claimedKeys.add(slot.key);
    const leaderAnchorX = leaderSpawn.spawnX;
    const leaderAnchorY = leaderSpawn.spawnY;
    groupSpawnPoints.push({ x: leaderAnchorX, y: leaderAnchorY });

    for (let i = 0; i < actualCompanions; i++) {
      const cslot = companionSlots[i];
      if (!cslot || claimedKeys.has(cslot.key) || entitiesByKey.has(cslot.key)) continue;
      let companionDex = leaderDex;
      let companionPick = -1;
      if (pattern.mixed && i === 0 && pool.length > 1) {
        const mixedBasePick =
          seededHashInt(cslot.mx * 451 + cslot.sx * 73, cslot.my * 463 + cslot.sy * 97, data.seed ^ SALT_GROUP) %
          pool.length;
        const mixedPick = reserveEncounterPick(pickScopeKey, pool, mixedBasePick, leaderPick);
        const mixedDex = encounterNameToDex(pool[mixedPick]);
        if (mixedDex != null && getPokemonConfig(mixedDex)) {
          companionDex = mixedDex;
          companionPick = mixedPick;
        }
      }
      const ok = spawnEntityForSlot(cslot, biomeId, companionDex, {
        pickIndex: companionPick,
        hp: 50,
        maxHp: 50,
        isBoss: false,
        groupId,
        groupLeaderKey: groupId ? slot.key : null,
        groupMemberIndex: i + 1,
        groupSize,
        groupCohesionSec: cohesionSec,
        groupMaxSpawnDist: isFlocking ? GROUP_MEMBER_MAX_SPAWN_DIST * 2.5 : GROUP_MEMBER_MAX_SPAWN_DIST,
        groupAnchorX: leaderAnchorX,
        groupAnchorY: leaderAnchorY,
        groupExistingPoints: groupSpawnPoints,
        groupHomeX: slot.centerX,
        groupHomeY: slot.centerY
      });
      if (ok) {
        claimedKeys.add(cslot.key);
        groupSpawnPoints.push({ x: ok.spawnX, y: ok.spawnY });
      }
    }
  }
}

