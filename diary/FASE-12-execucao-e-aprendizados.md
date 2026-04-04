# Fase 12: Urbanização Estruturada e Conectividade Path-Aware — Execução e Aprendizados

## O que foi feito

Nesta fase, elevamos o nível de detalhe do nosso mundo procedural, movendo além da topologia natural para uma infraestrutura urbana funcional e esteticamente premium.

1.  **Layout Urbano e Ativos Dinâmicos**:
    *   Integramos o tileset `PokemonCenter.png` e definimos `OBJECT_SETS` detalhados para os três pilares de uma cidade Pokémon: **Centro Pokémon**, **PokéMart** e **Casas Residenciais**.
    *   Implementamos um motor de layout determinístico em `chunking.js` que posiciona estas estruturas em coordenadas fixas relativas ao nó central da cidade, garantindo consistência visual em qualquer seed.
    *   **Renderização em Camadas (Dual-Pass)**: Para suportar a profundidade visual, as bases/portas são assadas nos *Chunks* estáticos, enquanto os telhados são desenhados dinamicamente. Isso permite que o player caminhe "atrás" das estruturas mantendo o *z-sorting* correto.

2.  **Tesselação de Pavemento e Lógica `conc-conv-d`**:
    *   Introduzimos uma nova variante de tesselação chamada `conc-conv-d`. Diferente dos sets côncavos tradicionais (de 13-roles), este padrão 3x3 foca em superfícies densas e uniformes, ideal para pavimentação urbana.
    *   Substituímos os placeholders genéricos por conjuntos de alta fidelidade: `gray-brick-mosaic`, `cemented-pavement` e `detailed-small-bricks`.
    *   Atualizamos o sistema de colisividade (`walkability.js`) para reconhecer automaticamente qualquer padrão de pavimento como superfície caminhável.

3.  **Conectividade de Rotas Inteligente (`roadMasks`)**:
    *   Resolvemos o problema crítico de fusão indesejada entre rotas paralelas (ex: Rota 101 e 107 correndo lado a lado sem se tocarem).
    *   **Engenharia de Bitmasks**: Cada rota gerada no grafo recebe um bit único em uma grade `Uint32Array` (`roadMasks`). A lógica de conectividade visual no micro-tiler agora realiza uma operação `AND` binária entre a célula atual e o vizinho. 
    *   Resultado: Estradas adjacentes agora permanecem logicamente e visualmente distintas, unindo-se apenas em intersecções reais de roteamento.

---

## Aprendizado Chave

O uso de **Bitmasks** para gerenciar conectividade em grids procedurais provou ser a solução mais elegante para separação de tipos e IDs. Ao condensar a "identidade" da rota em um bit, mantivemos a performance nativa do Javascript (operações bitwise são extremamente rápidas) sem a necessidade de objetos complexos no loop de renderização. 

Outro ponto vital foi a consolidação do pipeline de *bake* estático vs dinâmico. Percebemos que objetos que possuem "altura" (acima do player) devem obrigatoriamente viver no loop dinâmico, enquanto a "base" deve ser congelada no canvas do chunk para economizar ciclos de CPU/GPU.

## Próximo Passo

Com a infraestrutura do mundo exterior estabilizada e urbanizada, o foco agora se volta para a **Persistência e Interatividade**:
*   Implementação de gatilhos de colisão para **Entrada em Interiores** (Warp System).
*   Utilização dos `proceduralEntityId` (IDs hex estáveis gerados por seed/coord) para persistir o estado de objetos coletáveis e diálogos de NPCs únicos por rota.
