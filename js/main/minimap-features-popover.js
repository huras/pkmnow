import { jumpToWorldMapLocation } from './world-map-camera-state.js';
import { setPlayerPos } from '../player.js';
import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import { HEIGHT_STEP_Z } from '../walkability.js';

export function renderFeaturesPopoverList(container, data) {
    container.innerHTML = '';
    
    // Cities
    const cities = data.graph?.nodes || [];
    if (cities.length) {
        renderSectionHeader(container, 'Cities & Gyms');
        cities.forEach(node => {
            const label = node.isGym ? `🏆 ${node.name}` : `🏠 ${node.name}`;
            container.appendChild(createFeatureRow(label, node.x, node.y, 16, {}, data));
        });
    }

    // Caves
    const caves = (data.landmarks || []).filter(lm => lm.type === 'CAVE');
    if (caves.length) {
        renderSectionHeader(container, 'Cave Entrances');
        caves.forEach((cave, i) => {
            const label = `🕳️ ${cave.name || `Cave ${i+1}`}`;
            container.appendChild(createFeatureRow(label, cave.x, cave.y, 24, {}, data));
        });
    }

    // Roads
    const roads = data.paths || [];
    if (roads.length) {
        renderSectionHeader(container, 'Routes');
        roads.forEach(path => {
            if (!path || !path.length) return;
            
            // Pick a point around 40% of the way to avoid the city start
            const midIndex = Math.min(path.length - 1, Math.max(0, Math.floor(path.length * 0.4)));
            const tpTarget = path[midIndex] || path[0];
            const label = `🛣️ ${path.name || 'Unnamed Route'}`;
            container.appendChild(createFeatureRow(label, tpTarget.x, tpTarget.y, 10, { 
                tpX: tpTarget.x, 
                tpY: tpTarget.y,
                isRoute: true 
            }, data));
        });
    }
}

function renderSectionHeader(container, text) {
    const header = document.createElement('div');
    header.style = 'font-weight: bold; padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-top: 8px; color: #8af; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em;';
    header.textContent = text;
    container.appendChild(header);
}

function createFeatureRow(label, mx, my, jumpZoom, options = {}, data = {}) {
    const row = document.createElement('div');
    row.style = 'display: flex; gap: 2px; align-items: stretch; width: 100%; margin-bottom: 2px;';

    // Jump button (Map focus)
    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.style = 'flex: 1; background: rgba(40,45,60,0.6); border: 1px solid rgba(255,255,255,0.1); color: #eee; padding: 6px 10px; text-align: left; cursor: pointer; border-radius: 4px 0 0 4px; font-size: 0.82rem; transition: all 0.2s; font-family: "Inter", sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    jumpBtn.textContent = label;
    jumpBtn.title = `Focus map on ${label}`;
    
    jumpBtn.onmouseover = () => {
        jumpBtn.style.background = 'rgba(60,80,120,0.8)';
        jumpBtn.style.borderColor = 'rgba(255,255,255,0.3)';
    };
    jumpBtn.onmouseout = () => {
        jumpBtn.style.background = 'rgba(40,45,60,0.6)';
        jumpBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    };
    jumpBtn.onclick = (e) => {
        e.stopPropagation();
        jumpToWorldMapLocation(mx, my, jumpZoom);
    };

    // Teleport button (Player warp)
    const tpBtn = document.createElement('button');
    tpBtn.type = 'button';
    tpBtn.style = 'flex: 0 0 32px; background: rgba(60,40,90,0.6); border: 1px solid rgba(255,255,255,0.1); border-left: none; color: #ccf; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 0 4px 4px 0; transition: all 0.2s;';
    tpBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
    tpBtn.title = `Teleport to ${label}`;

    tpBtn.onmouseover = () => {
        tpBtn.style.background = 'rgba(100,60,160,0.8)';
        tpBtn.style.borderColor = 'rgba(255,255,255,0.3)';
        tpBtn.style.color = '#fff';
    };
    tpBtn.onmouseout = () => {
        tpBtn.style.background = 'rgba(60,40,90,0.6)';
        tpBtn.style.borderColor = 'rgba(255,255,255,0.1)';
        tpBtn.style.color = '#ccf';
    };
    tpBtn.onclick = (e) => {
        e.stopPropagation();
        
        let targetX = mx;
        let targetY = my;
        
        // If it's a cave, teleport slightly in front of the center (to avoid landing inside a cliff wall)
        // Usually caves are on south edges, so we move south a bit.
        if (label.includes('🕳️')) {
            const cave = (data.landmarks || []).find(lm => lm.x === mx && lm.y === my && lm.type === 'CAVE');
            if (cave) {
                // Adjust landing based on facing
                if (cave.facing === 'north') targetY -= 0.6;
                else if (cave.facing === 'east') targetX += 0.6;
                else if (cave.facing === 'west') targetX -= 0.6;
                else targetY += 0.6; // south (default)
            } else {
                targetY += 0.6; 
            }
        }

        const px = (targetX + 0.5) * MACRO_TILE_STRIDE;
        const py = (targetY + 0.5) * MACRO_TILE_STRIDE;
        
        // Calculate correct Z height
        const tile = getMicroTile(Math.floor(px), Math.floor(py), data);
        const targetZ = (tile?.heightStep || 0) * HEIGHT_STEP_Z;
        
        setPlayerPos(px, py);
        
        // Apply Z height
        if (window.player) {
            window.player.z = targetZ;
            window.player.visualZ = targetZ;
            window.player.groundZ = targetZ;
        }
        
        // Visual feedback
        const originalBg = tpBtn.style.background;
        tpBtn.style.background = '#4f4';
        tpBtn.style.color = '#000';
        setTimeout(() => {
            tpBtn.style.background = originalBg;
            tpBtn.style.color = '#ccf';
        }, 300);
    };

    row.appendChild(jumpBtn);
    row.appendChild(tpBtn);
    return row;
}
