import { buildPlayModeTileDebugInfo } from './play-tile-debug-info.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape, proceduralEntityIdHex, PROC_SALT_GRASS_LAYER_TOP } from '../tessellation-logic.js';
import {
  didFormalTreeSpawnAtRoot,
  getFormalTreeTrunkWorldXSpan,
  getScatterTreeTrunkWorldSpanIfOrigin,
  getScatterNonTreeVegetationCircleWorldSpanIfOrigin,
  EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER,
  formalTreeTrunkBlocksWorldPoint,
  scatterTreeTrunkBlocksWorldPoint,
  formalTreeTrunkOverlapsMicroCell,
  scatterTreeTrunkOverlapsMicroCell,
  scatterTreeTrunkFootprintRowOYRel
} from '../walkability.js';

/**
 * Compact bundle for debugging play “details” (trees, scatter props, grass): Pass 2, colliders, deterministic ids.
 */
export function buildPlayModeDetailDebugPayload(mx, my, data) {
  const tileInfo = buildPlayModeTileDebugInfo(mx, my, data);
  const highlight = tileInfo.playDetailHighlight;
  const wx = mx + 0.5;
  const wy = my + 0.5;

  const colliderWorldSamples = {
    tileCenter: { x: wx, y: wy },
    formalTrunkBlocksWorldPoint: formalTreeTrunkBlocksWorldPoint(wx, wy, data),
    scatterTrunkBlocksWorldPoint: scatterTreeTrunkBlocksWorldPoint(wx, wy, data),
    formalTrunkOverlapsThisCell: formalTreeTrunkOverlapsMicroCell(mx, my, data),
    scatterTrunkOverlapsThisCell: scatterTreeTrunkOverlapsMicroCell(mx, my, data)
  };

  let formalCollider = null;
  if (highlight?.kind === 'formal-tree') {
    formalCollider = {
      rootX: highlight.rootX,
      my: highlight.my,
      idHex: highlight.idHex,
      didSpawnAtRoot: didFormalTreeSpawnAtRoot(highlight.rootX, highlight.my, data),
      trunkSpanWorld: getFormalTreeTrunkWorldXSpan(highlight.rootX, highlight.my, data)
    };
  }

  let scatterCollider = null;
  if (highlight?.kind === 'scatter-tree') {
    const memo = new Map();
    const trunkSpanWorld = getScatterTreeTrunkWorldSpanIfOrigin(highlight.ox0, highlight.oy0, data, memo);
    const sp = tileInfo.vegetation.scatterPass2;
    const itemKey =
      (sp.pass2B.drawsHere && sp.pass2B.itemKey) ||
      (sp.pass2C.drawsHere && sp.pass2C.match?.itemKey) ||
      tileInfo.vegetation.scatterContinuation?.itemKey ||
      null;
    const objSet = itemKey ? OBJECT_SETS[itemKey] : null;
    let objectSetSummary = null;
    let trunkFootprintRowOYRel = null;
    if (objSet) {
      const { rows, cols } = parseShape(objSet.shape);
      const basePart = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
      trunkFootprintRowOYRel = scatterTreeTrunkFootprintRowOYRel(basePart, rows, cols, itemKey);
      objectSetSummary = {
        itemKey,
        shape: objSet.shape,
        rows,
        cols,
        parts: (objSet.parts || []).map((p) => ({
          role: p.role,
          ids: p.ids ? [...p.ids] : []
        }))
      };
    }
    scatterCollider = {
      originMicro: { mx: highlight.ox0, my: highlight.oy0 },
      idHex: highlight.idHex,
      trunkSpanWorld,
      trunkFootprintRowOYRel,
      itemKey,
      objectSetSummary
    };
  }

  let scatterSolidCollider = null;
  if (highlight?.kind === 'scatter-solid') {
    const objSet = OBJECT_SETS[highlight.itemKey];
    let objectSetSummary = null;
    if (objSet) {
      objectSetSummary = {
        itemKey: highlight.itemKey,
        shape: objSet.shape,
        rows: highlight.rows,
        cols: highlight.cols,
        parts: (objSet.parts || []).map((p) => ({
          role: p.role,
          ids: p.ids ? [...p.ids] : []
        }))
      };
    }
    const circleMemo = new Map();
    const experimentCircleSpan =
      EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER
        ? getScatterNonTreeVegetationCircleWorldSpanIfOrigin(highlight.ox0, highlight.oy0, data, circleMemo)
        : null;
    scatterSolidCollider = {
      originMicro: { mx: highlight.ox0, my: highlight.oy0 },
      idHex: highlight.idHex,
      itemKey: highlight.itemKey,
      rows: highlight.rows,
      cols: highlight.cols,
      microFootprint: {
        mxMin: highlight.ox0,
        myMin: highlight.oy0,
        mxMaxExclusive: highlight.ox0 + highlight.cols,
        myMaxExclusive: highlight.oy0 + highlight.rows
      },
      experimentScatterSolidCircleCollider: EXPERIMENT_SCATTER_SOLID_CIRCLE_COLLIDER,
      circleSpanWorld: experimentCircleSpan,
      objectSetSummary
    };
  }

  let grassDetail = null;
  if (highlight?.kind === 'grass') {
    grassDetail = {
      mx: highlight.mx,
      my: highlight.my,
      variant: highlight.variant,
      idHexBase: highlight.idHex,
      idHexTopLayer: proceduralEntityIdHex(data.seed, highlight.mx, highlight.my, PROC_SALT_GRASS_LAYER_TOP)
    };
  }

  return {
    schema: 'play-detail-debug-v1',
    purpose:
      'Play detail: formal/scatter trees, scatter solids (rocks/crystals/etc.), grass — Pass 2, colliders, deterministic procedural ids.',
    worldSeed: data.seed,
    coord: tileInfo.coord,
    detailHighlight: highlight,
    colliderWorldSamples,
    formalCollider,
    scatterCollider,
    scatterSolidCollider,
    grassDetail,
    logic: tileInfo.logic,
    vegetation: {
      noiseTrees: tileInfo.vegetation.noiseTrees,
      noiseScatter: tileInfo.vegetation.noiseScatter,
      noiseGrass: tileInfo.vegetation.noiseGrass,
      typeFactor: tileInfo.vegetation.typeFactor,
      scatterContinuation: tileInfo.vegetation.scatterContinuation,
      scatterPass2: tileInfo.vegetation.scatterPass2,
      nearbyFormalTrees: tileInfo.vegetation.nearbyFormalTrees,
      overlayHints: tileInfo.vegetation.overlayHints,
      activeSprites: tileInfo.vegetation.activeSprites
    },
    surroundings: {
      heightStep: tileInfo.surroundings.heightStep,
      formals: tileInfo.surroundings.formals,
      scatter: tileInfo.surroundings.scatter
    },
    proceduralEntities: tileInfo.proceduralEntities,
    collision: tileInfo.collision,
    terrain: tileInfo.terrain,
    cell: tileInfo.cell,
    layers: tileInfo.layers
  };
}

/** @deprecated Use buildPlayModeDetailDebugPayload */
export function buildPlayModeTreeDebugPayload(mx, my, data) {
  return buildPlayModeDetailDebugPayload(mx, my, data);
}
