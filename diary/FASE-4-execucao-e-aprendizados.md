# Fase 4: O "Sabor" Pokémon (Landmarks e Ecodex) — Execução e Aprendizados

## O que foi feito

Se a Fase 3 trouxe a terra, a Fase 4 trouxe a "Vida" e a "Identidade". Seguindo nosso documento mestre, é aqui que cruzamos os dados geográficos matemáticos com informações de design de jogo tipicamente encontradas nos RPGs da franquia: Pokémons Selvagens e Cidades Nomeadas.

1. **O Ecodex (`ecodex.js`)**
   - Criamos o mapeamento tabelado que cruza `Biomas -> Tabelas de Encontro`.
   - Poplamos exclusivamente os dados da Geração 1, distribuindo as espécies em seus devidos habitats naturais. Zubats nas Cavernas, Tentacools na água, Weedles nas matas e Chanseys como encontros raros de Savana.
   - Isso foi acoplado logicamente para ser varrido pelo HUD "estilo Civilization V" no Hover interativo, entregando *game-design* integrado à grade procedimental.

2. **Geração Semântica (Cidades, Rotas e Pontos de Interesse):**
   - Introduzimos o `names.js`, abandonando os IDs matemáticos "Nó 4, Aresta 12" e passando a gerar prefixos, sufixos e denominações coerentes para cada nodo do Mundo. Ex: `Pallet Town`, `Rota 1`, `Veridian City`.
   - Integramos o `landmarks.js`, lendo a topografia para posicionar as "dungeons" fixas. Pontos de interesse estáticos como Faróis à beira-mar, Cavernas em vulcões secos e Montes Congelados nas altas neves.
   - Refinamos visualmente esses elementos no Canvas (Ginásios com ícones dourados, Towns em vermelho e Landmarks como diamantes cintilantes na cor do hash).

## Aprendizados

O grande aprendizado aqui remete à advertência inicial do `PLANO-E-ABORDAGEM.md`: **"O Escopo de Conteúdo"**.
Tentar gerar os stats, níveis e IA dos encontros dentro da geração do terreno inflaria a complexidade a um ponto caótico. A abordagem "Data-Driven" (Tabelas acopladas) salvou essa fase. O algoritmo gera a estrutura, dita que o lugar é "Místico" e a tabela fixa encarrega de colocar "Abras e Haunters" no lugar. Isso permitiu prototipar a alma da região sem precisarmos recriar um motor inteiro de batalhas GBA!
