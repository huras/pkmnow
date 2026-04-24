import { BIOMES } from '../biomes.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_TO_FOLIAGE,
  BIOME_VEGETATION,
  GRASS_TILES,
  TREE_TILES,
  getGrassVariant,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  SCATTER_NOISE_SEED_OFFSET,
  SCATTER_NOISE_SCALE,
  SCATTER_NOISE_THRESHOLD
} from '../biome-tiles.js';
import { MACRO_TILE_STRIDE, getMicroTile, foliageDensity, foliageType } from '../chunking.js';
import { TERRAIN_SETS, OBJECT_SETS } from '../tessellation-data.js';
import {
  getRoleForCell,
  parseShape,
  proceduralEntityIdHex,
  PROC_SALT_GRASS_CELL,
  PROC_SALT_GRASS_LAYER_TOP,
  PROC_SALT_SCATTER_CELL,
  PROC_SALT_SCATTER_INSTANCE,
  PROC_SALT_FORMAL_TREE_CELL,
  PROC_SALT_ROCK,
  PROC_SALT_CRYSTAL
} from '../tessellation-logic.js';
import { resolveScatterVegetationItemKey } from '../vegetation-channels.js';
import {
  analyzeScatterPass2Base,
  validScatterOriginMicro,
  grassSuppressedByScatterFootprint,
  scatterItemKeyIsTree
} from '../scatter-pass2-debug.js';
import {
  getTerrainSetWalkKind,
  isBaseTerrainSpriteWalkable,
  getFoliageOverlayTileId,
  getLakeLotusFoliageWalkRole,
  isPurpleLakePoolWalkBlockingRole,
  FOLIAGE_POOL_OVERLAY_UNWALKABLE_TILE_IDS,
  didFormalTreeSpawnAtRoot
} from '../walkability.js';
import { canWalk } from '../player.js';
import { computeTerrainRoleAndSprite, roleNameForSpriteIdInSet, TILE_DEBUG_DIRS_3X3 } from './terrain-role-helpers.js';
import { getObjectTileFlags } from './object-tile-flags.js';


export function buildPlayModeTileDebugInfo(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  const biome = Object.values(BIOMES).find((b) => b.id === tile.biomeId);

  const seed = data.seed;
  const fdTrees = foliageDensity(mx, my, seed + 5555, TREE_NOISE_SCALE);
  const fdScatter = foliageDensity(mx, my, seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE);
  const fdGrass = foliageDensity(mx, my, seed, 3);
  const ft = foliageType(mx, my, seed);
  const foliageOverlayIdDbg = getFoliageOverlayTileId(mx, my, data);
  const lakeLotusWalkRoleDbg = getLakeLotusFoliageWalkRole(mx, my, data);

  const surroundings = {
    heightStep: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ],
    biome: [
      ['', '', ''],
      ['', '', ''],
      ['', '', '']
    ],
    formals: [
      [false, false, false],
      [false, false, false],
      [false, false, false]
    ],
    scatter: [
      [false, false, false],
      [false, false, false],
      [false, false, false]
    ]
  };

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = mx + dx;
      const ny = my + dy;
      const t = getMicroTile(nx, ny, data) || { heightStep: 0, biomeId: 0 };
      const bEnv = Object.values(BIOMES).find((b) => b.id === t.biomeId);
      const fTrees = foliageDensity(nx, ny, seed + 5555, TREE_NOISE_SCALE);
      const fScat = foliageDensity(nx, ny, seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE);
      const treeType = getTreeType(t.biomeId, nx, ny, seed);

      surroundings.heightStep[dy + 1][dx + 1] = t.heightStep;
      surroundings.biome[dy + 1][dx + 1] = bEnv ? bEnv.name : '???';
      surroundings.formals[dy + 1][dx + 1] = !!treeType && (nx + ny) % 3 === 0 && fTrees >= TREE_DENSITY_THRESHOLD;
      surroundings.scatter[dy + 1][dx + 1] = fScat > SCATTER_NOISE_THRESHOLD;
    }
  }

  const gx = Math.floor(mx / MACRO_TILE_STRIDE);
  const gy = Math.floor(my / MACRO_TILE_STRIDE);
  let macroIdx = -1;
  const isMacroValid = gx >= 0 && gx < data.width && gy >= 0 && gy < data.height;
  if (isMacroValid) macroIdx = gy * data.width + gx;

  const baseAt = computeTerrainRoleAndSprite(mx, my, data, tile.heightStep);
  const centerSpriteId = baseAt.spriteId;

  const debugLayers = [];
  if (baseAt.set && centerSpriteId != null) {
    debugLayers.push({
      layer: 'base',
      terrainSetName: baseAt.setName,
      tileIndex: centerSpriteId,
      role: baseAt.role,
      terrainRole: `${baseAt.setName} / ${baseAt.role ?? '—'}`
    });
  }
  if (foliageOverlayIdDbg != null) {
    const fName = BIOME_TO_FOLIAGE[tile.biomeId];
    const fSet = fName ? TERRAIN_SETS[fName] : null;
    const fRole = fSet ? roleNameForSpriteIdInSet(fSet, foliageOverlayIdDbg) : '—';
    debugLayers.push({
      layer: 'foliage',
      terrainSetName: fName || '—',
      tileIndex: foliageOverlayIdDbg,
      role: fRole,
      terrainRole: fName ? `${fName} / ${fRole}` : '—'
    });
  }

  const heightLevels3x3 = TILE_DEBUG_DIRS_3X3.map(({ dx, dy, label }) => {
    const nx = mx + dx;
    const ny = my + dy;
    const t = getMicroTile(nx, ny, data) || { heightStep: 0, biomeId: 0 };
    const bN = Object.values(BIOMES).find((b) => b.id === t.biomeId);
    return { label, nx, ny, h: t.heightStep, biome: bN?.name ?? '—' };
  });

  const neighborsDetail = TILE_DEBUG_DIRS_3X3.map(({ dx, dy, label }) => {
    const nx = mx + dx;
    const ny = my + dy;
    const t = getMicroTile(nx, ny, data);
    if (!t) {
      return {
        label,
        nx,
        ny,
        elev: null,
        biome: '—',
        role: '—',
        tileInfo: '—',
        terrainSetName: null,
        spriteId: null
      };
    }
    const bN = Object.values(BIOMES).find((b) => b.id === t.biomeId);
    const nb = computeTerrainRoleAndSprite(nx, ny, data, t.heightStep);
    const tileInfo =
      nb.set && nb.spriteId != null ? `ID ${nb.spriteId} → ${nb.setName} / ${nb.role ?? '—'}` : '—';
    return {
      label,
      nx,
      ny,
      elev: t.heightStep,
      biome: bN?.name ?? '—',
      role: nb.role ?? '—',
      tileInfo,
      terrainSetName: nb.setName,
      spriteId: nb.spriteId
    };
  });

  const cellDebug = {
    elevation: tile.heightStep,
    biome: biome?.name ?? '—',
    expectedRole: baseAt.role ?? (tile.heightStep < 1 ? 'base' : null),
    baseTerrainSetName: baseAt.setName
  };

  const telemetry = {
    tx: mx,
    ty: my,
    cell: {
      elevation: cellDebug.elevation,
      biome: cellDebug.biome,
      expectedRole: cellDebug.expectedRole
    },
    layers: debugLayers.map((L) => ({
      layer: L.layer,
      terrainSetName: L.terrainSetName,
      tileIndex: L.tileIndex,
      role: L.role,
      terrainRole: L.terrainRole
    })),
    heightLevels3x3,
    neighbors: neighborsDetail.map((n) => ({
      label: n.label,
      nx: n.nx,
      ny: n.ny,
      elev: n.elev,
      biome: n.biome,
      role: n.role,
      tileInfo: n.tileInfo
    }))
  };

  const scatterPass2 = analyzeScatterPass2Base(mx, my, data);

  const {
    activeSprites,
    scatterContinuation,
    suppressGrassLikeRender,
    isFormalOccupied,
    occupiedByScatter
  } = (() => {
    const sprites = [];
    let scatterContinuation = null;
    const treeType = getTreeType(tile.biomeId, mx, my, seed);
    const isFormalTree = !!treeType && (mx + my) % 3 === 0 && fdTrees >= TREE_DENSITY_THRESHOLD;
    const isFormalNeighbor =
      !!treeType && (mx + my) % 3 === 1 && foliageDensity(mx - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
    const isFormalOccupied = isFormalTree || isFormalNeighbor;

    if (isFormalTree) {
      const ids = TREE_TILES[treeType];
      if (ids) sprites.push({ type: 'formal-tree-base', ids: ids.base }, { type: 'formal-tree-top', ids: ids.top });
    }

    let occupiedByScatter = false;
    const scatterItems = BIOME_VEGETATION[tile.biomeId] || [];
    const microWDbg = data.width * MACRO_TILE_STRIDE;
    const microHDbg = data.height * MACRO_TILE_STRIDE;
    const getTdbg = (tx, ty) => getMicroTile(tx, ty, data);
    const validOriginMemoDbg = new Map();
    if (!tile.isRoad && !tile.isCity) {
      const maxScatterRowsDbg = 8;
      outerCont: for (let dox = 1; dox <= 3; dox++) {
        const ox = mx - dox;
        for (let oyDelta = 0; oyDelta < maxScatterRowsDbg; oyDelta++) {
          const oy = my - oyDelta;
          if (oy < 0 || oy >= microHDbg) break;
          const nTile = getMicroTile(ox, oy, data);
          if (
            nTile &&
            foliageDensity(ox, oy, seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE) > SCATTER_NOISE_THRESHOLD &&
            !nTile.isRoad &&
            validScatterOriginMicro(ox, oy, seed, microWDbg, microHDbg, getTdbg, validOriginMemoDbg)
          ) {
            if ((BIOME_VEGETATION[nTile.biomeId] || []).length === 0) continue;
            const nItemKey = resolveScatterVegetationItemKey(ox, oy, nTile, seed);
            if (!nItemKey) continue;
            const nObjSet = OBJECT_SETS[nItemKey];
            if (nObjSet) {
              const { rows, cols } = parseShape(nObjSet.shape);
              const doy = my - oy;
              if (dox < cols && doy >= 0 && doy < rows) {
                occupiedByScatter = true;
                const base = nObjSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
                const top = nObjSet.parts.find((p) => p.role === 'top' || p.role === 'tops');
                scatterContinuation = {
                  originMicro: { mx: ox, my: oy },
                  columnIndexFromOrigin: dox,
                  rowIndexFromOrigin: doy,
                  itemKey: nItemKey,
                  shape: nObjSet.shape,
                  baseIds: base?.ids ?? null,
                  topIds: top?.ids ?? null
                };
                break outerCont;
              }
            }
          }
        }
      }

      if (
        scatterItems.length > 0 &&
        !isFormalOccupied &&
        !occupiedByScatter &&
        fdScatter > SCATTER_NOISE_THRESHOLD &&
        validScatterOriginMicro(mx, my, seed, microWDbg, microHDbg, getTdbg, validOriginMemoDbg)
      ) {
        const itemKey = resolveScatterVegetationItemKey(mx, my, tile, seed);
        const objSet = itemKey ? OBJECT_SETS[itemKey] : null;
        if (objSet) {
          const { cols } = parseShape(objSet.shape);
          const treeTypeChk = getTreeType(tile.biomeId, mx, my, seed);
          const formalAt = (txc, tyc) =>
            (!!treeTypeChk &&
              (txc + tyc) % 3 === 0 &&
              foliageDensity(txc, tyc, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) ||
            (!!treeTypeChk &&
              (txc + tyc) % 3 === 1 &&
              foliageDensity(txc - 1, tyc, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD);
          const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
          let anyLeftCol = false;
          if (base?.ids?.length) {
            for (let idx = 0; idx < base.ids.length; idx++) {
              if (idx % cols !== 0) continue;
              const tyc = my + Math.floor(idx / cols);
              if (!formalAt(mx, tyc)) anyLeftCol = true;
            }
          }
          if (anyLeftCol) {
            const top = objSet.parts.find((p) => p.role === 'top' || p.role === 'tops');
            if (base) sprites.push({ type: `scatter-${itemKey}-base`, ids: base.ids });
            if (top) sprites.push({ type: `scatter-${itemKey}-top`, ids: top.ids });
            occupiedByScatter = true;
          }
        }
      }
    }

    const suppressGrassLikeRender =
      grassSuppressedByScatterFootprint(mx, my, data, validOriginMemoDbg) ||
      (scatterItems.length > 0 &&
        !tile.isRoad &&
        !tile.isCity &&
        !isFormalOccupied &&
        foliageDensity(mx, my, seed + SCATTER_NOISE_SEED_OFFSET, SCATTER_NOISE_SCALE) > SCATTER_NOISE_THRESHOLD);

    if (!isFormalOccupied && !occupiedByScatter && fdGrass >= 0.45 && !suppressGrassLikeRender) {
      const variant = getGrassVariant(tile.biomeId);
      const tiles = GRASS_TILES[variant];
      if (tiles) {
        const mainId =
          variant === 'desert'
            ? tiles.original
            : variant === 'lotus'
              ? ft < 0.5
                ? tiles.original
                : tiles.grass2 ?? tiles.original
              : ft < 0.5
                ? tiles.original
                : tiles.grass2 || tiles.original;
        sprites.push({ type: `grass-${variant}-base`, ids: [mainId] });
        if (variant !== 'desert' && variant !== 'lotus' && tiles.originalTop && ft < 0.5) {
          sprites.push({ type: `grass-${variant}-top`, ids: [tiles.originalTop] });
        }
      }
    }
    return { activeSprites: sprites, scatterContinuation, suppressGrassLikeRender, isFormalOccupied, occupiedByScatter };
  })();

  const scatterItemKeyHere =
    (scatterPass2.pass2B.drawsHere && scatterPass2.pass2B.itemKey) ||
    (scatterPass2.pass2C.drawsHere && scatterPass2.pass2C.match?.itemKey) ||
    scatterContinuation?.itemKey ||
    null;

  const scatterRootMicro =
    scatterContinuation?.originMicro ??
    scatterPass2.pass2C.match?.originMicro ??
    (scatterPass2.pass2B.drawsHere ? { mx, my } : null);

  const playDetailHighlight = (() => {
    if (didFormalTreeSpawnAtRoot(mx, my, data)) {
      return {
        kind: 'formal-tree',
        rootX: mx,
        my,
        idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_FORMAL_TREE_CELL)
      };
    }
    if (didFormalTreeSpawnAtRoot(mx - 1, my, data)) {
      return {
        kind: 'formal-tree',
        rootX: mx - 1,
        my,
        idHex: proceduralEntityIdHex(seed, mx - 1, my, PROC_SALT_FORMAL_TREE_CELL)
      };
    }
    if (scatterPass2.pass2ScatterBaseWouldDrawHere && scatterItemKeyHere && scatterRootMicro) {
      const idHex = proceduralEntityIdHex(seed, scatterRootMicro.mx, scatterRootMicro.my, PROC_SALT_SCATTER_INSTANCE);
      if (scatterItemKeyIsTree(scatterItemKeyHere)) {
        return {
          kind: 'scatter-tree',
          ox0: scatterRootMicro.mx,
          oy0: scatterRootMicro.my,
          itemKey: scatterItemKeyHere,
          idHex
        };
      }
      const objSetH = OBJECT_SETS[scatterItemKeyHere];
      const shapeH = objSetH ? parseShape(objSetH.shape) : { rows: 1, cols: 1 };
      return {
        kind: 'scatter-solid',
        ox0: scatterRootMicro.mx,
        oy0: scatterRootMicro.my,
        itemKey: scatterItemKeyHere,
        rows: shapeH.rows,
        cols: shapeH.cols,
        idHex
      };
    }
    if (!isFormalOccupied && !occupiedByScatter && fdGrass >= 0.45 && !suppressGrassLikeRender) {
      const variant = getGrassVariant(tile.biomeId);
      const tiles = GRASS_TILES[variant];
      if (tiles) {
        return {
          kind: 'grass',
          mx,
          my,
          variant,
          idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_GRASS_CELL)
        };
      }
    }
    return null;
  })();

  const detailInstances = activeSprites.map((s) => {
    const t = s.type;
    if (t === 'formal-tree-base' || t === 'formal-tree-top') {
      return {
        type: t,
        idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_FORMAL_TREE_CELL)
      };
    }
    if (t.startsWith('scatter-') && scatterRootMicro) {
      return {
        type: t,
        idHex: proceduralEntityIdHex(seed, scatterRootMicro.mx, scatterRootMicro.my, PROC_SALT_SCATTER_INSTANCE)
      };
    }
    if (t.includes('grass-') && t.endsWith('-base')) {
      return { type: t, idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_GRASS_CELL) };
    }
    if (t.includes('grass-') && t.endsWith('-top')) {
      return { type: t, idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_GRASS_LAYER_TOP) };
    }
    return { type: t, idHex: null };
  });

  const overlayDebugLayers = activeSprites.flatMap((s) =>
    (s.ids || []).map((id) => ({
      layer: 'overlay',
      terrainSetName: null,
      sourceSheet: 'nature',
      tileIndex: id,
      role: s.type,
      terrainRole: `${s.type} / sprite`
    }))
  );
  const allDebugLayers = [...debugLayers, ...overlayDebugLayers];
  telemetry.layers = allDebugLayers.map((L) => ({
    layer: L.layer,
    terrainSetName: L.terrainSetName,
    sourceSheet: L.sourceSheet,
    tileIndex: L.tileIndex,
    role: L.role,
    terrainRole: L.terrainRole
  }));

  const nearbyFormalTrees = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = mx + dx;
      const ny = my + dy;
      const t = getMicroTile(nx, ny, data);
      if (!t) continue;
      const tt = getTreeType(t.biomeId, nx, ny, seed);
      const nNoise = foliageDensity(nx, ny, seed + 5555, TREE_NOISE_SCALE);
      const phaseRoot = !!tt && (nx + ny) % 3 === 0 && nNoise >= TREE_DENSITY_THRESHOLD;
      if (!phaseRoot) continue;
      const blockers = [];
      if (t.heightStep < 1 || t.isRoad || t.isCity) {
        blockers.push('altura/estrada/cidade');
      } else {
        const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[t.biomeId] || 'grass'];
        if (setForRole) {
          const checkAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= t.heightStep;
          const role = getRoleForCell(ny, nx, data.height * MACRO_TILE_STRIDE, data.width * MACRO_TILE_STRIDE, checkAtOrAbove, setForRole.type);
          if (role !== 'CENTER') blockers.push(`papel_terreno=${role}`);
        }
        const right = getMicroTile(nx + 1, ny, data);
        if (!right || right.heightStep !== t.heightStep) blockers.push('direita_mesma_altura');
      }
      const pack = tt ? TREE_TILES[tt] : null;
      nearbyFormalTrees.push({
        micro: { mx: nx, my: ny },
        offsetFromCenter: { dx, dy },
        treeType: tt,
        noiseTrees: Number(nNoise.toFixed(3)),
        spriteBaseIds: pack?.base ?? null,
        spriteTopIds: pack?.top ?? null,
        rendererWouldDraw: blockers.length === 0,
        blockers: blockers.length ? blockers : null
      });
    }
  }

  const dbgTreeType = getTreeType(tile.biomeId, mx, my, seed);
  const dbgPhase = (mx + my) % 3;
  const dbgWestRoot =
    !!dbgTreeType &&
    (mx - 1 + my) % 3 === 0 &&
    foliageDensity(mx - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  const overlayHints = [];
  if (scatterContinuation) {
    overlayHints.push(
      'Este tile pode ser coberto pela base/top de scatter com origem a Oeste — ver scatterContinuation (ids).'
    );
  }
  if (activeSprites.length === 0) {
    if (dbgPhase === 2) overlayHints.push('(mx+my)%3=2: tile nunca é raiz nem coluna direita da árvore formal 2-wide.');
    if (dbgPhase === 1 && !dbgWestRoot) {
      overlayHints.push(
        `(mx+my)%3=1: seria “metade direita” só se Oeste fosse raiz com noise≥${TREE_DENSITY_THRESHOLD} — Oeste não qualifica.`
      );
    }
    if (dbgPhase === 0 && fdTrees < TREE_DENSITY_THRESHOLD) {
      overlayHints.push(`Fase raiz mas noiseTrees ${fdTrees.toFixed(3)} < ${TREE_DENSITY_THRESHOLD}.`);
    }
    if (fdGrass < 0.45) overlayHints.push(`noiseGrass ${fdGrass.toFixed(3)} < 0.45.`);
    if (fdScatter <= SCATTER_NOISE_THRESHOLD && !scatterContinuation) {
      overlayHints.push(`noiseScatter ${fdScatter.toFixed(3)} ≤ 0.82 e sem continuação a partir do Oeste.`);
    }
  }
  if (scatterContinuation && !scatterPass2.pass2C.drawsHere) {
    overlayHints.push(
      'Continuação geométrica (Oeste) presente, mas Pass 2 · 2C não pinta base aqui — ver scatterPass2.pass2C (westNeighborHint / razões).'
    );
  }

  const isFormalTreeRoot =
    !!getTreeType(tile.biomeId, mx, my, seed) &&
    (mx + my) % 3 === 0 &&
    fdTrees >= TREE_DENSITY_THRESHOLD;

  const proceduralEntities = {
    schemaNote:
      'Hex = uint32 determinístico: seededHashInt(mx,my,worldSeed+kindSalt). Mesmo mundo+coords+sal → mesmo id (save, corte de árvore, minério esgotado, etc.). Scatter multi-tile: id na raiz micro (PROC_SALT_SCATTER_INSTANCE). Grama base vs topo: PROC_SALT_GRASS_CELL / PROC_SALT_GRASS_LAYER_TOP. Ver detailInstances (espelha activeSprites).',
    worldSeed: seed,
    detailInstances,
    grassCell: { idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_GRASS_CELL) },
    scatterCell: { idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_SCATTER_CELL) },
    rockCell: { idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_ROCK) },
    crystalCell: { idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_CRYSTAL) },
    formalTreeRoot: isFormalTreeRoot
      ? { micro: { mx, my }, idHex: proceduralEntityIdHex(seed, mx, my, PROC_SALT_FORMAL_TREE_CELL) }
      : null,
    scatterInstance: scatterRootMicro
      ? {
          rootMicro: scatterRootMicro,
          idHex: proceduralEntityIdHex(seed, scatterRootMicro.mx, scatterRootMicro.my, PROC_SALT_SCATTER_INSTANCE)
        }
      : null
  };

  return {
    coord: { mx, my, gx, gy },
    cell: cellDebug,
    layers: allDebugLayers,
    heightLevels3x3,
    neighborsDetail,
    telemetry,
    macro: {
      elevation: isMacroValid ? data.cells[macroIdx]?.toFixed(3) : 'N/A',
      temperature: isMacroValid && data.temperature ? data.temperature[macroIdx]?.toFixed(3) : 'N/A',
      moisture: isMacroValid && data.moisture ? data.moisture[macroIdx]?.toFixed(3) : 'N/A',
      anomaly: isMacroValid && data.anomaly ? data.anomaly[macroIdx]?.toFixed(3) : 'N/A'
    },
    surroundings,
    terrain: {
      biome: biome?.name,
      heightStep: tile.heightStep,
      isRoad: tile.isRoad,
      isCity: tile.isCity,
      spriteId: centerSpriteId
    },
    vegetation: {
      noiseTrees: fdTrees.toFixed(3),
      noiseScatter: fdScatter.toFixed(3),
      noiseGrass: fdGrass.toFixed(3),
      typeFactor: ft.toFixed(3),
      activeSprites,
      scatterContinuation,
      scatterPass2,
      nearbyFormalTrees,
      overlayHints
    },
    collision: {
      gameCanWalk: canWalk(mx, my, data),
      foliageOverlaySpriteId: foliageOverlayIdDbg,
      foliagePoolOverlayBlocksWalk:
        foliageOverlayIdDbg != null && FOLIAGE_POOL_OVERLAY_UNWALKABLE_TILE_IDS.has(foliageOverlayIdDbg),
      lakeLotusFoliageWalkRole: lakeLotusWalkRoleDbg,
      lakeLotusWalkRoleBlocks:
        lakeLotusWalkRoleDbg != null && isPurpleLakePoolWalkBlockingRole(lakeLotusWalkRoleDbg),
      walkSurfaceKind: getTerrainSetWalkKind(BIOME_TO_TERRAIN[tile.biomeId] || 'grass'),
      baseTerrainSpriteWalkable: isBaseTerrainSpriteWalkable(centerSpriteId),
      terrainSprite: {
        id: centerSpriteId,
        objectSets: getObjectTileFlags(centerSpriteId)
      },
      overlays: activeSprites.map((s) => ({
        type: s.type,
        tiles: (s.ids || []).map((id) => ({
          id,
          objectSets: getObjectTileFlags(id)
        }))
      }))
    },
    logic: {
      isFormalTree: (() => {
        const treeType = getTreeType(tile.biomeId, mx, my, seed);
        return !!treeType && (mx + my) % 3 === 0 && fdTrees >= TREE_DENSITY_THRESHOLD;
      })(),
      isFormalNeighbor: (() => {
        const treeType = getTreeType(tile.biomeId, mx - 1, my, seed);
        return (
          !!treeType &&
          (mx + my) % 3 === 1 &&
          foliageDensity(mx - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD
        );
      })()
    },
    proceduralEntities,
    playDetailHighlight
  };
}