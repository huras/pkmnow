import { buildPlayModeTileDebugInfo } from './play-tile-debug-info.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { parseShape } from '../tessellation-logic.js';
import {
  didFormalTreeSpawnAtRoot,
  getFormalTreeTrunkWorldXSpan,
  getScatterTreeTrunkWorldSpanIfOrigin,
  formalTreeTrunkBlocksWorldPoint,
  scatterTreeTrunkBlocksWorldPoint,
  formalTreeTrunkOverlapsMicroCell,
  scatterTreeTrunkOverlapsMicroCell,
  scatterTreeTrunkFootprintRowOYRel
} from '../walkability.js';

/**
 * Compact bundle for debugging formal/scatter trees: sprites, Pass 2, and narrow-trunk colliders.
 * Paste into issues / Cursor.
 */
export function buildPlayModeTreeDebugPayload(mx, my, data) {
  const tileInfo = buildPlayModeTileDebugInfo(mx, my, data);
  const highlight = tileInfo.treeColliderHighlight;
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
  if (highlight?.kind === 'formal') {
    formalCollider = {
      rootX: highlight.rootX,
      my: highlight.my,
      didSpawnAtRoot: didFormalTreeSpawnAtRoot(highlight.rootX, highlight.my, data),
      trunkSpanWorld: getFormalTreeTrunkWorldXSpan(highlight.rootX, highlight.my, data)
    };
  }

  let scatterCollider = null;
  if (highlight?.kind === 'scatter') {
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
      trunkSpanWorld,
      trunkFootprintRowOYRel,
      itemKey,
      objectSetSummary
    };
  }

  return {
    schema: 'play-tree-debug-v1',
    purpose:
      'Tree sprite, formal/scatter placement logic, and narrow-trunk collider data — paste into Cursor or a GitHub issue.',
    worldSeed: data.seed,
    coord: tileInfo.coord,
    treeColliderHighlight: highlight,
    colliderWorldSamples,
    formalCollider,
    scatterCollider,
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
