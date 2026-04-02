import { generate } from './generator.js';
import { render } from './render.js';

const canvas = document.getElementById('map');
const seedInput = document.getElementById('seed');
const btnGenerate = document.getElementById('generate');

// Tooltip para debug (estilo injetado para garantir legibilidade)
const tooltip = document.createElement('div');
tooltip.className = 'debug-tooltip';
Object.assign(tooltip.style, {
  position: 'absolute',
  backgroundColor: 'rgba(0, 0, 0, 0.85)',
  color: '#fff',
  padding: '8px',
  borderRadius: '4px',
  fontSize: '12px',
  pointerEvents: 'none',
  display: 'none',
  zIndex: '1000',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  fontFamily: 'sans-serif',
  lineHeight: '1.4'
});
canvas.parentElement.style.position = 'relative';
canvas.parentElement.appendChild(tooltip);

let currentData = null;

// Semente padrão solicitada
if (seedInput) {
  seedInput.value = "demoasdasd1";
}

function run() {
  currentData = generate(seedInput.value);
  render(canvas, currentData);
}

// Hover para debug de célula
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
    
    tooltip.style.display = 'block';
    tooltip.style.left = `${mouseX + 15}px`;
    tooltip.style.top = `${mouseY + 15}px`;
    
    // Conteúdo formatado
    tooltip.innerHTML = `
      <div style="font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:4px; padding-bottom:2px;">
        Célula [${gx}, ${gy}]
      </div>
      <div style="display:grid; grid-template-columns: auto 1fr; gap: 8px;">
        <span>Terrain:</span> <b style="text-align:right">${val.toFixed(3)}</b>
        <span>Traffic:</span> <b style="text-align:right">${traffic} paths</b>
        <span>Import.:</span> <b style="text-align:right; color:${imp > 5 ? '#ffd700' : '#fff'}">${imp}</b>
      </div>
      ${city ? `<div style="margin-top:6px; color:#ff5b5b; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;"><b>CITY (ID: ${city.id})</b></div>` : ''}
    `;
    
    render(canvas, currentData, { hover: { x: gx, y: gy } });
  } else {
    tooltip.style.display = 'none';
    render(canvas, currentData);
  }
});

canvas.addEventListener('mouseleave', () => {
  tooltip.style.display = 'none';
  if (currentData) render(canvas, currentData);
});

// Click para copiar JSON bruto
canvas.addEventListener('click', () => {
  if (!currentData) return;
  
  const json = JSON.stringify({
    seed: currentData.seed,
    width: currentData.width,
    height: currentData.height,
    cities: currentData.graph.nodes,
    paths: currentData.paths.length
  }, null, 2);
  
  navigator.clipboard.writeText(json).then(() => {
    const originalContent = tooltip.innerHTML;
    tooltip.innerHTML = "<b style='color:#00ff00'>JSON COPIADO!</b>";
    setTimeout(() => tooltip.innerHTML = originalContent, 1000);
  });
});

btnGenerate.addEventListener('click', run);
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

// Execução inicial
run();
