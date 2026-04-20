# Far Cry — ambient “unknown” audio & minimap discipline

This document captures the **design intent**, **player-facing behaviour**, **implementation**, and **evolution** of the Far Cry feature in this project. It is written so a new contributor (or a future you) understands *why* things are the way they are—not only *what* the code does.

---

## 1. What “Far Cry” means here

The name nods to **Ubisoft’s *Far Cry***: using **sound and light UI** to make the world feel watched, alive, and slightly dangerous without dumping exposition. In our Pokémon-style overworld, Far Cry is **not** a combat mechanic—it is a **short, authored beat**:

- A **wild cry** plays (species-specific).
- **Screen-space waves** roll in from the direction of the “source” (where the chosen wild lives in the world).
- **Minimap echoes** pulse at that origin in macro-tile space.

So the player gets: **audio identity + spatial hint + map echo**, in one package.

---

## 2. Design pillars (why this fits a Miyamoto-shaped game feel)

These are the values we optimised for—whether or not anyone’s name is on the box.

### 2.1 Discovery without checklist UI

Unknown species already use **`?`** on the minimap when `minimapSpeciesKnown` is false. Far Cry ties **audio** to that same “I don’t know what it is yet” state: the world suggests *something* is out there, without opening a modal or a quest log.

### 2.2 Audio as a compass

Cries are **directionally hinted** (screen waves + echo position). The cry itself is mixed as a **non-positional** short cue (centred on the listener) so distance doesn’t punish readability; the **waves and minimap** carry “where”.

### 2.3 Minimap literacy — don’t drown the player in `?`

If every unknown wild appeared as `?` immediately, the minimap becomes **noise**. So we split unknowns into two **logical** layers:

| Layer | Meaning | Minimap |
|--------|---------|---------|
| **Hidden unknown** | Species still hidden *and* this wild has **never** been part of a Far Cry intro | **No marker** (not the same as distance culling—it’s intentional absence) |
| **Revealed unknown** | Far Cry has “introduced” this wild for minimap purposes | Normal **`?`** / silhouette flow (same as before for unknowns) |

After `markWildMinimapSpeciesKnown`, portraits behave as today—Far Cry intro is orthogonal to “species learned by play”.

This is a **cheap, elegant** throttle: the player **hears** the jungle before the map agrees to show every silhouette.

### 2.4 One brain, two hands — auto and manual must agree

The **HUD “Next Far Cry”** button and the **automatic timer** must call the **same** selection and emission path (`tryEmitFarCry`). No “debug path” that drifts from “real path”. That keeps QA simple and prevents “it works when I click but not in the wild” class bugs.

---

## 3. Player-facing behaviour (current)

### 3.1 Automatic Far Cry — interval schedule

Delays are **between successful emissions** (auto or HUD). If an attempt finds no target, the **same** delay is used again (the schedule slot does not advance). Constants in `far-cry-system.js`:

| After… | Next wait (seconds) | New `?` on minimap |
|--------|---------------------|--------------------|
| Session start | **3** (until 1st attempt) | 1st cry: **guaranteed** pending pick if any in pool |
| 1st success | **15** | 2nd: **guaranteed** new if possible |
| 2nd success | **20** | 3rd: **guaranteed** new if possible |
| 3rd success | **15** | Normal §3.4.1 probability |
| 4th success | **30** | Alternating with 15s |
| 5th success | **15** | … |
| 6th+ | **30, 15, 30, …** | … |

From the 4th successful cry onward the pattern is **15 → 30 → 15 → 30** seconds (the “fourth acts like the first” of that repeating leg).

### 3.2 Manual Far Cry (“Next Far Cry” in the groups popover)

- Same `tryEmitFarCry` as auto (including the first-three **guaranteed new** rule when `farCrySuccessCount < 3`).
- On **success**, manual advances **`farCrySuccessCount`** and the **same** next-interval timer as auto (so the cadence stays one global schedule).
- If nothing eligible: button shows **“Sem alvo”** feedback (UI layer); the auto countdown is unchanged.

### 3.3 Who can be chosen?

Candidates are **wild entities** in `entitiesByKey` that:

- Are not despawning / dead.
- Have finite positions.
- **`minimapSpeciesKnown !== true`** — aligned with minimap “unknown” (`undefined` counts as unknown).

Pool: **nearest 24** in **macro-tile** space (same spirit as minimap’s top-N ordering), not a hard world “ring” in micro-tiles.

### 3.4 Smart queue — “hear the surrounds”

Selection is **not** uniform random anymore:

1. Sort by distance → take top 24.
2. Split into **pending** (`!minimapFarCryIntroduced`) and **done** (already introduced on minimap).
3. Sort each group by **`atan2`** around the player → compass order.
4. **New minimap intro** (picking from **pending**) is probabilistic (see §3.4.1), **except** for the **first three successful Far Cries** after a reset: those always take **pending** when the nearest-24 pool has any pending entry. On a failed roll (fourth+), if **done** candidates exist in the top 24, Far Cry still fires toward one of those (cry + VFX, no new `?`). If the roll fails and only pending exists in range, **no** Far Cry this attempt (auto retries after the same interval; manual shows “Sem alvo” when nothing fires).
5. Separate round-robin indices: **`farCryPendingCycleIndex`** and **`farCryDoneCycleIndex`** within each branch.

As the player moves, the pool changes; pending vs done rebalances naturally. The effect is a **gentle scan** around the horizon instead of hammering the same RNG slot.

### 3.4.1 Probability of revealing another `?`

Let **N** = count of wilds that already show as **`?`** on the minimap (species still unknown **and** `minimapFarCryIntroduced`).

- For the **first three successful emissions** after `resetFarCrySystem`, pending is **forced** when present (overrides the roll below).
- If **N = 0** (no `?` on the map yet): the next Far Cry that would introduce a pending wild always does so (**100%** new intro when only pending is available), in addition to the first-three rule above.
- If **N ≥ 1**: chance to pick **pending** (a new intro) this tick is  
  `newRevealBaseChanceWhenMarksOnMap × perRevealedQuestionMarkMult ** N`  
  (capped to \[0, 1\]). Defaults: **0.75** base, **0.5** per existing `?`.

Tune at runtime without rebuild via exported **`farCryRevealTuning`** in `far-cry-system.js` (e.g. from the browser console after importing the module).

### 3.5 After a Far Cry fires

- `markWildFarCryMinimapIntroduced(entity)` → `minimapFarCryIntroduced = true`.
- Minimap may now show that wild’s **`?`** (if still species-unknown).
- Waves + minimap echoes age out on their own timers.

---

## 4. Technical map (where things live)

| Concern | Module / file |
|--------|------------------|
| Scheduling, pick queue, cry + VFX state | `js/main/far-cry-system.js` |
| Screen wave draw | `js/render/render-far-cry.js` → `drawFarCryScreenWaves` |
| Minimap echo draw | `js/render/render-far-cry.js` → `drawFarCryMinimapEchoes` |
| Play loop hook | `js/main/game-loop.js` → `updateFarCrySystem` |
| Main canvas pass | `js/render.js` (waves after play stack) |
| Minimap pass | `js/render/render-minimap.js` |
| HUD button | `js/main/minimap-hud-popovers.js` + `play.html` / `debug-play.html` |
| Minimap intro flag API | `js/wild-pokemon/wild-minimap-species-known.js` → `markWildFarCryMinimapIntroduced` |
| Cry playback, preload | `js/pokemon/pokemon-cries.js` |

### 4.1 Cry mix note

Far Cry uses a **dedicated envelope** on `playPokemonCry` (volume / rate) so it reads as an **ambient beat**, not a battle sting. Volumes were tuned after playtesting (too quiet → raised; still below “default field cry” so it doesn’t stomp combat SFX).

---

## 5. Development path (honest chronology)

This section is the **lab notebook**: what broke, what we learned, why the final shape is sharper.

### 5.1 Origins — Far Cry as a system

- Added **timer + VFX + cry** as a cohesive system rather than bolting cry-only.
- **Unknown-only rule**: Far Cry must align with minimap **`?`** semantics (`minimapSpeciesKnown !== true`), not “any wild”.

### 5.2 Manual “Next Far Cry” vs reality

Early HUD picks used **stricter** filters than the minimap (distance caps, `dexId` finiteness, `spawnPhase` gates, `!undefined` bugs for unknown). Result: **`?` visible but “Sem alvo”**.

**Lesson:** any selector that feeds the HUD must be **provably the same predicate** as the minimap marker, or players correctly call it broken.

### 5.3 Audio “sometimes silent”

`playPokemonCry` could fire before `HAVE_CURRENT_DATA`. Browsers may reject `play()`; errors were swallowed.

**Lesson:** preload / warm path belongs in the cry pipeline (`playPokemonCryImpl` deferral), not in ad-hoc callers.

### 5.4 Volume & distance philosophy

- Cry was made **non-spatial** (no entity position on the spatial graph) so **distance doesn’t explode loudness**.
- Envelope lowered then **raised again** after feedback—tuning is a live knob.

### 5.5 One system, not two

Auto used different gates (cooldown, spawn phase) vs manual → felt like two games.

**Lesson:** `tryEmitFarCry` is the **single front door**. Timer and HUD are just **callers**.

### 5.6 Minimap two-layer unknowns

Problem: too many `?` at once.  
Solution: **hide** unknown markers until Far Cry introduces them; then normal `?` rules apply.

**Lesson:** “Culling” and “disclosure” are different UX tools—use the right one on purpose.

### 5.7 Queue that respects movement

Random pick ignored **spatial storytelling**.  
**Lesson:** sort by angle + prefer pending intros + rotate index → the world **reads** as you walk.

---

## 6. Constants (quick reference)

Defined in `far-cry-system.js` (names may drift—trust the file as source of truth):

| Constant / export | Role |
|---------------------|------|
| `FAR_CRY_GAP_BEFORE_1ST_SEC` | Seconds until first auto attempt (default `3`) |
| `FAR_CRY_GAP_AFTER_1ST_SEC` / `_2ND_` | Gaps before 2nd / 3rd cry (`15` / `20`) |
| `FAR_CRY_ALT_SHORT_SEC` / `FAR_CRY_ALT_LONG_SEC` | Repeating leg after 3rd success (`15` / `30`) |
| `FAR_CRY_CANDIDATE_POOL` | Max nearest unknowns considered (matches minimap spirit) |
| `FAR_CRY_WAVE_MAX_AGE_SEC` | Screen wave lifetime |
| `FAR_CRY_MINIMAP_ECHO_MAX_AGE_SEC` | Minimap echo lifetime |
| `farCryRevealTuning.newRevealBaseChanceWhenMarksOnMap` | Base factor when at least one `?` is already on the minimap (default `0.75`) |
| `farCryRevealTuning.perRevealedQuestionMarkMult` | Each existing `?` multiplies that chance by this factor (default `0.5`; tweak while playtesting) |

---

## 7. Reset & lifecycle

`resetFarCrySystem()` clears waves, echoes, **both Far Cry cycle indices** (pending / done), **`farCrySuccessCount`**, and resets the timer to the **3s** pre-first gap. Call when leaving play or regenerating the map so state doesn’t leak across sessions.

---

## 8. Possible extensions (not promises)

- **Trunk + canopy mask** for “dark read-through only on overlap pixels” under trees (GPU or shared draw pass).
- **Per-biome Far Cry rate** or weather coupling.
- **Telemetry**: log how often pool is empty vs successful fire (balance tuning).

---

## 9. Closing note

If this feature feels obvious in play, that’s the goal: **a small number of moving parts**, each justified by a player problem (discovery, direction, map noise, fairness between auto and manual). The implementation is allowed to be clever; the **experience** should feel inevitable.

— *Document version: written to capture intent and history for maintainers. Tweak the doc when behaviour changes.*
