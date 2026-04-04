import { generate, DEFAULT_CONFIG } from './generator.js';
import { render, loadTilesetImages } from './render.js';
import { BIOMES } from './biomes.js';
import { getEncounters } from './ecodex.js';
import { player, setPlayerPos, tryMovePlayer, updatePlayer, canWalk } from './player.js';
import { CHUNK_SIZE, getMicroTile, foliageDensity, foliageType } from './chunking.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import {
  getRoleForCell,
  seededHash,
  parseShape,
  proceduralEntityIdHex,
  PROC_SALT_GRASS_CELL,
  PROC_SALT_SCATTER_CELL,
  PROC_SALT_SCATTER_INSTANCE,
  PROC_SALT_FORMAL_TREE_CELL,
  PROC_SALT_ROCK,
  PROC_SALT_CRYSTAL
} from './tessellation-logic.js';
import {
  BIOME_TO_TERRAIN, BIOME_VEGETATION,
  GRASS_TILES, TREE_TILES,
  getGrassVariant, getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE
} from './biome-tiles.js';
import {
  analyzeScatterPass2Base,
  validScatterOriginMicro,
  grassSuppressedByScatterFootprint
} from './scatter-pass2-debug.js';
import { getTerrainSetWalkKind, isBaseTerrainSpriteWalkable } from './walkability.js';

/** Tile id → walkable / abovePlayer (apenas OBJECT_SETS em tessellation-data.js) */
const OBJECT_TILE_FLAGS_BY_ID = (() => {
  const m = new Map();
  for (const objSet of Object.values(OBJECT_SETS)) {
    for (const part of objSet.parts || []) {
      if (typeof part.walkable !== 'boolean' || typeof part.abovePlayer !== 'boolean') continue;
      for (const id of part.ids || []) {
        m.set(id, { walkable: part.walkable, abovePlayer: part.abovePlayer });
      }
    }
  }
  return m;
})();

function getObjectTileFlags(tileId) {
  if (tileId == null) return null;
  return OBJECT_TILE_FLAGS_BY_ID.get(tileId) ?? null;
}

const canvas = document.getElementById('map');
const minimap = document.getElementById('minimap');
const seedInput = document.getElementById('seed');
const btnGenerate = document.getElementById('generate');
const infoBar = document.getElementById('hud-info');
const btnExport = document.getElementById('exportBtn');
const btnImport = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const btnSettings = document.getElementById('btnSettings');
const settingsModal = document.getElementById('settingsModal');
const btnApplySettings = document.getElementById('btnApplySettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnBackToMap = document.getElementById('btnBackToMap');
const playFpsEl = document.getElementById('play-fps');

let currentData = null;
let appMode = 'map'; // 'map' or 'play'
let currentConfig = { ...DEFAULT_CONFIG };
let gameTime = 0;
let animFrameId = null;

function getSettings() {
  const viewType = document.querySelector('input[name="viewType"]:checked')?.value || 'biomes';
  const overlayPaths = document.getElementById('chkRotas')?.checked ?? true;
  const overlayGraph = document.getElementById('chkGrafo')?.checked ?? true;
  const overlayContours = document.getElementById('chkCurvas')?.checked ?? true;
  return { viewType, overlayPaths, overlayGraph, overlayContours, appMode, player, time: gameTime };
}

function updateView() {
  if (currentData) render(canvas, currentData, { settings: getSettings(), hover: lastHoverTile });
}

// Animation loop (Play Mode only)
let lastTimestamp = 0;
/** Timestamps (performance.now) do fim de cada frame — FPS = quantos caem na última 1 s (mais fiel que 1/dt). */
const playFpsSampleTimes = [];
const heldKeys = new Set();

function gameLoop(timestamp) {
  const dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  gameTime = timestamp / 1000;

  // Smooth movement update with speed multiplier (Shift = 5x speed)
  const speedMultiplier = heldKeys.has('shift') ? 5 : 1;
  updatePlayer(dt, speedMultiplier);

  // Se o player terminou de andar e uma tecla direcional contínua pressionada, anda de novo
  if (!player.moving && currentData) {
    let dx = 0, dy = 0;
    if (heldKeys.has('up')) dy = -1;
    else if (heldKeys.has('down')) dy = 1;
    else if (heldKeys.has('left')) dx = -1;
    else if (heldKeys.has('right')) dx = 1;
    if (dx !== 0 || dy !== 0) {
      tryMovePlayer(dx, dy, currentData);
    }
  }

  const tFrameStart = performance.now();
  updateView();
  if (appMode === 'play' && playFpsEl) {
    const tEnd = performance.now();
    const frameMs = tEnd - tFrameStart;
    playFpsSampleTimes.push(tEnd);
    const cutoff = tEnd - 1000;
    while (playFpsSampleTimes.length && playFpsSampleTimes[0] < cutoff) playFpsSampleTimes.shift();
    const fps = playFpsSampleTimes.length;
    playFpsEl.textContent = `${fps} FPS · ${frameMs.toFixed(1)} ms/frame`;
  }
  if (appMode === 'play') {
    animFrameId = requestAnimationFrame(gameLoop);
  }
}

function startGameLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(gameLoop);
}

function stopGameLoop() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function run() {
  currentData = generate(seedInput.value, currentConfig);
  updateView();
}

// Ouvintes para os botões de Fase 5
document.querySelectorAll('input[name="viewType"], #chkRotas, #chkGrafo').forEach(el => {
  el.addEventListener('change', updateView);
});

// Hover para debug de célula (Estilo Civilization HUD)
let lastHoverTile = null;

canvas.addEventListener('mousemove', (e) => {
  if (!currentData) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (appMode === 'play') {
    const tileW = 40, tileH = 40;
    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;
    const mx = Math.floor((mouseX - canvas.width/2)/tileW + vx + 0.5);
    const my = Math.floor((mouseY - canvas.height/2)/tileH + vy + 0.5);
    lastHoverTile = { x: mx, y: my };
    return; // O loop de animação vai cuidar do render(canvas, ...)
  }

  // Escala para coordenadas de grid (Modo Mapa)
  const gx = Math.floor((mouseX / rect.width) * currentData.width);
  const gy = Math.floor((mouseY / rect.height) * currentData.height);
  lastHoverTile = { x: gx, y: gy };

  if (gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height) {
    const idx = gy * currentData.width + gx;
    const val = currentData.cells[idx];
    const imp = currentData.cellImportance ? currentData.cellImportance[idx] : 0;
    const traffic = currentData.roadTraffic ? currentData.roadTraffic[idx] : 0;
    
    // Procura se há cidade aqui
    const city = currentData.graph.nodes.find(n => n.x === gx && n.y === gy);
    // Procura se há rota (path) aqui (para a fase 4)
    let routeName = '';
    if (traffic > 0 && currentData.paths) {
      const activePath = currentData.paths.find(p => p.some(cell => cell.x === gx && cell.y === gy));
      if (activePath) routeName = activePath.name || `Rota (Importância ${activePath.importance})`;
    }
    
    const temp = currentData.temperature ? currentData.temperature[idx] : 0;
    const moist = currentData.moisture ? currentData.moisture[idx] : 0;
    const bId = currentData.biomes ? currentData.biomes[idx] : 0;
    const biome = Object.values(BIOMES).find(b => b.id === bId) || { name: 'Desconhecido' };
    const anom = currentData.anomaly ? currentData.anomaly[idx] : 0;
    const encounters = getEncounters(bId);
    const encounterText = encounters.slice(0, 3).join(", ");
    
    // Procura se há landmark aqui
    const landmark = currentData.landmarks ? currentData.landmarks.find(l => l.x === gx && l.y === gy) : null;

    // Conteúdo formatado para o HUD FIXO
    let mainInfo = '';
    if (city) {
      mainInfo = `<span style="color:#ff5b5b; font-weight:bold; margin-left:10px;">🏙️ ${city.name}</span>`;
    } else if (landmark) {
      mainInfo = `<span style="color:#00ffff; font-weight:bold; margin-left:10px;">✨ ${landmark.name}</span>`;
    } else if (routeName) {
      mainInfo = `<span style="color:#ffd700; font-weight:bold; margin-left:10px;">🛣️ ${routeName}</span>`;
    }

    infoBar.innerHTML = `
      <span class="biome-name">${biome.name}</span>
      <span><span class="label">Elev</span><b>${val.toFixed(2)}</b></span>
      <span><span class="label">Temp</span><b>${temp.toFixed(2)}</b></span>
      <span><span class="label">Humid</span><b>${moist.toFixed(2)}</b></span>
      <span title="${encounters.join(', ')}"><span class="label">Eco</span><b style="color:#8ceda1">${encounterText}</b></span>
      ${mainInfo}
    `;
    
    render(canvas, currentData, { hover: { x: gx, y: gy }, settings: getSettings() });
  } else {
    // infoBar.textContent = "Mova o mouse sobre o mapa para ver os detalhes do terreno";
    updateView();
  }
});

canvas.addEventListener('mouseleave', () => {
  if (currentData && appMode === 'map') updateView();
});

function enterPlayMode(gx, gy) {
  setPlayerPos(gx * CHUNK_SIZE + CHUNK_SIZE / 2, gy * CHUNK_SIZE + CHUNK_SIZE / 2);
  appMode = 'play';
  btnExport.classList.add('hidden');
  btnBackToMap.classList.remove('hidden');
  minimap.classList.remove('hidden');
  infoBar.innerHTML = "<b style='color:#fff'>Mova-se com WASD ou Setas. Aperte ESC para sair.</b>";
  playFpsSampleTimes.length = 0;
  if (playFpsEl) playFpsEl.textContent = '…';

  // Ativa Fullscreen UX
  document.body.classList.add('play-mode-active');
  document.querySelector('.app').classList.add('play-mode-active');
  
  resizeCanvas();
  startGameLoop();
}

btnBackToMap.addEventListener('click', () => {
  appMode = 'map';
  btnExport.classList.remove('hidden');
  btnBackToMap.classList.add('hidden');
  minimap.classList.add('hidden');
  infoBar.innerHTML = "Mova o mouse sobre o mapa para ver os detalhes do terreno";
  
  // Desativa Fullscreen UX
  document.body.classList.remove('play-mode-active');
  document.querySelector('.app').classList.remove('play-mode-active');

  stopGameLoop();
  resizeCanvas();
  updateView();
});

function resizeCanvas() {
  if (appMode === 'play') {
    const wrap = document.querySelector('.map-wrap');
    const w = Math.max(1, Math.floor(wrap.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(wrap.clientHeight || window.innerHeight));
    canvas.width = w;
    canvas.height = h;
  } else {
    canvas.width = 512;
    canvas.height = 512;
  }
}

window.addEventListener('resize', () => {
  if (currentData) {
     resizeCanvas();
     updateView();
  }
});

// Clique no mapa entra no modo play
canvas.addEventListener('click', (e) => {
  if (!currentData || appMode !== 'map') return;
  const rect = canvas.getBoundingClientRect();
  const gx = Math.floor(((e.clientX - rect.left) / rect.width) * currentData.width);
  const gy = Math.floor(((e.clientY - rect.top) / rect.height) * currentData.height);
  
  if (gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height) {
    enterPlayMode(gx, gy);
  }
});

function buildPlayModeTileDebugInfo(mx, my, data) {
  const tile = getMicroTile(mx, my, data);
  const biome = Object.values(BIOMES).find((b) => b.id === tile.biomeId);

  const seed = data.seed;
  const fdTrees = foliageDensity(mx, my, seed + 5555, TREE_NOISE_SCALE);
  const fdScatter = foliageDensity(mx, my, seed + 111, 2.5);
  const fdGrass = foliageDensity(mx, my, seed, 3);
  const ft = foliageType(mx, my, seed);

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
      const fScat = foliageDensity(nx, ny, seed + 111, 2.5);
      const treeType = getTreeType(t.biomeId);

      surroundings.heightStep[dy + 1][dx + 1] = t.heightStep;
      surroundings.biome[dy + 1][dx + 1] = bEnv ? bEnv.name : '???';
      surroundings.formals[dy + 1][dx + 1] = !!treeType && (nx + ny) % 3 === 0 && fTrees >= TREE_DENSITY_THRESHOLD;
      surroundings.scatter[dy + 1][dx + 1] = fScat > 0.82;
    }
  }

  const gx = Math.floor(mx / CHUNK_SIZE);
  const gy = Math.floor(my / CHUNK_SIZE);
  let macroIdx = -1;
  const isMacroValid = gx >= 0 && gx < data.width && gy >= 0 && gy < data.height;
  if (isMacroValid) macroIdx = gy * data.width + gx;

  const centerSpriteId = (() => {
    let setName = BIOME_TO_TERRAIN[tile.biomeId] || 'grass';
    if (tile.isRoad) {
      setName = tile.roadFeature || 'road';
    }
    const set = TERRAIN_SETS[setName];
    if (!set) return null;
    const isAtOrAbove = (r, c) => (getMicroTile(c, r, data)?.heightStep ?? -99) >= tile.heightStep;
    const role = getRoleForCell(my, mx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, isAtOrAbove, set.type);
    return set.roles[role] ?? set.roles['CENTER'] ?? set.centerId;
  })();

  const scatterPass2 = analyzeScatterPass2Base(mx, my, data);

  const { activeSprites, scatterContinuation } = (() => {
    const sprites = [];
    let scatterContinuation = null;
    const treeType = getTreeType(tile.biomeId);
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
    const microWDbg = data.width * CHUNK_SIZE;
    const microHDbg = data.height * CHUNK_SIZE;
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
            foliageDensity(ox, oy, seed + 111, 2.5) > 0.82 &&
            !nTile.isRoad &&
            validScatterOriginMicro(ox, oy, seed, microWDbg, microHDbg, getTdbg, validOriginMemoDbg)
          ) {
            const itemsAtO = BIOME_VEGETATION[nTile.biomeId] || [];
            if (itemsAtO.length === 0) continue;
            const nItemKey = itemsAtO[Math.floor(seededHash(ox, oy, seed + 222) * itemsAtO.length)];
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
        fdScatter > 0.82 &&
        validScatterOriginMicro(mx, my, seed, microWDbg, microHDbg, getTdbg, validOriginMemoDbg)
      ) {
        const itemKey = scatterItems[Math.floor(seededHash(mx, my, seed + 222) * scatterItems.length)];
        const objSet = OBJECT_SETS[itemKey];
        if (objSet) {
          const { cols } = parseShape(objSet.shape);
          const treeTypeChk = getTreeType(tile.biomeId);
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
        foliageDensity(mx, my, seed + 111, 2.5) > 0.82);

    if (!isFormalOccupied && !occupiedByScatter && fdGrass >= 0.45 && !suppressGrassLikeRender) {
      const variant = getGrassVariant(tile.biomeId);
      const tiles = GRASS_TILES[variant];
      if (tiles) {
        const mainId = ft < 0.5 ? tiles.original : (tiles.cactusBase || tiles.grass2 || tiles.original);
        sprites.push({ type: `grass-${variant}-base`, ids: [mainId] });
        if (variant === 'desert' && ft >= 0.5 && tiles.cactusTop) {
          sprites.push({ type: `grass-${variant}-top`, ids: [tiles.cactusTop] });
        } else if (tiles.originalTop && ft < 0.5) {
          sprites.push({ type: `grass-${variant}-top`, ids: [tiles.originalTop] });
        }
      }
    }
    return { activeSprites: sprites, scatterContinuation };
  })();

  const nearbyFormalTrees = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = mx + dx;
      const ny = my + dy;
      const t = getMicroTile(nx, ny, data);
      if (!t) continue;
      const tt = getTreeType(t.biomeId);
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
          const role = getRoleForCell(ny, nx, data.height * CHUNK_SIZE, data.width * CHUNK_SIZE, checkAtOrAbove, setForRole.type);
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

  const dbgTreeType = getTreeType(tile.biomeId);
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
    if (fdScatter <= 0.82 && !scatterContinuation) {
      overlayHints.push(`noiseScatter ${fdScatter.toFixed(3)} ≤ 0.82 e sem continuação a partir do Oeste.`);
    }
  }
  if (scatterContinuation && !scatterPass2.pass2C.drawsHere) {
    overlayHints.push(
      'Continuação geométrica (Oeste) presente, mas Pass 2 · 2C não pinta base aqui — ver scatterPass2.pass2C (westNeighborHint / razões).'
    );
  }

  const isFormalTreeRoot =
    !!getTreeType(tile.biomeId) &&
    (mx + my) % 3 === 0 &&
    fdTrees >= TREE_DENSITY_THRESHOLD;

  const scatterRootMicro =
    scatterContinuation?.originMicro ??
    scatterPass2.pass2C.match?.originMicro ??
    (scatterPass2.pass2B.drawsHere ? { mx, my } : null);

  const proceduralEntities = {
    schemaNote:
      'Hex = uint32 determinístico: seededHashInt(mx,my,worldSeed+kindSalt). Mesmo mundo+coords+sal → mesmo id (save, corte de árvore, minério esgotado, etc.). Scatter multi-tile: id na raiz micro (PROC_SALT_SCATTER_INSTANCE).',
    worldSeed: seed,
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
        const treeType = getTreeType(tile.biomeId);
        return !!treeType && (mx + my) % 3 === 0 && fdTrees >= TREE_DENSITY_THRESHOLD;
      })(),
      isFormalNeighbor: (() => {
        const treeType = getTreeType(tile.biomeId);
        return (
          !!treeType &&
          (mx + my) % 3 === 1 &&
          foliageDensity(mx - 1, my, seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD
        );
      })()
    },
    proceduralEntities
  };
}

const playContextMenu = document.getElementById('play-context-menu');
const btnPlayCtxTeleport = document.getElementById('play-ctx-teleport');
const btnPlayCtxDebug = document.getElementById('play-ctx-debug');
let playContextPending = null;

function closePlayContextMenu() {
  if (!playContextMenu) return;
  playContextMenu.hidden = true;
  playContextMenu.setAttribute('aria-hidden', 'true');
  playContextPending = null;
  window.removeEventListener('mousedown', onPlayContextMenuDismiss, true);
  window.removeEventListener('keydown', onPlayContextMenuKey, true);
}

function onPlayContextMenuDismiss(ev) {
  if (playContextMenu && playContextMenu.contains(ev.target)) return;
  closePlayContextMenu();
}

function onPlayContextMenuKey(ev) {
  if (ev.key === 'Escape') closePlayContextMenu();
}

function openPlayContextMenu(pageX, pageY, mx, my) {
  if (!playContextMenu) return;
  closePlayContextMenu();
  playContextPending = { mx, my };
  playContextMenu.hidden = false;
  playContextMenu.setAttribute('aria-hidden', 'false');
  playContextMenu.style.left = `${pageX}px`;
  playContextMenu.style.top = `${pageY}px`;
  setTimeout(() => {
    window.addEventListener('mousedown', onPlayContextMenuDismiss, true);
    window.addEventListener('keydown', onPlayContextMenuKey, true);
  }, 0);
}

canvas.addEventListener('contextmenu', (e) => {
  if (appMode !== 'play' || !currentData) return;
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  const tileW = 40;
  const tileH = 40;
  const vx = player.visualX ?? player.x;
  const vy = player.visualY ?? player.y;

  const mx = Math.floor((screenX - canvas.width / 2) / tileW + vx + 0.5);
  const my = Math.floor((screenY - canvas.height / 2) / tileH + vy + 0.5);

  const maxMX = currentData.width * CHUNK_SIZE;
  const maxMY = currentData.height * CHUNK_SIZE;
  if (mx < 0 || my < 0 || mx >= maxMX || my >= maxMY) return;

  openPlayContextMenu(e.clientX, e.clientY, mx, my);
});

if (btnPlayCtxTeleport) {
  btnPlayCtxTeleport.addEventListener('click', () => {
    if (!playContextPending || !currentData) return;
    const { mx, my } = playContextPending;
    setPlayerPos(mx, my);
    closePlayContextMenu();
    updateView();
  });
}

if (btnPlayCtxDebug) {
  btnPlayCtxDebug.addEventListener('click', () => {
    if (!playContextPending || !currentData) return;
    const { mx, my } = playContextPending;
    closePlayContextMenu();
    openDebugModal(buildPlayModeTileDebugInfo(mx, my, currentData));
  });
}

// Modal Logic
const debugModal = document.getElementById('tile-debug-modal');
const debugContent = document.getElementById('tile-debug-content');
const btnDebugClose = document.getElementById('tile-debug-close');
const btnDebugCopy = document.getElementById('tile-debug-copy-json');
let lastDebugInfo = null;

if (btnDebugClose) {
  btnDebugClose.addEventListener('click', () => {
    debugModal.classList.remove('is-open');
  });
}

if (btnDebugCopy) {
  btnDebugCopy.addEventListener('click', () => {
    if (lastDebugInfo) {
      navigator.clipboard.writeText(JSON.stringify(lastDebugInfo, null, 2)).then(() => {
        const oldText = btnDebugCopy.textContent;
        btnDebugCopy.textContent = 'COPIED!';
        setTimeout(() => btnDebugCopy.textContent = oldText, 2000);
      });
    }
  });
}

function formatObjectSetsFlags(f) {
  if (!f) return '— (fora de OBJECT_SETS; bases de terreno vêm de TERRAIN_SETS)';
  return `walkable: ${f.walkable ? 'sim' : 'não'} · acima do jogador: ${f.abovePlayer ? 'sim' : 'não'}`;
}

function openDebugModal(info) {
  lastDebugInfo = info;
  const coll = info.collision;
  const overlayRows = coll && coll.overlays && coll.overlays.length
    ? coll.overlays.map((o) => {
        const cells = o.tiles.map((t) => `#${t.id} → ${formatObjectSetsFlags(t.objectSets)}`).join('<br>');
        return `<tr><th style="vertical-align:top">${o.type}</th><td style="font-size:0.78rem;line-height:1.35">${cells}</td></tr>`;
      }).join('')
    : '<tr><th>Overlays</th><td>—</td></tr>';

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
               ${info.terrain.spriteId !== null ? `<div class="sprite-icon" style="background: url('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png') -${(info.terrain.spriteId % 57)*16}px -${Math.floor(info.terrain.spriteId / 57)*16}px;"></div>` : ''}
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
          <tr><th>Pode andar (jogo)</th><td>${coll.gameCanWalk ? 'sim' : 'não'} <span style="opacity:0.75;font-size:0.8rem">(Layer Base / Terrain Foliage + sprite na allowlist)</span></td></tr>
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

  const escDbg = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

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

  debugContent.innerHTML =
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
  debugModal.classList.add('is-open');
}

// Teclado: Track held keys para movimento contínuo estilo Pokémon
function keyToDir(key) {
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'up';
  if (key === 'ArrowDown' || key === 's' || key === 'S') return 'down';
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left';
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
  return null;
}

window.addEventListener('keydown', (e) => {
  if (appMode === 'play') {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'Shift'].includes(e.key)) {
       e.preventDefault();
    }

    if (e.key === 'Shift') {
      heldKeys.add('shift');
    }

    const dir = keyToDir(e.key);
    if (dir) {
      heldKeys.add(dir);

      // Tenta iniciar movimento imediato se não está andando
      if (!player.moving && currentData) {
        let dx = 0, dy = 0;
        if (dir === 'up') dy = -1;
        else if (dir === 'down') dy = 1;
        else if (dir === 'left') dx = -1;
        else if (dir === 'right') dx = 1;
        tryMovePlayer(dx, dy, currentData);
      }

      // Atualiza HUD
      if (currentData) {
        const tile = getMicroTile(player.x, player.y, currentData);
        const bId = tile.biomeId;
        const encounters = getEncounters(bId);
        let prefix = "";
        
        const macroX = Math.floor(player.x / CHUNK_SIZE);
        const macroY = Math.floor(player.y / CHUNK_SIZE);

        if (currentData.graph) {
           const city = currentData.graph.nodes.find(n => Math.abs(n.x - macroX) <= 1 && Math.abs(n.y - macroY) <= 1);
           if (city) prefix = `<span style="color:#ff5b5b">🏙️ ${city.name}</span> | `;
        }
        if (!prefix && currentData.paths) {
           const activePath = currentData.paths.find(p => p.some(c => c.x === macroX && c.y === macroY));
           if (activePath) prefix = `<span style="color:#ffd700">🛣️ ${activePath.name || 'Rota'}</span> | `;
        }
        
        infoBar.innerHTML = `${prefix}<span style="color:#8ceda1">Biome: ${Object.values(BIOMES).find(b=>b.id===bId).name} | Selvagens: ${encounters.slice(0, 3).join(', ')}</span>`;
      }
    }
    
    if (e.key === 'Escape') {
      btnBackToMap.click();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') heldKeys.delete('shift');
  const dir = keyToDir(e.key);
  if (dir) heldKeys.delete(dir);
});

// --- LÓGICA DE CONFIGURAÇÕES E I/O ---

btnSettings.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
  // Sincroniza sliders com o config atual
  document.getElementById('cfgWaterLevel').value = (currentConfig.waterLevel || 0.38) * 100;
  document.getElementById('cfgElevation').value = currentConfig.elevationScale;
  document.getElementById('cfgElevationDetailOctaves').value =
    currentConfig.elevationDetailOctaves ?? DEFAULT_CONFIG.elevationDetailOctaves;
  document.getElementById('cfgElevationDetailStrength').value = Math.round(
    (currentConfig.elevationDetailStrength ?? DEFAULT_CONFIG.elevationDetailStrength) * 1000
  );
  document.getElementById('cfgTemperature').value = currentConfig.temperatureScale;
  document.getElementById('cfgMoisture').value = currentConfig.moistureScale;
  document.getElementById('cfgDesertMoisture').value = (currentConfig.desertMoisture || 0.38) * 100;
  document.getElementById('cfgForestMoisture').value = (currentConfig.forestMoisture || 0.58) * 100;
  document.getElementById('cfgAnomaly').value = currentConfig.anomalyScale;
  document.getElementById('cfgCities').value = currentConfig.cityCount;
  document.getElementById('cfgGyms').value = currentConfig.gymCount;
});

btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

btnApplySettings.addEventListener('click', () => {
  currentConfig = {
    waterLevel: parseInt(document.getElementById('cfgWaterLevel').value) / 100,
    elevationScale: parseInt(document.getElementById('cfgElevation').value),
    elevationDetailOctaves: parseInt(document.getElementById('cfgElevationDetailOctaves').value, 10),
    elevationDetailStrength:
      parseInt(document.getElementById('cfgElevationDetailStrength').value, 10) / 1000,
    elevationDetailPersistence: currentConfig.elevationDetailPersistence ?? DEFAULT_CONFIG.elevationDetailPersistence,
    temperatureScale: parseInt(document.getElementById('cfgTemperature').value),
    moistureScale: parseInt(document.getElementById('cfgMoisture').value),
    desertMoisture: parseInt(document.getElementById('cfgDesertMoisture').value) / 100,
    forestMoisture: parseInt(document.getElementById('cfgForestMoisture').value) / 100,
    anomalyScale: parseInt(document.getElementById('cfgAnomaly').value),
    cityCount: parseInt(document.getElementById('cfgCities').value),
    gymCount: parseInt(document.getElementById('cfgGyms').value),
    extraEdges: currentConfig.extraEdges
  };
  settingsModal.classList.add('hidden');
  run();
});

btnImport.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.seed && data.config) {
        seedInput.value = data.seed;
        currentConfig = { ...DEFAULT_CONFIG, ...data.config };
        run();
        infoBar.innerHTML = "<b style='color:#00ff00'>MUNDO IMPORTADO!</b>";
      } else {
        alert("Arquivo JSON inválido ou formato antigo.");
      }
    } catch (err) {
      alert("Erro ao ler JSON: " + err.message);
    }
  };
  reader.readAsText(file);
});

// Fase 5: Exportação Otimizada (Seed + Config)
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (!currentData) return;
    
    // Otimização: Exportamos apenas a Seed e a Configuração.
    // O sistema de Chunks e o Gerador reconstruirão tudo deterministicamente.
    const exportData = {
      version: 2,
      seed: seedInput.value,
      config: currentConfig
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `pkmn-config-${exportData.seed}.json`;
    document.body.appendChild(a);
    a.click();
    
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    const originalContent = infoBar.innerHTML;
    infoBar.innerHTML = "<b style='color:#00ff00'>JSON EXPORTADO COM SUCESSO!</b>";
    setTimeout(() => {
      // Evita piscar se o mouse for movido rapidamente
      if (infoBar.innerHTML.includes('JSON EXPORTADO')) {
         infoBar.innerHTML = originalContent;
      }
    }, 2000);
  });
}

btnGenerate.addEventListener('click', run);
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

// Execução inicial com pré-carregamento de ativos
loadTilesetImages().then(() => {
  run();
});
