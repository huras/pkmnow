import { DUNGEON_TILE_TYPES } from './tile-map.js';
import { BIOME_TO_TERRAIN } from '../biome-tiles.js';
import { TERRAIN_SETS } from '../tessellation-data.js';
import { imageCache } from '../image-cache.js';
import { TessellationEngine } from '../tessellation-engine.js';
import { getRoleForCell, seededHash } from '../tessellation-logic.js';
import { getConcConvATerrainTileSpec, drawTerrainCellFromSheet } from '../render/conc-conv-a-terrain-blit.js';
import { player } from '../player.js';
import { getResolvedSheets } from '../pokemon/pokemon-asset-loader.js';
import { resolvePmdFrameSpecForSlice, resolveCanonicalPmdH } from '../pokemon/pmd-layout-metrics.js';
import { POKEMON_HEIGHTS } from '../pokemon/pokemon-heights.js';
import { PMD_MON_SHEET } from '../pokemon/pmd-default-timing.js';

const TILE_PX = 28;

export function renderDungeon(canvas, dungeonState, timeSec) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !dungeonState?.active || !dungeonState.map) return;
  const map = dungeonState.map;
  const cw = canvas.width;
  const ch = canvas.height;
  const camX = dungeonState.playerX * TILE_PX - cw * 0.5;
  const camY = dungeonState.playerY * TILE_PX - ch * 0.5;
  const terrainDraw = resolveDungeonTerrainDrawSpec(Number(dungeonState.biomeId) || 0);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#07070a';
  ctx.fillRect(0, 0, cw, ch);

  const minX = Math.max(0, Math.floor(camX / TILE_PX) - 2);
  const minY = Math.max(0, Math.floor(camY / TILE_PX) - 2);
  const maxX = Math.min(map.width - 1, Math.ceil((camX + cw) / TILE_PX) + 2);
  const maxY = Math.min(map.height - 1, Math.ceil((camY + ch) / TILE_PX) + 2);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = map.get(x, y);
      const sx = Math.floor(x * TILE_PX - camX);
      const sy = Math.floor(y * TILE_PX - camY);
      drawDungeonTile(ctx, sx, sy, x, y, map, t, terrainDraw);
    }
  }

  const px = Math.floor(dungeonState.playerX * TILE_PX - camX);
  const py = Math.floor(dungeonState.playerY * TILE_PX - camY);
  drawDungeonPlayerSprite(ctx, px, py, dungeonState);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `${Math.max(14, Math.floor(cw * 0.018))}px monospace`;
  ctx.fillText('Dungeon - use any stairs to exit', 18, 28);
  ctx.restore();
}

function drawDungeonTile(ctx, sx, sy, x, y, map, tileType, terrainDraw) {
  if (terrainDraw && tileType !== DUNGEON_TILE_TYPES.VOID) {
    drawDungeonTerrainTile(ctx, sx, sy, x, y, map, tileType, terrainDraw);
  } else {
    ctx.fillStyle = tileType === DUNGEON_TILE_TYPES.WALL ? '#1b1d23' : '#3a3f49';
    ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
  }
  if (tileType === DUNGEON_TILE_TYPES.STAIRS_DOWN) {
    ctx.fillStyle = 'rgba(200,133,59,0.82)';
    ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
  } else if (tileType === DUNGEON_TILE_TYPES.STAIRS_UP) {
    ctx.fillStyle = 'rgba(79,132,209,0.82)';
    ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
  }
}

function drawDungeonTerrainTile(ctx, sx, sy, x, y, map, tileType, terrainDraw) {
  const isWalk = isWalkableDungeonTile(tileType);
  const set = isWalk ? terrainDraw.floorSet : terrainDraw.wallSet;
  const img = isWalk ? terrainDraw.floorImg : terrainDraw.wallImg;
  const cols = isWalk ? terrainDraw.floorCols : terrainDraw.wallCols;
  const role = getRoleForCell(
    y,
    x,
    map.height,
    map.width,
    (r, c) => {
      const t = map.get(c, r);
      return isWalk ? isWalkableDungeonTile(t) : t === DUNGEON_TILE_TYPES.WALL;
    },
    set?.type || 'conc-conv-a'
  );
  const spec = getConcConvATerrainTileSpec(set, role);
  const centerTileId = Number(set?.roles?.CENTER ?? set?.centerId);
  const tileId = spec?.tileId != null ? spec.tileId : centerTileId;
  drawTerrainCellFromSheet(ctx, img, cols, 16, tileId, sx, sy, TILE_PX, TILE_PX, !!spec?.flipX);

  if (isWalk) {
    const n = seededHash(x, y, 91823);
    const alpha = 0.04 + n * 0.06;
    ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
    ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
  }
}

function resolveDungeonTerrainDrawSpec(biomeId) {
  const terrainName = BIOME_TO_TERRAIN?.[biomeId] || 'grass';
  const floorSet = TERRAIN_SETS?.[terrainName];
  if (!floorSet) return null;
  const floorPath = TessellationEngine.getImagePath(floorSet.file);
  const floorImg = floorPath ? imageCache.get(floorPath) : null;
  if (!floorImg) return null;

  const wallTerrainName = resolveDungeonWallTerrainName(biomeId, terrainName);
  const wallSet = TERRAIN_SETS[wallTerrainName] || TERRAIN_SETS['altura Pedra'] || floorSet;
  const wallPath = TessellationEngine.getImagePath(wallSet.file);
  const wallImg = wallPath ? imageCache.get(wallPath) : null;
  if (!wallImg) return null;

  const floorCols = resolveSheetCols(floorPath);
  const wallCols = resolveSheetCols(wallPath);
  return { floorSet, floorImg, floorCols, wallSet, wallImg, wallCols };
}

function resolveDungeonWallTerrainName(biomeId, floorTerrainName) {
  if (typeof floorTerrainName === 'string' && floorTerrainName.startsWith('altura ')) return floorTerrainName;
  switch (Number(biomeId)) {
    case 7: // SNOW
    case 8: // ICE
      return 'altura Gelo';
    case 2: // DESERT
    case 9: // SAVANNA
      return 'altura Terra Amarela';
    case 13: // VOLCANO
    case 14: // GHOST_WOODS
    case 15: // ARCANE
      return 'altura Pedra Roxa';
    case 11: // MOUNTAIN
    case 12: // PEAK
      return 'altura Pedra';
    default:
      return 'altura Terra Marrom';
  }
}

function resolveSheetCols(path) {
  if (!path) return 57;
  if (path.includes('caves')) return 50;
  if (path.includes('magiscarf') || path.includes('further_additional')) return 54;
  return 57;
}

function isWalkableDungeonTile(tileType) {
  return (
    tileType === DUNGEON_TILE_TYPES.FLOOR ||
    tileType === DUNGEON_TILE_TYPES.CORRIDOR ||
    tileType === DUNGEON_TILE_TYPES.STAIRS_DOWN ||
    tileType === DUNGEON_TILE_TYPES.STAIRS_UP
  );
}

function drawDungeonPlayerSprite(ctx, px, py, dungeonState) {
  const dex = Number(player?.dexId) || 1;
  const sheets = getResolvedSheets(imageCache, dex);
  const moving = !!dungeonState?.animMoving;
  const sheet = moving ? sheets?.walk : sheets?.idle;
  const slice = moving ? 'walk' : 'idle';
  if (!sheet) {
    ctx.fillStyle = 'rgba(173, 228, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(px, py, TILE_PX * 0.3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const { sw, sh, animCols } = resolvePmdFrameSpecForSlice(sheet, dex, slice);
  const canonicalH = resolveCanonicalPmdH(sheets?.idle, sheets?.walk, dex);
  const targetHeightTiles = POKEMON_HEIGHTS[dex] || 1.1;
  const targetHeightPx = targetHeightTiles * TILE_PX;
  const finalScale = targetHeightPx / Math.max(1, canonicalH);
  const dw = sw * finalScale;
  const dh = sh * finalScale;
  const sx = ((Number(dungeonState?.animFrame) || 0) % Math.max(1, animCols)) * sw;
  const sy = (Number(dungeonState?.animRow) || 0) * sh;
  const dx = px - dw * 0.5;
  const dy = py - dh * PMD_MON_SHEET.pivotYFrac;
  ctx.drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh);
}
