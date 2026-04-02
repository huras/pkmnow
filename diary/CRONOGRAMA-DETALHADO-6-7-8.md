# Diário de Desenvolvimento: Fases 6, 7 e 8

Este documento consolida as enormes mudanças arquitetônicas e visuais implementadas na evolução do "Gerador de Mapas" para a "Engine Explorável".

---

## Fase 6: Autotiling e Tilesets (Pixel Art GBA Style)
**Objetivo:** Abandonar os blocos de cores sólidas e implementar visuais de alta definição utilizando os Tilesets estilo GameBoy Advance.
- **Tessellation Engine (13-roles):** Implementamos o motor de "Auto-Tiling" usando bitmasking de 8 vizinhos (`getRoleForCell`). Isso permitiu o desenho inteligente de cantos côncavos, convexos, bordas verticais e horizontais, além do preenchimento central. Corrigimos anomalias de 1px (`applyMorphologicalCleanup`) que o ruído gerava e poderiam quebrar o tiling.
- **Vegetation Scatter Dinâmico:** Introduziu um espalhamento (scatter) determinístico de folhagens, árvores e pedras usando a função `seededHash(x, y)`.
- **Async Image Loading:** Refatoração de `main.js` e `render.js` para usar o Canvas nativo via `ctx.drawImage` com leitura de uma `Image()` pre-carregada.

## Fase 7: Mecânica Play e Minimapa
**Objetivo:** Permitir ao jogador "dar zoom" num ponto e circular interativamente, transformando a arte estática numa "tela de jogo".
- **Sistema de Tela-Cheia:** O clique do jogador transita a página para classe CSS `.play-mode-active`, escondendo bordas e menus excedentes para entregar imersão de 100vh.
- **O Herói (Player):** Adicionado `player.js` para centralizar a posição `(x, y)` e validar a "Colisão". O sistema permite o player nadar livremente SE houver uma ponte validada pelo grafo da rede viária do mundo.
- **Minimapa:** Um Canvas secundário ancorado sobre o canto inferior direito com tracking ao vivo exibindo um ping piscante na posição do player.

## Fase 8: Chunking Dinâmico (Magia do Micro-Grid Infinito)
**Objetivo:** Expandir a escala do globo em 256x sem estourar a Memória RAM, permitindo cidades ocuparem dezenas de casas de espaço e que transições entre biomas fossem orgânicas e compridas.
- **Destruição do Array Absoluto:** O Canvas parou de ler o tabuleiro gigante da memória. Construímos o `chunking.js` — um calculador matemático em tempo-real.
- **Interpolação Bilinear Fina:** O Micro-grid interpola 4 pontos do Macro-grid misturados a uma oitava fina de `ValueNoise` (`microNoise`), criando rios irregulares, pequenas manchas de biomas híbridos em cordilheiras e areia sinuosa. Toda a magia acontece dinamicamente por onde o `camera frustum` do player caminha.
- **Escala "BOTW / Minecraft":** Cada ponto (1x1) da matriz de 128x128 agora hospeda um terreno local de `16x16`. Largura e altura virtuais saltaram de ~16k blocos para absurdos 4.19 Milhões de blocos.

---

### Futuras Oportunidades: Fase 9 (Sistema de Interações "Zelda")
1. Mapear Colisão Avançada de Cidades Procedurais (Ruas e Casas pré-fabricadas renderizadas via chunks).
2. Substituir `Hover` do personagem na grama e aplicar o "Pokémon surge do mato se pisar na vegetação scatter local".
3. Adicionar Drops no chão usando os mesmos IDs determinísticos da folhagem do micro-grid.
