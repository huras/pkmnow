/**
 * Exemplo de um Mod/Plugin utilizando o novo sistema de Registro Dinâmico.
 * Para instalar, este arquivo deve ser importado ou adicionado como script na página principal.
 */
import { PluginRegistry } from '../core/plugin-registry.js';
// Em um cenário real, modders usariam `window.PokemonModRegistry`

console.log('[TestMod] Loading custom Pokemon mod...');

// 1. Registrando um novo Ataque (Move)
PluginRegistry.registerMove('shadow-ball', {
  cooldownSec: 1.2,
  supportsCharge: false,
  cast: (sourceX, sourceY, targetX, targetY, sourceEntity, { pushParticle }) => {
    // Apenas um exemplo visual genérico: joga partículas escuras ao redor
    console.log('[TestMod] Casting Shadow Ball!');
    for (let i = 0; i < 10; i++) {
      pushParticle({
        type: 'burst',
        x: sourceX + (Math.random() - 0.5),
        y: sourceY + (Math.random() - 0.5),
        z: 0.5,
        vx: (targetX - sourceX) * 2 + (Math.random() - 0.5),
        vy: (targetY - sourceY) * 2 + (Math.random() - 0.5),
        vz: 2,
        life: 0.5,
        maxLife: 0.5
      });
    }
  }
});

// 2. Registrando um novo Bioma
PluginRegistry.registerBiome('CORRUPTED_LANDS', {
  id: 99,
  name: "Terras Corrompidas",
  color: "#2a0a2a", // Roxo bem escuro
  terrain: "Palette base — arcane", // Reutiliza o set visual arcano (escuro)
  foliage: "above dense-bushes", // Camada superior sombria
  vegetation: ['large-purple-crystal [2x2]', 'small-purple-crystal [1x1]', 'mushroom-1 [1x1]'],
  encounters: ['Gastly', 'Haunter', 'Zubat', 'Misdreavus', 'mod_shadow_pikachu'],
  bgm: [
    'audio/suno-original-bgm/arcane/3-01. Anistar City.mp3',
    'audio/suno-original-bgm/ghost-woods/120. Old Chateau.mp3'
  ],
  anomalyCheck: (e, t, m, a, isLand) => {
    // Aparece quando a anomalia é muito alta e a temperatura é fria
    return isLand && a > 0.9 && t < 0.4;
  }
});


// 3. Registrando um novo Item
PluginRegistry.registerItem('shadow-stone', {
  name: 'Pedra Sombria',
  slug: 'shadow-stone',
  description: 'Uma pedra estranha que emana uma aura negra.'
});

// 4. Registrando um novo Pokémon (Fakemon / Modded)
PluginRegistry.registerPokemon('mod_shadow_pikachu', {
  name: 'Shadow Pikachu',
  crySlug: 'pikachu', // reutiliza o grito original
  tileHeight: 1.2,
  displayScaleMultiplier: 1.1,
  idle: { frameWidth: 32, frameHeight: 32, durations: [10, 10, 10, 10] },
  walk: { frameWidth: 32, frameHeight: 32, durations: [8, 8, 8, 8] }
});

console.log('[TestMod] Mod loaded successfully!');
