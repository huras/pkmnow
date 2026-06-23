# Unity (PkmnWildCry7): `StreamingAssets/world.json`

This documents the **AI-first / data-driven** world config loaded at play time by `WorldTerrainOrchestrator` in the Unity 6 project **PkmnWildCry7**. It mirrors the *intent* of tuning `DEFAULT_CONFIG` + biome thresholds in the web repo (`js/generator.js`, `js/biomes.js`), but uses **Unity’s FBM Perlin** pipeline (`TerrainGenerationSettings`) — maps are **not** byte-identical to the JS Mulberry32 + value-noise world.

**See also:** [biomes, terrain tiles, vegetation](./unity-biomes-tiles-vegetation-pkmnwildcry7.md).

## Layout

| Path (Unity) | Role |
|--------------|------|
| `Assets/StreamingAssets/world.json` | Active config (committed in template so Play works immediately; you may gitignore locally). |
| `Assets/StreamingAssets/world.example.json` | Same shape, safe reference / copy source. |
| `Assets/StreamingAssets/README.txt` | Copy workflow + WebGL note. |

## Runtime behavior

- **`WorldTerrainOrchestrator`** (`Assets/Scripts/v2/WorldTerrainOrchestrator.cs`):
  - If **Load Config From Streaming Assets** is enabled (default), it reads `streamingConfigRelativePath` (default `world.json`) via `StreamingAssetsText.LoadSync`.
  - On **missing / empty file**: one-line **warning** + fallback = `TerrainGenerationProfile` settings if assigned, else `TerrainGenerationSettings.GameplayMapDefault`.
  - On **invalid JSON**: **error** + same fallback.
  - If **Load Config From Streaming Assets** is disabled: behavior matches the pre-bootstrap project — `TerrainGenerationProfile` if set, else `TerrainGenerationSettings.Default` (not `GameplayMapDefault`).
- **`StreamingAssetsText`** (`Assets/Scripts/v2/00_Bootstrap/StreamingAssetsText.cs`): Editor / standalone use `File.ReadAllText`. **WebGL**: `LoadSync` is not supported; use `LoadAsync` or disable StreamingAssets load and use a profile asset.
- **`ApplyRuntimeConfigFromJson(string)`**: rebuilds the chunk generator from a full JSON string (tools / hot reload).

## JSON root (`WorldConfigJson`)

| Field | Type | Notes |
|-------|------|--------|
| `worldSeed` | int | Passed to noise / chunk fill. |
| `chunkWidth`, `chunkHeight` | int | Chunk size; if `<= 0` after parse, clamped to 32. |
| `maxLandHeightStep` | int | Generator cap; if `<= 0`, clamped to 6. |
| `tilemapWriteOffset` | `{ "x","y","z" }` | Optional; if omitted/null, previous inspector value kept when not loading from JSON (when loading JSON, object should be present for deterministic apply). |
| `rebuildOnStart` | bool | |
| `startChunkOrigin` | `{ "x","y" }` | |
| `generation` | object | See below. If **omitted** or null: fallback generation = profile or `GameplayMapDefault`. |

**JsonUtility caveat:** If `generation` is present but **incomplete**, missing fields deserialize as **0 / false** and can break noise (e.g. `elevationFrequency == 0`). Prefer either a **full** `generation` block (copy `world.example.json`) or omit `generation` entirely to use fallback.

## JSON `generation` (`WorldGenSettingsJson`)

Maps 1:1 to `TerrainGenerationSettings` in `Assets/Scripts/v2/05_ChunkGeneration/TerrainGenerationSettings.cs`:

- **`legacyBiomeScoring`**: if **true**, disables web-parity rules and uses old `TerrainBiomeTextureSet` scoring (or `BiomeClassifier`). Omitted / **false** keeps **`getBiome`-style** rules from [`js/biomes.js`](../../js/biomes.js).
- **`webWaterLevel`**, **`webDesertMoisture`**, **`webForestMoisture`**: same roles as `waterLevel` / `desertMoisture` / `forestMoisture` in the web project (defaults **0.21**, **0.33**, **0.66**).
- `coordinateScale`, `elevationFrequency`, `elevationDomainOffset` `{x,y}`, `temperatureFrequency`, `temperatureDomainOffset`, `moistureFrequency`, `moistureDomainOffset`, `anomalyFrequency`, `anomalyDomainOffset`
- `fbmOctave2FrequencyMultiplier`, `fbmOctaveJitter`, `fbmOctave0Weight`, `fbmOctave1Weight`
- Biome / height thresholds: `oceanElevationBelow`, `beachElevationBelow`, `anomalyNoiseAbove`, `snowTemperatureBelow`, `snowElevationAbove`, `highlandsElevationAbove`, `heightOceanBelowElevation`, `heightLandStartElevation`, `landCurvePower`
- Gameplay steps: `useGameplayStepModel`, `landSteps`, `waterSteps`, `landStepCurveExponent`, `beachElevationBand`, `secondaryHeightPassEnabled`, `secondaryHeightNoiseScale`, `secondaryHeightDownThreshold`, `secondaryHeightUpThreshold`

After load, `ClampForInspector()` runs on the struct (same as the inspector path).

## Parity vs web repo (conceptual)

| Web (`js`) | Unity |
|------------|--------|
| `waterLevel`, `BEACH_ELEVATION_BAND`, Whittaker + anomalies | `oceanElevationBelow`, `beachElevationBelow`, `TerrainChunkGenerator` / `BiomeClassifier` / optional `TerrainBiomeTextureSet` |
| `MACRO_TILE_STRIDE`, micro sampling | Chunk streaming / per-cell sampling in `TerrainChunkGenerator` (different stride constants) |
| Deterministic Mulberry32 + value noise FBM | Perlin FBM + domain offsets in `MacroNoiseSampler` |

Tuning **feel**: edit JSON and hit Play — no need to touch `TerrainGenerationProfile` assets for numeric experiments.

## Example file in this repo

See [`examples/pkmnwildcry7-world.example.json`](./examples/pkmnwildcry7-world.example.json) (duplicate of the Unity `world.example.json` for prompts and docs).
