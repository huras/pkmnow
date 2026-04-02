# Experimento: gerador procedural de região (estilo GBA)

Projeto em **HTML, CSS e JavaScript** para explorar geração procedural de mapas no estilo de regiões 2D tipo Pokémon GBA.

## Documentação

- **[Plano, passos, dificuldades e abordagem](docs/PLANO-E-ABORDAGEM.md)** — o que será feito, em que ordem, quais problemas esperar e por quê.

## Executar (Fase 0)

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
- `js/generator.js` — `generate(seed)` (stub: grid 32×32 de ruído para validar pipeline)
- `js/render.js` — `render(canvas, dados)`
- `js/main.js` — UI (seed, botão) e orquestração

Próximo passo planejado: **Fase 1** — grafo de mundo mínimo (ver documento).
