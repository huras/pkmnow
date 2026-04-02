# Evolução: Do Caos ao Mapa Pokémon (Refinamento da Fase 2)

Este documento registra os erros "clássicos" de geração procedural encontrados durante a Fase 2 e como as correções foram implementadas. Perfeito para o roteiro do vídeo de evolução do sistema.

---

## 1. O Problema: "Cidades Peixe" e "Cidades Gêmeas"

Na primeira versão da Fase 2, tínhamos 3 problemas críticos que quebravam a imersão:
1. **Cidades no Mar**: O gerador de cidades sorteava coordenadas (X, Y) sem saber nada sobre o terreno. Resultado: cidades no meio do oceano.
2. **Clumping (Aglomerados)**: Sem uma regra de distância, duas cidades podiam nascer a 1 metro de distância uma da outra, enquanto o resto do mapa ficava vazio.
3. **Febre das Pontes**: O algoritmo A* via que o "custo" de andar na água era o mesmo da grama. Ele criava retas perfeitas cortando o mar com dezenas de pontes desnecessárias.

---

## 2. A Evolução do Código (Os Fixes)

### 2.1 Posicionamento Consciente do Terreno
**Antes**: `id, x, y` sorteados puramente com `rng.next()`.
**Depois**: O gerador agora consulta o grid de `Value Noise` antes de colocar a cidade.
- **Regra**: Só é permitido colocar o nó se o valor da célula for `> 0.3` (Terra firme).
- **Raio de Exclusão**: Implementamos um `minDistSq`. Se uma nova coordenada estiver muito perto de uma cidade já existente, o sistema descarta e tenta de novo (até 500 vezes).

### 2.2 Reequilíbrio de Custo do A*
Para resolver o problema das pontes infinitas, alteramos a "física" do mundo:
- **Custo Terreno Plano**: 1-4 unidades.
- **Custo Água**: 40 unidades.
Isso força o A* a "pensar": *A menos que eu precise MUITO atravessar esse rio para chegar no destino, eu vou dar a volta por terra firme porque é 10x mais barato.*

### 2.3 Hierarquia: 8 Ginásios e 6 Vilas
Para dar o feeling de progressão de um jogo real, definimos o metadado `isGym`.
- **Lógica**: Sorteamos 8 cidades entre as 14 para serem os grandes hubs (Ginásios). Reduzimos a aleatoriedade pura para garantir uma estrutura de jogo funcional.

### 2.4 A Economia das Estradas (Highway Splicing)
**Problema**: Múltiplas rotas paralelas criando um "emaranhado" feio.
**Solução**: Implementamos um sistema de **Pavimentação Procedural**.
- O gerador mantém um `workingCostMap`.
- Assim que o A* define uma rota, ele "pavimenta" aquelas células, reduzindo o custo de travessia para **0.05** (quase zero).
- Rotas subsequentes, ao calcular seu caminho, são "atraídas" para essas células já pavimentadas, fundindo caminhos diferentes em uma única **Rodovia Central**.
- **Resultado**: O mapa agora tem "troncos" principais de tráfego, eliminando rotas redundantes.

### 2.5 Centralidade e Orçamento de Infraestrutura (FASE 2.3)
**Problema**: Cidades distantes (ex: em ilhas ou separadas por cadeias de montanhas) ainda tinham dificuldade de se conectar de forma natural.
**Solução**: Implementamos **Edge Betweenness Centrality**.
- O sistema calcula quais conexões são mais importantes para a região (as que fazem parte de mais caminhos curtos entre cidades).
- **Orçamentação**: Rotas com alta centralidade ganham um "subsídio" de construção.
  - O custo da água cai de 40 para até 5 para as rotas principais.
  - Isso permite que o governo regional "construa" pontes longas ou túneis em montanhas para as vias principais, enquanto vias locais ainda precisam contornar obstáculos.

---

## 3. Antes vs Depois (Para o Vídeo)

| Feature | Versão 2.0 (Caos) | Versão 2.1 (Refinada) | Versão 2.2 (Rodovias) | Versão 2.3 (Hierarquia) |
| :--- | :--- | :--- | :--- | :--- |
| **Local das Cidades** | Aleatório (chão ou mar) | **Terra firme** | **Terra firme** | **Terra firme** |
| **Espaçamento** | Aglomerados feios | **Distribuídas** | **Distribuídas** | **Distribuídas** |
| **Rotas** | Retas e cheias de pontes | Seguem a costa | **Fundem-se em Highways** | **Paredes e Mares vancíveis** |
| **Visual** | Pontos isolados | Linhas finas | Troncos de tráfego | **Espessura por Importância** |

---

## 4. Lição Aprendida
*Geração procedural não é sobre aleatoriedade total, é sobre **aleatoriedade restrita por regras de design**.* 
Ao injetar conhecimento do terreno e da topologia do grafo no pathfinding, transformamos um amontoado de pontos em uma região que parece ter sido planejada para um jogo AAA.

---
*Documentação atualizada para incluir o sistema de Centralidade de Grafo.*
