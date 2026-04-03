import { getMicroTile, foliageDensity, CHUNK_SIZE } from './chunking.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { getRoleForCell, seededHash, parseShape } from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN,
  BIOME_VEGETATION,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
} from './biome-tiles.js';

/**
 * Espelha o Pass 2 do render (bases scatter): 2B só coluna esquerda na origem + 2C colunas dox≥1.
 * Usa getMicroTile em todo o mapa (sem cache de viewport).
 */
export function analyzeScatterPass2Base(mx, my, data) {
  const seed = data.seed;
  const microW = data.width * CHUNK_SIZE;
  const microH = data.height * CHUNK_SIZE;
  const getT = (x, y) => getMicroTile(x, y, data);

  const empty = () => ({
    centerRoleOk: false,
    pass2B: { drawsHere: false, reasons: ['tile null'], itemKey: null, cols: null, baseLeftColumnSpriteIds: [] },
    pass2C: { drawsHere: false, reasons: [], match: null, westNeighborHint: null },
    pass2ScatterBaseWouldDrawHere: false,
  });

  const tile = getT(mx, my);
  if (!tile) return empty();

  let centerRoleOk = true;
  const centerFailReasons = [];
  if (tile.heightStep < 1) {
    centerRoleOk = false;
    centerFailReasons.push('heightStep < 1');
  }
  const setForRole = TERRAIN_SETS[BIOME_TO_TERRAIN[tile.biomeId] || 'grass'];
  if (setForRole && tile.heightStep >= 1) {
    const checkAtOrAbove = (r, c) => (getT(c, r)?.heightStep ?? -99) >= tile.heightStep;
    const role = getRoleForCell(my, mx, microH, microW, checkAtOrAbove, setForRole.type);
    if (role !== 'CENTER') {
      centerRoleOk = false;
      centerFailReasons.push(`papel terreno=${role} (≠ CENTER)`);
    }
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
    for (let dox = 1; dox <= 3; dox++) {
      const nx = mx - dox;
      const nTile = getT(nx, my);
      if (nTile && foliageDensity(nx, my, seed + 111, 2.5) > 0.82 && !nTile.isRoad) {
        const nItemKey = scatterItemsHere[Math.floor(seededHash(nx, my, seed + 222) * scatterItemsHere.length)];
        const nObjSet = OBJECT_SETS[nItemKey];
        if (nObjSet) {
          const { cols } = parseShape(nObjSet.shape);
          if (dox < cols) {
            occupiedByScatter = true;
            occDetail = `scatter a Oeste: origem (${nx},${my}) · ${nItemKey} · dox=${dox} < cols=${cols}`;
            break;
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
    } else {
      itemKey2B = scatterItemsHere[Math.floor(seededHash(mx, my, seed + 222) * scatterItemsHere.length)];
      const objSet = OBJECT_SETS[itemKey2B];
      if (!objSet) {
        reasons2B.push(`OBJECT_SETS sem entrada para "${itemKey2B}"`);
      } else {
        const { cols } = parseShape(objSet.shape);
        cols2B = cols;
        let canSpawn = true;
        for (let ox = 0; ox < cols; ox++) {
          const txc = mx + ox;
          if (formalTree(txc, my) || formalNeighbor(txc, my)) {
            canSpawn = false;
            reasons2B.push(`canSpawn false: formal no footprint ox=${ox} → micro (${txc},${my})`);
            break;
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
  } else if (!centerRoleOk || tile.heightStep < 1) {
    reasons2C.push('Pass 2 não desenha vegetação (CENTER/altura)');
    reasons2C.push(...centerFailReasons);
  } else {
    for (let dox = 1; dox <= 4; dox++) {
      const ox0 = mx - dox;
      if (ox0 < 0 || ox0 >= microW) continue;
      const nTile = getT(ox0, my);
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
      if (isFTO(ox0, my) || isFNO(ox0, my)) continue;

      const scatterItemsOrigin = BIOME_VEGETATION[nTile.biomeId] || [];
      let occOriginWest = false;
      for (let dw = 1; dw <= 3; dw++) {
        const nxw = ox0 - dw;
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
            if (dw < cWest) {
              occOriginWest = true;
              break;
            }
          }
        }
      }
      if (occOriginWest) continue;

      const setO = TERRAIN_SETS[BIOME_TO_TERRAIN[nTile.biomeId] || 'grass'];
      if (setO) {
        const chkO = (r, c) => (getT(c, r)?.heightStep ?? -99) >= nTile.heightStep;
        if (getRoleForCell(my, ox0, microH, microW, chkO, setO.type) !== 'CENTER') continue;
      }
      if (foliageDensity(ox0, my, seed + 111, 2.5) <= 0.82) continue;
      const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
      if (itemsO.length === 0) continue;
      const itemKeyO = itemsO[Math.floor(seededHash(ox0, my, seed + 222) * itemsO.length)];
      const objSetO = OBJECT_SETS[itemKeyO];
      if (!objSetO) continue;
      const { cols: colsO } = parseShape(objSetO.shape);
      if (dox >= colsO) continue;

      const treeTypeO = getTreeType(nTile.biomeId);
      let canFrag = true;
      for (let ox = 0; ox < colsO; ox++) {
        const txc = ox0 + ox;
        const isFTx =
          !!treeTypeO &&
          (txc + my) % 3 === 0 &&
          foliageDensity(txc, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        const isFNx =
          !!treeTypeO &&
          (txc + my) % 3 === 1 &&
          foliageDensity(txc - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
        if (isFTx || isFNx) {
          canFrag = false;
          break;
        }
      }
      if (!canFrag) continue;

      const basePartO = objSetO.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
      if (!basePartO?.ids?.length) continue;
      const row0 = 0;
      const idxO = row0 * colsO + dox;
      if (idxO < 0 || idxO >= basePartO.ids.length) continue;

      draws2C = true;
      match2C = {
        originMicro: { mx: ox0, my },
        columnIndexFromOrigin: dox,
        itemKey: itemKeyO,
        shape: objSetO.shape,
        baseSpriteId: basePartO.ids[idxO],
      };
      reasons2C.push(`match: fragmento coluna ${dox} · origem (${ox0},${my}) · ${itemKeyO}`);
      break;
    }
    if (!draws2C) {
      reasons2C.push('nenhum dox∈[1..4] passou em todos os gates do 2C');
    }
  }

  const westNeighborHint =
    !draws2C && scatterItemsHere.length > 0 && !tile.isRoad && !tile.isCity && centerRoleOk
      ? explain2CForDox(mx, my, 1, tile, getT, seed, microW, microH)
      : null;

  const pass2ScatterBaseWouldDrawHere = draws2B || draws2C;

  return {
    centerRoleOk,
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

function explain2CForDox(mx, my, dox, tile, getT, seed, microW, microH) {
  const ox0 = mx - dox;
  if (ox0 < 0 || ox0 >= microW) return `dox=${dox}: origem ox0=${ox0} fora do mapa micro`;
  const nTile = getT(ox0, my);
  if (!nTile || nTile.heightStep < 1 || nTile.isRoad || nTile.isCity) {
    return `dox=${dox}: tile em (${ox0},${my}) inválido, altura<1, estrada ou cidade`;
  }
  if (tile.heightStep !== nTile.heightStep) {
    return `dox=${dox}: heightStep deste tile (${tile.heightStep}) ≠ origem (${nTile.heightStep})`;
  }
  const treeFormalOrigin = getTreeType(nTile.biomeId);
  const isFTO = (tx, ty) =>
    !!treeFormalOrigin &&
    (tx + ty) % 3 === 0 &&
    foliageDensity(tx, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  const isFNO = (tx, ty) =>
    !!treeFormalOrigin &&
    (tx + ty) % 3 === 1 &&
    foliageDensity(tx - 1, ty, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
  if (isFTO(ox0, my) || isFNO(ox0, my)) {
    return `dox=${dox}: origem (${ox0},${my}) em célula “formal” (raiz ou vizinho)`;
  }
  const scatterItemsOrigin = BIOME_VEGETATION[nTile.biomeId] || [];
  for (let dw = 1; dw <= 3; dw++) {
    const nxw = ox0 - dw;
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
        if (dw < cWest) {
          return `dox=${dox}: origem (${ox0},${my}) occupiedByScatter (scatter mais a Oeste: ${ik}, dw=${dw}<cols=${cWest})`;
        }
      }
    }
  }
  const setO = TERRAIN_SETS[BIOME_TO_TERRAIN[nTile.biomeId] || 'grass'];
  if (setO) {
    const chkO = (r, c) => (getT(c, r)?.heightStep ?? -99) >= nTile.heightStep;
    const role = getRoleForCell(my, ox0, microH, microW, chkO, setO.type);
    if (role !== 'CENTER') return `dox=${dox}: papel terreno na origem (${ox0},${my}) = ${role}`;
  }
  if (foliageDensity(ox0, my, seed + 111, 2.5) <= 0.82) {
    return `dox=${dox}: noiseScatter na origem (${ox0},${my}) ≤ 0.82`;
  }
  const itemsO = BIOME_VEGETATION[nTile.biomeId] || [];
  if (itemsO.length === 0) return `dox=${dox}: bioma da origem sem lista scatter`;
  const itemKeyO = itemsO[Math.floor(seededHash(ox0, my, seed + 222) * itemsO.length)];
  const objSetO = OBJECT_SETS[itemKeyO];
  if (!objSetO) return `dox=${dox}: OBJECT_SETS sem "${itemKeyO}"`;
  const { cols: colsO } = parseShape(objSetO.shape);
  if (dox >= colsO) return `dox=${dox}: coluna fora do objeto (${itemKeyO} cols=${colsO})`;
  const treeTypeO = getTreeType(nTile.biomeId);
  for (let ox = 0; ox < colsO; ox++) {
    const txc = ox0 + ox;
    const isFTx =
      !!treeTypeO &&
      (txc + my) % 3 === 0 &&
      foliageDensity(txc, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
    const isFNx =
      !!treeTypeO &&
      (txc + my) % 3 === 1 &&
      foliageDensity(txc - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD;
    if (isFTx || isFNx) {
      return `dox=${dox}: canFrag false (formal no footprint ${txc},${my})`;
    }
  }
  const basePartO = objSetO.parts.find((p) => p.role === 'base' || p.role === 'CENTER');
  const idxO = dox;
  if (!basePartO?.ids?.length || idxO >= basePartO.ids.length) {
    return `dox=${dox}: sem sprite de base para índice ${idxO}`;
  }
  return `dox=${dox}: todos os gates OK — esperado desenhar base id=${basePartO.ids[idxO]} (se não vê no ecrã, ver cache viewport / ordem de pass)`;
}
