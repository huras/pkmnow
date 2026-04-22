import { getSocialActionById } from '../social/social-actions.js';
import { getSpeciesBehavior } from './pokemon-behavior.js';
import { getEffectiveWildBehavior } from './wild-effective-behavior.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import { clamp, entitiesByKey } from './wild-core-state.js';
import { setEmotion } from './wild-motion-ai.js';
import { setWildSpeechBubble } from '../social/speech-bubble-state.js';
import { markWildMinimapSpeciesKnown } from './wild-minimap-species-known.js';

const WILD_SOCIAL_INTERACTION_RADIUS = 9.0;
const WILD_SOCIAL_RIPPLE_RADIUS = 14.0;
const WILD_SOCIAL_REACTION_COOLDOWN_SEC = 0.45;
const WILD_SOCIAL_MEMORY_DECAY_PER_SEC = 0.55;
const WILD_SOCIAL_SIGNAL_DECAY_PER_SEC = 0.9;
const WILD_SOCIAL_SIGNAL_DELTA_TILES = 0.85;
const WILD_SOCIAL_EVENT_TTL_SEC = 10.0;
const WILD_SOCIAL_EVENT_MAX = 10;
const WILD_SOCIAL_NEARBY_EVENT_RADIUS = 8.5;

const PLAYER_SOCIAL_TACKLE_HIT_RADIUS = 2.25;
const PLAYER_SOCIAL_TACKLE_DAMAGE = 8;
const PLAYER_SOCIAL_TACKLE_KNOCKBACK = 3.2;

const WILD_KNOCKBACK_LOCK_SEC = 0.34;

const PLAYER_FIELD_MOVE_KNOCKBACK_FALLBACK = 2.4;

export function isTackleSocialAction(action) {
  if (!action) return false;
  const id = String(action.id || '').toLowerCase();
  const label = String(action.label || '').toLowerCase();
  return id === 'tackle' || id === 'challenge' || id.includes('tackle') || label.includes('tackle');
}

export function applyWildKnockbackFromPoint(entity, fromX, fromY, strength) {
  if (!entity) return;
  const dx = (entity.x ?? 0) - (Number(fromX) || 0);
  const dy = (entity.y ?? 0) - (Number(fromY) || 0);
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const kb = Math.max(0.2, Number(strength) || PLAYER_FIELD_MOVE_KNOCKBACK_FALLBACK);
  const blend = 0.05;
  entity.vx = (entity.vx || 0) * blend + nx * kb;
  entity.vy = (entity.vy || 0) * blend + ny * kb;
  entity.knockbackLockSec = Math.max(entity.knockbackLockSec || 0, WILD_KNOCKBACK_LOCK_SEC);
  if (entity.aiState !== 'sleep') {
    entity.aiState = 'alert';
    entity.alertTimer = Math.max(entity.alertTimer || 0, WILD_KNOCKBACK_LOCK_SEC * 0.9);
  }
  entity.targetX = null;
  entity.targetY = null;
  entity.wanderTimer = 0;
  entity.idlePauseTimer = 0;
}

export function ensureSocialMemory(entity) {
  if (!entity.socialMemory) {
    entity.socialMemory = {
      affinity: 0,
      threat: 0,
      curiosity: 0,
      approachSignal: 0,
      retreatSignal: 0,
      reactionCooldown: 0
    };
  }
  if (!Array.isArray(entity.recentNearbyEvents)) entity.recentNearbyEvents = [];
  if (entity.lastPlayerDist == null) entity.lastPlayerDist = null;
  if (entity.lastProximitySignalAt == null) entity.lastProximitySignalAt = 999;
  return entity.socialMemory;
}

export function pushRecentNearbyEvent(entity, type, intensity = 1, meta) {
  ensureSocialMemory(entity);
  const evt = {
    type: String(type || ''),
    intensity: Number.isFinite(intensity) ? intensity : 0,
    ttl: WILD_SOCIAL_EVENT_TTL_SEC
  };
  if (meta && meta.subjectDex != null) evt.subjectDex = Math.floor(Number(meta.subjectDex)) || 0;
  entity.recentNearbyEvents.push(evt);
  if (entity.recentNearbyEvents.length > WILD_SOCIAL_EVENT_MAX) {
    entity.recentNearbyEvents.splice(0, entity.recentNearbyEvents.length - WILD_SOCIAL_EVENT_MAX);
  }
}

export function getNearbyEventIntensity(entity, eventType) {
  const list = entity.recentNearbyEvents;
  if (!Array.isArray(list) || !list.length) return 0;
  let total = 0;
  for (const evt of list) {
    if (evt.type === eventType) total += Number(evt.intensity) || 0;
  }
  return total;
}

function getAllySpeciesHurtIntensity(entity) {
  const myDex = entity.dexId ?? 1;
  const list = entity.recentNearbyEvents;
  if (!Array.isArray(list) || !list.length) return 0;
  let total = 0;
  for (const evt of list) {
    if (evt.type !== 'ally_species_hurt') continue;
    if (evt.subjectDex != null && evt.subjectDex !== myDex) continue;
    total += Number(evt.intensity) || 0;
  }
  return total;
}

export function broadcastNearbySpeciesAllyHurt(worldX, worldY, victimDex, intensity = 1, ignoreEntity = null) {
  const vd = Math.floor(Number(victimDex)) || 1;
  for (const e of entitiesByKey.values()) {
    if (e === ignoreEntity) continue;
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
    if ((e.dexId ?? 1) !== vd) continue;
    const dist = Math.hypot(e.x - worldX, e.y - worldY);
    if (dist > WILD_SOCIAL_NEARBY_EVENT_RADIUS) continue;
    const scaled = intensity * clamp(1 - dist / WILD_SOCIAL_NEARBY_EVENT_RADIUS, 0.25, 1);
    pushRecentNearbyEvent(e, 'ally_species_hurt', scaled, { subjectDex: vd });
  }
}

export function broadcastNearbyPlayerEvent(worldX, worldY, eventType, intensity = 1, ignoreEntity = null) {
  for (const e of entitiesByKey.values()) {
    if (e === ignoreEntity) continue;
    if ((e.spawnPhase ?? 1) < 0.5 || e.isDespawning || e.deadState) continue;
    const dist = Math.hypot(e.x - worldX, e.y - worldY);
    if (dist > WILD_SOCIAL_NEARBY_EVENT_RADIUS) continue;
    const scaled = intensity * clamp(1 - dist / WILD_SOCIAL_NEARBY_EVENT_RADIUS, 0.2, 1);
    pushRecentNearbyEvent(e, eventType, scaled);
  }
}

export function decaySocialMemory(entity, dt) {
  const memory = ensureSocialMemory(entity);
  const smoothStep = Math.max(0, dt);

  const decayTowardZero = (value, rate) => {
    if (value > 0) return Math.max(0, value - smoothStep * rate);
    if (value < 0) return Math.min(0, value + smoothStep * rate);
    return 0;
  };

  memory.affinity = decayTowardZero(memory.affinity, WILD_SOCIAL_MEMORY_DECAY_PER_SEC);
  memory.threat = decayTowardZero(memory.threat, WILD_SOCIAL_MEMORY_DECAY_PER_SEC * 0.85);
  memory.curiosity = decayTowardZero(memory.curiosity, WILD_SOCIAL_MEMORY_DECAY_PER_SEC * 0.7);
  memory.approachSignal = decayTowardZero(memory.approachSignal, WILD_SOCIAL_SIGNAL_DECAY_PER_SEC);
  memory.retreatSignal = decayTowardZero(memory.retreatSignal, WILD_SOCIAL_SIGNAL_DECAY_PER_SEC);
  memory.reactionCooldown = Math.max(0, (memory.reactionCooldown || 0) - smoothStep);

  if (!Array.isArray(entity.recentNearbyEvents) || !entity.recentNearbyEvents.length) {
    entity.recentNearbyEvents = [];
  } else {
    const kept = [];
    for (const evt of entity.recentNearbyEvents) {
      evt.ttl = (evt.ttl || 0) - smoothStep;
      if (evt.ttl > 0) kept.push(evt);
    }
    entity.recentNearbyEvents = kept;
  }

  entity.provoked01 = Math.max(0, (entity.provoked01 || 0) - smoothStep * 0.3);
  if (!entity.wildGrassHostileDeathBattle) {
    entity.wildTempAggressiveSec = Math.max(0, (entity.wildTempAggressiveSec || 0) - smoothStep);
    const allyStrain = getAllySpeciesHurtIntensity(entity);
    if (allyStrain >= 0.85) {
      entity.wildTempAggressiveSec = Math.min(22, Math.max(entity.wildTempAggressiveSec || 0, 6.5));
    }
  }
}

export function trackPlayerProximitySignals(entity, distToPlayer, dt) {
  const memory = ensureSocialMemory(entity);
  if (entity.lastPlayerDist == null) {
    entity.lastPlayerDist = distToPlayer;
    return;
  }
  const delta = distToPlayer - entity.lastPlayerDist;
  entity.lastPlayerDist = distToPlayer;
  entity.lastProximitySignalAt = (entity.lastProximitySignalAt || 0) + Math.max(0, dt);

  if (Math.abs(delta) < WILD_SOCIAL_SIGNAL_DELTA_TILES) return;
  if (delta < 0) {
    memory.approachSignal = clamp(memory.approachSignal + 0.45, -2, 2.5);
  } else {
    memory.retreatSignal = clamp(memory.retreatSignal + 0.45, -2, 2.5);
  }
  entity.lastProximitySignalAt = 0;
}

function resolveSocialActionInput(actionInput) {
  if (!actionInput) return null;
  if (typeof actionInput === 'string') return getSocialActionById(actionInput);
  if (typeof actionInput === 'object') {
    if (actionInput.id) return getSocialActionById(actionInput.id) || actionInput;
  }
  return null;
}

function socialDeltasForIntent(intent) {
  switch (intent) {
    case 'friendly':
      return { affinity: 0.62, threat: -0.2, curiosity: 0.22 };
    case 'playful':
      return { affinity: 0.35, threat: 0.05, curiosity: 0.5 };
    case 'curious':
      return { affinity: 0.12, threat: 0, curiosity: 0.66 };
    case 'calming':
      return { affinity: 0.25, threat: -0.5, curiosity: 0.18 };
    case 'assertive':
      return { affinity: -0.05, threat: 0.45, curiosity: 0.2 };
    case 'scary':
      return { affinity: -0.25, threat: 0.86, curiosity: -0.05 };
    default:
      return { affinity: 0, threat: 0, curiosity: 0 };
  }
}

function behaviorSocialModifiers(archetype) {
  switch (archetype) {
    case 'timid':
      return { affinityMul: 0.95, threatMul: 1.18, curiosityMul: 0.8 };
    case 'skittish':
      return { affinityMul: 0.82, threatMul: 1.35, curiosityMul: 0.72 };
    case 'aggressive':
      return { affinityMul: 0.72, threatMul: 0.9, curiosityMul: 1.2 };
    default:
      return { affinityMul: 1, threatMul: 1, curiosityMul: 1 };
  }
}

function chooseEmotionByOutcome(action, outcome, memory) {
  if (outcome === 'deescalate') return action.balloonType ?? 2;
  if (outcome === 'flee') return 5;
  if (outcome === 'approach') return 4;
  if (memory.threat > 1.4) return 0;
  return action.balloonType ?? 7;
}

function socialSexIntentMul(entity, intent) {
  const s = entity?.sex;
  if (!s || s === 'genderless') return { affinity: 1, threat: 1 };
  if (intent === 'scary') {
    return s === 'female' ? { affinity: 1, threat: 1.07 } : { affinity: 1, threat: 1.02 };
  }
  if (intent === 'assertive') {
    return s === 'male' ? { affinity: 0.99, threat: 1.05 } : { affinity: 1, threat: 1.03 };
  }
  if (intent === 'calming') {
    return s === 'female' ? { affinity: 1.05, threat: 1 } : { affinity: 1.02, threat: 1 };
  }
  return { affinity: 1, threat: 1 };
}

function applySocialReactionToWild(entity, action, player, influence) {
  if (!entity || !action || !player) return false;
  if ((entity.spawnPhase ?? 1) < 0.5 || entity.isDespawning || entity.deadState) return false;

  const memory = ensureSocialMemory(entity);
  if (memory.reactionCooldown > 0) return false;

  const behavior = entity.behavior || getSpeciesBehavior(entity.dexId ?? 1);
  const eff = getEffectiveWildBehavior(entity);
  const playerCfg = getPokemonConfig(player.dexId ?? 1);
  const wildCfg = getPokemonConfig(entity.dexId ?? 1);
  const playerHeight = Number(playerCfg?.heightTiles) || 2.1;
  const wildHeight = Number(wildCfg?.heightTiles) || 2.1;
  const sizeDelta = clamp((playerHeight - wildHeight) / 2.2, -1.25, 1.25);
  const intentDelta = socialDeltasForIntent(action.intent);
  const behaviorMul = behaviorSocialModifiers(behavior.archetype);
  const hostileNearby =
    getNearbyEventIntensity(entity, 'player_damage') +
    getNearbyEventIntensity(entity, 'player_field_move') +
    getNearbyEventIntensity(entity, 'hostile_social');
  const friendlyNearby = getNearbyEventIntensity(entity, 'friendly_social');

  const intimidationFactor =
    action.intent === 'assertive' || action.intent === 'scary' ? Math.max(0, sizeDelta) : 0;
  const calmingFactor = action.intent === 'calming' ? Math.max(0, sizeDelta) : 0;

  const sexM = socialSexIntentMul(entity, action.intent);

  let affinityDelta =
    (intentDelta.affinity * behaviorMul.affinityMul +
      friendlyNearby * 0.08 -
      hostileNearby * 0.06 +
      memory.retreatSignal * 0.08 -
      memory.approachSignal * 0.04 -
      intimidationFactor * 0.08) *
    influence;
  let threatDelta =
    (intentDelta.threat * behaviorMul.threatMul +
      hostileNearby * 0.2 +
      memory.approachSignal * 0.18 -
      memory.retreatSignal * 0.16 +
      intimidationFactor * 0.38 -
      calmingFactor * 0.16) *
    influence;
  const curiosityDelta =
    (intentDelta.curiosity * behaviorMul.curiosityMul +
      memory.retreatSignal * 0.1 -
      hostileNearby * 0.07) *
    influence;

  affinityDelta *= sexM.affinity;
  threatDelta *= sexM.threat;

  memory.affinity = clamp(memory.affinity + affinityDelta, -2.6, 3.1);
  memory.threat = clamp(memory.threat + threatDelta, 0, 3.8);
  memory.curiosity = clamp(memory.curiosity + curiosityDelta, -2, 3.2);

  const intentEventType =
    action.intent === 'scary' || action.intent === 'assertive' ? 'hostile_social' : 'friendly_social';
  pushRecentNearbyEvent(entity, intentEventType, 0.8 * influence);
  pushRecentNearbyEvent(entity, `social_${action.id}`, 0.7 * influence);

  if (action.intent === 'assertive' || action.intent === 'scary') {
    const bump = (action.intent === 'scary' ? 0.26 : 0.17) * influence;
    entity.provoked01 = clamp((entity.provoked01 || 0) + bump, 0, 3);
    if (entity.provoked01 >= 0.52) {
      entity.wildTempAggressiveSec = Math.min(22, Math.max(entity.wildTempAggressiveSec || 0, 5.0));
    }
  }

  const moodScore =
    memory.affinity +
    memory.curiosity * 0.35 -
    memory.threat -
    hostileNearby * 0.22 +
    memory.retreatSignal * 0.18 -
    memory.approachSignal * 0.2;

  let outcome = 'neutral';
  if (moodScore >= 0.95) {
    if (!entity.wildGrassHostileDeathBattle) {
      entity.aiState = 'wander';
      entity.vx = 0;
      entity.vy = 0;
      outcome = 'deescalate';
    } else {
      entity.aiState = 'alert';
      entity.alertTimer = Math.max(entity.alertTimer || 0, 0.8);
      outcome = 'neutral';
    }
  } else if (moodScore <= -0.65) {
    if (eff.archetype === 'aggressive' && (action.intent === 'assertive' || action.intent === 'scary')) {
      entity.aiState = 'approach';
      outcome = 'approach';
    } else {
      entity.aiState = 'flee';
      outcome = 'flee';
    }
    entity.targetX = null;
    entity.targetY = null;
  } else {
    entity.aiState = 'alert';
    entity.alertTimer = Math.max(entity.alertTimer || 0, 0.8);
    outcome = 'neutral';
  }

  setEmotion(entity, chooseEmotionByOutcome(action, outcome, memory), outcome !== 'deescalate', action.portraitSlug);

  const emoji = String(action.emoji || '💬');
  const slugRaw = String(action.portraitSlug || 'Normal').trim() || 'Normal';
  const portraitSlug = slugRaw.replace(/[^\w.-]/g, '') || 'Normal';
  const line =
    outcome === 'deescalate'
      ? 'Okay…'
      : outcome === 'flee'
        ? 'Eek!'
        : outcome === 'approach'
          ? 'Hey!'
          : 'Hmm?';
  const think = outcome === 'flee' || outcome === 'neutral';
  setWildSpeechBubble(
    entity,
    [
      { kind: 'portrait', slug: portraitSlug, fallbackEmoji: emoji },
      { kind: 'text', text: line }
    ],
    { durationSec: 2.0 + 0.55 * influence, kind: think ? 'think' : 'say' }
  );

  memory.reactionCooldown = WILD_SOCIAL_REACTION_COOLDOWN_SEC;
  markWildMinimapSpeciesKnown(entity);
  return true;
}

/**
 * Social interaction channel from numpad. The nearest wild in radius receives full impact,
 * nearby wild receive lighter ripple updates based on distance.
 * @param {import('../social/social-actions.js').SocialAction | string} actionInput
 * @param {{ x: number, y: number, dexId?: number } | null | undefined} player
 * @param {object | null | undefined} data
 * @returns {{ consumed: boolean, reactedCount: number }}
 */
export function triggerPlayerSocialAction(actionInput, player, data) {
  if (!player || !data) return { consumed: false, reactedCount: 0 };
  const action = resolveSocialActionInput(actionInput);
  if (!action) return { consumed: false, reactedCount: 0 };

  const px = Number(player.x) || 0;
  const py = Number(player.y) || 0;
  /** @type {{ entity: any, dist: number }[]} */
  const nearby = [];
  let primary = null;
  let primaryDist = Infinity;

  for (const entity of entitiesByKey.values()) {
    if ((entity.spawnPhase ?? 1) < 0.5 || entity.isDespawning || entity.deadState) continue;
    const dist = Math.hypot(entity.x - px, entity.y - py);
    if (dist > WILD_SOCIAL_RIPPLE_RADIUS) continue;
    nearby.push({ entity, dist });
    if (dist <= WILD_SOCIAL_INTERACTION_RADIUS && dist < primaryDist) {
      primary = entity;
      primaryDist = dist;
    }
  }

  if (!nearby.length || !primary) return { consumed: true, reactedCount: 0 };

  let reactedCount = 0;
  if (applySocialReactionToWild(primary, action, player, 1.0)) reactedCount += 1;

  for (const entry of nearby) {
    if (entry.entity === primary) continue;
    const ripple = clamp(1 - entry.dist / WILD_SOCIAL_RIPPLE_RADIUS, 0, 1) * 0.42;
    if (ripple < 0.1) continue;
    if (applySocialReactionToWild(entry.entity, action, player, ripple)) reactedCount += 1;
  }

  if (isTackleSocialAction(action) && primaryDist <= PLAYER_SOCIAL_TACKLE_HIT_RADIUS) {
    if (typeof primary.takeDamage === 'function') primary.takeDamage(PLAYER_SOCIAL_TACKLE_DAMAGE, player);
    setEmotion(primary, 5, false, 'Pain');
    setWildSpeechBubble(
      primary,
      [
        { kind: 'portrait', slug: 'Pain', fallbackEmoji: '💥' },
        { kind: 'text', text: 'Oof!' }
      ],
      { durationSec: 2.1, kind: 'say' }
    );
    applyWildKnockbackFromPoint(primary, px, py, PLAYER_SOCIAL_TACKLE_KNOCKBACK);
    pushRecentNearbyEvent(primary, 'player_field_move', 1.1);
    broadcastNearbyPlayerEvent(primary.x, primary.y, 'player_field_move', 0.75, primary);
  }

  const eventType =
    action.intent === 'scary' || action.intent === 'assertive' ? 'hostile_social' : 'friendly_social';
  broadcastNearbyPlayerEvent(px, py, eventType, 0.45);
  return { consumed: true, reactedCount };
}

