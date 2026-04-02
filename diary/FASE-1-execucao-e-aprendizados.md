# Diário — Fase 1: execução e aprendizados

Data de referência: abril/2026. Este arquivo registra a execução da Fase 1 (grafo mínimo), incluindo testes, decisões e lições práticas.

---

## 1. O que a Fase 1 entregou

- Geração de **hubs (cidades)** em grid com margem configurável e sem sobreposição.
- Construção de espinha dorsal com **MST (Kruskal)** para garantir conectividade base.
- Inclusão de arestas extras (**chords**) para criar ciclos e reduzir linearidade.
- Validação de conectividade com **BFS**.
- Passo defensivo de **reparo de conectividade** caso o grafo saia desconexo.
- Overlay no canvas para visualizar **nós** e **arestas** sobre o terreno.

Arquivos centrais da fase: `js/graph.js`, `js/generator.js`, `js/render.js`.

---

## 2. Como executar e verificar

1. Subir servidor local:

```bash
npx --yes serve .
```

2. Abrir no navegador o endereço indicado (ex.: `http://localhost:3000`).
3. Alterar a seed e clicar **Gerar**.
4. Conferir no canvas:
   - cidades como nós;
   - rotas como arestas;
   - estrutura conectada (não deve haver “ilhas” de hubs).

### Verificação técnica feita na execução

Smoke test do módulo de grafo:

- `nodes: 7`
- `edges: 9`
- `connected: true`
- `bfs: true`

Teste de determinismo:

- mesma seed usada duas vezes gerou assinatura idêntica de `nodes + edges` (`true`).

---

## 3. Abordagem aplicada (e por quê)

### 3.1 Posicionamento de cidades

- Estratégia: sorteio em área útil (`margin`) + fallback por varredura.
- Motivo: evita colisão infinita e garante robustez mesmo em grids pequenos.

### 3.2 MST como base

- Estratégia: Kruskal com peso `dist² + jitter`.
- Motivo: conecta todo mundo com custo espacial baixo e mantém variação leve entre seeds.

### 3.3 Chords (arestas extras)

- Estratégia: adicionar pares aleatórios únicos, com guard de tentativas.
- Motivo: quebrar árvore pura e melhorar navegabilidade.

### 3.4 Validação e reparo

- Estratégia: BFS para validar e, se necessário, conectar componentes pelo menor par intercomponente.
- Motivo: conectividade é requisito estrutural do mundo; sem isso, o resto perde valor.

---

## 4. Aprendizados técnicos

- **Reprodutibilidade**: com seed determinística, bugs de layout ficam auditáveis.
- **Separação de responsabilidades**: `graph.js` isolado manteve `generator.js` e `render.js` mais simples.
- **Visual debug acelera iteração**: overlay de nós/arestas revelou rapidamente qualidade das conexões.
- **Defensividade compensa**: mesmo com MST teoricamente conectada, manter `repairConnectivity` evita regressões futuras.

---

## 5. Dificuldades e observações

- Em PowerShell antigo, encadeamento com `&&` pode falhar; preferir `;` ou comandos separados.
- Mensagens de ambiente apareceram após comandos Node, mas os resultados principais do teste foram válidos.
- O grafo estava correto mesmo antes do layout físico das rotas; isso foi essencial para evoluir para fases seguintes.

---

## 6. Estado atual em relação à Fase 1

A Fase 1 foi concluída e validada. O projeto já evoluiu para fase posterior no fluxo principal, mas este registro fixa:

- o que foi entregue na Fase 1;
- como foi testado;
- os aprendizados que orientam manutenção e refactor.

---

*Este diário complementa o `docs/PLANO-E-ABORDAGEM.md` com foco de execução real.*
