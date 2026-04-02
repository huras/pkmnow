# Diário — Fase 2: execução e aprendizados

Data de referência: abril/2026. Este arquivo registra a transição do grafo abstrato para um terreno físico e a implementação de caminhos reais entre as cidades.

---

## 1. O que a Fase 2 entregou

- **Macro-Grid (Value Noise)**: Saímos do ruído randômico puro para um terreno coerente com elevações (água, planície, montanha).
- **A* Pathfinding**: Implementação de busca de caminho em grid 2D com pesos baseados no terreno.
- **Corredores de Rota**: Representação visual e lógica das rotas como células no grid (não mais apenas linhas retas).
- **Paleta de Cores**: Renderização com cores que facilitam a distinção de biomas básicos (Verde para grama, Azul para água, Marrom para picos).

Arquivos novos: `js/pathfind.js`.
Arquivos modificados: `js/generator.js`, `js/render.js`, `index.html`.

---

## 2. Como executar e testar

1. Inicie o servidor: `npx serve .`.
2. Acesse `http://localhost:3000`.
3. Observe o mapa gerado:
   - Os círculos vermelhos são as cidades.
   - As trilhas brancas são as rotas conectando-as.
4. Clique em **Gerar** para ver novas configurações de relevo e caminhos.
5. Verfique a **persistência**: a mesma seed deve gerar exatamente o mesmo layout de terreno e os mesmos caminhos curvilíneos.

---

## 3. Aprendizados técnicos

### 3.1 Terreno Coerente vs Aleatório
- Usar `rng.next()` em cada célula gera ruído ("sal e pimenta").
- Para um mapa macro, precisamos de **coerência espacial**. Implementamos um **Value Noise** simples (escala 8x8 com interpolação cosseno) que cria colinas e lagos suaves, essencial para dar "personalidade" à região.

### 3.2 A* e a "Geografia do Custo"
- O A* puro busca a menor distância geométrica.
- Ao adicionar um **multiplicador de custo** baseado no valor da célula de terreno (ex: `1 + v^2 * 10`), forçamos o algoritmo a agir como um engenheiro de estradas:
  - Se for muito caro subir a montanha, ele dá a volta.
  - Se a planície estiver livre, ele segue por lá.
- Isso gera as curvas naturais que vemos no mapa, tornando as rotas interativas com o ambiente.

### 3.3 Separação de Camadas no Renderer
- O renderer agora desenha em camadas:
  1. Terreno (base).
  2. Corredores de rota (camada lógica do A*).
  3. Overlay do grafo (transparente, para debug/referência).
  4. Cidades (nós interativos).
- Essa ordem garante que o "jogador" (ou usuário) entenda a hierarquia visual.

---

## 4. Limitações e Desafios

- **Largura das Rotas**: Atualmente as rotas têm 1 célula de largura. Em um grid 32x32, isso parece um corredor. Em grids maiores, precisaremos de algoritmos de "engrossamento" (dilation).
- **Interseções**: Quando rotas se cruzam, elas apenas sobrepõem os pixels. Futuramente, pode ser interessante tratar "nós de rota" como cidades secundárias ou entroncamentos.
- **Performance**: O A* é rápido em 32x32. Se escalarmos para 1024x1024, precisaremos de otimizações (Hierarchical A* ou JPS).

---

## 5. Próximo passo sugerido

Fase 3: **Micro-detalhes e Biomas específicos**. Agora que temos o layout macro (onde as coisas estão), podemos definir biomas mais variados (floresta, deserto, pântano) baseados em umidade e temperatura, e talvez começar a pensar na tesselação de tiles individuais.

---

*Este diário foca na implementação da geografia e conexão lógica do mundo.*
