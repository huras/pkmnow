# Constantes principais do jogo

Este documento lista as constantes mais importantes para balanceamento e comportamento global do projeto.
O foco aqui e explicar "o que muda no jogo" quando cada valor e ajustado.

## 1) Mundo e escala base

Fonte: `js/chunking.js`, `js/world-movement-constants.js`, `js/biomes.js`, `js/player.js`.

- `MACRO_TILE_STRIDE = 32`
  - Quantidade de micro-tiles por celula macro.
  - Impacta geracao, limites do mundo, minimapa e distribuicao de spawns.

- `LAND_STEPS = 12`
  - Numero de degraus discretos de elevacao em terra.
  - Define o "relevo util" acima do nivel da agua.

- `WATER_STEPS = 5`
  - Numero de degraus discretos abaixo do nivel da agua.
  - Quanto maior, maior a faixa de variacao de profundidade.

- `WORLD_MAX_WALK_SPEED_TILES_PER_SEC = 3.2`
  - Velocidade horizontal canonica de deslocamento no mundo.
  - Serve de referencia para player e movimentacao de wilds.

- `PLAYER_FLIGHT_MAX_Z_TILES = 28`
  - Teto de altura para voo no modo criativo.
  - Afeta navegacao vertical, camera e interacoes por eixo Z.

- `BEACH_ELEVATION_BAND = 0.05`
  - Faixa acima de `waterLevel` tratada como praia.
  - Ajusta o tamanho da borda costeira.

- `DEFAULT_WATER_LEVEL = 0.21`
  - Nivel do mar padrao quando o config nao informa `waterLevel`.
  - Muda drasticamente proporcao terra/agua no mapa.

## 2) Render e camera (modo play)

Fonte: `js/render/render-constants.js`.

- `PLAY_CHUNK_SIZE = 4`
  - Tamanho dos blocos usados para camada estatica no play.
  - Troca principal entre custo de redraw e granularidade de cache.

- `PLAY_BAKE_TILE_PX = 42`
  - Tamanho em pixels do micro-tile no bake de chunks.
  - Deve permanecer estavel para manter consistencia de chaves de cache.

- `PLAY_CAMERA_Z_REF = 58`
  - Referencia de normalizacao do `z` da camera.
  - Controla sensacao de zoom/profundidade no modo play.

- `PLAY_SEA_OVERLAY_ALPHA_LOD01 = 0.82`
  - Opacidade da camada animada do oceano em LOD proximo.
  - Regula mistura entre autotile base e animacao de agua.

- `WATER_ANIM_SRC_W = 16`, `WATER_ANIM_SRC_H = 16`
  - Dimensoes do frame de animacao de agua no tileset.

- `VEG_MULTITILE_OVERLAP_PX = 1`
  - Sobreposicao de vegetacao multi-tile.
  - Evita "fenda" visual entre celulas.

- `MAX_SCATTER_ROWS_PASS2 = 6`
  - Maximo de linhas analisadas no passo de scatter.
  - Controla alcance de verificacoes de elementos acima do tile.

## 3) Grama e oclusao do jogador

Fonte: `js/render/render-constants.js`, `js/player.js`.

- `GRASS_DEFER_AROUND_PLAYER_DELTAS`
  - Lista de offsets (E/W/S/SE/SW) para adiar partes da grama.
  - Garante leitura visual correta quando o jogador entra na vegetacao.

- `PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC = 0.25`
  - Fracao inferior da grama desenhada na frente do jogador.
  - Define quao "imerso" o personagem parece na vegetacao.

- `PLAYER_TILE_GRASS_OVERLAY_ALPHA = 0.92`
  - Alpha do overlay frontal de grama.
  - Valores maiores deixam o efeito mais marcado.

- `PLAYER_IDLE_WAITING_FRAME_INDEX = 0`
  - Quadro idle usado em regras de sobreposicao dependentes de pose.

## 4) Luz solar e transicao de bioma arborizado

Fonte: `js/render/render-constants.js`.

- `FORMAL_TREES_SUN_RAYS_BOOST_INTENSITY = 0.45`
  - Intensidade extra dos raios de sol sob copa de arvores formais.

- `FORMAL_TREES_SUN_RAYS_FADE_SEC = 1.8`
  - Tempo de fade para entrar/sair do boost de luz.

- `SUN_LIGHT_RAYS_DAWN_EDGE_FADE_HOURS = 1.0`
  - Janela de transicao da luz no inicio do dia.

- `SUN_LIGHT_RAYS_NIGHT_EDGE_FADE_HOURS = 1.5`
  - Janela de transicao da luz no fim do dia.

## 5) Spawn e IA de Pokemon selvagem

Fonte: `js/wild-pokemon/wild-pokemon-constants.js`.

- `WILD_MACRO_SUBDIVISION = 0.25`
  - Subdivisao das celulas macro para slots de spawn.
  - Impacta densidade espacial de pontos de spawn dentro de cada macro-celula.

- `WILD_MAX_SIMULTANEOUS_SLOTS = 15`
  - Limite de slots simulados ao mesmo tempo.
  - Define teto de carga de IA e evita manter slots distantes sem necessidade.

- `WILD_WANDER_RADIUS_TILES = 15`
  - Raio maximo de passeio de cada selvagem em torno do slot.

- `GRASS_WALK_HOSTILE_SPAWN_CHANCE = 0.0155`
  - Chance por passo em grama alta de gerar encontro hostil.
  - E um dos knobs centrais de frequencia de encounter.

- `GRASS_WALK_HOSTILE_AGGRO_SEC = 22`
  - Duracao inicial do estado agressivo apos spawn hostil.

- `GRASS_WALK_HOSTILE_SPAWN_COOLDOWN_SEC = 10`
  - Cooldown minimo entre spawns hostis em grama.
  - Suaviza sequencias ruins de RNG.

## 6) Combate e projetil

Fonte: `js/moves/move-constants.js`.

- `MAX_PROJECTILES = 120`
  - Quantidade maxima de projeteis ativos.
  - Em overflow, os mais antigos sao descartados.

- `MAX_PARTICLES = 400`
  - Limite de particulas simultaneas para efeitos visuais.

- `COLLISION_BROAD_PHASE_TILES = 4`
  - Distancia para culling de checagens de colisao.
  - Reduz custo de hit-test.

- `PROJECTILE_Z_HIT_TOLERANCE_TILES = 1.35`
  - Tolerancia em Z para projetil causar dano.
  - Evita acerto falso quando sombra 2D parece perto, mas altura real diverge.

- Intervalos de trilha de particulas:
  - `EMBER_TRAIL_INTERVAL = 0.045`
  - `WATER_TRAIL_INTERVAL = 0.038`
  - `PSY_TRAIL_INTERVAL = 0.05`
  - `POWDER_TRAIL_INTERVAL = 0.06`
  - `SILK_TRAIL_INTERVAL = 0.05`
  - `LASER_TRAIL_INTERVAL = 0.03`
  - Controlam a densidade visual das trilhas por tipo de ataque.

- `WILD_MOVE_COOLDOWN_DEFAULT = 1.15`
  - Intervalo base de uso de golpe pela IA selvagem.

## 7) Ciclo de dia e presets de horario

Fonte: `js/main/world-time-of-day.js`.

- `PHASE_DAWN_START = 6`
- `PHASE_DAY_START = 10`
- `PHASE_AFTERNOON_START = 17`
- `PHASE_NIGHT_START = 22`
  - Pontos de corte das fases do dia no relogio 24h.
  - Afetam tint do mundo, ambience e leitura visual de horario.

- `PRESET_HOUR = { dawn: 7, day: 12, afternoon: 19, night: 1 }`
  - Horas padrao para atalhos/snap do painel de desenvolvimento.

## 8) Como usar este guia para balanceamento

- Ajustes de escala e "feeling de mundo": comecar por `MACRO_TILE_STRIDE`, `WORLD_MAX_WALK_SPEED_TILES_PER_SEC` e `DEFAULT_WATER_LEVEL`.
- Ajustes de encounter: focar em `GRASS_WALK_HOSTILE_SPAWN_CHANCE`, `GRASS_WALK_HOSTILE_SPAWN_COOLDOWN_SEC` e `WILD_MAX_SIMULTANEOUS_SLOTS`.
- Ajustes de performance visual: priorizar `MAX_PROJECTILES`, `MAX_PARTICLES`, `PLAY_CHUNK_SIZE` e `COLLISION_BROAD_PHASE_TILES`.
- Ajustes de legibilidade no render: revisar `PLAY_CAMERA_Z_REF`, constantes de grama e fases de horario.
