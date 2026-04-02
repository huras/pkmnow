# Diário — Fase 0: execução e aprendizados

Data de referência: abril/2026. Este arquivo registra **como rodar** o que foi feito na Fase 0 e **o que aprendemos** ao implementar o esqueleto.

---

## 1. O que a Fase 0 entregou

- Página com **canvas** 512×512.
- **Seed** editável (texto ou número como string) + botão **Gerar**; Enter no campo também dispara geração.
- Pipeline: `generate(seed)` → objeto de dados → `render(canvas, dados)`.
- **PRNG determinístico** (mulberry32 + hash FNV-1a para strings), sem `Math.random()`.
- **Stub visual**: grid 32×32 de valores pseudoaleatórios derivados da seed, desenhado no canvas (tons de cinza/azul leve).

Arquivos envolvidos: `index.html`, `css/style.css`, `js/rng.js`, `js/generator.js`, `js/render.js`, `js/main.js`.

---

## 2. Como executar

### Por que não basta abrir o HTML no disco

O projeto usa **módulos ES** (`type="module"` + `import`/`export`). Navegadores costumam bloquear ou restringir carregamento de módulos via protocolo `file://` (CORS / política de origem). Por isso a abertura estável é via **HTTP local**.

### Opção A — `serve` (npm)

Na raiz do repositório:

```bash
npx --yes serve .
```

Abra no navegador o URL que o comando imprimir (ex.: `http://localhost:3000`) e acesse `index.html` ou a raiz, conforme o servidor listar.

### Opção B — Live Server (editor)

Extensão **Live Server** no VS Code/Cursor: “Open with Live Server” na pasta ou no `index.html`. Garante origem HTTP e recarrega ao salvar.

### Opção C — Python (se já estiver no PATH)

```bash
python -m http.server 8080
```

Depois: `http://localhost:8080/index.html`.

### Verificação rápida

1. Carregar a página: deve aparecer o canvas com textura (ruído) estável.
2. Alterar a seed para `demo` e clicar **Gerar** — memorizar o padrão.
3. Mudar para outra string (ex.: `outra`) — o padrão muda.
4. Voltar para `demo` — o padrão deve ser **idêntico** ao do passo 2 (reprodutibilidade).

---

## 3. Aprendizados técnicos

### 3.1 Seed e reprodutibilidade

- **Bug reproduzível** exige a mesma sequência de “sorteios” em toda execução; `Math.random()` não garante isso entre reloads nem entre ambientes.
- Separar **normalização da seed** (`normalizeSeed`: número finito, string vazia → default, dígitos só → unsigned, senão hash de string) deixa a UX clara e o núcleo do gerador sempre com um inteiro 32-bit estável.
- Documentar ou testar mentalmente: strings diferentes podem colidir em hash (raro); para trabalho experimental está aceitável.

### 3.2 Separação generate / render

- **Gerar** produz dados puros (estruturas, arrays); **render** só lê esses dados e desenha.
- Facilita depurar (“o bug é no algoritmo ou no desenho?”) e alinha com **inversão de dependência**: o canvas não precisa conhecer o RNG.
- O stub `Float32Array` de 32×32 já força um contrato mínimo (`width`, `height`, `cells`) que as fases seguintes podem estender ou substituir (grafo, macro, tiles) sem misturar com pixels.

### 3.3 Módulos pequenos (SRP)

- `rng.js` só aleatoriedade determinística.
- `generator.js` só orquestração do “mundo” da Fase 0 (e futuramente do pipeline).
- `render.js` só desenho.
- `main.js` só DOM e eventos.

Isso reduz acoplamento e mantém o arquivo de entrada HTML enxuto.

### 3.4 Canvas e escala

- Tile “lógico” 32×32 em um canvas 512×512 implica **16px** por célula no desenho atual; usar `Math.floor`/`Math.ceil` nos retângulos evita frestas brancas por arredondamento.
- `image-rendering: pixelated` no CSS ajuda quando no futuro os tiles forem sprites nítidos estilo GBA.

### 3.5 Ambiente Windows / shell

- Em PowerShell, encadear com `&&` pode falhar em versões antigas; usar `;` ou comandos separados ao documentar scripts para colegas no Windows.

---

## 4. Limitações conscientes da Fase 0

- O conteúdo do mapa ainda **não** é uma região Pokémon: é apenas ruído correlacionado à seed para validar infraestrutura.
- Não há export JSON, overlays de debug nem grafo — previstos nas fases seguintes.
- Mapas muito maiores podem exigir Web Worker ou geração incremental; não foi necessário para 32×32.

---

## 5. Próximo passo sugerido

Fase 1 (plano): **grafo mínimo** (cidades/arestas), validação de conectividade (BFS/DFS), e **overlay** do grafo sobre o canvas ou ao lado do stub, mantendo seed determinística.

---

*Este diário é complementar ao `docs/PLANO-E-ABORDAGEM.md` e ao `README.md`; foca em execução real e lições aprendidas, não em repetir o desenho arquitetural completo.*
