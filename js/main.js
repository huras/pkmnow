import { generate, DEFAULT_CONFIG } from './generator.js';
import { render, loadTilesetImages } from './render.js';
import { BIOMES } from './biomes.js';
import { getEncounters } from './ecodex.js';
import { player, setPlayerPos, tryMovePlayer, updatePlayer } from './player.js';
import { CHUNK_SIZE, getMicroTile, foliageDensity, foliageType } from './chunking.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { getRoleForCell, seededHash, parseShape } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN, BIOME_VEGETATION,
  GRASS_TILES, TREE_TILES,
  getGrassVariant, getTreeType
} from './biome-tiles.js';

const canvas = document.getElementById('map');
const minimap = document.getElementById('minimap');
const seedInput = document.getElementById('seed');
const btnGenerate = document.getElementById('generate');
const infoBar = document.getElementById('hud-info');
const btnExport = document.getElementById('exportBtn');
const btnImport = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const btnSettings = document.getElementById('btnSettings');
const settingsModal = document.getElementById('settingsModal');
const btnApplySettings = document.getElementById('btnApplySettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnBackToMap = document.getElementById('btnBackToMap');

let currentData = null;
let appMode = 'map'; // 'map' or 'play'
let currentConfig = { ...DEFAULT_CONFIG };
let gameTime = 0;
let animFrameId = null;

function getSettings() {
  const viewType = document.querySelector('input[name="viewType"]:checked')?.value || 'biomes';
  const overlayPaths = document.getElementById('chkRotas')?.checked ?? true;
  const overlayGraph = document.getElementById('chkGrafo')?.checked ?? true;
  const overlayContours = document.getElementById('chkCurvas')?.checked ?? true;
  return { viewType, overlayPaths, overlayGraph, overlayContours, appMode, player, time: gameTime };
}

function updateView() {
  if (currentData) render(canvas, currentData, { settings: getSettings(), hover: lastHoverTile });
}

// Animation loop (Play Mode only)
let lastTimestamp = 0;
const heldKeys = new Set();

function gameLoop(timestamp) {
  const dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  gameTime = timestamp / 1000;

  // Smooth movement update
  updatePlayer(dt);

  // Se o player terminou de andar e uma tecla direcional contínua pressionada, anda de novo
  if (!player.moving && currentData) {
    let dx = 0, dy = 0;
    if (heldKeys.has('up')) dy = -1;
    else if (heldKeys.has('down')) dy = 1;
    else if (heldKeys.has('left')) dx = -1;
    else if (heldKeys.has('right')) dx = 1;
    if (dx !== 0 || dy !== 0) {
      tryMovePlayer(dx, dy, currentData);
    }
  }

  updateView();
  if (appMode === 'play') {
    animFrameId = requestAnimationFrame(gameLoop);
  }
}

function startGameLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(gameLoop);
}

function stopGameLoop() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function run() {
  currentData = generate(seedInput.value, currentConfig);
  updateView();
}

// Ouvintes para os botões de Fase 5
document.querySelectorAll('input[name="viewType"], #chkRotas, #chkGrafo').forEach(el => {
  el.addEventListener('change', updateView);
});

// Hover para debug de célula (Estilo Civilization HUD)
let lastHoverTile = null;

canvas.addEventListener('mousemove', (e) => {
  if (!currentData) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (appMode === 'play') {
    const tileW = 40, tileH = 40;
    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;
    const mx = Math.floor((mouseX - canvas.width/2)/tileW + vx + 0.5);
    const my = Math.floor((mouseY - canvas.height/2)/tileH + vy + 0.5);
    lastHoverTile = { x: mx, y: my };
    return; // O loop de animação vai cuidar do render(canvas, ...)
  }

  // Escala para coordenadas de grid (Modo Mapa)
  const gx = Math.floor((mouseX / rect.width) * currentData.width);
  const gy = Math.floor((mouseY / rect.height) * currentData.height);
  lastHoverTile = { x: gx, y: gy };

  if (gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height) {
    const idx = gy * currentData.width + gx;
    const val = currentData.cells[idx];
    const imp = currentData.cellImportance ? currentData.cellImportance[idx] : 0;
    const traffic = currentData.roadTraffic ? currentData.roadTraffic[idx] : 0;
    
    // Procura se há cidade aqui
    const city = currentData.graph.nodes.find(n => n.x === gx && n.y === gy);
    // Procura se há rota (path) aqui (para a fase 4)
    let routeName = '';
    if (traffic > 0 && currentData.paths) {
      const activePath = currentData.paths.find(p => p.some(cell => cell.x === gx && cell.y === gy));
      if (activePath) routeName = activePath.name || `Rota (Importância ${activePath.importance})`;
    }
    
    const temp = currentData.temperature ? currentData.temperature[idx] : 0;
    const moist = currentData.moisture ? currentData.moisture[idx] : 0;
    const bId = currentData.biomes ? currentData.biomes[idx] : 0;
    const biome = Object.values(BIOMES).find(b => b.id === bId) || { name: 'Desconhecido' };
    const anom = currentData.anomaly ? currentData.anomaly[idx] : 0;
    const encounters = getEncounters(bId);
    const encounterText = encounters.slice(0, 3).join(", ");
    
    // Procura se há landmark aqui
    const landmark = currentData.landmarks ? currentData.landmarks.find(l => l.x === gx && l.y === gy) : null;

    // Conteúdo formatado para o HUD FIXO
    let mainInfo = '';
    if (city) {
      mainInfo = `<span style="color:#ff5b5b; font-weight:bold; margin-left:10px;">🏙️ ${city.name}</span>`;
    } else if (landmark) {
      mainInfo = `<span style="color:#00ffff; font-weight:bold; margin-left:10px;">✨ ${landmark.name}</span>`;
    } else if (routeName) {
      mainInfo = `<span style="color:#ffd700; font-weight:bold; margin-left:10px;">🛣️ ${routeName}</span>`;
    }

    infoBar.innerHTML = `
      <span class="biome-name">${biome.name}</span>
      <span><span class="label">Elev</span><b>${val.toFixed(2)}</b></span>
      <span><span class="label">Temp</span><b>${temp.toFixed(2)}</b></span>
      <span><span class="label">Humid</span><b>${moist.toFixed(2)}</b></span>
      <span title="${encounters.join(', ')}"><span class="label">Eco</span><b style="color:#8ceda1">${encounterText}</b></span>
      ${mainInfo}
    `;
    
    render(canvas, currentData, { hover: { x: gx, y: gy }, settings: getSettings() });
  } else {
    // infoBar.textContent = "Mova o mouse sobre o mapa para ver os detalhes do terreno";
    updateView();
  }
});

canvas.addEventListener('mouseleave', () => {
  if (currentData && appMode === 'map') updateView();
});

function enterPlayMode(gx, gy) {
  setPlayerPos(gx * CHUNK_SIZE + CHUNK_SIZE / 2, gy * CHUNK_SIZE + CHUNK_SIZE / 2);
  appMode = 'play';
  btnExport.classList.add('hidden');
  btnBackToMap.classList.remove('hidden');
  minimap.classList.remove('hidden');
  infoBar.innerHTML = "<b style='color:#fff'>Mova-se com WASD ou Setas. Aperte ESC para sair.</b>";
  
  // Ativa Fullscreen UX
  document.body.classList.add('play-mode-active');
  document.querySelector('.app').classList.add('play-mode-active');
  
  resizeCanvas();
  startGameLoop();
}

btnBackToMap.addEventListener('click', () => {
  appMode = 'map';
  btnExport.classList.remove('hidden');
  btnBackToMap.classList.add('hidden');
  minimap.classList.add('hidden');
  infoBar.innerHTML = "Mova o mouse sobre o mapa para ver os detalhes do terreno";
  
  // Desativa Fullscreen UX
  document.body.classList.remove('play-mode-active');
  document.querySelector('.app').classList.remove('play-mode-active');

  stopGameLoop();
  resizeCanvas();
  updateView();
});

function resizeCanvas() {
  if (appMode === 'play') {
    const wrap = document.querySelector('.map-wrap');
    canvas.width = wrap.clientWidth || window.innerWidth;
    // Pega o espaço que sobra pra tentar preencher bem a tela:
    canvas.height = wrap.clientHeight || window.innerHeight;
  } else {
    canvas.width = 512;
    canvas.height = 512;
  }
}

window.addEventListener('resize', () => {
  if (currentData) {
     resizeCanvas();
     updateView();
  }
});

// Clique no mapa entra no modo play
canvas.addEventListener('click', (e) => {
  if (!currentData || appMode !== 'map') return;
  const rect = canvas.getBoundingClientRect();
  const gx = Math.floor(((e.clientX - rect.left) / rect.width) * currentData.width);
  const gy = Math.floor(((e.clientY - rect.top) / rect.height) * currentData.height);
  
  if (gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height) {
    enterPlayMode(gx, gy);
  }
});

// Menu de contexto para Debug no Modo Play
canvas.addEventListener('contextmenu', (e) => {
  if (appMode !== 'play' || !currentData) return;
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  
  // Constantes do render.js Play Mode
  const tileW = 40, tileH = 40;
  const vx = player.visualX ?? player.x;
  const vy = player.visualY ?? player.y;

  const mx = Math.floor((screenX - canvas.width/2)/tileW + vx + 0.5);
  const my = Math.floor((screenY - canvas.height/2)/tileH + vy + 0.5);

  const tile = getMicroTile(mx, my, currentData);
  const biome = Object.values(BIOMES).find(b => b.id === tile.biomeId);

  const seed = currentData.seed;
  const fdTrees = foliageDensity(mx, my, seed + 5555, 2);
  const fdScatter = foliageDensity(mx, my, seed + 111, 2.5);
  const fdGrass = foliageDensity(mx, my, seed, 3);
  const ft = foliageType(mx, my, seed);

  // Geração da Matriz 3x3 (Surroundings)
  const surroundings = {
    heightStep: [[0,0,0],[0,0,0],[0,0,0]],
    biome: [['','',''],['','',''],['','','']],
    formals: [[false,false,false],[false,false,false],[false,false,false]],
    scatter: [[false,false,false],[false,false,false],[false,false,false]]
  };
  
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = mx + dx;
      const ny = my + dy;
      const t = getMicroTile(nx, ny, currentData) || { heightStep: 0, biomeId: 0 };
      const bEnv = Object.values(BIOMES).find(b => b.id === t.biomeId);
      const fTrees = foliageDensity(nx, ny, seed + 5555, 2);
      const fScat = foliageDensity(nx, ny, seed + 111, 2.5);
      const treeType = getTreeType(t.biomeId);
      
      surroundings.heightStep[dy+1][dx+1] = t.heightStep;
      surroundings.biome[dy+1][dx+1] = bEnv ? bEnv.name.substring(0,3).toUpperCase() : '???';
      surroundings.formals[dy+1][dx+1] = (!!treeType && (nx + ny) % 3 === 0 && fTrees >= 0.6);
      surroundings.scatter[dy+1][dx+1] = (fScat > 0.82);
    }
  }

  // Geração dos dados Macro (Raw Scale)
  const gx = Math.floor(mx / CHUNK_SIZE);
  const gy = Math.floor(my / CHUNK_SIZE);
  let macroIdx = -1;
  const isMacroValid = gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height;
  if (isMacroValid) macroIdx = gy * currentData.width + gx;

  const debugInfo = {
    coord: { mx, my, gx, gy },
    macro: {
      elevation: isMacroValid ? currentData.cells[macroIdx]?.toFixed(3) : 'N/A',
      temperature: (isMacroValid && currentData.temperature) ? currentData.temperature[macroIdx]?.toFixed(3) : 'N/A',
      moisture: (isMacroValid && currentData.moisture) ? currentData.moisture[macroIdx]?.toFixed(3) : 'N/A',
      anomaly: (isMacroValid && currentData.anomaly) ? currentData.anomaly[macroIdx]?.toFixed(3) : 'N/A'
    },
    surroundings,
    terrain: {
      biome: biome?.name,
      heightStep: tile.heightStep,
      isRoad: tile.isRoad,
      isCity: tile.isCity,
      spriteId: (function() {
         const setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
         const set = TERRAIN_SETS[setName];
         if (!set) return null;
         const isAtOrAbove = (r, c) => (getMicroTile(c, r, currentData)?.heightStep ?? -99) >= tile.heightStep;
         const role = getRoleForCell(my, mx, currentData.height * CHUNK_SIZE, currentData.width * CHUNK_SIZE, isAtOrAbove, set.type);
         return set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
      })()
    },
    vegetation: {
      noiseTrees: fdTrees.toFixed(3),
      noiseScatter: fdScatter.toFixed(3),
      noiseGrass: fdGrass.toFixed(3),
      typeFactor: ft.toFixed(3),
      activeSprites: (function() {
        const sprites = [];
        const treeType = getTreeType(tile.biomeId);
        const isFormalTree = !!treeType && (mx + my) % 3 === 0 && fdTrees >= 0.6;
        const isFormalNeighbor = !!treeType && (mx + my) % 3 === 1 && foliageDensity(mx - 1, my, seed + 5555, 2) >= 0.6;
        const isFormalOccupied = isFormalTree || isFormalNeighbor;

        // Checando Formal Trees
        if (isFormalTree) {
           const ids = TREE_TILES[treeType];
           if (ids) sprites.push({ type: 'formal-tree-base', ids: ids.base }, { type: 'formal-tree-top', ids: ids.top });
        }

        // Checando Scatter
        let occupiedByScatter = false;
        const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
        if (scatterItems.length > 0 && !tile.isRoad && !tile.isCity) {
           // Vizinhos à esquerda
           for (let dox = 1; dox <= 3; dox++) {
             const nx = mx - dox, nTile = getMicroTile(nx, my, currentData);
             if (nTile && foliageDensity(nx, my, seed + 111, 2.5) > 0.82) {
               const nItemKey = scatterItems[Math.floor(seededHash(nx, my, seed + 222) * scatterItems.length)];
               const nObjSet = OBJECT_SETS[nItemKey];
               if (nObjSet && dox < parseShape(nObjSet.shape).cols) { occupiedByScatter = true; break; }
             }
           }

           if (!isFormalOccupied && !occupiedByScatter && fdScatter > 0.82) {
              const itemKey = scatterItems[Math.floor(seededHash(mx, my, seed + 222) * scatterItems.length)];
              const objSet = OBJECT_SETS[itemKey];
              if (objSet) {
                 const base = objSet.parts.find(p => p.role === 'base' || p.role === 'CENTER');
                 const top = objSet.parts.find(p => p.role === 'top' || p.role === 'tops');
                 if (base) sprites.push({ type: `scatter-${itemKey}-base`, ids: base.ids });
                 if (top) sprites.push({ type: `scatter-${itemKey}-top`, ids: top.ids });
                 occupiedByScatter = true;
              }
           }
        }

        // Checando Grass
        if (!isFormalOccupied && !occupiedByScatter && fdGrass >= 0.45) {
           const variant = getGrassVariant(tile.biomeId), tiles = GRASS_TILES[variant];
           if (tiles) {
              const mainId = (ft < 0.5) ? tiles.original : (tiles.cactusBase || tiles.grass2 || tiles.original);
              sprites.push({ type: `grass-${variant}-base`, ids: [mainId] });
              // Se tiver topo (ex: cacto), incluir também
              if (variant === 'desert' && ft >= 0.5 && tiles.cactusTop) {
                 sprites.push({ type: `grass-${variant}-top`, ids: [tiles.cactusTop] });
              } else if (tiles.originalTop && ft < 0.5) {
                 sprites.push({ type: `grass-${variant}-top`, ids: [tiles.originalTop] });
              }
           }
        }
        return sprites;
      })()
    },
    logic: {
      isFormalTree: (function(){ 
        const treeType = getTreeType(tile.biomeId);
        return !!treeType && (mx + my) % 3 === 0 && fdTrees >= 0.6;
      })(),
      isFormalNeighbor: (function(){
        const treeType = getTreeType(tile.biomeId);
        return !!treeType && (mx + my) % 3 === 1 && foliageDensity(mx - 1, my, seed + 5555, 2) >= 0.6;
      })()
    }
  };

  openDebugModal(debugInfo);
});

// Modal Logic
const debugModal = document.getElementById('tile-debug-modal');
const debugContent = document.getElementById('tile-debug-content');
const btnDebugClose = document.getElementById('tile-debug-close');
const btnDebugCopy = document.getElementById('tile-debug-copy-json');
let lastDebugInfo = null;

if (btnDebugClose) {
  btnDebugClose.addEventListener('click', () => {
    debugModal.classList.remove('is-open');
  });
}

if (btnDebugCopy) {
  btnDebugCopy.addEventListener('click', () => {
    if (lastDebugInfo) {
      navigator.clipboard.writeText(JSON.stringify(lastDebugInfo, null, 2)).then(() => {
        const oldText = btnDebugCopy.textContent;
        btnDebugCopy.textContent = 'COPIED!';
        setTimeout(() => btnDebugCopy.textContent = oldText, 2000);
      });
    }
  });
}

function openDebugModal(info) {
  lastDebugInfo = info;
  
  const terrainHtml = `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">Terrain Intelligence</div>
      <table class="tile-debug-table">
        <tbody>
          <tr><th>Biome</th><td>${info.terrain.biome || 'Unknown'}</td></tr>
          <tr><th>Height Step</th><td>${info.terrain.heightStep}</td></tr>
          <tr><th>Macro Terrain</th><td>Elev: ${info.macro.elevation} | T: ${info.macro.temperature} | M: ${info.macro.moisture} | A: ${info.macro.anomaly}</td></tr>
          <tr><th>Road / City</th><td>${info.terrain.isRoad ? 'Yes' : 'No'} / ${info.terrain.isCity ? 'Yes' : 'No'}</td></tr>
          <tr><th>Base Sprite ID</th><td>
             <div style="display:flex; align-items:center; gap:8px;">
               ${info.terrain.spriteId !== null ? info.terrain.spriteId : 'N/A'} 
               ${info.terrain.spriteId !== null ? `<div class="sprite-icon" style="background: url('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png') -${(info.terrain.spriteId % 57)*16}px -${Math.floor(info.terrain.spriteId / 57)*16}px;"></div>` : ''}
             </div>
          </td></tr>
        </tbody>
      </table>
    </div>
  `;

  const renderMatrix = (matrix, renderer) => {
    return `<div class="tile-debug-matrix">
      ${matrix.map((row, dy) => row.map((cell, dx) => {
         const isCenter = dy === 1 && dx === 1;
         return `<div class="tile-debug-cell ${isCenter ? 'active-center' : ''}">${renderer(cell, isCenter, dy, dx)}</div>`;
      }).join('')).join('')}
    </div>`;
  };

  const surroundHtml = `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">3x3 Surroundings</div>
      <div style="display:flex; gap:16px;">
        <div style="flex:1">
          <span class="cell-label" style="font-size:0.7rem; color:#a0a0b0; display:block; text-align:center; margin-bottom:4px">HeightStep</span>
          ${renderMatrix(info.surroundings.heightStep, val => `H:${val}`)}
        </div>
        <div style="flex:1">
          <span class="cell-label" style="font-size:0.7rem; color:#a0a0b0; display:block; text-align:center; margin-bottom:4px">Biomes</span>
          ${renderMatrix(info.surroundings.biome, val => val)}
        </div>
        <div style="flex:1">
          <span class="cell-label" style="font-size:0.7rem; color:#a0a0b0; display:block; text-align:center; margin-bottom:4px">Tree/Scatter Occup.</span>
          ${renderMatrix(info.surroundings.formals, (isTree, isC, dy, dx) => {
             const isScat = info.surroundings.scatter[dy][dx];
             if (isTree) return '<span style="color:#8ceda1">Tree</span>';
             if (isScat) return '<span style="color:#d2a1ff">Scat</span>';
             return '<span style="color:#444">-</span>';
          })}
        </div>
      </div>
    </div>
  `;

  const vegHtml = `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">Vegetation Matrix</div>
      <div class="tile-debug-grid">
        <div class="tile-debug-cell">
            <span class="cell-label">Trees Noise</span>
            ${info.vegetation.noiseTrees}
        </div>
        <div class="tile-debug-cell">
            <span class="cell-label">Scatter Noise</span>
            ${info.vegetation.noiseScatter}
        </div>
        <div class="tile-debug-cell">
            <span class="cell-label">Grass Noise</span>
            ${info.vegetation.noiseGrass}
        </div>
        <div class="tile-debug-cell center">
            <span class="cell-label">Type Factor</span>
            ${info.vegetation.typeFactor}
        </div>
      </div>
    </div>
  `;

  let spritesHtml = '';
  if (info.vegetation.activeSprites && info.vegetation.activeSprites.length > 0) {
     const badges = info.vegetation.activeSprites.map(s => {
        let icons = '';
        if (s.ids) {
           icons = s.ids.map(id => `<div class="sprite-icon" style="background: url('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png') -${(id % 57)*16}px -${Math.floor(id / 57)*16}px;"></div>`).join('');
        }
        return `<div class="sprite-badge"><span class="sprite-badge-label">${s.type}</span><div class="tile-debug-sprite-stack">${icons}</div></div>`;
     }).join('');
     spritesHtml = `
       <div class="tile-debug-section">
         <div class="tile-debug-section-title">Active Overlays</div>
         <div>${badges}</div>
       </div>
     `;
  }

  const logicHtml = `
     <div class="tile-debug-section">
       <div class="tile-debug-section-title">Exclusion Logic</div>
       <table class="tile-debug-table">
         <tbody>
           <tr><th>Formal Tree Root</th><td>${info.logic.isFormalTree ? 'Yes' : 'No'}</td></tr>
           <tr><th>Formal Protected Bounds</th><td>${info.logic.isFormalNeighbor ? 'Yes' : 'No'}</td></tr>
         </tbody>
       </table>
     </div>
  `;

  debugContent.innerHTML = terrainHtml + surroundHtml + vegHtml + logicHtml + spritesHtml;
  document.getElementById('tile-debug-title').innerHTML = `Telemetry: Sector [${info.coord.mx}, ${info.coord.my}]`;
  debugModal.classList.add('is-open');
}

// Teclado: Track held keys para movimento contínuo estilo Pokémon
function keyToDir(key) {
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'up';
  if (key === 'ArrowDown' || key === 's' || key === 'S') return 'down';
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left';
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
  return null;
}

window.addEventListener('keydown', (e) => {
  if (appMode === 'play') {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
       e.preventDefault();
    }

    const dir = keyToDir(e.key);
    if (dir) {
      heldKeys.add(dir);

      // Tenta iniciar movimento imediato se não está andando
      if (!player.moving && currentData) {
        let dx = 0, dy = 0;
        if (dir === 'up') dy = -1;
        else if (dir === 'down') dy = 1;
        else if (dir === 'left') dx = -1;
        else if (dir === 'right') dx = 1;
        tryMovePlayer(dx, dy, currentData);
      }

      // Atualiza HUD
      if (currentData) {
        const tile = getMicroTile(player.x, player.y, currentData);
        const bId = tile.biomeId;
        const encounters = getEncounters(bId);
        let prefix = "";
        
        const macroX = Math.floor(player.x / CHUNK_SIZE);
        const macroY = Math.floor(player.y / CHUNK_SIZE);

        if (currentData.graph) {
           const city = currentData.graph.nodes.find(n => Math.abs(n.x - macroX) <= 1 && Math.abs(n.y - macroY) <= 1);
           if (city) prefix = `<span style="color:#ff5b5b">🏙️ ${city.name}</span> | `;
        }
        if (!prefix && currentData.paths) {
           const activePath = currentData.paths.find(p => p.some(c => c.x === macroX && c.y === macroY));
           if (activePath) prefix = `<span style="color:#ffd700">🛣️ ${activePath.name || 'Rota'}</span> | `;
        }
        
        infoBar.innerHTML = `${prefix}<span style="color:#8ceda1">Biome: ${Object.values(BIOMES).find(b=>b.id===bId).name} | Selvagens: ${encounters.slice(0, 3).join(', ')}</span>`;
      }
    }
    
    if (e.key === 'Escape') {
      btnBackToMap.click();
    }
  }
});

window.addEventListener('keyup', (e) => {
  const dir = keyToDir(e.key);
  if (dir) heldKeys.delete(dir);
});

// --- LÓGICA DE CONFIGURAÇÕES E I/O ---

btnSettings.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
  // Sincroniza sliders com o config atual
  document.getElementById('cfgWaterLevel').value = (currentConfig.waterLevel || 0.38) * 100;
  document.getElementById('cfgElevation').value = currentConfig.elevationScale;
  document.getElementById('cfgTemperature').value = currentConfig.temperatureScale;
  document.getElementById('cfgMoisture').value = currentConfig.moistureScale;
  document.getElementById('cfgDesertMoisture').value = (currentConfig.desertMoisture || 0.38) * 100;
  document.getElementById('cfgForestMoisture').value = (currentConfig.forestMoisture || 0.58) * 100;
  document.getElementById('cfgAnomaly').value = currentConfig.anomalyScale;
  document.getElementById('cfgCities').value = currentConfig.cityCount;
  document.getElementById('cfgGyms').value = currentConfig.gymCount;
});

btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

btnApplySettings.addEventListener('click', () => {
  currentConfig = {
    waterLevel: parseInt(document.getElementById('cfgWaterLevel').value) / 100,
    elevationScale: parseInt(document.getElementById('cfgElevation').value),
    temperatureScale: parseInt(document.getElementById('cfgTemperature').value),
    moistureScale: parseInt(document.getElementById('cfgMoisture').value),
    desertMoisture: parseInt(document.getElementById('cfgDesertMoisture').value) / 100,
    forestMoisture: parseInt(document.getElementById('cfgForestMoisture').value) / 100,
    anomalyScale: parseInt(document.getElementById('cfgAnomaly').value),
    cityCount: parseInt(document.getElementById('cfgCities').value),
    gymCount: parseInt(document.getElementById('cfgGyms').value),
    extraEdges: currentConfig.extraEdges
  };
  settingsModal.classList.add('hidden');
  run();
});

btnImport.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.seed && data.config) {
        seedInput.value = data.seed;
        currentConfig = { ...DEFAULT_CONFIG, ...data.config };
        run();
        infoBar.innerHTML = "<b style='color:#00ff00'>MUNDO IMPORTADO!</b>";
      } else {
        alert("Arquivo JSON inválido ou formato antigo.");
      }
    } catch (err) {
      alert("Erro ao ler JSON: " + err.message);
    }
  };
  reader.readAsText(file);
});

// Fase 5: Exportação Otimizada (Seed + Config)
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (!currentData) return;
    
    // Otimização: Exportamos apenas a Seed e a Configuração.
    // O sistema de Chunks e o Gerador reconstruirão tudo deterministicamente.
    const exportData = {
      version: 2,
      seed: seedInput.value,
      config: currentConfig
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `pkmn-config-${exportData.seed}.json`;
    document.body.appendChild(a);
    a.click();
    
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    const originalContent = infoBar.innerHTML;
    infoBar.innerHTML = "<b style='color:#00ff00'>JSON EXPORTADO COM SUCESSO!</b>";
    setTimeout(() => {
      // Evita piscar se o mouse for movido rapidamente
      if (infoBar.innerHTML.includes('JSON EXPORTADO')) {
         infoBar.innerHTML = originalContent;
      }
    }, 2000);
  });
}

btnGenerate.addEventListener('click', run);
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

// Execução inicial com pré-carregamento de ativos
loadTilesetImages().then(() => {
  run();
});
