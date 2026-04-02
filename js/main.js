import { generate } from './generator.js';
import { render, loadTilesetImages } from './render.js';
import { BIOMES } from './biomes.js';
import { getEncounters } from './ecodex.js';

const canvas = document.getElementById('map');
const seedInput = document.getElementById('seed');
const btnGenerate = document.getElementById('generate');
const infoBar = document.getElementById('hud-info');

let currentData = null;

// Semente padrão solicitada
if (seedInput) {
  seedInput.value = "demoasdasd1";
}

function getSettings() {
  const viewType = document.querySelector('input[name="viewType"]:checked')?.value || 'biomes';
  const overlayPaths = document.getElementById('chkRotas')?.checked ?? true;
  const overlayGraph = document.getElementById('chkGrafo')?.checked ?? true;
  return { viewType, overlayPaths, overlayGraph };
}

function updateView() {
  if (currentData) render(canvas, currentData, { settings: getSettings() });
}

function run() {
  currentData = generate(seedInput.value);
  updateView();
}

// Ouvintes para os botões de Fase 5
document.querySelectorAll('input[name="viewType"], #chkRotas, #chkGrafo').forEach(el => {
  el.addEventListener('change', updateView);
});

// Hover para debug de célula (Estilo Civilization HUD)
canvas.addEventListener('mousemove', (e) => {
  if (!currentData) return;

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
  // infoBar.textContent = "Mova o mouse sobre o mapa para ver os detalhes do terreno";
  if (currentData) updateView();
});

// Fase 5: Exportação Completa de Dados
const btnExport = document.getElementById('exportBtn');
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (!currentData) return;
    
    // Convertendo TypedArrays para exportação no JSON
    const exportData = {
      seed: currentData.seed,
      width: currentData.width,
      height: currentData.height,
      cells: currentData.cells ? Array.from(currentData.cells) : [],
      biomes: currentData.biomes ? Array.from(currentData.biomes) : [],
      temperature: currentData.temperature ? Array.from(currentData.temperature) : [],
      moisture: currentData.moisture ? Array.from(currentData.moisture) : [],
      graph: currentData.graph,
      paths: currentData.paths,
      landmarks: currentData.landmarks
    };

    // Não usa null, 2 para o arquivo final não ficar gigante com as arrays,
    // mas ainda é um JSON padrão.
    const jsonStr = JSON.stringify(exportData);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `pkmn-region-${currentData.seed}.json`;
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
