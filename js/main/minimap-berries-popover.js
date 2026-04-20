import { getAllBerryTreeStates } from './berry-tree-system.js';

const BERRY_EMOJIS = {
  'Cheri': '🍒',
  'Chesto': '🌰',
  'Pecha': '🍑',
  'Rawst': '🍓',
  'Aspear': '🍐',
  'Leppa': '🍇',
  'Oran': '🫐'
};

const MATURITY_LABELS = {
  0: 'Sprout',
  1: 'Growing',
  2: 'Mature'
};

/**
 * Renders the list of discovered berry trees in the minimap popover.
 * @param {HTMLElement} listRoot
 * @param {{ x?: number, y?: number } | null | undefined} player
 */
export function renderBerriesPopoverList(listRoot, player) {
  if (!listRoot) return;
  
  const berryStates = getAllBerryTreeStates();
  listRoot.replaceChildren();

  if (berryStates.size === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '12px';
    empty.style.color = 'rgba(255,255,255,0.4)';
    empty.style.fontSize = '0.7rem';
    empty.style.textAlign = 'center';
    empty.textContent = 'No berries discovered in this region yet.';
    listRoot.appendChild(empty);
    return;
  }

  const px = Number(player?.x);
  const py = Number(player?.y);
  const hasPlayerPos = Number.isFinite(px) && Number.isFinite(py);

  // Sort by nearest -> farthest from player; fallback keeps stable deterministic order.
  const sorted = Array.from(berryStates.entries()).sort((a, b) => {
    if (hasPlayerPos) {
      const [axRaw, ayRaw] = a[0].split(',');
      const [bxRaw, byRaw] = b[0].split(',');
      const ax = Number(axRaw);
      const ay = Number(ayRaw);
      const bx = Number(bxRaw);
      const by = Number(byRaw);
      const aHasCoords = Number.isFinite(ax) && Number.isFinite(ay);
      const bHasCoords = Number.isFinite(bx) && Number.isFinite(by);
      if (aHasCoords && bHasCoords) {
        const da = (ax - px) ** 2 + (ay - py) ** 2;
        const db = (bx - px) ** 2 + (by - py) ** 2;
        if (da !== db) return da - db;
      } else if (aHasCoords !== bHasCoords) {
        return aHasCoords ? -1 : 1;
      }
    }
    if (a[1].maturityStage !== b[1].maturityStage) return b[1].maturityStage - a[1].maturityStage;
    if (a[1].type !== b[1].type) return a[1].type.localeCompare(b[1].type);
    return a[0].localeCompare(b[0]);
  });

  for (const [coords, state] of sorted) {
    const item = document.createElement('div');
    item.className = 'berry-item';

    const icon = document.createElement('div');
    icon.className = 'berry-item__icon';
    icon.textContent = BERRY_EMOJIS[state.type] || '🫐';
    
    const info = document.createElement('div');
    info.className = 'berry-item__info';
    
    const name = document.createElement('div');
    name.className = 'berry-item__name';
    name.textContent = `${state.type} Berry`;
    
    const attr = document.createElement('div');
    attr.className = 'berry-item__attr';
    attr.textContent = `At ${coords.replace(',', ', ')}`;
    
    const status = document.createElement('div');
    status.className = 'berry-item__status';
    
    const maturity = document.createElement('span');
    maturity.className = 'berry-item__maturity';
    maturity.textContent = MATURITY_LABELS[state.maturityStage] || 'Unknown';
    
    // Colorize maturity
    if (state.maturityStage === 2) {
        maturity.style.background = 'rgba(120, 255, 120, 0.15)';
        maturity.style.color = '#a0ffa0';
    } else if (state.maturityStage === 1) {
        maturity.style.background = 'rgba(255, 220, 120, 0.15)';
        maturity.style.color = '#ffe0a0';
    }

    status.appendChild(maturity);
    
    if (state.harvested) {
      const harvested = document.createElement('span');
      harvested.className = 'berry-item__harvested';
      harvested.textContent = 'Harvested';
      status.appendChild(harvested);
    }

    info.appendChild(name);
    info.appendChild(attr);
    info.appendChild(status);
    
    item.appendChild(icon);
    item.appendChild(info);
    
    listRoot.appendChild(item);
  }
}
