import { getMicroTile, foliageDensity, MACRO_TILE_STRIDE } from './chunking.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { getRoleForCell, seededHash, parseShape, terrainRoleAllowsScatter2CContinuation } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_VEGETATION,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  tileSurfaceAllowsScatterVegetation
} from './biome-tiles.js';

const MAX_SCATTER_ROWS_PASS2 = 8;
const MAX_SCATTER_COLS_FOOTPRINT = 8;
const MAX_SCATTER_COLS_OVERLAP_SEARCH = 4; // Deve ser >= cols - 1 de qualquer árvore

/**
 * Gates até ao scan do footprint (incl. interior a Oeste), **sem** “já estou em cima da base de
 * outro scatter”. Usado por `insideAnotherScatterBaseFootprintMicro` para não recair em
 * `validScatterOriginMicro` (evita recursão infinita A↔B).
 */
function scatterOriginStrictUpToFootprintScan(mx, my, seed, microW, microH, getT, memo) {
  const nTile = getT(mx, my);
  if (!tileSurfaceAllowsScatterVegetation(nTile)) return false;

  const treeFormalOrigin = getTreeType(nTile.biomeId);
  const isFormalTreeOrig = (tx, ty) =>
    !!treeFormalOrigin &&
    (tx + ty) % 3 === 0 &&
    foliageDensity(tx, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  const isFormalNeighborOrig = (tx, ty) =>
    !!treeFormalOrigin &&
    (tx + ty) % 3 === 1 &&
    foliageDensity(tx - 1, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  if (isFormalTreeOrig(mx, my) || isFormalNeighborOrig(mx, my)) return false;

  const scatterItemsOrigin = BIOME_VEGETATION[nTile.biomeId] || [];
  for (let dw = 1; dw <= MAX_SCATTER_COLS_OVERLAP_SEARCH; dw++) {
    const nxw = mx - dw;
    const tileWest = getT(nxw, my);
    if (
      tileWest &&
      foliageDensity(nxw, my, seed + 111, 2.5) > 0.82 &&
      !tileWest.isRoad &&
      !tileWest.isCity
    ) {
      const itemsAtWest = BIOME_VEGETATION[tileWest.biomeId] || [];
      if (itemsAtWest.length === 0) continue;
      const ik = itemsAtWest[Math.floor(seededHash(nxw, my, seed + 222) * itemsAtWest.length)];
      const os = OBJECT_SETS[ik];
      if (os) {
        const { cols: cWest } = parseShape(os.shape);
        if (dw < cWest && validScatterOriginMicro(nxw, my, seed, microW, microH, getT, memo)) {
          return false;
        }
      }
    }
  }

  const setO = TERRAIN_SETS[BIOME_TO_TERRAIN[nTile.biomeId] || 'grass'];
  if (setO) {
    const chkO = (r, c) => (getT(c, r)?.heightStep ?? -99) >= nTile.heightStep;
    if (getRoleForCell(my, mx, microH, microW, chkO, setO.type) !== 'CENTER') return false;
  }

  if (foliageDensity(mx, my, seed + 111, 2.5) <= 0.82) return false;
  const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
  if (itemsO.length === 0) return false;

  const itemKeyO = itemsO[Math.floor(seededHash(mx, my, seed + 222) * itemsO.length)];
  const objSetO = OBJECT_SETS[itemKeyO];
  if (!objSetO) return false;
  const { rows: rowsO, cols: colsO } = parseShape(objSetO.shape);
  const treeTypeO = getTreeType(nTile.biomeId);

  for (let dy = 0; dy < rowsO; dy++) {
    for (let dx = 0; dx < colsO; dx++) {
      const gx = mx + dx;
      const gy = my + dy;
      const cTile = getT(gx, gy);

      if (!cTile || cTile.heightStep !== nTile.heightStep || cTile.isRoad || cTile.isCity) {
        return false;
      }

      const setC = TERRAIN_SETS[BIOME_TO_TERRAIN[cTile.biomeId] || 'grass'];
      if (setC) {
        const chkC = (r, c) => (getT(c, r)?.heightStep ?? -99) >= nTile.heightStep;
        if (getRoleForCell(gy, gx, microH, microW, chkC, setC.type) !== 'CENTER') return false;
      }

      const isFT =
        !!treeTypeO &&
        (gx + gy) % 3 === 0 &&
        foliageDensity(gx, gy, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
      const isFN =
        !!treeTypeO &&
        (gx + gy) % 3 === 1 &&
        foliageDensity(gx - 1, gy, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
      if (isFT || isFN) return false;
    }
  }

  return true;
}

/**
 * True se (mx,my) cai dentro do retângulo **base** de um scatter cuja origem é outra célula
 * (tipicamente a norte / NO na janela de busca). Evita raiz 2B de pormenor 1×1 em cima da base de
 * cristal/rocha maior — `validScatterOriginMicro` só bloqueava interiores à **oeste** na mesma linha.
 */
function insideAnotherScatterBaseFootprintMicro(mx, my, seed, microW, microH, getT, memo = null) {
  const here = getT(mx, my);
  if (!tileSurfaceAllowsScatterVegetation(here)) return false;
  if ((BIOME_VEGETATION[here.biomeId] || []).length === 0) return false;

  for (let oy0 = my; oy0 >= my - MAX_SCATTER_ROWS_PASS2 + 1 && oy0 >= 0; oy0--) {
    for (let ox0 = mx; ox0 >= mx - MAX_SCATTER_COLS_FOOTPRINT + 1 && ox0 >= 0; ox0--) {
      if (ox0 === mx && oy0 === my) continue;

      const nTile = getT(ox0, oy0);
      if (!tileSurfaceAllowsScatterVegetation(nTile)) continue;
      if (here.heightStep !== nTile.heightStep) continue;

      if (!scatterOriginStrictUpToFootprintScan(ox0, oy0, seed, microW, microH, getT, memo)) continue;
      if (foliageDensity(ox0, oy0, seed + 111, 2.5) <= 0.82) continue;

      const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
      if (itemsO.length === 0) continue;
      const itemKey = itemsO[Math.floor(seededHash(ox0, oy0, seed + 222) * itemsO.length)];
      const objSet = OBJECT_SETS[itemKey];
      if (!objSet) continue;
      const { rows, cols } = parseShape(objSet.shape);
      const dmx = mx - ox0;
      const dmy = my - oy0;
      if (dmx >= 0 && dmy >= 0 && dmx < cols && dmy < rows) return true;
    }
  }
  return false;
}

/**
 * True se (mx,my) pode ser coluna esquerda de um scatter (2B / origem 2C): não é interior de
 * outro scatter a Oeste cuja **origem seja válida**, papel CENTER, noise e footprint sem formal.
 * `memo` (Map "mx,my"→bool) evita custo recursivo no render quando a cadeia a Oeste é longa.
 */
export function validScatterOriginMicro(mx, my, seed, microW, microH, getT, memo = null) {
  const memoKey = memo ? `${mx},${my}` : null;
  if (memo && memo.has(memoKey)) return memo.get(memoKey);

  if (!scatterOriginStrictUpToFootprintScan(mx, my, seed, microW, microH, getT, memo)) {
    if (memo) memo.set(memoKey, false);
    return false;
  }

  if (insideAnotherScatterBaseFootprintMicro(mx, my, seed, microW, microH, getT, memo)) {
    if (memo) memo.set(memoKey, false);
    return false;
  }

  if (memo) memo.set(memoKey, true);
  return true;
}

/**
 * True se (mx,my) está dentro do retângulo base de um scatter cuja origem passa nas mesmas regras do 2B
 * (origem válida + noise), **mesmo quando o spawn falha** (ex.: formal no footprint).
 * Evita grama por baixo de “árvores que o gerador queria” mas não desenhou.
 */
export function grassSuppressedByScatterFootprint(mx, my, data, memo = null) {
  const seed = data.seed;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const getT = (x, y) => getMicroTile(x, y, data);
  const here = getT(mx, my);
  if (!tileSurfaceAllowsScatterVegetation(here)) return false;
  if ((BIOME_VEGETATION[here.biomeId] || []).length === 0) return false;

  for (let oy0 = my; oy0 >= my - MAX_SCATTER_ROWS_PASS2 + 1 && oy0 >= 0; oy0--) {
    for (let ox0 = mx; ox0 >= mx - MAX_SCATTER_COLS_FOOTPRINT + 1 && ox0 >= 0; ox0--) {
      const dmx = mx - ox0;
      const dmy = my - oy0;
      if (dmx < 0 || dmy < 0) continue;

      const nTile = getT(ox0, oy0);
      if (!tileSurfaceAllowsScatterVegetation(nTile)) continue;
      if (here.heightStep !== nTile.heightStep) continue;

      if (!validScatterOriginMicro(ox0, oy0, seed, microW, microH, getT, memo)) continue;
      if (foliageDensity(ox0, oy0, seed + 111, 2.5) <= 0.82) continue;

      const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
      if (itemsO.length === 0) continue;
      const itemKey = itemsO[Math.floor(seededHash(ox0, oy0, seed + 222) * itemsO.length)];
      const objSet = OBJECT_SETS[itemKey];
      if (!objSet) continue;
      const { rows, cols } = parseShape(objSet.shape);
      if (dmx < cols && dmy < rows) return true;
    }
  }
  return false;
}

/**
 * Conjunto de chaves "mx,my" no viewport onde não se desenha grama (footprint scatter “hipotético” +
 * células com noise scatter alto). Uma passagem O(origens no retângulo expandido) em vez de
 * grassSuppressedByScatterFootprint por tile — evita lag no render.
 */
export function buildScatterFootprintNoGrassSet(startX, endX, startY, endY, data, memo = null) {
  const set = new Set();
  const seed = data.seed;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const getT = (x, y) => getMicroTile(x, y, data);

  const ox0Min = Math.max(0, startX - MAX_SCATTER_COLS_FOOTPRINT + 1);
  const oy0Min = Math.max(0, startY - MAX_SCATTER_ROWS_PASS2 + 1);
  const ox0Max = Math.min(microW, endX);
  const oy0Max = Math.min(microH, endY);

  for (let oy0 = oy0Min; oy0 < oy0Max; oy0++) {
    for (let ox0 = ox0Min; ox0 < ox0Max; ox0++) {
      const nTile = getT(ox0, oy0);
      if (!tileSurfaceAllowsScatterVegetation(nTile)) continue;
      if (!validScatterOriginMicro(ox0, oy0, seed, microW, microH, getT, memo)) continue;
      if (foliageDensity(ox0, oy0, seed + 111, 2.5) <= 0.82) continue;

      const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
      if (itemsO.length === 0) continue;
      const itemKey = itemsO[Math.floor(seededHash(ox0, oy0, seed + 222) * itemsO.length)];
      const objSet = OBJECT_SETS[itemKey];
      if (!objSet) continue;
      const { rows, cols } = parseShape(objSet.shape);

      for (let dy = 0; dy < rows; dy++) {
        for (let dx = 0; dx < cols; dx++) {
          const gx = ox0 + dx;
          const gy = oy0 + dy;
          if (gx < startX || gx >= endX || gy < startY || gy >= endY) continue;
          const cTile = getT(gx, gy);
          if (cTile && cTile.heightStep === nTile.heightStep) set.add(`${gx},${gy}`);
        }
      }
    }
  }

  for (let gy = startY; gy < endY; gy++) {
    for (let gx = startX; gx < endX; gx++) {
      const t = getT(gx, gy);
      if (!t || t.isRoad || t.isCity) continue;
      if ((BIOME_VEGETATION[t.biomeId] || []).length === 0) continue;
      if (foliageDensity(gx, gy, seed + 111, 2.5) > 0.82) set.add(`${gx},${gy}`);
    }
  }

  return set;
}

/**
 * Espelha o Pass 2 do render (bases scatter): 2B só coluna esquerda na origem + 2C colunas dox≥1.
 * Usa getMicroTile em todo o mapa (sem cache de viewport).
 */
export function analyzeScatterPass2Base(mx, my, data) {
  const seed = data.seed;
  const microW = data.width * MACRO_TILE_STRIDE;
  const microH = data.height * MACRO_TILE_STRIDE;
  const getT = (x, y) => getMicroTile(x, y, data);
  const originMemo = new Map();

  const empty = () => ({
    centerRoleOk: false,
    destTerrainRole: null,
    scatter2cDestOk: false,
    pass2B: { drawsHere: false, reasons: ['tile null'], itemKey: null, cols: null, baseLeftColumnSpriteIds: [] },
    pass2C: { drawsHere: false, reasons: [], match: null, westNeighborHint: null },
    pass2ScatterBaseWouldDrawHere: false,
  });

  const tile = getT(mx, my);
  if (!tile) return empty();

  let centerRoleOk = true;
  const centerFailReasons = [];
  let destTerrainRole = null;
  let terrainAtDestAllowsContinuation = true;
  const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];

  if (!tileSurfaceAllowsScatterVegetation(tile)) {
    centerRoleOk = false;
    terrainAtDestAllowsContinuation = false;
    centerFailReasons.push('superfície sem scatter (água/step inválido)');
  } else if (setForRole) {
    // IMPORTANTE: isAtOrAbove deve ser consistente com o render.js (ignora biomas, foca em degrau)
    const checkAtOrAbove = (r, c) => (getT(c, r)?.heightStep ?? -99) >= tile.heightStep;
    destTerrainRole = getRoleForCell(my, mx, microH, microW, checkAtOrAbove, setForRole.type);
    centerRoleOk = destTerrainRole === 'CENTER';
    if (!centerRoleOk) {
      centerFailReasons.push(`papel terreno dest=${destTerrainRole} (≠ CENTER)`);
    }
    terrainAtDestAllowsContinuation = terrainRoleAllowsScatter2CContinuation(destTerrainRole);
  }

  const scatterItemsHere = BIOME_VEGETATION[tile.biomeId] || [];
  const treeTypeHere = getTreeType(tile.biomeId);
  const formalTree = (x, y) =>
    !!treeTypeHere &&
    (x + y) % 3 === 0 &&
    foliageDensity(x, y, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  const formalNeighbor = (x, y) =>
    !!treeTypeHere &&
    (x + y) % 3 === 1 &&
    foliageDensity(x - 1, y, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;

  const reasons2B = [];
  let draws2B = false;
  let itemKey2B = null;
  let cols2B = null;
  let baseLeftColumnSpriteIds = [];

  if (!(scatterItemsHere.length > 0 && !tile.isRoad && !tile.isCity)) {
    if (!scatterItemsHere.length) reasons2B.push('sem itens de scatter neste bioma');
    else if (tile.isRoad) reasons2B.push('estrada');
    else if (tile.isCity) reasons2B.push('cidade');
  } else if (!centerRoleOk) {
    reasons2B.push(...centerFailReasons);
  } else {
    const formalOcc = formalTree(mx, my) || formalNeighbor(mx, my);
    let occupiedByScatter = false;
    let occDetail = '';
    outerOcc: for (let dox = 1; dox <= 3; dox++) {
      const ox = mx - dox;
      for (let oyDelta = 0; oyDelta < MAX_SCATTER_ROWS_PASS2; oyDelta++) {
        const oy = my - oyDelta;
        if (oy < 0 || oy >= microH) break;
        const nTile = getT(ox, oy);
        if (
          nTile &&
          foliageDensity(ox, oy, seed + 111, 2.5) > 0.82 &&
          !nTile.isRoad &&
          validScatterOriginMicro(ox, oy, seed, microW, microH, getT, originMemo)
        ) {
          const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
          const nItemKey = itemsO[Math.floor(seededHash(ox, oy, seed + 222) * itemsO.length)];
          const nObjSet = OBJECT_SETS[nItemKey];
          if (nObjSet) {
            const { rows, cols } = parseShape(nObjSet.shape);
            const doy = my - oy;
            if (dox < cols && doy >= 0 && doy < rows) {
              occupiedByScatter = true;
              occDetail = `scatter: origem (${ox},${oy}) · ${nItemKey} · coluna +${dox} linha +${doy} (${cols}×${rows})`;
              break outerOcc;
            }
          }
        }
      }
    }
    if (formalOcc) {
      reasons2B.push(formalTree(mx, my) ? 'raiz formal neste tile' : 'vizinho formal (metade direita) neste tile');
    } else if (occupiedByScatter) {
      reasons2B.push(occDetail);
    } else if (foliageDensity(mx, my, seed + 111, 2.5) <= 0.82) {
      reasons2B.push('noiseScatter ≤ 0.82');
    } else if (!validScatterOriginMicro(mx, my, seed, microW, microH, getT, originMemo)) {
      reasons2B.push('tile não é raiz scatter válida (interior a Oeste / formal no footprint / papel≠CENTER)');
    } else {
      itemKey2B = scatterItemsHere[Math.floor(seededHash(mx, my, seed + 222) * scatterItemsHere.length)];
      const objSet = OBJECT_SETS[itemKey2B];
      if (!objSet) {
        reasons2B.push(`OBJECT_SETS sem entrada para "${itemKey2B}"`);
      } else {
        const { rows, cols } = parseShape(objSet.shape);
        cols2B = cols;
        const basePart = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
        if (!basePart?.ids?.length) reasons2B.push('sem part base/CENTER/ALL com ids');
        else {
          baseLeftColumnSpriteIds = basePart.ids.filter((_, idx) => idx % cols === 0);
          let drawableLeft = 0;
          let blockedLeft = 0;
          for (let idx = 0; idx < basePart.ids.length; idx++) {
            if (idx % cols !== 0) continue;
            const tyc = my + Math.floor(idx / cols);
            if (formalTree(mx, tyc) || formalNeighbor(mx, tyc)) blockedLeft++;
            else drawableLeft++;
          }
          draws2B = drawableLeft > 0;
          if (blockedLeft > 0) {
            reasons2B.push(
              draws2B
                ? `2B parcial: ${drawableLeft} tile(s) na coluna esquerda · ${blockedLeft} omitido(s) (formal)`
                : `2B: coluna esquerda toda bloqueada por formal (${blockedLeft} tile(s))`
            );
          }
          if (!draws2B && blockedLeft === 0) reasons2B.push('sem sprites na coluna esquerda do base');
        }
      }
    }
  }

  const reasons2C = [];
  let draws2C = false;
  let match2C = null;

  if (tile.isRoad || tile.isCity) {
    reasons2C.push('gate 2C: estrada ou cidade');
  } else if (!tileSurfaceAllowsScatterVegetation(tile)) {
    reasons2C.push(...centerFailReasons.filter((r) => r.includes('scatter') || r.includes('step')));
  } else if (!terrainAtDestAllowsContinuation) {
    reasons2C.push(
      `gate 2C: papel terreno dest=${destTerrainRole ?? '—'} bloqueia continuação (aceita CENTER/IN, bloqueia OUT/EDGE)`
    );
  } else {
    outer2c: for (let dox = 1; dox <= 4; dox++) {
      const ox0 = mx - dox;
      if (ox0 < 0 || ox0 >= microW) {
        reasons2C.push(`dox=${dox}: fora do mapa micro`);
        continue;
      }

      for (let oyDelta = 0; oyDelta < MAX_SCATTER_ROWS_PASS2; oyDelta++) {
        const oy0 = my - oyDelta;
        if (oy0 < 0 || oy0 >= microH) break;

        const nTile = getT(ox0, oy0);
        if (!tileSurfaceAllowsScatterVegetation(nTile)) continue;
        if (tile.heightStep !== nTile.heightStep) continue;

        const treeFormalOrigin = getTreeType(nTile.biomeId);
        const isFTO = (tx, ty) =>
          !!treeFormalOrigin &&
          (tx + ty) % 3 === 0 &&
          foliageDensity(tx, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        const isFNO = (tx, ty) =>
          !!treeFormalOrigin &&
          (tx + ty) % 3 === 1 &&
          foliageDensity(tx - 1, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        if (isFTO(ox0, oy0) || isFNO(ox0, oy0)) continue;

        if (!validScatterOriginMicro(ox0, oy0, seed, microW, microH, getT, originMemo)) continue;

        const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
        const itemKeyO = itemsO[Math.floor(seededHash(ox0, oy0, seed + 222) * itemsO.length)];
        const objSetO = OBJECT_SETS[itemKeyO];
        if (!objSetO) continue;
        const { rows: rowsO, cols: colsO } = parseShape(objSetO.shape);
        const doy = my - oy0;
        if (dox >= colsO || doy < 0 || doy >= rowsO) continue;

        const basePartO = objSetO.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
        if (!basePartO?.ids?.length) continue;
        const idxO = doy * colsO + dox;
        if (idxO < 0 || idxO >= basePartO.ids.length) continue;

        const treeFormalDest = getTreeType(tile.biomeId);
        const isFTD =
          !!treeFormalDest &&
          (mx + my) % 3 === 0 &&
          foliageDensity(mx, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        const isFND =
          !!treeFormalDest &&
          (mx + my) % 3 === 1 &&
          foliageDensity(mx - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        if (isFTD || isFND) continue;

        draws2C = true;
        match2C = {
          originMicro: { mx: ox0, my: oy0 },
          columnIndexFromOrigin: dox,
          rowIndexFromOrigin: doy,
          itemKey: itemKeyO,
          shape: objSetO.shape,
          baseSpriteId: basePartO.ids[idxO],
        };
        reasons2C.push(
          `match: coluna +${dox} linha +${doy} · origem (${ox0},${oy0}) · ${itemKeyO}`
        );
        break outer2c;
      }
    }
    if (!draws2C) {
      reasons2C.push('nenhum dox∈[1..4] passou em todos os gates do 2C (validOrigin / overlap / footprint / out-of-ids)');
    }
  }

  const westNeighborHint =
    !draws2C && !tile.isRoad && !tile.isCity && terrainAtDestAllowsContinuation
      ? explain2CForDox(mx, my, 1, tile, getT, seed, microW, microH, originMemo)
      : null;

  const pass2ScatterBaseWouldDrawHere = draws2B || draws2C;

  return {
    centerRoleOk,
    destTerrainRole,
    terrainAtDestAllowsContinuation,
    pass2B: {
      drawsHere: draws2B,
      reasons: reasons2B,
      itemKey: itemKey2B,
      cols: cols2B,
      baseLeftColumnSpriteIds,
    },
    pass2C: {
      drawsHere: draws2C,
      reasons: reasons2C,
      match: match2C,
      westNeighborHint,
    },
    pass2ScatterBaseWouldDrawHere,
  };

}

export function scatterItemKeyIsSolid(itemKey) {
  if (!itemKey) return false;
  const k = itemKey.toLowerCase();
  return (
    k.includes('tree') ||
    k.includes('rock') ||
    k.includes('crystal') ||
    k.includes('cactus') ||
    k.includes('broadleaf') ||
    k.includes('palm')
  );
}

/** Scatter props that are trees (narrow trunk collider). Big cactus counts as a tree; small cactus stays full-tile like rocks. */
export function scatterItemKeyIsTree(itemKey) {
  if (!itemKey) return false;
  const k = itemKey.toLowerCase();
  if (k.includes('big-cactus')) return true;
  if (k.includes('crystal') || k.includes('rock') || k.includes('cactus')) return false;
  return k.includes('tree') || k.includes('broadleaf') || k.includes('palm');
}

/** Persistent memo: `analyzeScatterPass2Base` is heavy; same (seed,mx,my) is queried many times per frame (collider overlay + movement). */
const scatterSolidBlockCache = new Map();
let scatterSolidBlockCacheSeed = null;
const SCATTER_SOLID_CACHE_MAX = 14000;

/**
 * Clear scatter solid cache (e.g. after loading a new world with the same seed).
 */
export function clearScatterSolidBlockCache() {
  scatterSolidBlockCache.clear();
  scatterSolidBlockCacheSeed = null;
}

/**
 * True when Pass 2 would draw a solid scatter **base** here (aligned with play-chunk-bake / render).
 * Avoids blocking tiles that only sit inside the nominal 4×3 footprint but never receive base art.
 * Walkability passes world feet through `canWalkMicroTile` → `floor(x),floor(y)` here; rocks/crystals/mineral bases use this cell.
 */
export function scatterSolidBaseBlocksMicroTile(mx, my, data) {
  const seed = data.seed;
  if (scatterSolidBlockCacheSeed !== seed) {
    scatterSolidBlockCache.clear();
    scatterSolidBlockCacheSeed = seed;
  }
  const key = `${mx},${my}`;
  if (scatterSolidBlockCache.has(key)) return scatterSolidBlockCache.get(key);

  const a = analyzeScatterPass2Base(mx, my, data);
  const solidKey =
    (a.pass2B.drawsHere && a.pass2B.itemKey) ||
    (a.pass2C.drawsHere && a.pass2C.match?.itemKey) ||
    null;
  const blocked =
    !!a.pass2ScatterBaseWouldDrawHere &&
    scatterItemKeyIsSolid(solidKey) &&
    !scatterItemKeyIsTree(solidKey);
  scatterSolidBlockCache.set(key, blocked);
  if (scatterSolidBlockCache.size > SCATTER_SOLID_CACHE_MAX) {
    let over = scatterSolidBlockCache.size - 8000;
    while (over-- > 0 && scatterSolidBlockCache.size > 8000) {
      const k0 = scatterSolidBlockCache.keys().next().value;
      scatterSolidBlockCache.delete(k0);
    }
  }
  return blocked;
}

function explain2CForDox(mx, my, dox, tile, getT, seed, microW, microH, memo = null) {
  const ox0 = mx - dox;
  if (ox0 < 0 || ox0 >= microW) return `dox=${dox}: origem ox0=${ox0} fora do mapa micro`;

  for (let oyDelta = 0; oyDelta < MAX_SCATTER_ROWS_PASS2; oyDelta++) {
    const oy0 = my - oyDelta;
    if (oy0 < 0 || oy0 >= microH) break;

    const nTile = getT(ox0, oy0);
    if (!tileSurfaceAllowsScatterVegetation(nTile)) continue;
    if (tile.heightStep !== nTile.heightStep) continue;

    const treeFormalOrigin = getTreeType(nTile.biomeId);
    const isFTO = (tx, ty) =>
      !!treeFormalOrigin &&
      (tx + ty) % 3 === 0 &&
      foliageDensity(tx, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
    const isFNO = (tx, ty) =>
      !!treeFormalOrigin &&
      (tx + ty) % 3 === 1 &&
      foliageDensity(tx - 1, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
    if (isFTO(ox0, oy0) || isFNO(ox0, oy0)) {
      return `dox=${dox}: candidato (${ox0},${oy0}) em célula “formal” (raiz ou vizinho)`;
    }
    if (!validScatterOriginMicro(ox0, oy0, seed, microW, microH, getT, memo)) {
      continue;
    }

    const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
    const itemKeyO = itemsO[Math.floor(seededHash(ox0, oy0, seed + 222) * itemsO.length)];
    const objSetO = OBJECT_SETS[itemKeyO];
    if (!objSetO) return `dox=${dox}: OBJECT_SETS sem "${itemKeyO}"`;
    const { rows: rowsO, cols: colsO } = parseShape(objSetO.shape);
    const doy = my - oy0;
    if (dox >= colsO || doy < 0 || doy >= rowsO) continue;

    const basePartO = objSetO.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
    const idxO = doy * colsO + dox;
    if (!basePartO?.ids?.length || idxO >= basePartO.ids.length) {
      return `dox=${dox}: sem sprite de base (ou ALL) para índice ${idxO} (${itemKeyO})`;
    }
    return `dox=${dox}: OK — origem (${ox0},${oy0}) · linha +${doy} coluna +${dox} · base id=${basePartO.ids[idxO]} · ${itemKeyO}`;
  }

  return `dox=${dox}: nenhum oy0 em [my..my-${MAX_SCATTER_ROWS_PASS2 - 1}] passou (formal / raiz inválida / fora do footprint)`;
}
