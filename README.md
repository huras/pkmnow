# Experimento: gerador procedural de região (estilo GBA)

Projeto em **HTML, CSS e JavaScript** para explorar geração procedural de mapas no estilo de regiões 2D tipo Pokémon GBA.

## Documentação

- **[Plano, passos, dificuldades e abordagem](docs/PLANO-E-ABORDAGEM.md)** — o que será feito, em que ordem, quais problemas esperar e por quê.
- **[Diário — Fase 0](diary/FASE-0-execucao-e-aprendizados.md)** — esqueleto.
- **[Diário — Fase 1](diary/FASE-1-execucao-e-aprendizados.md)** — grafo mínimo (MST + BFS + conectividade).
- **[Diário — Fase 2](diary/FASE-2-execucao-e-aprendizados.md)** — geografia e caminhos reais (A*).

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
- `js/graph.js` — cidades no grid, MST + acordes, BFS e conectividade
- `js/pathfind.js` — algoritmo A* com pesos de terreno (Fase 2)
- `js/generator.js` — Value Noise + Pathfinding (Fase 2)
- `js/render.js` — cores de bioma e corredores de rota
- `js/main.js` — UI (seed, botão) e orquestração

**Fase 0**, **Fase 1** e **Fase 2** estão implementadas. Próximo passo planejado: **Fase 3** — Micro-detalhes, biomas reais (umidade/temperatura) e tesselação.
