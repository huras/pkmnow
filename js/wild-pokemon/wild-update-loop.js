import { entitiesByKey } from './wild-core-state.js';
import { ensureEntityStamina, tickEntityStamina } from '../entity-stamina.js';
import { decaySocialMemory, trackPlayerProximitySignals } from './wild-social-system.js';
import { updateWorldReactions } from '../simulation/world-reactions.js';
import {
  advanceWildPokemonAnim,
  integrateWildPokemonVertical,
  updateWildMotion
} from './wild-motion-ai.js';
import { tickWildGroupLeaderPhaseWhenMotionSkipped } from './wild-group-behavior.js';
import { beginWildWalkProbeCache, endWildWalkProbeCache } from '../walkability.js';

/** Skip heavy wander pathing when far (sleep/flee/approach/alert still run every frame). */
const WILD_WANDER_LOD_SKIP_DIST = 40;
/** Interaction-priority ring: keep nearby mons fully responsive. */
const WILD_INTERACTION_PRIORITY_DIST = 26;
/** Mid ring keeps reduced cadence while still feeling alive. */
const WILD_INTERACTION_MID_DIST = 48;
const WILD_UPDATE_CADENCE_MID = 2;
const WILD_UPDATE_CADENCE_FAR = 4;
/** Prevent huge simulation jumps when accumulated dt is consumed. */
const WILD_LOD_DT_CAP = 0.12;

let wildUpdateFrameCounter = 0;

/** Wall-time breakdown for the last `updateWildPokemon` call (ms). */
export const wildUpdatePerfLast = {
  miscMs: 0,
  verticalMs: 0,
  socialMs: 0,
  motionMs: 0,
  postMs: 0
};

function nextWildUpdateFrame() {
  wildUpdateFrameCounter = (wildUpdateFrameCounter + 1) % 1_000_000_000;
  return wildUpdateFrameCounter;
}

function wildNeedsFullRateUpdate(entity, distToPlayer) {
  return (
    distToPlayer <= WILD_INTERACTION_PRIORITY_DIST ||
    entity.aiState !== 'wander' ||
    entity.isDespawning ||
    (entity.spawnPhase ?? 1) < 1 ||
    (entity.knockbackLockSec || 0) > 0 ||
    entity.hurtTimer > 0 ||
    entity.hitFlashTimer > 0 ||
    !!entity.deadState
  );
}

function wildCadenceForDistance(distToPlayer) {
  if (distToPlayer <= WILD_INTERACTION_MID_DIST) return WILD_UPDATE_CADENCE_MID;
  return WILD_UPDATE_CADENCE_FAR;
}

export function resetWildUpdateFrameCounter() {
  wildUpdateFrameCounter = 0;
}

export function updateWildPokemon(dt, data, playerX, playerY, options = {}) {
  if (!data) return;
  
  const ignorePlayer = !!options.ignorePlayer;
  const aiPlayerX = ignorePlayer ? -99999 : playerX;
  const aiPlayerY = ignorePlayer ? -99999 : playerY;

  beginWildWalkProbeCache();

  try {
    updateWorldReactions(dt, data, playerX, playerY);
    wildUpdatePerfLast.miscMs = 0;
    wildUpdatePerfLast.verticalMs = 0;
    wildUpdatePerfLast.socialMs = 0;
    wildUpdatePerfLast.motionMs = 0;
    wildUpdatePerfLast.postMs = 0;

    const toDelete = [];
    const frameNo = nextWildUpdateFrame();
    for (const [k, e] of entitiesByKey.entries()) {
      if (e?._strengthCarryHidden) continue;
      const distToPlayer = Math.hypot(e.x - playerX, e.y - playerY);
      const distToAiPlayer = ignorePlayer ? 99999 : distToPlayer;

      const distanceInactivated =
        distToPlayer > WILD_WANDER_LOD_SKIP_DIST &&
        e.aiState === 'wander' &&
        !e.isDespawning &&
        (e.spawnPhase ?? 1) >= 0.5;
      e._distanceInactivated = distanceInactivated;
      let mark = performance.now();
      const isCloseEnough = distToPlayer < 24;
      const fullRate = wildNeedsFullRateUpdate(e, distToAiPlayer);
      const cadence = fullRate ? 1 : wildCadenceForDistance(distToAiPlayer);
      const lodOffset = e._lodOffset ?? 0;
      const processThisFrame = cadence === 1 || (frameNo + lodOffset) % cadence === 0;
      e._lodDtAccum = (e._lodDtAccum || 0) + dt;
      if (!processThisFrame) continue;
      const stepDt = Math.min(WILD_LOD_DT_CAP, e._lodDtAccum);
      e._lodDtAccum = 0;
      const skipWanderMotion = distanceInactivated;

      wildUpdatePerfLast.miscMs += performance.now() - mark;
      mark = performance.now();

      if (e.isDespawning) {
        if (e.deadTimer > 0) {
          e.deadTimer = Math.max(0, e.deadTimer - stepDt);
        }
        if (e.deadTimer <= 0) {
          e.spawnPhase = Math.max(0, (e.spawnPhase ?? 1) - stepDt * 2.0);
        }
        if (e.spawnPhase <= 0) toDelete.push(k);
      } else {
        if (isCloseEnough || e.spawnPhase > 0) {
          e.spawnPhase = Math.min(1, (e.spawnPhase ?? 0) + stepDt * 0.7);
        }
      }

      wildUpdatePerfLast.miscMs += performance.now() - mark;
      mark = performance.now();

      integrateWildPokemonVertical(e, stepDt);

      wildUpdatePerfLast.verticalMs += performance.now() - mark;
      mark = performance.now();

      decaySocialMemory(e, stepDt);
      trackPlayerProximitySignals(e, distToAiPlayer, stepDt);

      wildUpdatePerfLast.socialMs += performance.now() - mark;
      mark = performance.now();

      if (!skipWanderMotion) {
        updateWildMotion(e, stepDt, data, aiPlayerX, aiPlayerY);
      } else {
        e.vx = 0;
        e.vy = 0;
        e.animMoving = false;
        ensureEntityStamina(e);
        tickEntityStamina(e, stepDt, false);
        tickWildGroupLeaderPhaseWhenMotionSkipped(e, stepDt, entitiesByKey);
      }

      wildUpdatePerfLast.motionMs += performance.now() - mark;
      mark = performance.now();

      if (e.hurtTimer > 0) e.hurtTimer = Math.max(0, e.hurtTimer - stepDt);
      advanceWildPokemonAnim(e, stepDt);

      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer -= stepDt;
        if (e.hitFlashTimer < 0) e.hitFlashTimer = 0;
      }

      wildUpdatePerfLast.postMs += performance.now() - mark;
    }
    // Do not push play-event-log rows here: each despawning wild mon would trigger a
    // full log snapshot + HUD rebuild (and portrait fetches), which stutters badly when
    // many entities expire in one frame. Map deletion alone is cheap.
    for (const k of toDelete) entitiesByKey.delete(k);
  } finally {
    endWildWalkProbeCache();
  }
}
