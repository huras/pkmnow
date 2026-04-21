import { loadTilesetImages } from './render.js';
import { BiomesModal } from './biomes-modal.js';

const statusEl = document.getElementById('biomesPageStatus');
const gridEl = document.getElementById('biomesGrid');

async function bootBiomesPage() {
  if (!gridEl) return;
  try {
    await loadTilesetImages();
    const biomes = new BiomesModal();
    biomes.render();
    if (statusEl) statusEl.textContent = 'Catálogo carregado.';
  } catch (err) {
    console.error('[biomes-page] Failed to load biome catalog:', err);
    if (statusEl) statusEl.textContent = 'Falha ao carregar catálogo de biomas.';
  }
}

void bootBiomesPage();
