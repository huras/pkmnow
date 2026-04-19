import { PluginRegistry } from './plugin-registry.js';
import { syncModBiomesToStaticObject } from '../biomes.js';


/**
 * Carrega a lista de mods ativos de um arquivo JSON e inicializa cada um.
 */
export async function initMods() {
  console.log('[ModLoader] Initializing mods...');
  try {
    const response = await fetch('js/mods/mods.json');
    if (!response.ok) {
      console.warn('[ModLoader] No mods.json found, skipping auto-load.');
      return;
    }
    
    const mods = await response.json();
    if (!Array.isArray(mods)) {
      console.error('[ModLoader] mods.json must be an array of strings (paths).');
      return;
    }

    for (const modPath of mods) {
      try {
        console.log(`[ModLoader] Loading mod: ${modPath}`);
        // Usamos import dinâmico para carregar o mod como um módulo ES.
        // O path é relativo a este arquivo (js/core/).
        await import(`../mods/${modPath}`);
      } catch (err) {
        console.error(`[ModLoader] Failed to load mod at ${modPath}:`, err);
      }
    }
    
    // Após carregar todos os mods, sincroniza os biomas para a UI
    syncModBiomesToStaticObject();
    
    console.log('[ModLoader] All mods loaded.');
  } catch (err) {
    console.error('[ModLoader] Error fetching mods.json:', err);
  }
}
