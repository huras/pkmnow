# Pipeline National Dex (sprites, cries, dados de espécie)

Este documento descreve **como o projeto integra Pokémon por geração** (hoje: Gen 1–4 Sinnoh, dex **1–493**) e como repetir o pipeline para futuras extensões.

## Fontes de verdade

| O quê | Onde | Notas |
|--------|------|--------|
| Teto do dex + nomes EN + slug de cry Showdown | [`js/pokemon/national-dex-registry.js`](../js/pokemon/national-dex-registry.js) | `NATIONAL_DEX_MAX`, `NATIONAL_DEX_LINES`, `encounterNameToDex`, `padDex3`, `getNationalShowdownCrySlug` |
| Compat imports antigos | [`js/pokemon/gen1-name-to-dex.js`](../js/pokemon/gen1-name-to-dex.js) | Re-exporta do registry |
| Tipos, `heightTiles`, `baseSpeed` | [`js/pokemon/pokemon-config.js`](../js/pokemon/pokemon-config.js) | Gerado por script; `getPokemonConfig` respeita `NATIONAL_DEX_MAX` do registry após rebuild |
| Encontros por bioma | [`js/ecodex.js`](../js/ecodex.js) | Strings devem bater com nomes do registry |
| Sprites PMD + folhas `NNN_walk.png` | `tilesets/pokemon/` + [`js/pokemon/pmd-anim-metadata.js`](../js/pokemon/pmd-anim-metadata.js) | Gerado por `import-spritecollab.ps1` |
| Cries MP3 | `audio/cries/gen1/` (dex ≤ 151) e `audio/cries/national/` (dex > 151) | [`js/pokemon/pokemon-cries.js`](../js/pokemon/pokemon-cries.js) |
| Portraits SpriteCollab | `tilesets/spritecollab-portraits/` ou `../SpriteCollab/portrait` | [`js/pokemon/spritecollab-portraits.js`](../js/pokemon/spritecollab-portraits.js) |

Constantes no registry: `NATIONAL_DEX_HOENN_MAX = 386`, `NATIONAL_DEX_SINNOH_MAX = 493` (= `NATIONAL_DEX_MAX` enquanto o teto for até Arceus).

---

## Ordem recomendada (após mudar nomes / teto no código)

1. **Registry** — em `national-dex-registry.js`:
   - Ajustar `NATIONAL_DEX_MAX`.
   - Adicionar linhas da nova geração (ex.: `GEN5_LINES`) e incluir em `NATIONAL_DEX_LINES`.
   - Mapeamentos especiais de encontro (`NAME_TO_DEX.set(...)`) se o `ecodex` usar apelidos.
   - `SHOWDOWN_CRY_SLUG_OVERRIDES` para casos que não batem com o slug automático (Nidoran, Unown, Ho-Oh, etc.); na Gen 3 podem aparecer outros (ex.: formas).

2. **Dados de gameplay por espécie** — rede + disco:
   ```bash
   node scripts/build-pokemon-config.mjs
   ```
   - Lê nomes do registry, PokeAPI para tipos/speed/altura (Gen 2+ sem altura manual usa heurística), preserva `heightTiles` já existentes no `pokemon-config.js` atual.

3. **Cries (Showdown CDN)** — intervalo configurável:
   ```bash
   node scripts/download-national-cries-showdown.mjs
   node scripts/download-national-cries-showdown.mjs --start 387 --end 493
   ```
   - Sem flags: `--start 152` até `NATIONAL_DEX_MAX` (dex > 151 em `audio/cries/national/`). Faixas parciais: `--start 387 --end 493`, etc.
   - Gen 1 continua em `audio/cries/gen1/` (`scripts/download-gen1-cries-showdown.ps1`).

4. **Sprites + metadata PMD** — SpriteCollab local:
   ```powershell
   .\scripts\import-spritecollab.ps1
   .\scripts\import-spritecollab.ps1 -MaxDex 386
   ```
   - Pastas de espécie: `SpriteCollab/sprite/0001` … `0493` (4 dígitos).
   - Saída: `tilesets/pokemon/001_*.png` … (3 dígitos no nome do ficheiro até dex 999).

5. **Auditoria** (somente relatório):
   ```bash
   node scripts/audit-national-dex-assets.mjs
   ```

6. **Jogo / design** — à mão, conforme necessidade:
   - [`js/ecodex.js`](../js/ecodex.js) — novos nomes por bioma.
   - [`js/wild-pokemon/wild-boss-variants.js`](../js/wild-pokemon/wild-boss-variants.js) — `WILD_BOSS_EVOLVE_TO` e `BOSS_PROMOTE_TARGET_BLOCK` para novas linhas e lendários.
   - [`js/wild-pokemon/wild-spawn-window.js`](../js/wild-pokemon/wild-spawn-window.js) — `SKY_SPECIES` para voadores / flutuantes.
   - [`js/wild-pokemon/pokemon-behavior.js`](../js/wild-pokemon/pokemon-behavior.js), [`js/moves/pokemon-moveset-config.js`](../js/moves/pokemon-moveset-config.js), [`js/moves/wild-move-table.js`](../js/moves/wild-move-table.js) — overrides e presets (`TYPE_PRESETS` já inclui tipos úteis Gen 3 como `steel`/`dark`/`fairy`).
   - [`js/pokemon/pokemon-sex.js`](../js/pokemon/pokemon-sex.js) — genderless / ratios se quiser fidelidade.

---

## Comportamento em runtime (fallbacks)

- **Sprite em falta**: o loader usa folhas de fallback (Gengar), ver [`js/pokemon/pokemon-asset-loader.js`](../js/pokemon/pokemon-asset-loader.js).
- **Metadata PMD em falta**: `getDexAnimMeta` devolve `null` e o renderer usa defaults onde aplicável.
- **Cry em falta**: pool de áudio pode falhar silenciosamente até o ficheiro existir; o audit ajuda a listar buracos.

---

## Gen 4 (Sinnoh) no repositório

**Código / dados:** `GEN4_LINES` (Turtwig … Arceus), registry **1–493**, `pokemon-config.js` via build, `ecodex`, `WILD_BOSS_EVOLVE_TO` (incl. evos cruzadas tipo Magneton→Magnezone, Eevee com **5** destinos), `BOSS_PROMOTE_TARGET_BLOCK` até Arceus, `SKY_SPECIES`, genderless, flight helpers, behavior, cries/moves wild, overrides Showdown (`mimejr`, `porygonz`).

**Ainda por conta do teu disco / pipelines locais:**

- [ ] `node scripts/download-national-cries-showdown.mjs` (ou `--start 387 --end 493` se já tens cries anteriores).
- [ ] `.\scripts\import-spritecollab.ps1` com SpriteCollab até **0493**.
- [ ] `node scripts/audit-national-dex-assets.mjs` até ficar limpo.

Se algum cry Showdown falhar, acrescenta override em `SHOWDOWN_CRY_SLUG_OVERRIDES` e volta a correr o download só na faixa afectada.

**Dex ≥ 1000** (futuro): `padDex3` deixa de chegar para nomes de ficheiro; seria preciso `padDex4` para pastas de tileset — até Sinnoh ainda cabe em 3 dígitos.

---

## Referência rápida de comandos

| Objetivo | Comando |
|----------|---------|
| Regenerar `pokemon-config.js` | `node scripts/build-pokemon-config.mjs` |
| Cries national (intervalo) | `node scripts/download-national-cries-showdown.mjs [--start A --end B]` |
| Import sprites + PMD JSON | `powershell -File .\scripts\import-spritecollab.ps1 [-MaxDex N]` |
| Relatório de ficheiros | `node scripts/audit-national-dex-assets.mjs` |

---

## Notas legais / conteúdo

Sprites e áudio vêm de pipelines locais (SpriteCollab, Showdown CDN) para desenvolvimento do teu projeto; mantém licenças e termos de uso das fontes que importas.
