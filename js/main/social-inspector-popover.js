import { getWildPokemonEntities } from '../wild-pokemon/index.js';
import { player } from '../player.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import {
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';
import { WILD_SOCIAL_SCENARIOS } from '../wild-pokemon/wild-scenario-data.js';
import { scenarioOrchestrator } from '../wild-pokemon/wild-scenario-orchestrator.js';
import { entitiesByKey } from '../wild-pokemon/wild-core-state.js';

const INSPECTOR_RADIUS = 20; // tiles
const MAX_ENTITIES = 12;

/** @param {any} e */
function isActiveWild(e) {
  if (!e) return false;
  if (e.isDespawning || e.deadState) return false;
  if ((e.spawnPhase ?? 1) < 0.5) return false;
  return Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.dexId);
}

/** @param {number} val @param {number} lo @param {number} hi */
function pct(val, lo, hi) {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(100, ((val - lo) / (hi - lo)) * 100));
}

/** @param {number} dex */
function speciesName(dex) {
  const cfg = getPokemonConfig(dex);
  return cfg?.name ?? `#${dex}`;
}

const ARCHETYPE_EMOJI = {
  timid: '🐇',
  skittish: '💨',
  neutral: '😐',
  aggressive: '🔥'
};

const NATURE_EMOJI = {
  Adamant: '💪',
  Jolly: '😄',
  Timid: '😰',
  Bold: '🛡️',
  Quiet: '🤫'
};

const STATE_LABEL = {
  wander: '🚶',
  flee: '🏃💨',
  alert: '⚠️',
  scenic: '🎭',
  approach: '🎯',
  follow_player: '💕🚶'
};

/**
 * Renders the social inspector list showing nearby Pokémon social memory.
 * @param {HTMLElement} listEl
 * @param {Map<string, HTMLImageElement>} imageCache
 */
export function renderSocialInspectorList(listEl, imageCache) {
  if (!listEl) return;

  const all = getWildPokemonEntities().filter(isActiveWild);
  const px = player.x;
  const py = player.y;

  const nearby = all
    .map((e) => ({ e, dist: Math.hypot(e.x - px, e.y - py) }))
    .filter((o) => o.dist <= INSPECTOR_RADIUS)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_ENTITIES);

  listEl.replaceChildren();

  if (!nearby.length) {
    const empty = document.createElement('div');
    empty.className = 'social-inspector__empty';
    empty.textContent = 'No wild Pokémon nearby';
    listEl.appendChild(empty);
    return;
  }

  for (const { e, dist } of nearby) {
    const row = document.createElement('div');
    row.className = 'social-inspector__row';

    // — Portrait —
    const portrait = document.createElement('div');
    portrait.className = 'social-inspector__portrait';
    const img = document.createElement('img');
    img.className = 'social-inspector__portrait-img';
    img.alt = speciesName(e.dexId);
    img.decoding = 'async';
    img.loading = 'lazy';
    const slug = 'Normal';
    const applySrc = () => {
      if (!img.isConnected) return;
      const tex = getSpriteCollabPortraitImage(imageCache, e.dexId, slug);
      if (tex?.src) img.src = tex.src;
    };
    applySrc();
    void ensureSpriteCollabPortraitLoaded(imageCache, e.dexId, slug).then(applySrc);
    portrait.appendChild(img);

    // — Info column —
    const info = document.createElement('div');
    info.className = 'social-inspector__info';

    // Name + state line
    const nameLine = document.createElement('div');
    nameLine.className = 'social-inspector__name-line';
    const archEmoji = ARCHETYPE_EMOJI[e.behavior?.archetype] || '';
    const natEmoji = NATURE_EMOJI[e.nature] || '';
    const stateEmoji = STATE_LABEL[e.aiState] || e.aiState || '';
    const groupPhase = e.groupPhase ? ` [${e.groupPhase}]` : '';
    nameLine.textContent = `${speciesName(e.dexId)} ${archEmoji}${natEmoji} ${stateEmoji}${groupPhase}`;
    nameLine.title = `Dist: ${dist.toFixed(1)}  Arch: ${e.behavior?.archetype || '?'}  Nature: ${e.nature || '?'}  State: ${e.aiState || '?'}`;

    // — Social memory bars —
    const mem = e.socialMemory;
    const bars = document.createElement('div');
    bars.className = 'social-inspector__bars';

    if (mem) {
      bars.appendChild(makeBar('💚', 'Affinity', mem.affinity || 0, -2.6, 3.1, '#4caf50', '#c62828'));
      bars.appendChild(makeBar('⚡', 'Threat', mem.threat || 0, 0, 3.8, '#ff9800', '#ff9800'));
      bars.appendChild(makeBar('🔍', 'Curiosity', mem.curiosity || 0, -2, 3.2, '#2196f3', '#2196f3'));
    } else {
      const noMem = document.createElement('div');
      noMem.className = 'social-inspector__no-mem';
      noMem.textContent = '— no social memory —';
      bars.appendChild(noMem);
    }

    info.appendChild(nameLine);
    info.appendChild(bars);
    row.appendChild(portrait);
    row.appendChild(info);
    listEl.appendChild(row);
  }
}

/**
 * @param {string} emoji
 * @param {string} label
 * @param {number} val
 * @param {number} lo
 * @param {number} hi
 * @param {string} posColor
 * @param {string} negColor
 */
function makeBar(emoji, label, val, lo, hi, posColor, negColor) {
  const wrapper = document.createElement('div');
  wrapper.className = 'social-inspector__bar-row';
  wrapper.title = `${label}: ${val.toFixed(2)} [${lo}…${hi}]`;

  const lbl = document.createElement('span');
  lbl.className = 'social-inspector__bar-emoji';
  lbl.textContent = emoji;

  const track = document.createElement('div');
  track.className = 'social-inspector__bar-track';

  // For affinity (which can be negative), center the bar at 0
  if (lo < 0) {
    const zeroPct = pct(0, lo, hi);
    const valPct = pct(val, lo, hi);
    const fill = document.createElement('div');
    fill.className = 'social-inspector__bar-fill';
    if (val >= 0) {
      fill.style.left = zeroPct + '%';
      fill.style.width = (valPct - zeroPct) + '%';
      fill.style.background = posColor;
    } else {
      fill.style.left = valPct + '%';
      fill.style.width = (zeroPct - valPct) + '%';
      fill.style.background = negColor;
    }
    // Zero marker
    const marker = document.createElement('div');
    marker.className = 'social-inspector__bar-zero';
    marker.style.left = zeroPct + '%';
    track.appendChild(fill);
    track.appendChild(marker);
  } else {
    const fill = document.createElement('div');
    fill.className = 'social-inspector__bar-fill';
    fill.style.width = pct(val, lo, hi) + '%';
    fill.style.background = posColor;
    track.appendChild(fill);
  }

  const valSpan = document.createElement('span');
  valSpan.className = 'social-inspector__bar-val';
  valSpan.textContent = val.toFixed(1);

  wrapper.appendChild(lbl);
  wrapper.appendChild(track);
  wrapper.appendChild(valSpan);
  return wrapper;
}

/**
 * Populates the scenario dropdown.
 * @param {HTMLSelectElement} selectEl
 */
export function populateScenarioSelect(selectEl) {
  if (!selectEl) return;
  // Keep the first "placeholder" option
  while (selectEl.options.length > 1) selectEl.remove(1);
  for (const s of WILD_SOCIAL_SCENARIOS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.id.replace(/_/g, ' ');
    selectEl.appendChild(opt);
  }
}

/**
 * Triggers the selected scenario on the nearest eligible group.
 * @param {string} scenarioId
 * @returns {boolean} true if triggered
 */
export function triggerScenarioOnNearestGroup(scenarioId) {
  const scenario = WILD_SOCIAL_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) return false;

  const all = getWildPokemonEntities().filter(isActiveWild);
  const px = player.x;
  const py = player.y;

  // Build groups
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const e of all) {
    if (!e.groupId) continue;
    if (!groups.has(e.groupId)) groups.set(e.groupId, []);
    groups.get(e.groupId).push(e);
  }

  // Find nearest eligible group
  let bestGroup = null;
  let bestDist = Infinity;
  for (const [gid, members] of groups) {
    if (members.length < scenario.minMembers) continue;
    // Skip groups already in a scenario
    if (scenarioOrchestrator.activeScenarios.has(gid)) continue;
    // Skip groups in scenic phase
    if (members[0]?.groupPhase === 'SCENIC') continue;
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    const d = Math.hypot(cx - px, cy - py);
    if (d < bestDist) {
      bestDist = d;
      bestGroup = { gid, members };
    }
  }

  if (!bestGroup) return false;

  bestGroup.members.sort(
    (a, b) => (Number(a.groupMemberIndex) || 0) - (Number(b.groupMemberIndex) || 0)
  );

  const finder = bestGroup.members[0];
  scenarioOrchestrator.startScenario(
    bestGroup.gid,
    scenarioId,
    bestGroup.members,
    finder.key
  );

  // Mark scenic
  for (const m of bestGroup.members) {
    m.groupPhase = 'SCENIC';
    m.discoveryCooldown = 60 + Math.random() * 40;
  }

  return true;
}
