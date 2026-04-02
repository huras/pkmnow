import { generate, DEFAULT_CONFIG } from './generator.js';
import { render, loadTilesetImages } from './render.js';
import { BIOMES } from './biomes.js';
import { getEncounters } from './ecodex.js';
import { player, setPlayerPos, tryMovePlayer, updatePlayer } from './player.js';
import { CHUNK_SIZE, getMicroTile } from './chunking.js';

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
  return { viewType, overlayPaths, overlayGraph, appMode, player, time: gameTime };
}

function updateView() {
  if (currentData) render(canvas, currentData, { settings: getSettings() });
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
canvas.addEventListener('mousemove', (e) => {
  if (!currentData || appMode === 'play') return;

  const rect = canvas.getBoundingClientRect();
  
  // Coordenadas relativas ao canvas
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Escala para coordenadas de grid
  const gx = Math.floor((mouseX / rect.width) * currentData.width);
  const gy = Math.floor((mouseY / rect.height) * currentData.height);

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
