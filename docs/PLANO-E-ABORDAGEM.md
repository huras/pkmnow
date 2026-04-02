# Gerador procedural de região (estilo GBA) — plano e abordagem

Documento vivo: descreve **passos**, **dificuldades**, **abordagem** e **por quê**, para implementação em **HTML, CSS e JavaScript** (sem obrigar framework).

---

## 1. Objetivo e escopo

**Objetivo**: gerar, de forma procedural, o **layout** de uma região inspirada em mapas 2D tipo Pokémon GBA (rotas, cidades como hubs, biomas, barreiras naturais), com visualização no navegador.

**Fora do escopo inicial (proposital)**:

- Motor de batalha, party, save completo de jogo.
- ROM hack ou injeção em cartucho; aqui o foco é **geração + visualização** (e eventual export JSON/tilemap).

**Por quê esse escopo**: validar o **PCG** (procedural content generation) e a **legibilidade** do mapa antes de acoplar sistemas de jogo — evita que bugs de mapa se misturem com bugs de gameplay.

---

## 2. Por quê HTML, CSS e JavaScript

| Motivo | Explicação |
|--------|------------|
| **Iteração rápida** | Abrir o arquivo no navegador ou um servidor estático basta; ideal para experimentar algoritmos. |
| **Visualização** | Canvas 2D ou grid DOM permite **debug** (cores por bioma, grafo sobreposto, heatmaps de altura). |
| **Sem dependência de engine** | Toda a lógica do gerador fica em JS puro, fácil de testar e portar depois para outro runtime. |
| **Distribuição** | Pode hospedar como site estático; útil para demos ou vídeos. |

**Trade-off**: performance para mapas enormes pode exigir **Canvas**, **OffscreenCanvas** ou geração em **Web Worker** mais tarde — não é necessário no MVP.

---

## 3. Abordagem geral (macro → micro)

A ordem importa: **decisões grandes primeiro**, detalhe depois.

1. **Grafo de mundo** (abstrato)  
   Nós = locais (cidades, pontos de interesse); arestas = conexões jogáveis (rotas, túneis).  
   **Por quê**: alcançabilidade e “forma” da região são propriedades de **grafo**, não de pixels. Corrigir ilhas no grafo é barato; corrigir depois no tilemap é caro.

2. **Embedding espacial** (geometria grosseira)  
   Posicionar nós no plano (ou em grid macro), desenhar **corredores** entre eles (polilinhas / grid de baixa resolução).  
   **Por quê**: define onde vão rios, montanhas e estradas sem fixar cada tile ainda.

3. **Campos contínuos ou grosseiros**  
   Altura, umidade (ou similar) em resolução menor que o tile final.  
   **Por quê**: biomas coerentes vêm de **gradientes** e regras de vizinhança, não de ruído aleatório tile a tile.

4. **Discretização em tilemap**  
   Converter o campo macro + máscaras de corredor/costa em tiles GBA-like (grama, areia, água, etc.).  
   **Por quê**: o visual final é discreto; separar “campo contínuo” de “sprite/tile” reduz artefatos.

5. **Conteúdo de jogo (opcional, data-driven)**  
   Por célula ou por região rotulada: tabelas de encontros, itens, tipo de ginásio — preenchidas por **rótulo** (ex.: `rota_3`, `floresta`, `cidade_litoral`), não inventadas pelo mesmo algoritmo do terreno.  
   **Por quê**: misturar game design completo com PCG de terreno **explode escopo** e dificulta debug.

---

## 4. Passos sugeridos (fases)

### Fase 0 — Esqueleto do projeto

- Página HTML, um `<canvas>` (recomendado) ou grid CSS para o mapa.
- Um módulo JS que expõe: `generate(seed) → dados` e `render(dados)`.
- Controle de **seed** (input numérico ou string hashável) para reprodutibilidade.

**Por quê**: seed fixa torna cada bug **reproduzível** — essencial em geradores.

**Status**: implementado — `index.html`, `css/style.css`, `js/rng.js`, `js/generator.js` (stub 32×32), `js/render.js`, `js/main.js`. Ver `README.md` para rodar com servidor estático.

### Fase 1 — Grafo mínimo

- Gerar N cidades (hubs) e M rotas como grafo **conexo** (árvore + arestas extras opcionais para ciclos).
- Validar com **BFS/DFS** a partir de um nó inicial; reparar componentes desconexas (aresta de emergência ou regeneração local).

**Por quê**: sem conectividade, o resto do pipeline vira decoração inútil.

**Status**: implementado — `js/graph.js` (posicionamento no grid, MST Kruskal com peso distância + jitter, acordes aleatórios, BFS `isConnected`, `repairConnectivity` defensivo); `generator.js` incorpora `graph`; `render.js` desenha fundo atenuado + arestas + nós. Overlay no canvas.

### Fase 2 — Layout macro no grid

- Plano discreto (ex.: 64×64 células “macro”) onde cada célula pode ser água, terra, montanha grossa, etc.
- Encaixar o grafo: corredores entre nós (pathfinding simples em grid macro, com custos).

**Por quê**: “rotas que fazem sentido” aparecem como **caminhos baratos** entre hubs, não como random walk cego.

### Fase 3 — Altura / umidade e biomas

- Preencher campos (noise + suavização ou blur simples).
- Classificar bioma por regras (ex.: água baixa + adjacente a terra → praia).
- Opcional: passo de **pós-processamento** que corrige vizinhanças inválidas (debug em overlay).

**Por quê**: transições suaves e regras tipo “praia perto de água” são **validação + classificação**, não sorte.

### Fase 4 — Tilemap fino e arte

- Amostrar macro → tiles (ou usar atlas de sprites quando houver arte).
- Autotiling ou regras de borda para não quebrar continuidade visual.

**Por quê**: GBA é **tile-based**; alinhar o pipeline ao formato final cedo evita refator grande.

### Fase 5 — Ferramentas de debug e export

- Overlays: grafo, componentes, bioma, altura.
- Export: JSON com tiles, dimensões, seed, metadados dos nós (para uso futuro ou outra ferramenta).

**Status**: implementado - Barra de ferramentas secundária com toggles de heatmap e botão de download JSON.

### Fase 6 — Fidelidade Visual: Tilesets e Autotiling [PLANEJADO]

- Substituir cores sólidas por um **Tileset de 16-bit**.
- Implementar **Autotiling (Bitmasking)**: O código decide qual sprite usar (ex: borda de grama com água) baseado na vizinhança.
- Adicionar camadas de decoração (árvores, flores, pedras) como objetos do grid.

**Por quê**: O visual 2D estilo Pokémon depende de transições suaves e conexão entre tiles, não apenas quadrados coloridos.

### Fase 7 — Interatividade: Modo Explorador [PLANEJADO]

- Adicionar um **Avatar (Treinador)** controlado via teclado (WASD/Setas).
- Sistema de **Colisão**: Diferenciar tiles "passáveis" (grama, rota) de "bloqueados" (água, montanha, casas).
- Gatilhos de **Encontros**: Chamar a UI do Ecodex visualmente quando o jogador caminhar em tiles de grama alta.

**Por quê**: Transforma o gerador em um protótipo funcional de jogo e valida a "navegabilidade" do mapa gerado.

### Fase 8 — Robustez de PCG: Conectividade Avançada [PLANEJADO]

- **Pontes e Túneis**: Lógica inteligente para cruzar rios (desenhar ponte) ou montanhas (caverna) mantendo a estética.
- **Validação de Alcance (Flood Fill)**: Garantir que todo o grafo é acessível a pé a partir do ponto inicial.
- **Biomas de Transição**: Regras para áreas de fronteira (ex: mistura de areia e neve ou grama queimada perto de vulcões).

**Por quê**: Elimina artefatos de geração e garante que qualquer mapa gerado seja 100% jogável sem "sobras" de erro.

---

## 5. Dificuldades esperadas

### 5.1 Ilhas e áreas inalcançáveis

- **Causa**: noise, rios ou montanhas cortam tudo sem respeitar o grafo.  
- **Abordagem**: o grafo manda na **conectividade**; obstáculos são **máscaras** que o pathfinding macro contorna. Reparar grafos após geração.

### 5.2 Mapa ilegível (“labirinto feio”)

- **Causa**: ruído independente em cada tile; falta de corredores largos e propósito por região.  
- **Abordagem**: chunks ou corredores com **largura mínima**; rotular “salas” (passagem, praça, área densa) e ajustar densidade.

### 5.3 Biomas incoerentes

- **Causa**: saltos bruscos de classe (deserto ao lado de neve).  
- **Abordagem**: camadas contínuas + faixas de transição; regras de vizinhança e overlay de erro para iterar.

### 5.4 Performance no navegador

- **Causa**: mapas grandes × múltiplos passes (blur, pathfinding).  
- **Abordagem**: gerar em resolução macro primeiro; **upsampling**; Web Worker se necessário; evitar `O(n²)` ingênuo em loops de vizinhança sem necessidade.

### 5.5 Escopo de “conteúdo Pokémon”

- **Causa**: tentar gerar ginásio divertido, encontros balanceados e história no mesmo passo do terreno.  
- **Abordagem**: **layout procedural + dados em tabelas** curadas; variar dentro de **templates** (ginásio tipo X) em vez de gerar regras de jogo do zero.

### 5.6 Propriedade intelectual

- **Nota**: “Pokémon” e assets oficiais são marca/conteúdo protegido. Para estudo local está ok; **distribuição pública** exige cuidado (arte original, nomes genéricos, sem usar sprites/marcas comerciais sem permissão).

---

## 6. Organização de código sugerida (JS)

Sem impor framework, uma separação clara ajuda:

- `rng.js` — PRNG determinístico a partir da seed (evitar `Math.random()` para reprodutibilidade).
- `graph.js` — geração e validação do grafo de mundo (**Fase 1**).
- `macroMap.js` — grid macro, pathfinding, máscaras.
- `biomes.js` — campos e classificação.
- `tiles.js` — discretização e autotiling.
- `render.js` — desenho no canvas + overlays.
- `main.js` — orquestração e UI (seed, botão “gerar”).

**Por quê**: testes manuais e futuros testes automatizados ficam por módulo; evita “god file”.

---

## 7. Princípios SOLID (guia para o código)

O plano acima foi **aprovado** com orientação **SOLID**: cada módulo tem um papel claro; extensões não obrigam reescrever o núcleo; dependências apontam para abstrações onde fizer sentido.

| Princípio | Como aplicar neste projeto |
|-----------|----------------------------|
| **S** — Responsabilidade única | Um arquivo = uma razão para mudar (`rng` só sorteio determinístico; `graph` só estrutura do mundo; `render` só saída visual). `main` só orquestra e liga UI. |
| **O** — Aberto/fechado | Novos biomas, overlays ou exportadores entram como **funções ou módulos novos** que consomem o mesmo modelo de dados (`WorldState` / DTO), sem editar o núcleo do gerador a cada feature. |
| **L** — Substituição de Liskov | Se houver “estratégias” (ex.: dois algoritmos de pathfinding), expor a **mesma interface** (mesma assinatura e contrato de retorno) para quem chama não precisar de `if (tipo)`. |
| **I** — Segregação de interface | Evitar um único objeto gigante “faz tudo”; preferir funções pequenas ou tipos enxutos (ex.: render não depende de RNG interno do gerador). |
| **D** — Inversão de dependência | Pipeline de geração depende de **abstrações** (ex.: função `random()` injetada ou PRNG passado do lado de fora; render recebe **dados puros**, não o gerador inteiro). Facilita testes e troca de backend visual. |

**Por quê**: SOLID aqui não é cerimônia — reduz acoplamento entre **PCG**, **UI** e **render**, e mantém o projeto extensível quando novas fases (biomas, export) entrarem sem virar um único arquivo de milhares de linhas.

---

## 8. Resumo

- **Stack**: HTML/CSS/JS para prototipar rápido e visualizar.  
- **Núcleo**: grafo conexo → layout macro → campos → tilemap → (opcional) dados por tabela.  
- **Principais riscos**: desconexão, feiura, bioma incoerente, escopo de gameplay — cada um tem mitigação explícita acima.  
- **Próximo passo prático**: implementar **Fase 0 + Fase 1** com seed e overlay do grafo; só então aumentar resolução e biomas.

Quando este plano mudar (por exemplo, troca para WebGL ou export para Tiled), atualize este documento com a data e o motivo da mudança.
