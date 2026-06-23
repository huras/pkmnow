# Geração de terreno 2D: ruído → altura → bioma → autotile → sprites

Este texto descreve **o que o código faz hoje**, na ordem em que os dados fluem, para que alguém consiga **reimplementar a mesma lógica** (mesma seed → mesmo mundo micro) sem adivinhar detalhes.

## 0. Mapa mental (uma frase por estágio)

1. **Macro (256×256)**: campos contínuos 0–1 (elevação, temperatura, umidade, anomalia) vêm de **FBM sobre value noise** + RNG determinístico.
2. **Classificação**: cada célula macro vira um **ID de bioma** (`Uint8Array`) com regras tipo Whittaker + anomalias; a costa recebe **cleanup morfológico** para não quebrar o autotile.
3. **Micro (41×41 tiles por célula macro)**: cada tile lógico `(mx, my)` **não é armazenado**; é **recomputado** por interpolação bilinear + smoothstep nos mapas macro, depois **quantização** em degraus (`heightStep`) e ajustes (cidades, estradas, segundo passe de altura).
4. **Sprites**: para cada degrau visível, calcula-se um **papel** (`role`) de autotile 3×3 em cima do predicado “há solo nesta altura ou acima?”. O papel aponta para um **tileId** na folha (`TERRAIN_SETS` / `OBJECT_SETS`). O canvas desenha por **camadas** (água → degraus 0…N → folhagem → estrada → escadas → props).

Arquivos centrais: `js/generator.js`, `js/chunking.js`, `js/biomes.js`, `js/tessellation-logic.js`, `js/render/play-chunk-bake.js`, `js/render/conc-conv-a-terrain-blit.js`, `js/biome-tiles.js`, `js/cave-placement.js`, `js/vegetation-channels.js`, `js/render/palette-base-draw.js`, `js/tessellation-data.js`.

---

## 1. Reprodutibilidade: seed e RNG

- **`normalizeSeed`** (`generator.js`): aceita inteiro unsigned ou string (FNV via `stringToSeed` em `rng.js`).
- **`createRng(seed)`** (`rng.js`): PRNG Mulberry32; cada `next()` devolve float em **[0, 1)**.
- **Ordem de consumo importa**: o gerador chama `generateFBMMap` várias vezes em sequência fixa (elevação → detalhe opcional → temperatura → umidade → anomalia). Qualquer mudança na ordem ou no número de chamadas altera o mundo.

---

## 2. Macro: value noise e FBM

### 2.1 Value noise 2D (`generateNoiseMap`)

Parâmetros: `rng`, largura `w`, altura `h`, **escala** `scale` (em células macro, não em pixels).

1. Grelha de **pontos de controle** espaçados `scale` células: dimensões `(ceil(w/scale)+1) × (ceil(h/scale)+1)`, cada vértice um `rng.next()` em [0,1).
2. Para cada célula `(x,y)` do mapa:
   - `gx = x/scale`, `gy = y/scale`; parte inteira `(ix,iy)` e frações `(fx,fy)`.
   - Interpolação **suavizada** (smoothstep em `fx` e `fy`) entre os quatro cantos do quadrado de controle.
   - Resultado em `cells[y*w+x]` ∈ [0,1].

Isso é **value noise com interpolação Hermite**, não Perlin clássico.

### 2.2 FBM (`generateFBMMap`)

Entrada: `baseScale`, `octaves`, `persistence`.

1. Primeira camada = `generateNoiseMap` com `baseScale`.
2. Para `o = 1 … octaves-1`: escala da camada = `max(2, round(baseScale / 2^o))`; soma `persistence^o * 2*(layer-0.5)` ao acumulado (detalhe centrado em zero).
3. **Clamp** final de cada célula para **[0,1]**.

### 2.3 Elevação com detalhe opcional

Depois da elevação base FBM, se `elevationDetailOctaves > 0` e `elevationDetailStrength > 0`:

- Gera outro FBM com escala `max(2, round(elevationScale/2))`.
- Para cada índice: `elevation[i] += strength * 2*(detail[i]-0.5)`, depois clamp 0–1.

### 2.4 Outros mapas macro

- `temperature`, `moisture`: FBM com escalas vindas do `config` (`DEFAULT_CONFIG` em `generator.js`).
- `anomaly`: FBM com **4 oitavas** e persistência 0.5 (mapa mais “quebrado” para bordas de biomas raros).

### 2.5 Bioma por célula macro

Loop `i = 0 … w*h-1`:

- Lê `e,t,m,a` dos quatro arrays.
- `biomes[i] = getBiomeWithAnomalies(e,t,m,a,config).id` (`biomes.js`).
- `getBiome` usa `resolveWaterLevel(config)`, faixa de praia `waterLevel + BEACH_ELEVATION_BAND`, patamares de montanha (`e > 0.7`, `e > 0.8`) e tabela úmido/temperado/quente. `getBiomeWithAnomalies` acrescenta biomas especiais quando `a` é alto (ler o arquivo para thresholds exatos).

### 2.6 Cleanup morfológico na **terra** (não no array de biomas diretamente)

Objetivo: remover **linhas finas de terra** cercada por água que o motor de 13 papéis não desenha bem.

- `wlLand = resolveWaterLevel(config)`.
- `isLandAt(r,c)` = `elevation[r*width+c] >= wlLand` (com bounds).
- `setLandAt(r,c,false)` força `elevation` para **0.25** (abaixo do mar → vira água na lógica de bioma/altura depois).
- `applyMorphologicalCleanup` (`tessellation-logic.js`): para cada terra, se **não** tem vizinho N e S **ou** não tem W e E, marca para virar água; aplica em lote.

---

## 3. Micro: de coordenadas `(mx, my)` para um “tile lógico”

Tudo passa por **`getMicroTile(mx, my, macroData)`** (`chunking.js`), exceto overrides manuais em `macroData.microTiles`.

### 3.1 Constantes que definem a geometria

- **`MACRO_TILE_STRIDE = 41`**: cada célula macro vira um bloco **41×41** tiles de jogo na horizontal/vertical.
- **`LAND_STEPS = 30`**, **`WATER_STEPS = 20`**: número de degraus discretos acima da praia e abaixo do mar.
- Mundo micro: largura = `macroData.width * MACRO_TILE_STRIDE` (mesmo para altura).

### 3.2 Elevação contínua no ponto micro

- `gx = mx / MACRO_TILE_STRIDE`, `gy = my / MACRO_TILE_STRIDE`.
- Cantos macro `(ix, iy) = floor(gx), floor(gy)`; frações `(tx, ty)`.
- **Smoothstep** nas frações: `sx = tx²(3-2tx)`, `sy = ty²(3-2ty)` — usado na **elevação** para platôs mais lisos.
- Bilinear nos quatro `cells` macro vizinhos → `e` ∈ [0,1].

### 3.3 `elevationToStep(e, waterLevel)` — do contínuo ao degrau

(`chunking.js`, alinhado a `getBiome` em `biomes.js`)

- `w = waterLevel` (clamp 1e-4…0.98), `beachUpper = w + BEACH_ELEVATION_BAND`.
- Se `e < w`: água. `t = clamp(e/w,0,1)`; retorno **`-WATER_STEPS + floor(t * WATER_STEPS)`** (mais negativo = mais fundo).
- Se `e < beachUpper`: **praia**, degrau **0**.
- Terra: `t = (e - beachUpper)/(1-beachUpper)`; curva **`t^exp`** com `exp = landStepCurveExponent` (default ~3 via getter/setter); retorno **`1 + floor(clamp(t,0,1) * LAND_STEPS)`** capado em `LAND_STEPS`.

### 3.4 Segundo passe de altura (“platôs” só em terra)

**`applySecondaryHeightPass`**: só se `baseStep >= 1` (não mexe em praia/água).

- Ruído suave: `foliageDensity(mx, my, seed + 0x62f9, 4/MACRO_TILE_STRIDE)` (ver §5.1).
- Média 3×3 desse ruído; score = `0.45*n + 0.55*nAvg`.
- Se `score <= 0.30` → **-1** degrau; se `score >= 0.70` → **+1**; senão 0. Clamp em `[1, LAND_STEPS]`.
- Em **cidades e estradas** o resultado do `getMicroTile` **não** reaplica esse passe no final (usa `heightStep` já resolvido pela lógica urbana/estrada).

### 3.5 Umidade, temperatura e anomalia no micro

- Para **umidade** e **temperatura**: interpolação **linear** nos cantos (`fx=tx`, `fy=ty`), não smoothstep.
- Soma **`biomeNoise = (seededHash(mx,my,seed)-0.5) * 0.005`** para quebrar linhas retas.
- Jitter macro 64×64: `jitter4x4` a partir de `seededHash(floor(mx/64), floor(my/64), seed+123)` × 0.02 somado a `m` e `t`.
- **Bordas orgânicas**: desloca `fx,fy` com hashes `seed+555` / `+666` × 0.15, clamp em [0,1] → `jfx, jfy`; **anomalia** interpola com `jfx, jfy`.
- `getBiomeWithAnomalies(e, t, m, a, config)` → `biomeId` base.

### 3.6 Cidades, `cityData`, terraplenagem

Se `macroData.cityData` existir:

- `footprintSet` com chave `"mx,my"`: tile dentro de cidade.
- Layout mais próximo pelo raio: **`dominantHeight`** substitui `heightStep` na área urbana; `e = 0.5` para não virar oceano.
- Prédios / ruas / town vs city: ver ramos `urbanBuilding`, `isPathTile`, `BIOMES.*` no mesmo arquivo.

### 3.7 Estradas e degraus (`roadTraffic`, `roadMasks`)

Se o macro-célula tem `roadTraffic[macroIdx] > 0`:

- Faixas no **espaço local** do bloco 41×41 (spine central, cardinal neighbors via máscaras de rota).
- **Achatar** elevação ao longo do eixo da estrada (interpolação travada em 0.5) quando não há escada.
- **Escadas** (`stair-*`): compara `elevationToStep` em vizinhos ao longo do eixo travado; define `roadFeature`.
- **`wooden-bridge`**: se `e < waterLevel` na faixa de estrada, `heightStep = 8` fixo.
- `isRoad` e `roadFeature` alimentam **qual sheet** de terreno usar depois (`terrain-role-helpers`: `road`, `stair-lr`, etc.).

### 3.8 Campos derivados para vegetação / flores

- **`foliageDensity`**: ver §5.1; guardado em `tile.foliageDensity`.
- **`foliageType`**: `seededHash(mx, my, seed+9993)` (reservado para variação).
- **`berryPatchDensity`**: `foliageDensity(..., seed+8881, 0.07)`.
- **Flower Fields**: mistura extra de escalas + “ridge” em `fine` para densificar manchas (`chunking.js`).

---

## 4. Degraus visuais = “penhascos” (cliffs)

Não há um mesh 3D no play 2D: o **cliff** é a **diferença de `heightStep` entre vizinhos**.

### 4.1 Predicado de máscara por altitude

Função usada no bake e nos helpers:

- `isAtOrAbove(level)(row, col)` = `getCachedTile(col, row)?.heightStep >= level`
  - Atenção: em **`getRoleForCell`** a assinatura é `(r, c, …, isLandAtFunc)` e **dentro** ela chama `isLandAtFunc(r, c)` — no bake, passa-se `(my, mx, …)` com closure `(r,c) => getCachedTile(c,r)`, ou seja, **alinhar `r` com linha (`my`) e `c` com coluna (`mx`)** como no código existente.

### 4.2 Papel (`role`) — autotile 13 posições

**`getRoleForCell`** (`tessellation-logic.js`):

- Para tipos `conc-conv-a|b|c`, cantos internos usam **terra “crua”** nas diagonais; cardinais podem usar `landPredicateFillSmallNoiseHoles` para tapar buracos 1×1.
- Saídas típicas: `CENTER`, `EDGE_N/S/E/W`, `OUT_*`, `IN_*`, fallbacks para penínsulas finas.

### 4.3 De tileId para pixel

**`getConcConvATerrainTileSpec(set, role)`** (`conc-conv-a-terrain-blit.js`):

- `tileId = set.roles[role] ?? centerId` (com `ENABLE_TERRAIN_MIRROR_OPTIMIZATION` desligado no projeto, não há flip por espelho aqui).
- **`drawTerrainCellFromSheet`**: recorta `16×16` na folha (`cols` vindo de `TessellationEngine.getTerrainSheetCols`), opcionalmente `flipX`.

Para **bordas com alpha** nos sets conc-conv, o bake **pinta primeiro o `CENTER`** por baixo e depois o tile da borda (ver comentário “Cantos/bordas conc-conv costumam ter alpha” em `play-chunk-bake.js`).

---

## 5. “Skins”, grama, árvores, rochas, cristais (camadas de conteúdo)

### 5.1 Campo base: `foliageDensity(mx, my, seed, scale)`

Implementação em `chunking.js`:

- Grelha em espaço `(mx*scale, my*scale)`; hash bilinear com **`seededHash`** nos quatro cantos do quadrado unitário (mesmo smoothstep que na elevação).
- Interpretação: **campo contínuo 0–1** barato, determinístico, usado para manchas orgânicas (folhagem, árvores formais, segundo passe de altura, etc.).

**`seededHash(x,y,seed)`** (`tessellation-logic.js`): mistura inteira de bits; retorno **0–1** (não é o mesmo PRNG do `createRng` do gerador macro — são **dois sistemas** de aleatoriedade determinística no projeto).

### 5.2 Skin de terreno (folhagem / overlay autotilado)

Constante **`FOLIAGE_DENSITY_THRESHOLD = 0.45`** (`biome-tiles.js`).

No bake (**passo 1.2**), no **degrau da superfície** (`tile.heightStep === level`):

- Resolve **`BIOME_TO_FOLIAGE[biomeId]`** → nome de `TERRAIN_SETS` (ex.: `"jogador light-grass"`, `"jogador rocky"`).
- Só desenha se `tile.foliageDensity >= threshold` e **vizinhança 3×3** estável: mesma altura, mesmo bioma, e (para o modo estrito) todos os 8 vizinhos na mesma altura.
- Máscara para autotile:
  - Padrão: mesma regra “solo seguro 3×3”.
  - **Poças** (`usesPoolAutotileMaskForFoliage`): lava / lago roxo — vizinho “solo” para o papel é quem tem `foliageDensity >= threshold` na mesma altura/bioma (borda do pool não vira `EDGE` espúrio).
- `getRoleForCell` + `getConcConvATerrainTileSpec` + `drawTerrainCellFromSheet` como no terreno base.

Estradas: só folhagem cujo nome **contém** `"grass"` (case insensitive) sob `isRoad` (“clean roads”).

### 5.3 Grama animada / curta (fora deste bake)

O bake devolve **`suppressedSet`**: tiles locais onde o **scatter** ocupou o chão ou ruído alto suprimiu tufo; o passo posterior de grama animada usa isso (`play-chunk-bake.js` comentário passo 3 / integração em `render.js`). A **grama curta** estática em tileset também aparece em fluxos de `GRASS_TILES` / render — tratar como **camada opcional** acoplada ao mesmo `heightStep` e bioma.

### 5.4 Árvores “formais” (2×1 no tileset nature)

Condições no **passo 2** do bake (`play-chunk-bake.js`):

- Superfície válida: **`tileSurfaceAllowsScatterVegetation`** — terra `heightStep >= 1` **ou** praia `BEACH` com `heightStep === 0`; não estrada/cidade.
- **`getTreeType(biomeId, mx, my, seed)`** escolhe variante (`biome-tiles.ts`).
- **Raiz formal**: `(mx+my) % 3 === 0` **e** `foliageDensity(mx, my, seed+5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD` (0.55); `TREE_NOISE_SCALE = 0.1`.
- Solo precisa ser **`CENTER`** do autotile do terreno **base** naquela altura; tile à direita mesmo `heightStep` e papel que permita continuação (`terrainRoleAllowsScatter2CContinuation` — bloqueia `OUT_*` e bordas `EDGE_*` para não “cortar” o tronco na quina).
- Desenha `TREE_TILES[treeType].base[0]` e `base[1]` com pequeno overlap horizontal (`VEG_MULTITILE_OVERLAP_PX`).

### 5.5 Scatter: rochas, cristais, flores, cactos, etc.

Mesmo passo 2, ramo **“Scatter Objects”**:

- Ruído de elegibilidade: `foliageDensity(mx, my, seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE) > SCATTER_NOISE_THRESHOLD`  
  (`SCATTER_NOISE_SEED_OFFSET = 111`, `SCALE = 2.2`, `THRESHOLD = 0.76`).
- Não pode ser vizinho conflitante de árvore formal (checagem `isFormalNeighbor`).
- **`resolveScatterVegetationItemKey`** (`vegetation-channels.js`): overrides → canais (ex. junco alto na selva) → lista **`BIOME_VEGETATION[biomeId]`** filtrada por **patch de berry** (`berryPatchDensity >= BERRY_PATCH_THRESHOLD`): em patch só entram itens cujo nome contém `berry-tree-`.
- Escolha final: `filtered[ floor(seededHash(ox,oy,seed+222) * len) ]`.
- Objeto vem de **`OBJECT_SETS[itemKey]`** (`tessellation-data.js`): parte `base` / `CENTER`, shape `cols×rows`, IDs na ordem **esquerda→direita, topo→baixo** (documentado em `docs/regras-de-tesselação.md`).
- Colisão com penhascos: tiles cobertos pela footprint entram em `suppressedSet` para grama; extensões a leste checam **`terrainRoleAllowsScatter2CContinuation`** no tile destino.

**Cristais / pedras**: são apenas **chaves** na lista por bioma (ex. `large-purple-crystal [2x2]` em `MOUNTAIN`) + mesma mecânica scatter. **`scatterHasWindSway` / `isSortableScatter`** (`biome-tiles.js`) classificam comportamento no render (cristal sem sway, sorting Y para objetos altos).

### 5.6 Transições entre paletas “base” (sand/rock/ice…)

**`imageForPaletteBaseTerrainDraw`** (`palette-base-draw.js`):

- Se o vizinho cardinal na **mesma altura** tiver outro **slug** de paleta base (`terrain-palette-base.js`), tenta carregar PNG de **transição** entre os dois slugs; se falhar, fica a imagem padrão do set.

---

## 6. Cavernas (entrada no overworld)

**`cave-placement.js`** — **não** gera mapa de caverna; só decide **onde uma entrada é candidata** no mundo 2D:

- Tile firme, não estrada/cidade.
- Papel do terreno base na **superfície** deve ser **`EDGE_N|S|E|W`** e os três vizinhos **inline** na direção da borda também `EDGE_*` compatíveis (`roleSupportsCave`) — ou seja, **segmento reto de penhasco** consistente.
- Gatilho:
  - **Ruído espacial**: `(mx*7 + my*13) % 47 === 0` **e** `foliageDensity(mx, my, seed+1234, 0.1) > 0.55`, **ou**
  - **Landmark** macro `CAVE` na célula **sem** o ruído acima (para garantir entrada em marco mesmo se o hash falhar).

Objetos tipo **`cave-entrance`** aparecem nas listas `BIOME_VEGETATION` onde aplicável e seguem scatter / sorting como demais props.

**Dungeon procedural** (`js/dungeon/*`) é **outro pipeline** (grade de salas, tile types); usa os **mesmos** `TERRAIN_SETS` e `drawTerrainCellFromSheet` para desenhar chão/parede, mas **não** passa por `getMicroTile`.

---

## 7. Ordem de desenho no chunk (referência única)

Resumo de **`bakeChunk`** (`play-chunk-bake.js`):

1. **Fundo de cor** por bioma (fill).
2. **Água** (`heightStep < 1`) com autotile + underfill center.
3. **Loop `level` de 0 a `LAND_STEPS`**:
   - Para cada tile com `heightStep >= level`:
     - Se o nível de baixo está totalmente coberto por `CENTER` (base ou folhagem densa), **pula** desenhar o “tampão” intermediário (`skipUnderCenterSprite`).
     - Camada base do bioma (`BIOME_TO_TERRAIN` → `TERRAIN_SETS`) com possível PNG de transição de paleta.
     - **Folhagem** (skin) se no topo lógico e densidade ok.
     - **Estrada** (overlay não-escada) com máscara `isRoad && !stair`.
     - **Escadas** com máscara alinhada ao mesmo `roadFeature`.
4. **Passo 2**: bases de árvore formal + bases scatter (`OBJECT_SETS`).
5. **Passo 3**: supressão de grama clump onde o mesmo ruído de scatter é alto (ou lista vinda do worker).

---

## 8. Checklist para reimplementar do zero

1. [ ] Mesmo PRNG macro (`rng.js`) e mesma sequência de `generateNoiseMap` / FBM / detalhe.
2. [ ] Mesmo `width=height=256` e `DEFAULT_CONFIG` (ou serializar `config` junto da seed).
3. [ ] Mesmo `getBiome` / `getBiomeWithAnomalies` e `applyMorphologicalCleanup` na elevação pós-geração.
4. [ ] Mesmo `MACRO_TILE_STRIDE`, `elevationToStep`, smoothstep vs linear nos campos, todos os offsets de seed citados em `getMicroTile`.
5. [ ] Mesmo `seededHash` para qualquer coisa micro (foliage, scatter, pontos de cidade se aplicável).
6. [ ] Mesmos `TERRAIN_SETS[].roles` e tipos (`conc-conv-*`) para mapear `role → tileId`.
7. [ ] Mesma ordem de passes no rasterizador.

Se todos os passos forem idênticos, o resultado **bit a bit** no layout lógico coincide; diferenças de GPU / `imageSmoothingEnabled` / assets PNG não entram na **lógica** de geração.

---

## 9. Leitura complementar no repositório

- **`docs/regras-de-tesselação.md`**: layout 3×3 dos papéis conc-conv e convenções de objetos multi-tile.
- **`diary/FASE-3-execucao-e-aprendizados.md`**: intenção de design (campos contínuos vs regras O(n²) por vizinhança).

---

*Documento gerado para alinhar implementação e documentação; ao mudar constantes ou ordem de RNG, atualize este arquivo e os comentários nos pontos de chamada correspondentes.*
