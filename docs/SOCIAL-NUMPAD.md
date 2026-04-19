# Social Numpad — guia completo

Referência sem segredos sobre o sistema de **ações sociais** disparadas pelo teclado numérico. Explica cada slot, o que ele faz nos Pokémon selvagens, como a memória social evolui, e os efeitos colaterais (ripple, knockback, agressividade temporária).

- Código-fonte: [`js/social/social-actions.js`](../js/social/social-actions.js), [`js/wild-pokemon/wild-social-system.js`](../js/wild-pokemon/wild-social-system.js), [`js/main/play-social-overlay.js`](../js/main/play-social-overlay.js).
- Overlay (grid no canto da tela): [`createPlaySocialOverlay`](../js/main/play-social-overlay.js).
- Dispatch (da tecla até os selvagens): `onPlaySocialAction` em `js/main.js` → `triggerPlayerSocialAction`.

---

## 1. Como usar

- Funciona apenas **no modo jogo** (depois de clicar numa região e entrar no mapa jogável).
- Pressione uma das teclas do **teclado numérico** (`Numpad1`..`Numpad9`) — **precisa ser o numpad**, não a linha de números acima das letras.
- O overlay **Social numpad** (canto da tela) mostra os 9 slots com retrato + emoji + rótulo. A ação disparada acende por ~1s e o rodapé mostra `Sent <Label>`.
- Mapeamento fixo de teclas:

| Tecla (Numpad) | Slot | Emoji | Ação          | Intenção     |
| -------------- | ---- | ----- | ------------- | ------------ |
| `Numpad1`      | 1    | 👋    | Greet         | friendly     |
| `Numpad2`      | 2    | 🙂    | Smile         | friendly     |
| `Numpad3`      | 3    | 🍎    | Offer Food    | calming      |
| `Numpad4`      | 4    | 🤔    | Curious Look  | curious      |
| `Numpad5`      | 5    | 😄    | Playful Jump  | playful      |
| `Numpad6`      | 6    | 🙇    | Bow           | calming      |
| `Numpad7`      | 7    | 😤    | Challenge     | assertive    |
| `Numpad8`      | 8    | ⚠️    | Warn          | assertive    |
| `Numpad9`      | 9    | 💢    | Threaten      | scary        |

> Observação: o mapeamento vive em `NUMPAD_CODE_TO_SOCIAL_SLOT` (`social-actions.js`). Num teclado sem numpad físico, ative o num-lock virtual do SO ou use um teclado externo.

---

## 2. O que acontece ao apertar

Ao apertar a tecla, `onPlaySocialAction` faz três coisas:

1. **`playSocialOverlay.flashAction(action.id)`** — acende o slot no overlay por ~1s e some em ~1.5s.
2. **`showPlayerSocialEmotion(action)`** — mostra o balão / portrait do **jogador** (você também "fala").
3. **`triggerPlayerSocialAction(action, player, currentData)`** — propaga a ação para os selvagens próximos.

Dentro de `triggerPlayerSocialAction` (em `wild-social-system.js`) o mundo é varrido assim:

- **Raio primário**: `WILD_SOCIAL_INTERACTION_RADIUS = 9.0` tiles. O selvagem **mais próximo dentro desse raio** é o **alvo primário** e recebe `influence = 1.0`.
- **Raio ripple**: `WILD_SOCIAL_RIPPLE_RADIUS = 14.0` tiles. Todos os outros selvagens dentro desse raio recebem um efeito proporcional à distância:
  - `ripple = clamp(1 - dist/14, 0, 1) * 0.42`
  - Se `ripple < 0.1`, o selvagem é ignorado.
- Se **nenhum selvagem** está dentro do raio primário (9 tiles), a ação é **consumida** mas não gera reação — o overlay acende mesmo assim.
- **Cooldown por entidade**: `WILD_SOCIAL_REACTION_COOLDOWN_SEC = 0.45s`. Spam não empilha; o selvagem simplesmente ignora re-aplicações dentro desse intervalo.

---

## 3. Modelo de memória social do selvagem

Cada selvagem mantém um `socialMemory` (criado por `ensureSocialMemory`):

| Campo             | Faixa            | O que representa                                                   |
| ----------------- | ---------------- | ------------------------------------------------------------------ |
| `affinity`        | `-2.6` a `+3.1`  | Quanto ele gosta do jogador. Positivo = amigável.                  |
| `threat`          | `0` a `+3.8`     | Quanto ele se sente ameaçado. Nunca fica negativo.                 |
| `curiosity`       | `-2` a `+3.2`    | Interesse / vontade de observar.                                   |
| `approachSignal`  | `-2` a `+2.5`    | Quanto o jogador chegou perto recentemente.                        |
| `retreatSignal`   | `-2` a `+2.5`    | Quanto o jogador se afastou recentemente.                          |
| `reactionCooldown`| segundos         | Trava a aplicação de novas reações sociais.                        |

Todos os campos **decaem de volta a zero** via `decaySocialMemory`:

- `affinity`: `0.55/s` em direção a 0.
- `threat`: `0.55 * 0.85 /s`.
- `curiosity`: `0.55 * 0.7 /s`.
- `approachSignal` / `retreatSignal`: `0.9/s`.
- `reactionCooldown` diminui 1s por segundo real.

Além disso, `trackPlayerProximitySignals` observa se o jogador se aproxima ou se afasta (> 0.85 tiles de variação) e bate +0.45 em `approachSignal` ou `retreatSignal`. Isso tempera reações futuras.

---

## 4. Efeito base por intenção

`socialDeltasForIntent(intent)` define o impacto bruto antes dos modificadores:

| Intent      | Δaffinity | Δthreat | Δcuriosity | Exemplo de slot   |
| ----------- | --------- | ------- | ---------- | ----------------- |
| `friendly`  | +0.62     | −0.20   | +0.22      | Greet, Smile      |
| `playful`   | +0.35     | +0.05   | +0.50      | Playful Jump      |
| `curious`   | +0.12     | 0       | +0.66      | Curious Look      |
| `calming`   | +0.25     | −0.50   | +0.18      | Offer Food, Bow   |
| `assertive` | −0.05     | +0.45   | +0.20      | Challenge, Warn   |
| `scary`     | −0.25     | +0.86   | −0.05      | Threaten          |

Esses deltas são depois multiplicados por **vários fatores**:

### 4.1 Arquétipo do selvagem (`behaviorSocialModifiers`)

| Arquétipo   | Δaffinity × | Δthreat × | Δcuriosity × |
| ----------- | ----------- | --------- | ------------ |
| `timid`     | 0.95        | 1.18      | 0.80         |
| `skittish`  | 0.82        | 1.35      | 0.72         |
| `aggressive`| 0.72        | 0.90      | 1.20         |
| outro       | 1.00        | 1.00      | 1.00         |

Ou seja: **tímidos se assustam mais**, **skittish muito mais**, **agressivo** fica mais curioso mas menos afetivo.

### 4.2 Tamanho relativo (`sizeDelta`)

Diferença de `heightTiles` (jogador vs selvagem) normalizada em `[-1.25, +1.25]`. Afeta:

- `assertive` / `scary`: ganhos de `threat` escalam com `max(0, sizeDelta)` — jogador maior **intimida mais**.
- `calming`: ganhos de redução de ameaça escalam com `max(0, sizeDelta)` — jogador maior acalma melhor (ex.: abaixar cabeça num Pokémon pequeno).
- Jogador menor que o selvagem **não intimida** com `assertive/scary` (fator zerado).

### 4.3 Eventos recentes no raio (`WILD_SOCIAL_NEARBY_EVENT_RADIUS = 8.5` tiles)

O selvagem escuta o que acontece em volta:

- `friendlyNearby` = `getNearbyEventIntensity(entity, 'friendly_social')`:
  - `affinity +0.08 × intensity` e `threat −0.06 × intensity`.
- `hostileNearby` = soma de `player_damage` + `player_field_move` + `hostile_social`:
  - `affinity −0.06` e `threat +0.20` por unidade.
- `ally_species_hurt` da mesma espécie: se intensidade ≥ 0.85, o selvagem entra em **agressividade temporária** (`wildTempAggressiveSec = 6.5s`).

### 4.4 Sinais de aproximação/retirada

- `retreatSignal` (jogador afastou): `affinity +0.08` mas também `curiosity +0.1`.
- `approachSignal` (jogador chegou): `affinity −0.04`, `threat +0.18`.
- Ou seja, **chegar correndo em cima** com uma intenção scary amplifica bastante a ameaça.

### 4.5 Sexo do selvagem (`socialSexIntentMul`)

Pequenos multiplicadores por sexo + intenção:

- `scary`: fêmea x1.07 em threat, macho x1.02.
- `assertive`: macho x1.05 em threat.
- `calming`: fêmea x1.05 em affinity, macho x1.02.
- Demais combinações: sem efeito.
- `genderless`: sempre x1.

### 4.6 Fator `influence`

- Alvo primário: `1.0`.
- Ripple: `~0 a 0.42`.
- Todos os deltas acima são multiplicados por esse `influence`.

---

## 5. Reação comportamental (outcome)

Depois de atualizar memória, o código calcula um `moodScore`:

```
moodScore =
    affinity
  + curiosity * 0.35
  - threat
  - hostileNearby * 0.22
  + retreatSignal * 0.18
  - approachSignal * 0.20
```

E decide `outcome`:

| Condição                                 | `aiState` resultante      | outcome        | Balão (default) |
| ---------------------------------------- | ------------------------- | -------------- | --------------- |
| `moodScore ≥ 0.95`                       | `wander` (para de se mexer) | `deescalate` | `action.balloonType` (ex.: Joyous / Inspired) |
| `moodScore ≤ -0.65` e arquétipo agressivo + intent `assertive`/`scary` | `approach` | `approach` | 4 (Angry) |
| `moodScore ≤ -0.65` (outros casos)       | `flee`                    | `flee`         | 5 (Pain)        |
| caso contrário                           | `alert` (com `alertTimer ≥ 0.8s`) | `neutral` | `action.balloonType` ou 0 (Surprised) se `threat > 1.4` |

E gera um **balão de fala** no selvagem (`setWildSpeechBubble`) com portrait + texto curto:

- `deescalate`: "Okay…"
- `flee`: "Eek!"
- `approach`: "Hey!"
- `neutral`: "Hmm?"

Também faz `pushRecentNearbyEvent`:

- `friendly_social` se intent é `friendly`/`calming`/`playful`/`curious` (ex.: aliados por perto ficam mais amigáveis).
- `hostile_social` se intent é `assertive`/`scary` (ex.: aliados por perto ficam mais desconfiados).
- Um evento específico por ação, tipo `social_greet`, `social_threaten`, etc. — reservado para reações especiais por espécie.

---

## 6. Provocação e agressividade temporária

Intenções hostis (`assertive`, `scary`) também incrementam `provoked01` no alvo primário:

- `scary` → `+0.26 × influence`, `assertive` → `+0.17 × influence` (clamp `[0, 3]`).
- Se `provoked01 ≥ 0.52`, liga `wildTempAggressiveSec` em **no mínimo 5s** (até 22s acumulados).
- `provoked01` decai 0.3/s, `wildTempAggressiveSec` decai 1s/s.

Resultado prático: **threatenar** várias vezes o mesmo selvagem faz ele ficar momentaneamente agressivo, mesmo que a espécie seja tímida.

---

## 7. Caso especial: `Challenge` como tackle social

`isTackleSocialAction(action)` reconhece ações de "tackle":

- `id === 'tackle'` ou `id === 'challenge'`, ou qualquer id/label contendo `tackle`.

Se o alvo primário está a `≤ PLAYER_SOCIAL_TACKLE_HIT_RADIUS (2.25)` tiles quando você dispara **Challenge**:

- Dá **8 de dano** (`PLAYER_SOCIAL_TACKLE_DAMAGE`).
- Aplica **knockback 3.2** (`PLAYER_SOCIAL_TACKLE_KNOCKBACK`) a partir da posição do jogador.
- Seta emoção `Pain` e balão "Oof!".
- Injeta `player_field_move` (1.1 no alvo + 0.75 broadcast num raio de 8.5).

Ou seja: `Numpad7` de perto é literalmente um **soco social** — gera ressentimento em aliados da mesma espécie (`ally_species_hurt`) e pode puxar bando inteiro pra agressividade.

---

## 8. Broadcast final no mapa

Depois de processar todos os selvagens, o sistema chama uma vez:

- `broadcastNearbyPlayerEvent(px, py, eventType, 0.45)`:
  - `eventType = 'hostile_social'` se intent é `assertive`/`scary`.
  - `eventType = 'friendly_social'` caso contrário.

Isso "vaza" a ação pra outros selvagens dentro de 8.5 tiles, mesmo que estejam fora do raio ripple de 14, servindo como **reputação ambiente** de curto prazo.

---

## 9. Receitas práticas

| Objetivo                                           | Como fazer                                                  |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Acalmar um selvagem em fuga                        | `Numpad6` (Bow) ou `Numpad3` (Offer Food). Fique parado pra não gerar `approachSignal`. |
| Fazer um bando se aproximar e observar             | `Numpad4` (Curious Look) repetido com intervalo de ~0.5s; o ripple espalha curiosidade. |
| Brincar com um Pokémon amistoso                    | `Numpad5` (Playful Jump) — custa pouco em `threat` e sobe bastante `curiosity`. |
| Intimidar sem violência                            | `Numpad8` (Warn). Mais forte se você estiver jogando com um Pokémon grande. |
| "Aggro" um selvagem agressivo para luta            | `Numpad9` (Threaten) + `Numpad7` (Challenge) de perto. Cuidado: aliados da mesma espécie também ficam agressivos. |
| Passar despercebido                                | Não use numpad. Ações sociais geram `broadcastNearbyPlayerEvent`, que tempera reações de outros selvagens próximos. |

---

## 10. Referências de código

- **Definição dos slots**: `SOCIAL_ACTIONS` em `js/social/social-actions.js`.
- **Dispatch do numpad**: `NUMPAD_CODE_TO_SOCIAL_SLOT` / `getSocialActionByNumpadCode` em `js/social/social-actions.js`; consumido no input handler do jogo.
- **Reação no selvagem**: `applySocialReactionToWild` em `js/wild-pokemon/wild-social-system.js`.
- **Ripple e primário**: `triggerPlayerSocialAction` no mesmo arquivo.
- **Overlay HUD**: `createPlaySocialOverlay` em `js/main/play-social-overlay.js`.
- **Balões e portraits**: `DEFAULT_PORTRAIT_SLUG_BY_BALLOON` em `js/pokemon/spritecollab-portraits.js`.
- **Emoções do selvagem**: `setEmotion` em `js/wild-pokemon/wild-motion-ai.js`.
