# Atalhos de teclado e mouse — referência completa

Lista de todos os atalhos reconhecidos pelo jogo, com fonte do arquivo e função que consome o evento. Use isso pra auditar ou pra escrever conteúdo de ajuda sem precisar adivinhar.

Atalhos só respondem quando o foco **não** está em um `<input>`, `<textarea>`, `<select>` ou elemento `contentEditable`. Os listeners principais rodam em **capture phase** pra não serem engolidos por default do navegador (ex.: `Ctrl+W`).

---

## 1. Modo jogo — movimento

Arquivo: [`js/main/game-loop.js`](../js/main/game-loop.js) → `registerPlayKeyboard`.

| Tecla                     | O que faz                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `W` / `A` / `S` / `D`     | Movimento 4-cardinal; combinações geram 8 direções com diagonal normalizada.                                                   |
| Setas (`Arrow*`)          | Mesmo que WASD.                                                                                                                |
| Duplo toque (~320 ms) numa direção cardinal | Ativa `player.runMode` (sprint estilo Kirby). Desativa ao soltar tudo e parar.                                   |
| `Space`                   | `tryJumpPlayer`. Base = 2 pulos (duplo-pulo); Pokémon Voador = até 6 pulos aéreos.                                             |
| `Shift` esquerdo/direito  | Desce altitude em voo criativo; usado como auxiliar no `playInputState.shift*Held`.                                            |
| `F`                       | `togglePlayerCreativeFlight` — só funciona em Pokémon com tipo Voador. Em voo, `Space` sobe e `Shift` desce; HUD mostra "Fly". |
| `E`                       | `tryStrengthInteractKeyE` — interação de força: pega / solta / arremessa pedras e detalhes de mapa (cristais, troncos, etc.).  |
| `Esc`                     | Modo jogo: sai e volta pro mapa global (`onEscapePlay`). Com ajuda aberta, fecha só a ajuda.                                   |
| `Ctrl` + tecla de movimento | Bloqueia atalhos do navegador (Ctrl+W/S/N) pra não fechar a aba; o movimento normal continua.                                |

> `keyToDir` em `game-loop.js` aceita tanto `KeyW/KeyA/KeyS/KeyD` quanto `Arrow*`. Qualquer evento dessas teclas recebe `preventDefault` em modo jogo.

---

## 2. Modo jogo — combate / ações

Arquivos: [`js/main/play-mouse-combat.js`](../js/main/play-mouse-combat.js), [`js/main/player-input-slots.js`](../js/main/player-input-slots.js).

### 2.1 Mouse — 5 slots fixos

| Botão / scroll   | Slot interno | Default do Charmander (exemplo) |
| ---------------- | ------------ | -------------------------------- |
| **LMB** (clique esquerdo)  | `lmb`       | `cut` (field melee)            |
| **RMB** (clique direito)   | `rmb`       | `flamethrower` (stream)        |
| **MMB** (botão do meio)    | `mmb`       | `ultimate`                     |
| **Wheel ↑**               | `wheelUp`   | 2º move do moveset (`confusion`, `bubble`, etc.) |
| **Wheel ↓**               | `wheelDown` | 3º move do moveset             |

Implementação:

- `canvas` escuta `wheel` e chama `castScrollSlotMove` usando o binding atual (`wheelUp` ou `wheelDown`) — [`play-mouse-combat.js` @ 1072](../js/main/play-mouse-combat.js).
- `pointerdown` / `pointerup` no canvas diferencia `e.button === 0 | 1 | 2` (LMB / MMB / RMB) e aciona charge/cast.

### 2.2 Dígitos 1–5 — roda de bind (hold-to-rebind)

| Tecla     | Slot editado | UI                    |
| --------- | ------------ | --------------------- |
| `Digit1`  | LMB          | "Hold 1 · release"    |
| `Digit2`  | RMB          | "Hold 2 · release"    |
| `Digit3`  | MMB          | "Hold 3 · release"    |
| `Digit4`  | Wheel ↑      | "Hold 4 · release"    |
| `Digit5`  | Wheel ↓      | "Hold 5 · release"    |

- Apertar a tecla arma a roda; após **170 ms** (`BIND_SLOT_WHEEL_HOLD_MS`), o overlay `#play-move-bind-wheel` abre.
- Com a roda aberta, o cursor escolhe o novo move (`updateBindWheelHover` usa ângulo do mouse no anel).
- Soltar a tecla grava o move no slot (`setPlayerInputBinding`), persistido em `localStorage` (`pkmn_player_input_slots_v2`).
- Se você soltar antes dos 170 ms, nada muda — serve só como tap inofensivo.

### 2.3 Carregamento de golpe (estilo Zelda)

- **Segurar LMB** acumula `chargeLeft01` (0 → 1) até `FIELD_LMB_CHARGE_MIN_HOLD_MS` e `CHARGE_FIELD_RELEASE_MIN_01`.
- **Soltar LMB** dispara a versão carregada (`castSelectedFieldSkill` com `charged = true`).
- Se o level da carga for ≥ 3, toca o SFX do Home Run Bat.
- Mesma lógica existe em **RMB** (`chargeRight01`) e **MMB** (`chargeMmb01`) para moves que suportam charge (não stream).

### 2.4 Modificador Ctrl (`combatModifierHeld`)

- `ControlLeft` mantido → `playInputState.ctrlLeftHeld = true`.
- Enquanto Ctrl está segurado, LMB/RMB/MMB **não** carregam nem fazem cast (`if (leftHeld && !mod)` etc.). Ou seja, Ctrl é um **"mute" temporário"** de combate.
- No `contextmenu` do canvas, `Ctrl+click direito` libera o menu nativo do navegador em vez do menu de contexto do jogo (útil para inspecionar DOM em debug).
- Observação: não existe mapeamento "Ctrl+clique = slot 3/4" no código atual. Quem documentou isso antes estava errado; a forma correta de acessar slot 3/4/5 é **MMB**, **Wheel ↑** e **Wheel ↓**.

---

## 3. Modo jogo — social

Arquivo: [`js/social/social-actions.js`](../js/social/social-actions.js) + [`js/main/game-loop.js`](../js/main/game-loop.js) (dispatch).

| Tecla     | Slot | Ação        |
| --------- | ---- | ----------- |
| `Numpad1` | 1    | Greet 👋     |
| `Numpad2` | 2    | Smile 🙂     |
| `Numpad3` | 3    | Offer Food 🍎 |
| `Numpad4` | 4    | Curious Look 🤔 |
| `Numpad5` | 5    | Playful Jump 😄 |
| `Numpad6` | 6    | Bow 🙇       |
| `Numpad7` | 7    | Challenge 😤 (soco social se colado) |
| `Numpad8` | 8    | Warn ⚠️      |
| `Numpad9` | 9    | Threaten 💢  |

Detalhes completos em [`docs/SOCIAL-NUMPAD.md`](./SOCIAL-NUMPAD.md).

---

## 4. Debug — overlays globais

Arquivo: [`js/render/render-debug-hotkeys.js`](../js/render/render-debug-hotkeys.js).

| Tecla | Toggle                            | Fallback se checkbox não existe |
| ----- | --------------------------------- | ------------------------------- |
| `C`   | `#chkPlayColliders` — mostra colisores do modo jogo (player / pedras / cristais / scatter pass). | `window.debugColliders` (boolean + `console.log`). |
| `V`   | `#chkWorldReactionsOverlay` — mostra mapa de calor de reações do mundo (heat / wet / shock / danger). | `window.debugWorldReactionsOverlay`. |

Os listeners são globais (`window.addEventListener('keydown', ...)`), funcionam tanto no mapa quanto no modo jogo, e só são ignorados quando o foco está em input / textarea / select / contentEditable.

---

## 5. Modais e campos

| Contexto                                  | Tecla    | Efeito                                                                                      |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| Modal de ajuda (`play-help-wiki-modal`)   | `Esc`    | Fecha a ajuda. Listener em [`play-help-wiki-modal.js`](../js/main/play-help-wiki-modal.js). |
| Menu de contexto do jogo (`play-context-menu`) | `Esc`    | Fecha o menu. [`play-context-menu.js` @ 67](../js/main/play-context-menu.js).               |
| Busca do seletor de Pokémon               | `Esc`    | Esconde a lista de resultados. [`character-selector.js` @ 413](../js/ui/character-selector.js). |
| Input de seed (`seedInput`)               | `Enter`  | Dispara `run()` (gerar / reiniciar). [`main.js` @ 1075](../js/main.js).                     |
| Painel do Pokémon (clique no nome/linha)  | `Ctrl` ou `⌘` + clique | Em modo jogo: `summonDebugWildPokemon` invoca um selvagem perto do jogador.      |

---

## 6. Comportamento em campos de texto

Todos os handlers do modo jogo começam com:

```js
if (
  el &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
) {
  return;
}
```

Ou seja, se você estiver digitando no **campo de seed**, na **busca de Pokémon** ou em qualquer input, nenhum atalho de jogo dispara — só os do próprio campo (`Enter` / `Esc`).

---

## 7. Listeners catalogados

Resumo dos locais de registro (para futuras auditorias):

| Arquivo                                          | Evento   | Escopo                                     |
| ------------------------------------------------ | -------- | ------------------------------------------ |
| `js/main/game-loop.js`                           | `keydown` / `keyup` (capture) | movimento, pulo, F, E, Ctrl, dígitos 1–5, numpad, Esc, Shift |
| `js/main/play-mouse-combat.js`                   | `pointerdown` / `pointerup` / `wheel` / `pointermove` no canvas | LMB/RMB/MMB, scroll wheel, charge, aim |
| `js/main/play-context-menu.js`                   | `keydown` (enquanto menu aberto) | Esc fecha                                |
| `js/render/render-debug-hotkeys.js`              | `keydown` (global)          | C, V debug                                  |
| `js/main/play-help-wiki-modal.js`                | `keydown` (capture, enquanto aberto) | Esc fecha                             |
| `js/ui/character-selector.js`                    | `keydown` no input de busca | Esc esconde lista                          |
| `js/main.js` (seed)                              | `keydown` no `seedInput`    | Enter gera                                 |

Se algum novo atalho for adicionado, atualize essa tabela e o artigo correspondente no modal de ajuda.
