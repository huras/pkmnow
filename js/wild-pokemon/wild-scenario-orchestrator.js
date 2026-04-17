import { WILD_SOCIAL_SCENARIOS } from './wild-scenario-data.js';
import { setWildSpeechBubble } from '../social/speech-bubble-state.js';
import { setEmotion } from './wild-motion-ai.js';
import { entitiesByKey } from './wild-core-state.js';

/**
 * Tracks and updates active social scenarios for Pokémon groups.
 */
export class WildScenarioOrchestrator {
  constructor() {
    this.activeScenarios = new Map(); // groupId -> scenarioState
  }

  /**
   * Updates all active scenarios.
   * @param {number} dt delta time in seconds
   */
  update(dt) {
    for (const [groupId, state] of this.activeScenarios.entries()) {
      // Abort if any member is invalid
      if (state.members.some(m => !m || m.deadState || m.isDespawning)) {
        this.endScenario(groupId, state);
        continue;
      }
      state.timer += dt;
      this.updateScenarioState(groupId, state);
    }
  }

  updateScenarioState(groupId, state) {
    const scenario = WILD_SOCIAL_SCENARIOS.find(s => s.id === state.scenarioId);
    if (!scenario) {
      this.activeScenarios.delete(groupId);
      return;
    }

    // Check if we need to advance to the next step
    let modified = false;
    for (const step of scenario.steps) {
      if (state.timer >= step.delay && !state.completedSteps.has(step)) {
        this.executeStep(state.members, step, state);
        state.completedSteps.add(step);
        modified = true;
      }
    }

    // End scenario if all steps done and last one duration expired
    const lastStep = scenario.steps[scenario.steps.length - 1];
    if (state.timer >= lastStep.delay + lastStep.duration) {
      this.endScenario(groupId, state);
    }
  }

  executeStep(members, step, state) {
    const targets = this.resolveTargets(members, step, state);
    for (const target of targets) {
      if (!target) continue;
      
      let bubble = step.bubble;
      if (step.bubbleByNature && target.nature) {
        bubble = step.bubbleByNature[target.nature] || step.bubbleByNature['default'] || bubble;
      }

      // Re-force facing during steps to ensure they keep looking at the discovery
      if (state.focusPoint) {
        const dx = state.focusPoint.x - target.x;
        const dy = state.focusPoint.y - target.y;
        if (Math.abs(dx) > Math.abs(dy)) {
          target.facing = dx > 0 ? 'right' : 'left';
        } else {
          target.facing = dy > 0 ? 'down' : 'up';
        }
      }

      if (bubble) {
        setWildSpeechBubble(target, bubble, { 
          durationSec: step.duration,
          kind: 'say'
        });
      }

      if (step.emotion !== undefined) {
        setEmotion(target, step.emotion, false);
      }
    }
  }

  resolveTargets(members, step, state) {
    if (step.actor === 'finder') {
      const finder = members.find(m => m.key === state.finderKey) || members[0];
      return [finder];
    }
    if (step.actor === 'leader') return [members.find(m => m.isLeader) || members[0]];
    if (step.actor === 'peers') {
        const finderKey = state.finderKey || members[0].key;
        return members.filter(m => m.key !== finderKey);
    }
    if (step.actor === 'skeptic') {
        const skeptic = members.find(m => m.nature === 'Adamant' && m.key !== state.finderKey) || 
                       members.find(m => m.key !== state.finderKey) || 
                       members[members.length - 1];
        return [skeptic];
    }
    if (step.actor === 'all') return members;
    return [];
  }

  startScenario(groupId, scenarioId, members, finderKey = null) {
    const finder = members.find(m => m.key === (finderKey || members[0].key)) || members[0];
    const actualFinderKey = finder.key;
    const scenario = WILD_SOCIAL_SCENARIOS.find(s => s.id === scenarioId);
    
    // Calculate focus point (discovery location)
    let fx = finder.x;
    let fy = finder.y;
    const dist = 1.1;
    if (finder.facing === 'up') fy -= dist;
    else if (finder.facing === 'down') fy += dist;
    else if (finder.facing === 'left') fx -= dist;
    else if (finder.facing === 'right') fx += dist;
    else fy += dist; // default

    this.activeScenarios.set(groupId, {
      scenarioId,
      members,
      timer: 0,
      completedSteps: new Set(),
      focusPoint: { x: fx, y: fy },
      itemSlug: scenario?.itemSlug,
      finderKey: actualFinderKey
    });
    
    // Freeze group and force look at discovery
    for (const m of members) {
      m.aiState = 'scenic';
      m.vx = 0;
      m.vy = 0;
      
      const dx = fx - m.x;
      const dy = fy - m.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        m.facing = dx > 0 ? 'right' : 'left';
      } else {
        m.facing = dy > 0 ? 'down' : 'up';
      }
    }
  }

  endScenario(groupId, state) {
    for (const m of state.members) {
      if (m.aiState === 'scenic') m.aiState = 'wander';
    }
    this.activeScenarios.delete(groupId);
  }
}

export const scenarioOrchestrator = new WildScenarioOrchestrator();
