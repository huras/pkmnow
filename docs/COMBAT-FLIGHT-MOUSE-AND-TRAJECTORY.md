# Combat: flight height, mouse aim, particles, colliders, Z-hits, and 3D trajectories

This document records design and implementation work from one development session: how play-mode combat behaves with **creative flight** (`player.z`), **mouse aim on the ground plane**, **visual/debug overlays**, **vertical hit alignment**, and **hypotenuse (3D) projectile paths** toward floor targets while respecting **horizontal max range**.

---

## 1. Projectiles and flying (initial behavior)

- **Hit tests** used only **X/Y** (`checkPlayerHit`, wild `checkCollision`): height `z` was ignored, so flying did not dodge low shots.
- **Projectile motion** updated only `proj.x` / `proj.y`; `proj.z` was set at spawn and stayed constant for most types.
- **`projIFrameSec`** still applied the same while flying.

Later we added **vertical alignment** for damage (section 6).

---

## 2. Trail particles “double” at shadow vs sprite while flying

**Symptom:** When shooting while flying, one effect appeared at the **shadow** and another at the **sprite**.

**Cause:** `drawBatchedProjectile` offsets draw position by `proj.z` (correct for the main bolt). **`spawnTrailParticle`** always used a tiny fixed `z` (~0.15–0.4 tiles), so trails drew near the **ground** while the body drew **high**.

**Fix (`js/moves/moves-manager.js`):**

- `spawnTrailParticle(px, py, trailType, baseZ = 0)` — trail `z` is `baseZ + 0.15 + random * 0.25`.
- Trail loop passes **`proj.z`**: `spawnTrailParticle(proj.x, proj.y, trailType, proj.z)`.

---

## 3. Mouse aim: ground under cursor + camera sync

**Symptoms:** Aim did not feel like “the tile under the mouse,” especially while flying.

**Causes:**

1. **`mousemove`** called `computePlayViewState()` on every move. That function **advances smoothed camera zoom** each call, while **`render()`** only advances it **once per frame** → inverse screen→world transform **desynced** from what was drawn.
2. **`mouseX || (player.x + 1)`** treated tile `0` as falsy.

**New module `js/render/play-camera-snapshot.js`:**

- After each play **`render()`**, `setPlayCameraSnapshot({ effTileW, effTileH, currentTransX, currentTransY, cw, ch })`.
- **`playScreenPixelsToWorldTileCoords(canvasW, canvasH, mousePxX, mousePxY, player)`** uses the snapshot when canvas size matches; otherwise falls back to one `computePlayViewState` call.
- **`clearPlayCameraSnapshot()`** on leaving play / map render.

**Wiring:**

- `js/render.js` — `setPlayCameraSnapshot` after `computePlayViewState` in play branch; `clearPlayCameraSnapshot` when `appMode === 'map'`.
- `js/main.js` — play `mousemove` uses `playScreenPixelsToWorldTileCoords`; `mouseValid = true` on move; `mouseValid = false` on canvas `mouseleave` / pointer leave; `clearPlayCameraSnapshot` on back to map; `mouseValid = false` on `enterPlayMode`.
- `js/main/play-input-state.js` — **`mouseValid`** flag.
- `js/main/play-mouse-combat.js` — **`aimAtCursor`**: if `!mouseValid`, default aim `(player.x+1, player.y)`; else target **tile center** `floor(mouseX)+0.5`, `floor(mouseY)+0.5`.
- `js/main/play-context-menu.js` — right-click world pick uses **`playScreenPixelsToWorldTileCoords`** for consistency with the rendered camera.

---

## 4. Hit / burst particles aligned with grid and impact height

**Goals:**

- Burst position **tile-centered** to match grid aim.
- **Height** of FX should match **who/what was hit** or **ground detonation**, not always `proj.z` (caster altitude), so air shots don’t pop explosions in the sky above ground targets.

**`spawnHitParticles(x, y, effectZ)` (`moves-manager.js`):**

- Snaps to **`floor(x)+0.5`, `floor(y)+0.5`**.
- Uses **`effectZ`** for burst vertical offset.

**`spawnIncinerateShards(proj, pushProjectileRef, effectZ)`:**

- Optional **`effectZ`**; shard origin **tile-centered**; `z` from `effectZ` (or `proj.z` if omitted).

**Call sites:**

- **TTL** (orb/core expires): `effectZ = 0`, **`applySplashToWild(proj, wildList, 0)`** so ground splashes still work.
- **Player hit:** `player.z`.
- **Wild hit:** `wild.z ?? 0`.

**`applySplashToWild(proj, wildList, splashZ?)`:**

- Third argument **`splashZ`**: when set (e.g. **`0`** on TTL), splash uses that height for **`zHitAligned`** vs each wild; default remains **`proj.z`** for direct hits.

---

## 5. Collider overlay: feet vs body while airborne

**Symptom:** Debug collider looked like it came only from **ground / feet**, not from the **flying sprite**.

**Cause:** Overlay drew a single circle at **`worldFeetFromPivotCell`** with no `z` lift.

**Fix (`js/render.js`):**

- **`airZ`** on player and wild **`renderItems`** (`player.z` / `we.z`).
- **`drawPlayEntityFootAndAirCollider`:** when `airZ > 0.02`, dashed **vertical axis** from ground feet to body height; faint ring at feet; **main** ring + marker at **`ft.y * tileH - airZ * tileH`** (same convention as sprites).
- **Logical cell** cyan debug: ground circle unchanged; if `player.z > 0.02`, dashed line to body + smaller ring at body height.

**Note:** This is **debug visualization** only. Gameplay collision was addressed separately (section 6).

---

## 6. Vertical hit alignment (no “shadow sniping” while high)

**Symptom:** At max flight, **shadow** near a wild Pokémon still caused **immediate hits** as if on the ground.

**Cause:** Damage was purely **2D** in X/Y; `player.x`/`player.y` stay on the grid while `player.z` lifts the sprite.

**Constants (`js/moves/move-constants.js`):**

- **`PROJECTILE_Z_HIT_TOLERANCE_TILES`** (default **1.35**) — about one body height; small jumps still interact; max flight does not line up with ground wilds.

**`moves-manager.js`:**

- **`zHitAligned(projZ, targetZ)`** — `|projZ - targetZ| <= tolerance`.
- **`checkPlayerHit`:** requires **`zHitAligned(proj.z, player.z ?? 0)`** (wild ground shots don’t tag a flyer far above without vertical overlap).
- **Wild loop:** **`zHitAligned(proj.z, wild.z ?? 0)`** before **`checkCollision`**.
- **`applySplashToWild`:** optional **`splashZ`** for explosion height (section 4).

---

## 7. Hypotenuse trajectories (3D line to ground aim)

**Goal:** Shots travel along the **hypotenuse** of the right triangle: vertical leg **`sourceEntity.z`**, horizontal leg from **`(sourceX, sourceY)`** to **clamped floor aim `(aimX, aimY)`**, target height **0** (floor under cursor). Still respect each move’s **horizontal max range** to the aim point.

**New module `js/moves/projectile-ground-hypot.js`:**

| Export | Role |
|--------|------|
| **`clampFloorAimToMaxRange(sx, sy, tx, ty, maxRangeTiles)`** | Clamps `(tx, ty)` to a max **horizontal** distance from `(sx, sy)`; returns `aimX`, `aimY`, `dirX`, `dirY`, `dist0`. |
| **`spawnAlongHypotTowardGround(sx, sy, sz, aimX, aimY, spawnTiles)`** | Spawn offset along the 3D segment toward `(aimX, aimY, 0)`. |
| **`velocityFromToGround(startX, startY, startZ, tx, ty, speed, opt?)`** | Unit vector in 3D toward `(tx, ty, 0)` × `speed` → **`vx`, `vy`, `vz`** and **`timeToLive`** from 3D path length ÷ speed. |

**Physics (`updateMoves` in `moves-manager.js`):**

- After `proj.x` / `proj.y`, if **`Number.isFinite(proj.vz)`**, then **`proj.z += proj.vz * dt`**.

**Updated move implementations:**

- `ember-move.js`, `water-burst-move.js`, `poison-sting-move.js`
- `zelda-ported-moves.js` (all ported casts + poison sting alias)
- **`castUltimate`** in `moves-manager.js` (ring shots use clamp + hypot toward ring targets on the floor)

**Ember spread:** Random floor offsets are **re-clamped** with `clampFloorAimToMaxRange` so spread cannot exceed max horizontal range from the source.

**Left unchanged on purpose:**

- **Incinerate shards** — still mostly **2D** burst debris with fixed / impact `z`.
- **Horizontal max range** — still defined in **XY**; 3D path length only affects **speed along the ray** and **TTL**.

---

## 8. File index (quick reference)

| Area | Files |
|------|--------|
| Camera snapshot / picking | `js/render/play-camera-snapshot.js`, `js/render.js`, `js/main.js`, `js/main/play-input-state.js`, `js/main/play-mouse-combat.js`, `js/main/play-context-menu.js` |
| Trail `z` | `js/moves/moves-manager.js` |
| Hit particles / splash / shards | `js/moves/moves-manager.js` |
| Collider overlay + `airZ` | `js/render.js` |
| Z tolerance constant | `js/moves/move-constants.js` |
| Z hit tests + `proj.vz` integration | `js/moves/moves-manager.js` |
| Hypot helpers + casts | `js/moves/projectile-ground-hypot.js`, `ember-move.js`, `water-burst-move.js`, `poison-sting-move.js`, `zelda-ported-moves.js`, `moves-manager.js` (`castUltimate`) |

---

## 9. Tuning knobs

- **`PROJECTILE_Z_HIT_TOLERANCE_TILES`** — stricter or looser vertical “reach” for hits.
- **`velocityFromToGround` … `ttlMargin` / `ttlPad`** per move — lifetime vs path length.
- **`PROJECTILE_Z_HIT_TOLERANCE_TILES`** vs **`spawnTrailParticle`** vertical jitter — keep trails readable without detaching from the bolt.

If you add new projectile types, reuse **`clampFloorAimToMaxRange` + `spawnAlongHypotTowardGround` + `velocityFromToGround`** (or document why they stay 2D), set **`vz`** when using 3D motion, and align **FX `effectZ`** with the same rules as existing `spawnHitParticles` / splash calls.
