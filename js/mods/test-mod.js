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

// 5. Novo: Utilizando Hooks de Renderização para um efeito visual de "Aura Corrompida"
PluginRegistry.registerHook('postRender', (ctx, data, options) => {
  // Só aplica se estivermos no bioma corrompido
  const player = options.settings?.player;
  if (!player || !data) return;
  
  // Pegamos o bioma atual do player (aproximado pelo centro da tela)
  const mx = Math.floor(player.x);
  const my = Math.floor(player.y);
  // Nota: getMicroTile não está exportado globalmente, mas podemos checar o biomeId se tivermos acesso ao chunk
  // Para simplificar no mod, vamos apenas checar se o bioma registrado é o CORRUPTED_LANDS
  
  // Efeito visual: Vinheta roxa pulsante
  const time = options.settings?.time || 0;
  const pulse = (Math.sin(time * 2) + 1) * 0.5;
  
  // Vamos aplicar apenas se o céu estiver escuro ou se for bioma específico (fictício aqui para o demo)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const grad = ctx.createRadialGradient(
    ctx.canvas.width/2, ctx.canvas.height/2, 0,
    ctx.canvas.width/2, ctx.canvas.height/2, ctx.canvas.width * 0.8
  );
  grad.addColorStop(0, 'rgba(42, 10, 42, 0)');
  grad.addColorStop(1, `rgba(42, 10, 42, ${0.2 + pulse * 0.15})`);
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
});

console.log('[TestMod] Mod loaded successfully!');
