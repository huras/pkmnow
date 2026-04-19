# Unity heightfield bridge — data contract (M1)

This describes files produced for **`PokemonOpenWild_v1`** (or any consumer) from the JS generator in [`js/generator.js`](../js/generator.js).

## Files

| File | Purpose |
|------|---------|
| `world.heightfield.json` | Metadata + paths (UTF-8 JSON) |
| `world.heights.f32` | Raw **float32**, **little-endian**, row-major |

## Grid and indexing (must match importer)

- `width`, `height`: macro grid size (today **256 × 256**).
- JS stores elevation in `cells` as `Float32Array` with index **`gy * width + gx`** where:
  - `gx` ∈ `[0, width)` → maps to **world +X**
  - `gy` ∈ `[0, height)` → maps to **world +Z** (Unity horizontal plane)
- Values are **normalized elevation in [0, 1]** (same as `generate().cells` after generator clamping).
- **`waterLevel`**: copied from `world.config.waterLevel` (fallback **0.21** if missing). Same 0–1 space as `cells`; sea/land threshold for gameplay/biomes — terrain mesh still uses full height range unless you mask in shader later.

## Raw binary (`world.heights.f32`)

- Length in bytes: `width * height * 4`.
- Order: for `gy` from `0` to `height-1`, for `gx` from `0` to `width-1`, emit `cells[gy * width + gx]` as IEEE-754 float32 LE.

## JSON schema (`world.heightfield.json`)

```json
{
  "schemaVersion": 1,
  "width": 256,
  "height": 256,
  "seed": 3735928559,
  "waterLevel": 0.21,
  "heightsEncoding": "float32le",
  "heightsFile": "world.heights.f32",
  "rowOrder": "ZMajor",
  "gridToWorld": {
    "originX": 0,
    "originZ": 0,
    "metersPerCell": 2,
    "terrainHeightMeters": 64
  }
}
```

- **`gridToWorld`**: defines how a grid corner maps to Unity world **XZ** and how normalized height maps to **Y**.
  - `originX`, `originZ`: world position of **grid corner** `(gx=0, gy=0)` (corner of cell (0,0); cell center is offset by half a cell if you need centers).
  - `metersPerCell`: world size of one macro cell along X and Z.
  - `terrainHeightMeters`: vertical size of the Unity terrain (`TerrainData.size.y`). Sample height in world units is **`normalized * terrainHeightMeters`** when terrain base Y is 0 and heights are stored normalized 0–1 in `TerrainData`.

## Unity conventions

- **Y is up.** Terrain lies in the **XZ** plane.
- **Corner alignment:** importer places terrain so that heightmap sample `(0,0)` sits at world `(originX, originZ)` and spans **`width * metersPerCell`** along **+X** and **`height * metersPerCell`** along **+Z**.
- **`TerrainData.SetHeights`:** Unity expects a 2D array indexed **`[xIndex, zIndex]`** where `xIndex` runs along world **X** and `zIndex` along world **Z**, both in **0..heightmapResolution-1**. Importer resamples **256 → 257** (next valid `2^n+1`) with bilinear upsampling when needed.

## Versioning

Bump **`schemaVersion`** if you change byte order, index order, or required fields.

## JS export command

From `experimento-gerador-regiao-pkmn`:

```bash
npm run export:unity-height
# optional: seed and output folder
node scripts/export-unity-heightfield.mjs demo unity-export/my-run
```

Copies into `PokemonOpenWild_v1/Assets/StreamingAssets/World` when that project exists at `H:/cursor/Unity Projects/PokemonOpenWild_v1`, or set **`UNITY_POKEMON_OPEN_WILD_ROOT`** to your Unity project root.
