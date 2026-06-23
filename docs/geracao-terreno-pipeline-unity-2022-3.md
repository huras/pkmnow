# Terreno 2D na Unity **2022.3.62f3** — mesmos *tipos* de sistema, aproveitando a engine

Este guia complementa a descrição do pipeline web em  
[`geracao-terreno-2d-ruido-para-sprites.md`](./geracao-terreno-2d-ruido-para-sprites.md).

**Objetivo aqui:** reproduzir as **mesmas categorias** de comportamento (campos contínuos, biomas, degraus de altura, autotile por vizinhança, camadas de solo/folhagem/estrada/props, vegetação procedural, transições, cavernas como *feature*), **sem** obrigar o mesmo PRNG nem o mesmo mapa para uma dada seed do projeto JS. Você pode — e deve — usar o que a Unity já resolve bem.

---

## 1. Filosofia: equivalência de *design*, não de *bytes*

| Ideia do projeto web | Na Unity (livre para implementar assim) |
|----------------------|----------------------------------------|
| Vários mapas 0–1 (altura, temperatura, umidade, “anomalia”) | `Mathf.PerlinNoise` / camadas octave no C#, **Burst + noise** em `Unity.Mathematics`, textura gerada em `RenderTexture` com shader, ou pacote tipo *Noise* — o que for mais legível para o time |
| Seed reprodutível *dentro do jogo* | `Random.InitState(seed)` ou `Unity.Mathematics.Random.CreateFromIndex((uint)seed)` — suficiente para “mesmo mundo ao recomeçar” na build Unity |
| Micro amostrado a partir do macro (ex.: stride 41 + interpolação) | Mesmo *conceito*; constantes podem ser tunadas no `ScriptableObject` |
| 13 papéis concavo-convexo + `role → sprite` | Mesma **lógica de máscara** (vizinhos + degrau); sprites vêm de **Sprite Atlas** + `Tile`/`Sprite` referências, não precisa copiar IDs do JSON web |
| Bake em canvas | **Opcional**; muitas equipes preferem **Tilemap + prefabs** |

**Regra prática:** leia o doc web para entender *o que* cada etapa faz; na Unity escolha a ferramenta que minimiza código custom de baixo nível.

---

## 2. O que é **mais eficiente em runtime** (ordem de prioridade)

Tudo abaixo assume: terreno **majoritariamente estático** após o chunk nascer, câmera se movendo, muitos tiles na tela.

### 2.1 Geração de dados (altura, bioma, roles) — custo **fora** do frame loop

| Abordagem | Runtime |
|-----------|---------|
| Gerar o chunk **uma vez** ao carregar / ao entrar no raio da câmera | Melhor custo amortizado |
| **Burst + Jobs** (`IJobParallelFor`) em `NativeArray` para preencher alturas/biomas | Muito barato na CPU; não bloqueia com alocações |
| `Mathf.PerlinNoise` em laço na main thread só em mapas pequenos | Aceitável; evite regenerar o mundo inteiro por frame |
| **`GetTileData` pesado** a cada frame em `TileBase` custom | **Evite** — prefira **preencher `Tilemap` uma vez** (`SetTiles`) com os tiles já resolvidos |

**Regra:** o custo de *decidir* o sprite deve cair na fase de **build do chunk**, não em `Update`.

### 2.2 Desenho (GPU) — o que minimiza draw calls e overdraw

| Abordagem | Runtime |
|-----------|---------|
| **`Tilemap`** estático (sprites batidos em chunks internos pela engine) | Em geral **muito bom**: batching nativo, poucos materiais |
| **Um `Mesh` + um material** com atlas (um draw call por chunk de terreno) | Ótimo em escala *se* você já tem geometria/UV prontos; mais trabalho de tooling |
| **Milhares de `SpriteRenderer`** soltos | Ruim (overhead de culling/transform); mitigue com **GPU Instancing** ou fundir em mesh |
| **`Texture2D.Apply` / `SetPixels` por frame** no terreno principal | **Caro** — reserve para minimapa ou bake ocasional |

### 2.3 Props (árvores, rochas, cristais)

| Abordagem | Runtime |
|-----------|---------|
| **Pooling** + reutilizar instâncias ao streamar chunks | Melhor que `Instantiate`/`Destroy` em borda de câmera |
| Poucos LODs (desativar canopy distante, sprite menor) | Reduz fill rate e overdraw |
| Muitos props com **mesmo material + atlas** | Melhor batching |

### 2.4 Colisão

| Abordagem | Runtime |
|-----------|---------|
| **`TilemapCollider2D` + `CompositeCollider2D`** em geometria estática | Um collider “fundido” — barato para física |
| Centenas de `BoxCollider2D` em pedregulho 1×1 | Aceitável com pooling; pior que composto único se o número explodir |

### 2.5 Resumo executivo

1. **Pré-compute por chunk** (Jobs/Burst opcional) → resultados em arrays ou `TileBase[]`.  
2. **Empurre para `Tilemap`** (ou um mesh por chunk) **uma vez**; não recalcule roles por `Update`.  
3. **Sprite Atlas** + poucos sorting layers.  
4. **Pool** de props; **composite** para chão.  
5. Trate **GPU bake de textura do mundo inteiro** como ferramenta de debug/minimap, não como loop de jogo.

---

## 3. Configuração do projeto (2022.3.62f3)

1. **Template**: *2D (URP)* — ganha **Light 2D**, **Shadow Caster 2D**, **Normal Map** opcional em sprites, bom equilíbrio para overworld.
2. **2D Pixel Perfect** (package): câmera com *assets pixels* nítidos em resoluções variadas — útil se o tile for 16×16.
3. **Sprite Atlas** (built-in): agrupe terreno, folhagem, natureza; reduz draw calls e define packing no Editor.
4. **Import**: tiles **16×16**, **Filter Mode = Point**, **Compression** desligada ou *Low Quality* até fechar o visual; **Pixels Per Unit = 16** se 1 unidade = 1 tile.

**Pastas sugeridas** (sem exigir assembly separado):

- `World/` — geração (ScriptableObjects de config, geradores).
- `World/Rendering/` — Tilemaps, chunk streaming, materiais.
- `World/Prefabs/` — árvore, rocha, cristal, portal de caverna.

Use `.asmdef` só se o projeto crescer — não é pré-requisito para “abordagem Unity”.

---

## 4. Ruído e macro-mapa: o que a Unity oferece

### 4.1 Opção rápida — `Mathf.PerlinNoise`

- Duas oitavas “na mão”: sample em escalas diferentes e some com pesos → **FBM simplificado**.
- Coordenadas em `float` (ex. `x * 0.03f`, `y * 0.03f`) para controlar tamanho de ilhas/montanhas.
- **Limitação:** Perlin da Unity não expõe seed direto; use **offset** derivado da seed (`Random.InitState(seed); var ox = Random.value * 1e4f`) ou `float2` offset fixo por mundo — reprodutível com `InitState`, não precisa bater com o JS.

### 4.2 Opção performance — **Burst + `Unity.Mathematics`**

- `Unity.Mathematics.noise` (cellular, classic Perlin, etc. na versão do pacote) em `IJobParallelFor` preenchendo `NativeArray<float>` para o mapa macro.
- Bom para mundos grandes ou regeneração em thread de trabalho.

### 4.3 Opção GPU — **RenderTexture + shader**

- Gera texturas de altura/bioma uma vez (ou raramente) e leia de volta com `AsyncGPUReadback` **só se** precisar na CPU (pathfinding, bioma).
- Útil para prototipar “continentes” com scroll infinito.

### 4.4 Classificação de bioma

- Porte a **tabela conceitual** do web (água / faixa de praia / montanha / Whittaker simplificado + faixas de anomalia) como métodos estáticos que recebem `float e,t,m,a` e devolvem um `enum BiomeId` **seu** — não precisa dos mesmos IDs numéricos do `biomes.js`.

### 4.5 Pós-processamento de costa

- Mantenha a **ideia** do `applyMorphologicalCleanup`: remover fiapos 1-wide de terra no mar melhora autotile e colliders. Implemente com laço em `bool[]` ou `Texture2D` de máscara — poucas linhas em C#.

---

## 5. Micro-tile e degraus (`heightStep`)

- **Mesmo modelo mental:** coordenada discreta `(mx, my)` → interpola campos macro → função contínua → **quantização** em degraus (água negativa, praia 0, terra 1…N).
- **Curva de terra** (`Pow`): copie a ideia do doc web para não ter só degraus lineares.
- **Segundo passe de “platô”** (ruído suave + vizinhança): opcional; melhora leitura dos penhascos.
- **Cidades/estradas:** ou você porta o grafo A* do JS, ou substitui por **Splines / Tilemap** pintados no Editor + *override layer* — o importante é ter **faixas planas** e **transições** onde o design pedir.

Nada impede de usar `Vector2` e `Mathf.SmoothStep` diretamente em um `MonoBehaviour` se o mapa for médio.

---

## 6. Renderização: priorize Tilemap + prefabs

Para *não* reinventar o `canvas` do browser:

### 6.1 **Grid + Tilemap** (recomendado como backbone)

- **Um `Grid`** com vários filhos:
  - `Tilemap` — **solo base** por degrau *ou* um único mapa com `TileBase` scriptado que desenha o degrau certo consultando `HeightMap`.
  - `Tilemap` — **água** (Animated Tile / rule para borda).
  - `Tilemap` — **folhagem** (sorting layer acima do chão).
  - `Tilemap` — **estrada / escada** (sorting ainda mais alto se necessário).

- **Rule Tile** (2D Extras, package oficial): cobre a maior parte dos casos “borda com água / grama” com menos código que 13 papéis genéricos. Se precisar de cantos internos tipo conc-conv, use **Rule Tile com rotações** ou um **`TileBase` custom** que implementa `GetTileData` lendo altura + vizinhos.

- **TilemapCollider2D + CompositeCollider2D**: gera um collider contínuo para o que for sólido — substitui boa parte de mesh manual para walk.

### 6.2 **Sorting Group + Order in Layer**

- Árvores, cristais e rochas altas: **prefab** com `SpriteRenderer` + `Sorting Group` para folhas vs tronco, **Y-sort** automático com *Transparency Sort Mode* = *Custom Axis* (0,1,0) no URP 2D.

### 6.3 Bake em `Texture2D` (opcional)

- Reserve para minimapa, *screenshot* de região, ou se quiser um único quad “satélite”. Não é o caminho mais “Unity” para gameplay interativo.

### 6.4 **Sprite Shape / 9-Slice**

- Útil para bordas suaves de costa ou trilhos — combina com spline se quiser rios largos.

---

## 7. Autotile (papéis) sem dor

- Implemente **uma função** `TerrainRole ResolveRole(Vector2Int cell, Func<Vector2Int, bool> isSolid)` com a **mesma tabela de casos** que o web (`CENTER`, `EDGE_*`, `OUT_*`, `IN_*`) — pode ser enum + switch.
- **Fonte de `isSolid`:** “altura do vizinho ≥ altura da célula atual” *ou* “não é água” — alinhado ao doc web.
- **Sprites:** mapeie cada `TerrainRole` para um `Sprite` no Inspector (`TerrainVisualSet` ScriptableObject) — workflow de designer, sem planilha de IDs do outro repo.

**`flipX`:** use `TileFlags.FlipX` em `TileData` ou `transform.localScale` no prefab.

---

## 8. Vegetação: prefabs + máscaras, não só tiles

| Tipo no web | Abordagem Unity |
|-------------|-----------------|
| Árvore 2×1 formal | Prefab com 2 sprites filhos ou **Sprite Shape** + collider composto |
| Scatter (pedras, cristais, flores) | `Physics2D.OverlapBox` / layer mask para não nascer dentro de collider; posição inicial com `Random` ou `PoissonDisc` (asset ou código) |
| Densidade por ruído | `Mathf.PerlinNoise` ou campo no `NativeArray` — threshold no `ScriptableObject` |
| Grama animada | **Animated Tile** ou **Shader Graph** com *Wind* no material da folhagem |

**Addressables** (opcional): carregue atlases de biomas sob demanda em consoles/mobile.

---

## 9. Cavernas e interiores

- **Overworld:** prefab de boca de caverna em células que satisfaçam “borda de penhasco reta” (mesma *ideia* que `cave-placement.js`), + `Collider2D` trigger + `SceneManager.LoadSceneAsync` additive.
- **Dungeon:** segunda cena com **Tilemap** próprio + iluminação local — o pacote **2D Dungeon** da Asset Store ou grid próprio; não precisa do `dungeon-generator.js` linha a linha.

---

## 10. Multithreading quando valer a pena

- **Jobs + Burst:** preencher arrays de altura/bioma em background — ótimo para mundos grandes.
- **Regra:** `Tilemap.SetTiles` / `Texture2D.Apply` / instanciar `GameObject` na **thread principal**.
- **Profiler** (Memory + CPU): confirme antes de otimizar.

---

## 11. Streaming

- **`Grid`** por chunk: desative `GameObject` de chunks distantes ou use **Scene Template** + load additive por região.
- **Object pooling** para partículas (folhas, água) se usar VFX.

---

## 12. Validação (sem golden file do JS)

- Playtest: biomas variados, costa legível, sem “single tile island” se o cleanup estiver ativo.
- **Frame budget:** tempo de geração de chunk alvo (ex. &lt; 5 ms na thread principal após cache).
- **Testes edit mode** (opcional): propriedades invariantes (“nenhum tile de estrada sem vizinho de estrada em modo X”) em vez de comparar floats com o browser.

---

## 13. Checklist — abordagem “Unity first”

- [ ] Campos contínuos + classificação de bioma + degraus discretos (conceito alinhado ao doc web).  
- [ ] `Random.InitState` (ou `Unity.Mathematics.Random`) para reprodutibilidade **na build**.  
- [ ] **Tilemap** + **Sprite Atlas** + **CompositeCollider2D** onde couber.  
- [ ] Papéis de borda implementados uma vez; artes ligadas via ScriptableObjects.  
- [ ] Props grandes como **prefabs** com sorting Y.  
- [ ] Caverna/dungeon como **cenas** ou **additive loading**.  
- [ ] Profiler + Jobs só onde medir ganho.

---

## 14. Documentação de referência no repositório web

- Lógica e ordem de camadas: [`geracao-terreno-2d-ruido-para-sprites.md`](./geracao-terreno-2d-ruido-para-sprites.md).  
- Layout de autotile 3×3 nos tilesets: [`regras-de-tesselação.md`](./regras-de-tesselação.md).

---

*Versão alvo do editor: **2022.3.62f3** (LTS). A lista de packages (URP, Pixel Perfect, opcional 2D Tilemap Extras) segue a documentação oficial da Unity para essa linha.*
