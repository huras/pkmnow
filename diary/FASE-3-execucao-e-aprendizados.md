# Fase 3: Altura, Umidade e Biomas — Execução e Aprendizados

## O que foi feito

A transição da "geometria abstrata" para a "natureza". O objetivo da Fase 3 foi abandonar a aleatoriedade caótica (ruído branco estático tile a tile) e usar **Campos Contínuos** (Noise) para gerar a geografia coerente do nosso mapa Pokémon.

1. **Campos Contínuos (Ruído):**
   - Implementamos geradores de ruído (ex: Value/Perlin Noise) usando nossa semente determinística (`rng.js`) para criar mapas de calor suaves de **Elevação** e **Umidade**, além de um modificador de **Temperatura**.
   - Escalonamos as frequências de ruído para criar lagos, ilhas e cordilheiras de forma orgânica, evitando aquele aspecto artificial de "labirinto feio".

2. **Matriz de Biomas (Classificação):**
   - Criamos o módulo `biomes.js` para ditar as regras matemáticas do ecossistema.
   - Em vez de sortear o bioma, o terreno é tipado através do cruzamento dos mapas de calor:
     - `Elevação baixa + Alta Umidade` = Oceano / Praia.
     - `Elevação média + Alta Umidade` = Florestas / Pântanos.
     - `Elevação alta + Baixa Umidade` = Montanhas secas / Vulcões.
   - Também aplicamos anomalias geológicas de passe-tardio (ex: `GHOST_WOODS` ou `ARCANE`) baseadas na proximidade com *Landmarks* ou ruídos secundários.

## Aprendizados

O maior *insight* dessa etapa foi a substituição de regras excessivamente complicadas `O(n²)` baseadas em "vizinhança" por uma pura intersecção de matrizes de Ruído (`Altura * Umidade * Temperatura`).
Isso se provou incrivelmente performático em rodar no navegador. Modificar a paisagem virou apenas um "ajuste de limites" num array `if(val < 0.3) -> Agua`, e não dependemos mais de regras demoradas de autotiling e simulações erosivas pesadas.

A reprodutibilidade se manteve intacta garantindo o core do projeto: a mesma *seed* sempre gera a mesma forma continental e os mesmos campos.
