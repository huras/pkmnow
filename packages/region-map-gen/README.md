# region-map-gen

Pure **ESM** procedural generator for a macro **256×256** region: FBM height/temperature/moisture, biome classification, roads (A* between cities), city layouts, and landmarks. No browser APIs — safe in Node or any bundler.

## Install

**From npm** (after you publish this package):

```bash
npm install region-map-gen
```

**From this monorepo** (workspace):

```json
"dependencies": {
  "region-map-gen": "workspace:*"
}
```

Then run `npm install` at the repo root.

## Usage

```js
import { generate, DEFAULT_CONFIG, normalizeSeed } from 'region-map-gen';

const seed = normalizeSeed('my world name');
const world = generate(seed, { ...DEFAULT_CONFIG, cityCount: 18 });

console.log(world.width, world.height); // 256 256
// world.cells — Float32Array elevation 0..1
// world.biomes — Uint8Array biome ids
// world.graph, world.paths, world.cityData, world.landmarks, …
```

For **tree-shaking** or deep imports, use the `exports` subpaths (same as this repo’s `js/*.js` shims):

```js
import { MACRO_TILE_STRIDE, getMicroTile } from 'region-map-gen/chunking.js';
import { BIOMES, getBiome } from 'region-map-gen/biomes.js';
import { createRng, stringToSeed } from 'region-map-gen/rng.js';
```

## API surface

| Export | Module |
|--------|--------|
| `generate`, `DEFAULT_CONFIG`, `normalizeSeed` | `generator.js` |
| `createRng`, `stringToSeed` | `rng.js` |
| `MACRO_TILE_STRIDE`, `getMicroTile`, … | `chunking.js` |
| `BIOMES`, `getBiome`, `getBiomeWithAnomalies`, … | `biomes.js` |
| Autotile / noise helpers | `tessellation-logic.js` |
| `getLandStepCurveExponent`, `setLandStepCurveExponent` | `land-step-curve.js` |
| `PluginRegistry` | `core/plugin-registry.js` |

Semantics of the returned `world` object are described in the parent repo: [`docs/geracao-terreno-2d-ruido-para-sprites.md`](../../docs/geracao-terreno-2d-ruido-para-sprites.md).

## Scripts

```bash
npm run smoke
```

Runs a quick `generate()` sanity check.

From monorepo root:

```bash
npm run smoke:region-map-gen
```

## Publish checklist

1. Set `"repository"` in `package.json` to your real Git URL (optional but recommended).
2. Bump `"version"` (semver).
3. `npm publish` from **this directory** (`packages/region-map-gen`). For a scoped public name, use `npm publish --access public`.
4. Confirm `"files"` includes everything you need (`src`, `README.md`, `scripts`).

## Consumers without workspaces

```bash
npm install file:../path/to/experimento-gerador-regiao-pkmn/packages/region-map-gen
```

Or depend on a **Git subdirectory** (npm supports `git+...` with `path` in newer npm — check npm docs for your version).

## Static / Newgrounds builds

If you copy `js/` into a flat bundle **without** `node_modules`, resolve `region-map-gen` with your bundler or vendor the `packages/region-map-gen/src` files into the bundle. The main game in this repo uses workspace `node_modules` so `import 'region-map-gen/...'` resolves at dev time.
