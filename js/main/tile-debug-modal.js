import { TERRAIN_SETS } from '../tessellation-data.js';
import { getMicroTile } from '../chunking.js';
import {
  computeTerrainRoleAndSprite,
  terrainSheetSpriteIconHtml,
  natureSpriteIconHtml
} from './terrain-role-helpers.js';

let lastDebugInfo = null;
/** @type {object | null} */
let lastDetailDebugInfo = null;
let getCurrentData = () => null;
let debugModalEl = null;
let debugContentEl = null;

function setDebugModalCopyButtons(mode) {
  const btnTile = document.getElementById('tile-debug-copy-json');
  const btnDetail = document.getElementById('tile-debug-copy-detail-json');
  if (btnTile) btnTile.classList.toggle('hidden', mode === 'detail');
  if (btnDetail) btnDetail.classList.toggle('hidden', mode !== 'detail');
}

export function configureTileDebugModal(cfg) {
  getCurrentData = cfg.getCurrentData;
  debugModalEl = cfg.debugModal;
  debugContentEl = cfg.debugContent;
}

export function getLastTileDebugInfo() {
  return lastDebugInfo;
}

export function getLastDetailDebugInfo() {
  return lastDetailDebugInfo;
}

/** @deprecated Use getLastDetailDebugInfo */
export function getLastTreeDebugInfo() {
  return lastDetailDebugInfo;
}


export function formatObjectSetsFlags(f) {
  if (!f) return '— (fora de OBJECT_SETS; bases de terreno vêm de TERRAIN_SETS)';
  return `walkable: ${f.walkable ? 'sim' : 'não'} · acima do jogador: ${f.abovePlayer ? 'sim' : 'não'}`;
}

export function openDebugModal(info) {
  lastDebugInfo = info;
  lastDetailDebugInfo = null;
  setDebugModalCopyButtons('tile');
  const escDbg = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const coll = info.collision;
  const overlayRows = coll && coll.overlays && coll.overlays.length
    ? coll.overlays.map((o) => {
        const cells = o.tiles.map((t) => `#${t.id} → ${formatObjectSetsFlags(t.objectSets)}`).join('<br>');
        return `<tr><th style="vertical-align:top">${o.type}</th><td style="font-size:0.78rem;line-height:1.35">${cells}</td></tr>`;
      }).join('')
    : '<tr><th>Overlays</th><td>—</td></tr>';

  const baseSetForPreview =
    info.cell?.baseTerrainSetName != null ? TERRAIN_SETS[info.cell.baseTerrainSetName] : null;
  const baseIconTerrain =
    baseSetForPreview && info.terrain.spriteId != null
      ? terrainSheetSpriteIconHtml(baseSetForPreview, info.terrain.spriteId)
      : '';
  const layerIconHtml = (L) => {
    if (L?.tileIndex == null) return '';
    const s = L?.terrainSetName ? TERRAIN_SETS[L.terrainSetName] : null;
    if (s) return terrainSheetSpriteIconHtml(s, L.tileIndex);
    if (L?.sourceSheet === 'nature') return natureSpriteIconHtml(L.tileIndex);
    return '';
  };

  const heroStack =
    (info.layers || [])
      .map((L) => {
        return layerIconHtml(L);
      })
      .join('') || '<span style="color:#888">—</span>';

  const heroAndCellHtml =
    info.cell != null
      ? `<div class="tile-debug-section">
      <div class="tile-debug-hero-preview">
        <div class="tile-debug-sprite-stack tile-debug-hero-stack">${heroStack}</div>
        <div>
          <div class="tile-debug-hero-label">Elevation ${escDbg(info.cell.elevation)} · ${escDbg(info.cell.biome)}</div>
          <div style="font-size:11px;color:#9898a8;margin-top:2px">Role: ${escDbg(info.cell.expectedRole ?? '—')}</div>
        </div>
      </div>
      <div class="tile-debug-section-title">Cell</div>
      <table class="tile-debug-table"><tbody>
        <tr><th>Elevation</th><td>${escDbg(String(info.cell.elevation))}</td></tr>
        <tr><th>Biome</th><td>${escDbg(info.cell.biome)}</td></tr>
        <tr><th>Expected role</th><td>${escDbg(info.cell.expectedRole ?? '—')}</td></tr>
        <tr><th>Base terrain set</th><td style="font-size:0.75rem">${escDbg(info.cell.baseTerrainSetName ?? '—')}</td></tr>
      </tbody></table>
    </div>`
      : '';

  const layersTableHtml =
    info.layers && info.layers.length
      ? `<div class="tile-debug-section">
      <div class="tile-debug-section-title">Layers &amp; sprites at this tile</div>
      <table class="tile-debug-table"><thead><tr><th>Sprite</th><th>Layer</th><th>Tile index</th><th>Terrain / role</th></tr></thead><tbody>
      ${info.layers
        .map((L) => {
          const spr = layerIconHtml(L) || '—';
          return `<tr><td>${spr}</td><td>${escDbg(L.layer)}</td><td>${L.tileIndex != null ? L.tileIndex : '—'}</td><td style="font-size:0.76rem">${escDbg(L.terrainRole)}</td></tr>`;
        })
        .join('')}
      </tbody></table>
    </div>`
      : '';

  const heightGridHtml =
    info.heightLevels3x3 && getCurrentData()
      ? `<div class="tile-debug-section">
      <div class="tile-debug-section-title">Height levels (3×3)</div>
      <div class="tile-debug-grid-3x3">
      ${info.heightLevels3x3
        .map((c) => {
          const isC = c.label === 'C';
          const t = getMicroTile(c.nx, c.ny, getCurrentData());
          let mini = '';
          if (t) {
            const nb = computeTerrainRoleAndSprite(c.nx, c.ny, getCurrentData(), t.heightStep);
            if (nb.set && nb.spriteId != null) mini = `<div class="tile-debug-mini-sprites">${terrainSheetSpriteIconHtml(nb.set, nb.spriteId)}</div>`;
          }
          return `<div class="tile-debug-cell${isC ? ' center' : ''}"><span class="cell-label">${escDbg(c.label)} (${c.nx},${c.ny})</span>H=${c.h} · ${escDbg(c.biome)}${mini}</div>`;
        })
        .join('')}
      </div>
    </div>`
      : '';

  const neighborsTableHtml =
    info.neighborsDetail && info.neighborsDetail.length
      ? `<div class="tile-debug-section">
      <div class="tile-debug-section-title">Neighbors detail (elevation, biome, role, sprite)</div>
      <table class="tile-debug-table"><thead><tr><th>Sprite</th><th>Pos</th><th>Elev</th><th>Biome</th><th>Role</th><th>Tile</th></tr></thead><tbody>
      ${info.neighborsDetail
        .map((n) => {
          const s = n.terrainSetName ? TERRAIN_SETS[n.terrainSetName] : null;
          const spr =
            s && n.spriteId != null
              ? `<span class="tile-debug-sprite-stack">${terrainSheetSpriteIconHtml(s, n.spriteId)}</span>`
              : '—';
          const el = n.elev != null ? String(n.elev) : '—';
          return `<tr><td>${spr}</td><td>${escDbg(n.label)} (${n.nx},${n.ny})</td><td>${el}</td><td>${escDbg(n.biome)}</td><td>${escDbg(n.role)}</td><td style="font-size:0.74rem">${escDbg(n.tileInfo)}</td></tr>`;
        })
        .join('')}
      </tbody></table>
    </div>`
      : '';

  const terrainHtml = `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">Terrain Intelligence</div>
      <table class="tile-debug-table">
        <tbody>
          <tr><th>Biome</th><td>${info.terrain.biome || 'Unknown'}</td></tr>
          <tr><th>Height Step</th><td>${info.terrain.heightStep}</td></tr>
          <tr><th>Macro Terrain</th><td>Elev: ${info.macro.elevation} | T: ${info.macro.temperature} | M: ${info.macro.moisture} | A: ${info.macro.anomaly}</td></tr>
          <tr><th>Road / City</th><td>${info.terrain.isRoad ? 'Yes' : 'No'} / ${info.terrain.isCity ? 'Yes' : 'No'}</td></tr>
          <tr><th>Base Sprite ID</th><td>
             <div style="display:flex; align-items:center; gap:8px;">
               ${info.terrain.spriteId !== null ? info.terrain.spriteId : 'N/A'}
               ${baseIconTerrain}
             </div>
          </td></tr>
        </tbody>
      </table>
    </div>
  `;

  const collisionHtml = coll ? `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">Colisão / metadados do tileset</div>
      <table class="tile-debug-table">
        <tbody>
          <tr><th>Pode andar (jogo)</th><td>${coll.gameCanWalk ? 'sim' : 'não'} <span style="opacity:0.75;font-size:0.8rem">(lago roxo: com overlay = bloqueia; sem overlay = só CENTER/IN_* bloqueiam; OUT/EDGE secos OK)</span></td></tr>
          <tr><th>Foliage overlay (sprite)</th><td>${coll.foliageOverlaySpriteId != null ? coll.foliageOverlaySpriteId : '— (sem overlay)'}</td></tr>
          <tr><th>Overlay pool bloqueia</th><td>${coll.foliagePoolOverlayBlocksWalk ? 'sim (lava: tudo; lago roxo: qualquer tile do overlay)' : 'não'}</td></tr>
          <tr><th>Lago roxo — papel (walk)</th><td>${coll.lakeLotusFoliageWalkRole != null ? coll.lakeLotusFoliageWalkRole : '—'}</td></tr>
          <tr><th>Lago roxo — papel bloqueia</th><td>${coll.lakeLotusWalkRoleBlocks ? 'sim (só sem overlay: CENTER ou IN_* )' : 'não'}</td></tr>
          <tr><th>Superfície (set)</th><td>${coll.walkSurfaceKind === 'layer-base' ? 'Layer Base' : coll.walkSurfaceKind === 'terrain-foliage' ? 'Terrain Foliage' : '— (água, penhasco, lava…)'}</td></tr>
          <tr><th>Sprite base permitido</th><td>${coll.baseTerrainSpriteWalkable ? 'sim' : 'não'}</td></tr>
          <tr><th>Sprite base → OBJECT_SETS</th><td>${formatObjectSetsFlags(coll.terrainSprite?.objectSets)}</td></tr>
          ${overlayRows}
        </tbody>
      </table>
    </div>
  ` : '';

  const renderMatrix = (matrix, renderer) => {
    return `<div class="tile-debug-matrix">
      ${matrix.map((row, dy) => row.map((cell, dx) => {
         const isCenter = dy === 1 && dx === 1;
         return `<div class="tile-debug-cell ${isCenter ? 'active-center' : ''}">${renderer(cell, isCenter, dy, dx)}</div>`;
      }).join('')).join('')}
    </div>`;
  };

  const surroundHtml = `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">3x3 Surroundings</div>
      <div style="display:flex; gap:16px;">
        <div style="flex:1">
          <span class="cell-label" style="font-size:0.7rem; color:#a0a0b0; display:block; text-align:center; margin-bottom:4px">HeightStep</span>
          ${renderMatrix(info.surroundings.heightStep, val => `H:${val}`)}
        </div>
        <div style="flex:1">
          <span class="cell-label" style="font-size:0.7rem; color:#a0a0b0; display:block; text-align:center; margin-bottom:4px">Biomes</span>
          ${renderMatrix(info.surroundings.biome, val => `<span class="tile-debug-biome-label">${val}</span>`)}
        </div>
        <div style="flex:1">
          <span class="cell-label" style="font-size:0.7rem; color:#a0a0b0; display:block; text-align:center; margin-bottom:4px">Tree/Scatter Occup.</span>
          ${renderMatrix(info.surroundings.formals, (isTree, isC, dy, dx) => {
             const isScat = info.surroundings.scatter[dy][dx];
             if (isTree) return '<span style="color:#8ceda1">Tree</span>';
             if (isScat) return '<span style="color:#d2a1ff">Scat</span>';
             return '<span style="color:#444">-</span>';
          })}
        </div>
      </div>
    </div>
  `;

  const vegHtml = `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">Vegetation Matrix</div>
      <div class="tile-debug-grid">
        <div class="tile-debug-cell">
            <span class="cell-label">Trees Noise</span>
            ${info.vegetation.noiseTrees}
        </div>
        <div class="tile-debug-cell">
            <span class="cell-label">Scatter Noise</span>
            ${info.vegetation.noiseScatter}
        </div>
        <div class="tile-debug-cell">
            <span class="cell-label">Grass Noise</span>
            ${info.vegetation.noiseGrass}
        </div>
        <div class="tile-debug-cell center">
            <span class="cell-label">Type Factor</span>
            ${info.vegetation.typeFactor}
        </div>
      </div>
    </div>
  `;

  const vg = info.vegetation;
  const overlayHintsHtml =
    vg.overlayHints && vg.overlayHints.length
      ? `<div class="tile-debug-section">
      <div class="tile-debug-section-title">Overlay hints (centro do tile)</div>
      <ul style="margin:0;padding-left:1.2rem;font-size:0.78rem;line-height:1.45;color:#c8c8d8">
        ${vg.overlayHints.map((h) => `<li>${String(h).replace(/</g, '&lt;')}</li>`).join('')}
      </ul>
    </div>`
      : '';

  const formalNearbyHtml =
    vg.nearbyFormalTrees && vg.nearbyFormalTrees.length
      ? `<div class="tile-debug-section">
      <div class="tile-debug-section-title">Árvores formais (fase raiz no 3×3)</div>
      <table class="tile-debug-table">
        <tbody>
          ${vg.nearbyFormalTrees
            .map(
              (t) => `<tr>
            <th>Δ${t.offsetFromCenter.dx},${t.offsetFromCenter.dy}</th>
            <td style="font-size:0.75rem;line-height:1.35">
              <strong>${t.treeType || '—'}</strong> · noise ${t.noiseTrees}
              · draw: ${t.rendererWouldDraw ? 'sim' : '<span style="color:#f88">não</span>'}
              ${t.blockers ? ` · bloqueios: ${t.blockers.join(', ')}` : ''}
              <br>
              base ${JSON.stringify(t.spriteBaseIds)} · top ${JSON.stringify(t.spriteTopIds)}
            </td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`
      : '';

  const pe = info.proceduralEntities;
  const proceduralHtml = pe
    ? `<div class="tile-debug-section">
      <div class="tile-debug-section-title">IDs procedurais (determinísticos)</div>
      <p style="font-size:0.72rem;color:#a0a0b0;margin:0 0 8px;line-height:1.45">${escDbg(pe.schemaNote)}</p>
      <table class="tile-debug-table">
        <tbody>
          <tr><th>worldSeed</th><td><code>${escDbg(String(pe.worldSeed))}</code></td></tr>
          <tr><th>Grama (célula)</th><td><code>${escDbg(pe.grassCell.idHex)}</code></td></tr>
          <tr><th>Scatter (célula)</th><td><code>${escDbg(pe.scatterCell.idHex)}</code></td></tr>
          <tr><th>Rocha (reserva)</th><td><code>${escDbg(pe.rockCell.idHex)}</code></td></tr>
          <tr><th>Cristal (reserva)</th><td><code>${escDbg(pe.crystalCell.idHex)}</code></td></tr>
          <tr><th>Árvore formal (raiz)</th><td>${
            pe.formalTreeRoot
              ? `<code>${escDbg(pe.formalTreeRoot.idHex)}</code> · [${pe.formalTreeRoot.micro.mx},${pe.formalTreeRoot.micro.my}]`
              : '—'
          }</td></tr>
          <tr><th>Instância scatter</th><td>${
            pe.scatterInstance
              ? `<code>${escDbg(pe.scatterInstance.idHex)}</code> · raiz [${pe.scatterInstance.rootMicro.mx},${pe.scatterInstance.rootMicro.my}]`
              : '—'
          }</td></tr>
        </tbody>
      </table>
    </div>`
    : '';

  const sp = vg.scatterPass2;
  const scatterPass2Html = sp
    ? `<div class="tile-debug-section">
      <div class="tile-debug-section-title">Pass 2 — base scatter (espelha render.js)</div>
      <table class="tile-debug-table">
        <tbody>
          <tr><th>Base scatter aqui (2B ∨ 2C)</th><td>${
            sp.pass2ScatterBaseWouldDrawHere
              ? '<strong style="color:#8d8">sim</strong>'
              : '<span style="color:#f88">não</span>'
          }</td></tr>
          <tr><th>CENTER / altura</th><td>${sp.centerRoleOk ? 'sim' : 'não'}</td></tr>
          <tr><th>Papel terreno (tile)</th><td>${escDbg(sp.destTerrainRole ?? '—')} · 2C OK: ${sp.scatter2cDestOk ? 'sim' : 'não'}</td></tr>
          <tr><th>2B origem (só col. esq.)</th><td>${
            sp.pass2B.drawsHere ? 'sim' : 'não'
          }${
            sp.pass2B.itemKey
              ? ` · <code style="font-size:0.72rem">${escDbg(sp.pass2B.itemKey)}</code> · cols=${sp.pass2B.cols ?? '—'}`
              : ''
          }</td></tr>
          <tr><th>2C continuação</th><td>${sp.pass2C.drawsHere ? 'sim' : 'não'}</td></tr>
        </tbody>
      </table>
      ${
        sp.pass2B.baseLeftColumnSpriteIds?.length
          ? `<p style="font-size:0.75rem;margin:6px 0 0;color:#a8a8b8">2B ids coluna esquerda: <code>${sp.pass2B.baseLeftColumnSpriteIds.join(
              ', '
            )}</code></p>`
          : ''
      }
      ${
        sp.pass2C.match
          ? `<p style="font-size:0.76rem;margin:8px 0 0;line-height:1.4">2C: origem [${sp.pass2C.match.originMicro.mx}, ${sp.pass2C.match.originMicro.my}] · coluna +${sp.pass2C.match.columnIndexFromOrigin}${
              sp.pass2C.match.rowIndexFromOrigin != null
                ? ` · linha +${sp.pass2C.match.rowIndexFromOrigin}`
                : ''
            } · <code>${escDbg(sp.pass2C.match.itemKey)}</code> · sprite base <strong>${sp.pass2C.match.baseSpriteId}</strong></p>`
          : ''
      }
      ${
        sp.pass2C.westNeighborHint
          ? `<p style="font-size:0.74rem;margin:6px 0 0;line-height:1.45;color:#aac">Vizinho imediato Oeste (dox=1): ${escDbg(sp.pass2C.westNeighborHint)}</p>`
          : ''
      }
      ${
        !sp.pass2B.drawsHere && sp.pass2B.reasons.length
          ? `<div style="margin-top:8px;font-size:0.74rem"><strong>Se 2B não desenha:</strong><ul style="margin:4px 0 0;padding-left:1.1rem;line-height:1.4">${sp.pass2B.reasons
              .map((r) => `<li>${escDbg(r)}</li>`)
              .join('')}</ul></div>`
          : ''
      }
      ${
        !sp.pass2C.drawsHere && sp.pass2C.reasons.length
          ? `<div style="margin-top:8px;font-size:0.74rem"><strong>2C:</strong><ul style="margin:4px 0 0;padding-left:1.1rem;line-height:1.4">${sp.pass2C.reasons
              .map((r) => `<li>${escDbg(r)}</li>`)
              .join('')}</ul></div>`
          : ''
      }
    </div>`
    : '';

  const scatterContHtml = vg.scatterContinuation
    ? (() => {
        const sc = vg.scatterContinuation;
        const allIds = [...(sc.baseIds || []), ...(sc.topIds || [])];
        const icons = allIds
          .map(
            (id) =>
              `<div class="sprite-icon" style="background: url('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png') -${(id % 57) * 16}px -${Math.floor(id / 57) * 16}px;"></div>`
          )
          .join('');
        return `<div class="tile-debug-section">
      <div class="tile-debug-section-title">Scatter continuação (Oeste → este tile)</div>
      <p style="font-size:0.78rem;margin:0 0 8px;color:#a0a0b0">Origem micro [${sc.originMicro.mx}, ${sc.originMicro.my}] · coluna +${sc.columnIndexFromOrigin}${
        sc.rowIndexFromOrigin != null ? ` · linha +${sc.rowIndexFromOrigin}` : ''
      } · <code>${String(sc.itemKey).replace(/</g, '')}</code> · ${sc.shape}</p>
      <div class="sprite-badge"><span class="sprite-badge-label">IDs</span><div class="tile-debug-sprite-stack">${icons}</div></div>
    </div>`;
      })()
    : '';

  let spritesHtml = '';
  if (info.vegetation.activeSprites && info.vegetation.activeSprites.length > 0) {
     const badges = info.vegetation.activeSprites.map(s => {
        let icons = '';
        if (s.ids) {
           icons = s.ids.map(id => `<div class="sprite-icon" style="background: url('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png') -${(id % 57)*16}px -${Math.floor(id / 57)*16}px;"></div>`).join('');
        }
        return `<div class="sprite-badge"><span class="sprite-badge-label">${s.type}</span><div class="tile-debug-sprite-stack">${icons}</div></div>`;
     }).join('');
     spritesHtml = `
       <div class="tile-debug-section">
         <div class="tile-debug-section-title">Active Overlays</div>
         <div>${badges}</div>
       </div>
     `;
  }

  const logicHtml = `
     <div class="tile-debug-section">
       <div class="tile-debug-section-title">Exclusion Logic</div>
       <table class="tile-debug-table">
         <tbody>
           <tr><th>Formal Tree Root</th><td>${info.logic.isFormalTree ? 'Yes' : 'No'}</td></tr>
           <tr><th>Formal Protected Bounds</th><td>${info.logic.isFormalNeighbor ? 'Yes' : 'No'}</td></tr>
         </tbody>
       </table>
     </div>
  `;

  debugContentEl.innerHTML =
    heroAndCellHtml +
    layersTableHtml +
    heightGridHtml +
    neighborsTableHtml +
    terrainHtml +
    collisionHtml +
    surroundHtml +
    vegHtml +
    proceduralHtml +
    overlayHintsHtml +
    formalNearbyHtml +
    scatterPass2Html +
    scatterContHtml +
    logicHtml +
    spritesHtml;
  document.getElementById('tile-debug-title').innerHTML = `Telemetry: Sector [${info.coord.mx}, ${info.coord.my}]`;
  debugModalEl.classList.add('is-open');
}

/**
 * Play “detail” debug (tree / scatter prop / grass) + JSON payload (`getLastDetailDebugInfo` for clipboard).
 * @param {object} payload - from `buildPlayModeDetailDebugPayload`
 */
export function openDetailDebugModal(payload) {
  lastDetailDebugInfo = payload;
  lastDebugInfo = null;
  setDebugModalCopyButtons('detail');

  const escDbg = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const h = payload.detailHighlight;
  const cw = payload.colliderWorldSamples;
  const hiRow =
    h == null
      ? `<tr><th>Highlight</th><td><span style="color:#f88">No detail at this tile (use a tile where “View detail data…” is available).</span></td></tr>`
      : `<tr><th>Highlight</th><td><code>${escDbg(JSON.stringify(h))}</code></td></tr>`;

  const formalRows =
    payload.formalCollider == null
      ? ''
      : `<tr><th>Formal idHex</th><td><code>${escDbg(payload.formalCollider.idHex ?? '—')}</code></td></tr>
         <tr><th>Formal trunk span</th><td><code>${escDbg(JSON.stringify(payload.formalCollider.trunkSpanWorld))}</code></td></tr>
         <tr><th>didSpawnAtRoot</th><td>${payload.formalCollider.didSpawnAtRoot ? 'yes' : 'no'}</td></tr>`;

  const scatterRows =
    payload.scatterCollider == null
      ? ''
      : `<tr><th>Scatter-tree idHex</th><td><code>${escDbg(payload.scatterCollider.idHex ?? '—')}</code></td></tr>
         <tr><th>Scatter origin</th><td>[${payload.scatterCollider.originMicro.mx}, ${payload.scatterCollider.originMicro.my}]</td></tr>
         <tr><th>Item key</th><td><code>${escDbg(payload.scatterCollider.itemKey ?? '—')}</code></td></tr>
         <tr><th>Scatter trunk span</th><td><code>${escDbg(JSON.stringify(payload.scatterCollider.trunkSpanWorld))}</code></td></tr>`;

  const solidRows =
    payload.scatterSolidCollider == null
      ? ''
      : `<tr><th>Scatter-solid idHex</th><td><code>${escDbg(payload.scatterSolidCollider.idHex ?? '—')}</code></td></tr>
         <tr><th>Origin</th><td>[${payload.scatterSolidCollider.originMicro.mx}, ${payload.scatterSolidCollider.originMicro.my}]</td></tr>
         <tr><th>Footprint</th><td>${payload.scatterSolidCollider.cols}×${payload.scatterSolidCollider.rows} micro</td></tr>
         <tr><th>Item key</th><td><code>${escDbg(payload.scatterSolidCollider.itemKey ?? '—')}</code></td></tr>
         <tr><th>microFootprint</th><td><code>${escDbg(JSON.stringify(payload.scatterSolidCollider.microFootprint))}</code></td></tr>`;

  const grassRows =
    payload.grassDetail == null
      ? ''
      : `<tr><th>Grass variant</th><td><code>${escDbg(payload.grassDetail.variant ?? '—')}</code></td></tr>
         <tr><th>idHex (base cell)</th><td><code>${escDbg(payload.grassDetail.idHexBase ?? '—')}</code></td></tr>
         <tr><th>idHex (top layer)</th><td><code>${escDbg(payload.grassDetail.idHexTopLayer ?? '—')}</code></td></tr>`;

  const jsonRaw = JSON.stringify(payload, null, 2);
  const jsonEsc = escDbg(jsonRaw);

  debugContentEl.innerHTML = `
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">Detail — classification &amp; collider</div>
      <table class="tile-debug-table"><tbody>
        ${hiRow}
        <tr><th>World sample (center)</th><td><code>${escDbg(JSON.stringify(cw.tileCenter))}</code></td></tr>
        <tr><th>formalTrunkBlocksWorldPoint</th><td>${cw.formalTrunkBlocksWorldPoint ? '<strong>yes</strong>' : 'no'}</td></tr>
        <tr><th>scatterTrunkBlocksWorldPoint</th><td>${cw.scatterTrunkBlocksWorldPoint ? '<strong>yes</strong>' : 'no'}</td></tr>
        <tr><th>formalTrunkOverlapsThisCell</th><td>${cw.formalTrunkOverlapsThisCell ? 'yes' : 'no'}</td></tr>
        <tr><th>scatterTrunkOverlapsThisCell</th><td>${cw.scatterTrunkOverlapsThisCell ? 'yes' : 'no'}</td></tr>
        ${formalRows}
        ${scatterRows}
        ${solidRows}
        ${grassRows}
      </tbody></table>
    </div>
    <div class="tile-debug-section">
      <div class="tile-debug-section-title">Logic &amp; Pass 2 (summary)</div>
      <table class="tile-debug-table"><tbody>
        <tr><th>Formal root (phase)</th><td>${payload.logic?.isFormalTree ? 'yes' : 'no'}</td></tr>
        <tr><th>Formal neighbor</th><td>${payload.logic?.isFormalNeighbor ? 'yes' : 'no'}</td></tr>
        <tr><th>Pass2 base here</th><td>${
          payload.vegetation?.scatterPass2?.pass2ScatterBaseWouldDrawHere
            ? '<strong style="color:#8d8">yes</strong>'
            : 'no'
        }</td></tr>
      </tbody></table>
    </div>
    <p style="font-size:0.74rem;color:#a8a8c0;margin:10px 0 6px;line-height:1.45">
      Use <strong>Copy detail JSON</strong> in the header for the full payload (sprites, OBJECT_SET ids, collision, procedural ids).
    </p>
    <details style="margin-top:4px">
      <summary style="cursor:pointer;color:#bde;font-size:0.85rem">Preview JSON (truncated display — copy button has full file)</summary>
      <pre style="max-height:38vh;overflow:auto;font-size:0.65rem;line-height:1.35;margin:8px 0 0;padding:8px;background:#1a1a22;border-radius:6px;border:1px solid #333">${jsonEsc}</pre>
    </details>
  `;

  const titleEl = document.getElementById('tile-debug-title');
  if (titleEl) {
    titleEl.textContent = `Detail debug · [${payload.coord?.mx ?? '?'}, ${payload.coord?.my ?? '?'}]`;
  }
  debugModalEl.classList.add('is-open');
}

/** @deprecated Use openDetailDebugModal */
export function openTreeDebugModal(payload) {
  openDetailDebugModal(payload);
}