import { getMicroTile, foliageDensity, CHUNK_SIZE } from './chunking.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { getRoleForCell, seededHash, parseShape, terrainRoleAllowsScatter2CContinuation } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_VEGETATION,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
} from './biome-tiles.js';

const MAX_SCATTER_ROWS_PASS2 = 8;

/**
 * True se (mx,my) pode ser coluna esquerda de um scatter (2B / origem 2C): não é interior de
 * outro scatter a Oeste cuja **origem seja válida**, papel CENTER, noise e footprint sem formal.
 * `memo` (Map "mx,my"→bool) evita custo recursivo no render quando a cadeia a Oeste é longa.
 */
export function validScatterOriginMicro(mx, my, seed, microW, microH, getT, memo = null) {
  const memoKey = memo ? `${mx},${my}` : null;
  if (memo && memo.has(memoKey)) return memo.get(memoKey);

  const nTile = getT(mx, my);
  if (!nTile || nTile.heightStep < 1 || nTile.isRoad || nTile.isCity) {
    if (memo) memo.set(memoKey, false);
    return false;
  }

  const treeFormalOrigin = getTreeType(nTile.biomeId);
  const isFormalTreeOrig = (tx, ty) =>
    !!treeFormalOrigin &&
    (tx + ty) % 3 === 0 &&
    foliageDensity(tx, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  const isFormalNeighborOrig = (tx, ty) =>
    !!treeFormalOrigin &&
    (tx + ty) % 3 === 1 &&
    foliageDensity(tx - 1, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  if (isFormalTreeOrig(mx, my) || isFormalNeighborOrig(mx, my)) {
    if (memo) memo.set(memoKey, false);
    return false;
  }

  const scatterItemsOrigin = BIOME_VEGETATION[nTile.biomeId] || [];
  for (let dw = 1; dw <= 3; dw++) {
    const nxw = mx - dw;
    const tileWest = getT(nxw, my);
    if (
      tileWest &&
      scatterItemsOrigin.length > 0 &&
      foliageDensity(nxw, my, seed + 111, 2.5) > 0.82 &&
      !tileWest.isRoad
    ) {
      const ik = scatterItemsOrigin[Math.floor(seededHash(nxw, my, seed + 222) * scatterItemsOrigin.length)];
      const os = OBJECT_SETS[ik];
      if (os) {
        const { cols: cWest } = parseShape(os.shape);
        if (
          dw < cWest &&
          validScatterOriginMicro(nxw, my, seed, microW, microH, getT, memo)
        ) {
          if (memo) memo.set(memoKey, false);
          return false;
        }
      }
    }
  }

  const setO = TERRAIN_SETS[BIOME_TO_TERRAIN[nTile.biomeId] || 'grass'];
  if (setO) {
    const chkO = (r, c) => (getT(c, r)?.heightStep ?? -99) >= nTile.heightStep;
    if (getRoleForCell(my, mx, microH, microW, chkO, setO.type) !== 'CENTER') {
      if (memo) memo.set(memoKey, false);
      return false;
    }
  }

  if (foliageDensity(mx, my, seed + 111, 2.5) <= 0.82) {
    if (memo) memo.set(memoKey, false);
    return false;
  }
  const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
  if (itemsO.length === 0) {
    if (memo) memo.set(memoKey, false);
    return false;
  }

  const itemKeyO = itemsO[Math.floor(seededHash(mx, my, seed + 222) * itemsO.length)];
  const objSetO = OBJECT_SETS[itemKeyO];
  if (!objSetO) {
    if (memo) memo.set(memoKey, false);
    return false;
  }
  const { cols: colsO } = parseShape(objSetO.shape);
  const treeTypeO = getTreeType(nTile.biomeId);
  for (let ox = 0; ox < colsO; ox++) {
    const txc = mx + ox;
    const isFT =
      !!treeTypeO &&
      (txc + my) % 3 === 0 &&
      foliageDensity(txc, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
    const isFN =
      !!treeTypeO &&
      (txc + my) % 3 === 1 &&
      foliageDensity(txc - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
    if (isFT || isFN) {
      if (memo) memo.set(memoKey, false);
      return false;
    }
  }

  if (memo) memo.set(memoKey, true);
  return true;
}

/**
 * Espelha o Pass 2 do render (bases scatter): 2B só coluna esquerda na origem + 2C colunas dox≥1.
 * Usa getMicroTile em todo o mapa (sem cache de viewport).
 */
export function analyzeScatterPass2Base(mx, my, data) {
  const seed = data.seed;
  const microW = data.width * CHUNK_SIZE;
  const microH = data.height * CHUNK_SIZE;
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
  let scatter2cDestOk = true;
  const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
  if (tile.heightStep < 1) {
    centerRoleOk = false;
    scatter2cDestOk = false;
    centerFailReasons.push('heightStep < 1');
  } else if (setForRole) {
    const checkAtOrAbove = (r, c) => (getT(c, r)?.heightStep ?? -99) >= tile.heightStep;
    destTerrainRole = getRoleForCell(my, mx, microH, microW, checkAtOrAbove, setForRole.type);
    centerRoleOk = destTerrainRole === 'CENTER';
    if (!centerRoleOk) {
      centerFailReasons.push(`papel terreno=${destTerrainRole} (≠ CENTER)`);
    }
    scatter2cDestOk = terrainRoleAllowsScatter2CContinuation(destTerrainRole);
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
        let canSpawn = true;
        for (let oy = 0; oy < rows && canSpawn; oy++) {
          for (let ox = 0; ox < cols; ox++) {
            const txc = mx + ox;
            const tyc = my + oy;
            if (formalTree(txc, tyc) || formalNeighbor(txc, tyc)) {
              canSpawn = false;
              reasons2B.push(`canSpawn false: formal no footprint (${txc},${tyc})`);
              break;
            }
          }
        }
        if (canSpawn) {
          const basePart = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
          if (!basePart?.ids?.length) reasons2B.push('sem part base/CENTER com ids');
          else {
            baseLeftColumnSpriteIds = basePart.ids.filter((_, idx) => idx % cols === 0);
            draws2B = baseLeftColumnSpriteIds.length > 0;
            if (!draws2B) reasons2B.push('sem sprites na coluna esquerda do base');
          }
        }
      }
    }
  }

  const reasons2C = [];
  let draws2C = false;
  let match2C = null;

  if (scatterItemsHere.length === 0 || tile.isRoad || tile.isCity) {
    reasons2C.push('gate 2C: tile atual sem lista scatter ou é estrada/cidade');
  } else if (tile.heightStep < 1) {
    reasons2C.push(...centerFailReasons.filter((r) => r.includes('heightStep')));
  } else if (!scatter2cDestOk) {
    reasons2C.push(
      `2C: papel destino=${destTerrainRole ?? '—'} não permite base de continuação (aceita CENTER e IN_*; bloqueia OUT_* e bordas EDGE_*)`
    );
  } else {
    outer2c: for (let dox = 1; dox <= 4; dox++) {
      const ox0 = mx - dox;
      if (ox0 < 0 || ox0 >= microW) continue;

      for (let oyDelta = 0; oyDelta < MAX_SCATTER_ROWS_PASS2; oyDelta++) {
        const oy0 = my - oyDelta;
        if (oy0 < 0 || oy0 >= microH) break;

        const nTile = getT(ox0, oy0);
        if (!nTile || nTile.heightStep < 1 || nTile.isRoad || nTile.isCity) continue;
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

        const basePartO = objSetO.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
        if (!basePartO?.ids?.length) continue;
        const idxO = doy * colsO + dox;
        if (idxO < 0 || idxO >= basePartO.ids.length) continue;

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
      reasons2C.push('nenhum dox∈[1..4] passou em todos os gates do 2C');
    }
  }

  const westNeighborHint =
    !draws2C && scatterItemsHere.length > 0 && !tile.isRoad && !tile.isCity && scatter2cDestOk
      ? explain2CForDox(mx, my, 1, tile, getT, seed, microW, microH, originMemo)
      : null;

  const pass2ScatterBaseWouldDrawHere = draws2B || draws2C;

  return {
    centerRoleOk,
    destTerrainRole,
    scatter2cDestOk,
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

function explain2CForDox(mx, my, dox, tile, getT, seed, microW, microH, memo = null) {
  const ox0 = mx - dox;
  if (ox0 < 0 || ox0 >= microW) return `dox=${dox}: origem ox0=${ox0} fora do mapa micro`;

  for (let oyDelta = 0; oyDelta < MAX_SCATTER_ROWS_PASS2; oyDelta++) {
    const oy0 = my - oyDelta;
    if (oy0 < 0 || oy0 >= microH) break;

    const nTile = getT(ox0, oy0);
    if (!nTile || nTile.heightStep < 1 || nTile.isRoad || nTile.isCity) continue;
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

    const basePartO = objSetO.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
    const idxO = doy * colsO + dox;
    if (!basePartO?.ids?.length || idxO >= basePartO.ids.length) {
      return `dox=${dox}: sem sprite de base para índice ${idxO} (${itemKeyO})`;
    }
    return `dox=${dox}: OK — origem (${ox0},${oy0}) · linha +${doy} coluna +${dox} · base id=${basePartO.ids[idxO]} · ${itemKeyO}`;
  }

  return `dox=${dox}: nenhum oy0 em [my..my-${MAX_SCATTER_ROWS_PASS2 - 1}] passou (formal / raiz inválida / fora do footprint)`;
}
