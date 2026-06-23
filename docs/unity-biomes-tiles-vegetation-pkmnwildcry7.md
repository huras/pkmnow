# PkmnWildCry7: biomes, which tiles they use, vegetation

Short map of how the Unity 6 project ties **noise → biome → visuals → props** (see also [`unity-streamingassets-world-json.md`](./unity-streamingassets-world-json.md)).

## Biomes (data)

1. **`TerrainChunkGenerator`** samples elevation / temperature / moisture / anomaly (FBM Perlin via `MacroNoiseSampler`).
2. **Classifier (default: web parity)**  
   When **`TerrainGenerationSettings.useWebParityBiomeClassification`** is true (default in `TerrainGenerationSettings.Default` and in **`StreamingAssets/world.json`** unless you set **`legacyBiomeScoring`: true**):
   - **`BiomeClassifierWeb`** mirrors **`getBiome`** + **`getBiomeWithAnomalies`** from [`js/biomes.js`](../../js/biomes.js) (Whittaker table, `waterLevel` + `BEACH_ELEVATION_BAND`, anomaly branches for Volcano / Ghost Woods / Flower Fields / Arcane). Returns **web biome ids** 0–20.
   - If **`TerrainBiomeTextureSet`** is assigned (e.g. **GreenyPlains**), **`BiomeWebToGreenyPlains.TextureSliceIndex`** maps that id to the **slice index** in the asset (so shaders still use the same texture arrays).
   - **`webWaterLevel`**, **`webDesertMoisture`**, **`webForestMoisture`** match JS `waterLevel` / `desertMoisture` / `forestMoisture`. With parity on, **`HeightStepQuantizer`** gameplay water line uses **`webWaterLevel`** via **`BiomeClassifierWeb.EffectiveWaterLevelForHeight`**.
3. **Legacy (opt-out)**  
   Set **`useWebParityBiomeClassification`** false or JSON **`legacyBiomeScoring`: true**:
   - With a biome texture set: old **rule-box scoring** on the asset.
   - Without: **`BiomeClassifier`** (6-type enum).

`SampleScene` uses **GreenyPlains**, so indices match that asset’s list (0 = Ocean, 1 = Beach, then Peak, Mountain, Tundra, Taiga, … — exact order is in `Assets/Materials/GreenyPlains.asset`).

## Tiles / terrain shading (3D discrete path)

`SampleScene` drives **`ChunkStreamManager`**, which calls **`WorldTerrainOrchestrator.RebuildDiscreteStepMesh`**.

- **`TerrainDiscreteStepMeshBuilder`** builds an **XZ** stepped mesh; **Y** is height. **UV1.x** stores the **biome index** as a float for the **URP biome terrain shader** (`PokemonOpenWild/URP Biome Terrain Lit` or Unlit).
- **`TerrainBiomeTextureSet`** (optional) builds **texture arrays** from each entry’s **surface/cliff** sprites and pushes them into the chunk material (`ApplyToMaterial`).
- **`StreamingAssets/world-visuals.json`** (optional, preferred for data-driven art): **`ChunkStreamManager`** loads **PNG paths** under StreamingAssets, builds the same **surface/cliff `Texture2DArray`**, and applies them to the chunk material. Keep **17 slices** in the same order as **`BiomeWebToGreenyPlains`** (0 = Ocean … 16 = Arcane). Use **`textureFallback`** (e.g. `Terrain/default.png`) so missing per-biome PNGs resolve without log spam; the checked-in placeholder is a small green 16×16 tile.

So: **biome index → shader samples the matching slice** in the surface/cliff arrays. No per-cell sprite tilemap on this path.

## Tiles (2D Tilemap path — optional)

If `layerStack` + **`TerrainVisualSet`** are wired, **`TerrainRoleResolver`** chooses a **TerrainRole** (13-style neighbourhood mask) and **`TerrainVisualSet.GetSprite(role)`** picks the sprite.

The checked-in **`TerrainVisualSet.asset`** had **empty entries**; the 3D streamer path does not use it. To use tilemaps you must fill `TerrainVisualSet` entries or generate them in code.

## Vegetation (what was added)

- **`world-visuals.json` → `vegetation`**: pools keyed by **`biomeWebIds`** (same integers as **`BiomeClassifierWeb.WebId`** / `js/biomes.js`). Each pool lists **`cellIndices`** into a tileset PNG (`tileset`, **`gridCellSize`**). **`cellIndexLayout`**: `0` = row-major like [`drawTerrainCellFromSheet`](../../js/render/conc-conv-a-terrain-blit.js) (`col = id % sheetCols`, `row = id / sheetCols` from top-left); `1` = column-major (`row = id % rows`, `col = id / rows`). Tiles per row are inferred from texture width ÷ `gridCellSize` (optional **`sheetTilesPerRow`** must match or Unity logs a warning). Legacy **`columns`** is still read when `sheetTilesPerRow` is 0. **`WorldVisualsRuntime`** registers this at runtime; no `Resources` import required for props.
- **`VegetationChunkScatter`**: after each chunk mesh build, spawns up to **N** child objects under a `Vegetation` folder: **SpriteRenderer + `BillboardYOnly`**, on land cells (`HeightStep >= 1`), skipping **web ids Ocean + Beach** when using JSON vegetation, else **biome indices ≤ 1** (Resources fallback), with **Perlin** density and a **checker** `(wx+wy)%2` to thin instances.
- **`ChunkStreamManager`**: **`enableVegetationScatter`** (default on) and **`maxVegetationInstancesPerChunk`**. Uses **`RebuildDiscreteStepMesh(..., copyCellsOut)`** so scatter reuses the same `TerrainChunkCellData[]` as the mesh (including **`WebBiomeId`** for JSON pools).

Fallback (no `vegetation` block or no `world-visuals.json`): **`NatureSpriteProvider`** — `Resources.LoadAll<Sprite>("WorldGen/NatureSheet")` — art at **`Assets/Resources/WorldGen/NatureSheet.png`**.

## Parity vs web `js/`

| Web | Unity (this project) |
|-----|----------------------|
| `getBiomeWithAnomalies` + long `BIOMES` table | GreenyPlains **rule list** + optional legacy `BiomeClassifier` |
| `TERRAIN_SETS` / autotile roles | 3D: **shader arrays**; 2D: `TerrainVisualSet` roles |
| `play-chunk-bake` scatter | `VegetationChunkScatter` on discrete chunks |

Noise and seeds are **not** identical to the browser project; tuning is via **`StreamingAssets/world.json`** and `TerrainGenerationProfile` / GreenyPlains ranges.
