# Experimento: gerador procedural de região (estilo GBA)

Projeto em **HTML, CSS e JavaScript** para explorar geração procedural de mapas no estilo de regiões 2D tipo Pokémon GBA.

## Documentação

- **[Plano, passos, dificuldades e abordagem](docs/PLANO-E-ABORDAGEM.md)** — o que será feito, em que ordem, quais problemas esperar e por quê.
- **[Diário — Fase 0](diary/FASE-0-execucao-e-aprendizados.md)** — execução e aprendizados.

## Executar

O projeto usa **módulos ES** (`import`/`export`). Abra via servidor HTTP local, por exemplo:

```bash
npx --yes serve .
```

Depois acesse o URL indicado no terminal (ex.: `http://localhost:3000`) e abra `index.html`.

Alternativa: extensão **Live Server** no VS Code/Cursor a partir da pasta do projeto.

## Estrutura atual

- `index.html` — página e `<canvas>`
- `css/style.css` — layout básico
- `js/rng.js` — seed string → número + PRNG determinístico
- `js/graph.js` — cidades no grid, MST + acordes, BFS e reparo de conectividade
- `js/generator.js` — `generate(seed)` → grid 32×32 + `graph` (Fase 1)
- `js/render.js` — `render(canvas, dados)` com overlay do grafo
- `js/main.js` — UI (seed, botão) e orquestração

**Fase 0** (esqueleto) e **Fase 1** (grafo mínimo) estão implementadas. Próximo passo planejado: **Fase 2** — layout macro no grid e corredores (ver documento).
