import { generate } from './generator.js';
import { render } from './render.js';

const canvas = document.getElementById('map');
const seedInput = document.getElementById('seed');
const btnGenerate = document.getElementById('generate');

// Tooltip para debug
const tooltip = document.createElement('div');
tooltip.className = 'debug-tooltip';
canvas.parentElement.appendChild(tooltip);

let currentData = null;

function run() {
  currentData = generate(seedInput.value);
  render(canvas, currentData);
}

// Hover para debug de célula
canvas.addEventListener('mousemove', (e) => {
  if (!currentData) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Escala para coordenadas de grid
  const gx = Math.floor((x / rect.width) * currentData.width);
  const gy = Math.floor((y / rect.height) * currentData.height);

  if (gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height) {
    const val = currentData.cells[gy * currentData.width + gx];
    
    // Procura se há cidade aqui
    const city = currentData.graph.nodes.find(n => n.x === gx && n.y === gy);
    
    tooltip.style.display = 'block';
    tooltip.style.left = `${e.clientX - rect.left + 15}px`;
    tooltip.style.top = `${e.clientY - rect.top + 15}px`;
    
    let info = `X: ${gx}, Y: ${gy}\nVal: ${val.toFixed(3)}`;
    if (city) info += `\nCity: ${city.isGym ? 'GYM' : 'Town'} (ID: ${city.id})`;
    
    tooltip.textContent = info;
    
    // Opcional: re-render com highlight
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
    edges: currentData.graph.edges
  }, null, 2);
  
  navigator.clipboard.writeText(json).then(() => {
    const originalText = tooltip.textContent;
    tooltip.textContent = "COPIADO JSON!";
    setTimeout(() => tooltip.textContent = originalText, 1000);
  });
});

btnGenerate.addEventListener('click', run);
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

run();
