import { playWildDamageHurtCry } from '../pokemon/pokemon-cries.js';
import { clamp } from './wild-core-state.js';
import {
  broadcastNearbyPlayerEvent,
  broadcastNearbySpeciesAllyHurt,
  ensureSocialMemory,
  pushRecentNearbyEvent
} from './wild-social-system.js';
import { setEmotion } from './wild-motion-ai.js';

export function bindStandardWildTakeDamage(entity) {
  entity.takeDamage = function (amount) {
    const memory = ensureSocialMemory(this);
    this.hp -= amount;
    this.hurtTimer = 0.28;
    this.hurtAnimTimer = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.hurtTimer = 0;
      this.deadState = this.animMeta?.faint ? 'faint' : 'sleep';
      this.deadTimer = 1.35;
      this.deadAnimTimer = 0;
      this.aiState = 'sleep';
      this.animMoving = false;
      this.vx = 0;
      this.vy = 0;
      setEmotion(this, 9, true, 'Pain');
      this.isDespawning = true;
    }
    this.hitFlashTimer = 0.2;

    if (!this.deadState && this.aiState !== 'sleep') {
      this.aiState = 'approach';
      this.alertTimer = Math.max(this.alertTimer || 0, 1.15);
      this.targetX = null;
      this.targetY = null;
    }

    memory.threat = clamp(memory.threat + 0.9, 0, 3.5);
    memory.affinity = clamp(memory.affinity - 0.35, -2.5, 3);
    pushRecentNearbyEvent(this, 'player_damage', 1.3);
    broadcastNearbyPlayerEvent(this.x, this.y, 'player_damage', 0.85, this);
    broadcastNearbySpeciesAllyHurt(this.x, this.y, this.dexId ?? 1, 1.05, this);
    this.provoked01 = clamp((this.provoked01 || 0) + 0.66, 0, 3);
    this.wildTempAggressiveSec = Math.min(22, Math.max(this.wildTempAggressiveSec || 0, 10.0));

    if (amount > 0) playWildDamageHurtCry(this);
  };
}

