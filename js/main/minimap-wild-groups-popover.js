import { getWildPokemonEntities } from '../wild-pokemon/index.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import {
  ensureSpriteCollabPortraitLoaded,
  getSpriteCollabPortraitImage
} from '../pokemon/spritecollab-portraits.js';

/** @param {any} e */
function isActiveWildEntity(e) {
  if (!e) return false;
  if (e.isDespawning || e.deadState) return false;
  if ((e.spawnPhase ?? 1) < 0.5) return false;
  return Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.dexId);
}

/** @param {string} groupId */
function formatGroupTitleLine(groupId) {
  const raw = String(groupId || '').replace(/^grp:/, '');
  return raw.length > 48 ? `${raw.slice(0, 22)}…${raw.slice(-20)}` : raw || '—';
}

/** @param {number} dex */
function speciesLabel(dex) {
  const cfg = getPokemonConfig(dex);
  return cfg?.name ?? `#${dex}`;
}

/**
 * @param {HTMLElement} listRoot
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {{ showLeaderRoamTarget?: boolean }} [options]
 */
export function renderWildGroupsPopoverList(listRoot, imageCache, options = {}) {
  const { showLeaderRoamTarget = false } = options;
  if (!listRoot) return;
  if (!imageCache) {
    listRoot.replaceChildren();
    const d = document.createElement('div');
    d.className = 'minimap-groups-popover__empty';
    d.textContent = 'Cache de imagens indisponível.';
    listRoot.appendChild(d);
    return;
  }

  const entities = getWildPokemonEntities().filter(isActiveWildEntity);
  const byGroup = new Map();
  /** @type {any[]} */
  const solos = [];

  for (const e of entities) {
    const gid = e.groupId;
    if (!gid) {
      solos.push(e);
      continue;
    }
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(e);
  }

  listRoot.replaceChildren();

  if (!entities.length) {
    const empty = document.createElement('div');
    empty.className = 'minimap-groups-popover__empty';
    empty.textContent = 'Nenhum Pokémon selvagem ativo na simulação.';
    listRoot.appendChild(empty);
    return;
  }

  /** @type {{ gid: string, members: any[] }[]} */
  const rows = [];
  for (const [gid, members] of byGroup) {
    members.sort((a, b) => (Number(a.groupMemberIndex) || 0) - (Number(b.groupMemberIndex) || 0));
    rows.push({ gid, members });
  }
  rows.sort((a, b) => String(a.gid).localeCompare(String(b.gid)));

  const slug = 'Normal';

  /**
   * @param {HTMLElement} host
   * @param {any} ent
   * @param {{ leaderKey: string | null }} ctx
   */
  const appendPortrait = (host, ent, ctx) => {
    const wrap = document.createElement('span');
    wrap.className = 'minimap-groups-popover__portrait-wrap';
    const dex = Math.floor(Number(ent.dexId) || 0);
    const isLeader = ctx.leaderKey != null && String(ent.key || '') === String(ctx.leaderKey);
    if (isLeader) wrap.classList.add('minimap-groups-popover__portrait-wrap--leader');

    const img = document.createElement('img');
    img.className = 'minimap-groups-popover__portrait';
    img.alt = speciesLabel(dex);
    img.decoding = 'async';
    img.loading = 'lazy';
    img.title = `${speciesLabel(dex)}${isLeader ? ' (líder)' : ''}`;

    const applySrc = () => {
      if (!img.isConnected) return;
      const tex = getSpriteCollabPortraitImage(imageCache, dex, slug);
      if (tex?.src) img.src = tex.src;
    };

    applySrc();
    void ensureSpriteCollabPortraitLoaded(imageCache, dex, slug).then(applySrc);

    wrap.appendChild(img);
    host.appendChild(wrap);
  };

  for (const { gid, members } of rows) {
    const leaderKeyRaw = members.find((m) => m.groupLeaderKey != null)?.groupLeaderKey;
    const leaderKey = leaderKeyRaw != null ? String(leaderKeyRaw) : null;
    const leader =
      (leaderKey && members.find((m) => String(m.key || '') === leaderKey)) || members[0];
    const phase = String(leader?.groupPhase ?? '—');
    const n = members.length;
    const row = document.createElement('div');
    row.className = 'minimap-groups-popover__row';

    const meta = document.createElement('div');
    meta.className = 'minimap-groups-popover__meta';
    const title = document.createElement('div');
    title.className = 'minimap-groups-popover__row-title';
    title.textContent = `${n} Pokémon · fase ${phase}`;
    title.title = String(gid);
    const sub = document.createElement('div');
    sub.className = 'minimap-groups-popover__row-sub';
    sub.textContent = formatGroupTitleLine(gid);
    meta.appendChild(title);
    meta.appendChild(sub);
    if (showLeaderRoamTarget) {
      const hint = document.createElement('div');
      hint.className = 'minimap-groups-popover__row-target';
      hint.textContent = phase === 'ROAM' ? 'Marcador do alvo do lider visivel no mapa.' : 'Sem marcador fora de ROAM.';
      meta.appendChild(hint);
    }

    const portraits = document.createElement('div');
    portraits.className = 'minimap-groups-popover__portraits';
    for (const m of members) appendPortrait(portraits, m, { leaderKey });

    row.appendChild(meta);
    row.appendChild(portraits);
    listRoot.appendChild(row);
  }

  if (solos.length) {
    const row = document.createElement('div');
    row.className = 'minimap-groups-popover__row minimap-groups-popover__row--solos';
    const meta = document.createElement('div');
    meta.className = 'minimap-groups-popover__meta';
    const title = document.createElement('div');
    title.className = 'minimap-groups-popover__row-title';
    title.textContent = `Sem grupo (${solos.length})`;
    title.title = 'Pokémon sem groupId (avulsos ou debug)';
    meta.appendChild(title);

    const portraits = document.createElement('div');
    portraits.className = 'minimap-groups-popover__portraits';
    solos.sort((a, b) => (Number(a.dexId) || 0) - (Number(b.dexId) || 0));
    for (const m of solos) appendPortrait(portraits, m, { leaderKey: null });

    row.appendChild(meta);
    row.appendChild(portraits);
    listRoot.appendChild(row);
  }
}
