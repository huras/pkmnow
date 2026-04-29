import { DUNGEON_TILE_TYPES } from './tile-map.js';

const TILE_PX = 28;

export function renderDungeon(canvas, dungeonState, timeSec) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !dungeonState?.active || !dungeonState.map) return;
  const map = dungeonState.map;
  const cw = canvas.width;
  const ch = canvas.height;
  const camX = dungeonState.playerX * TILE_PX - cw * 0.5;
  const camY = dungeonState.playerY * TILE_PX - ch * 0.5;

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
      ctx.fillStyle = resolveTileColor(t);
      ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
    }
  }

  const pulse = 0.75 + 0.25 * Math.sin((Number(timeSec) || 0) * 6);
  const px = Math.floor(dungeonState.playerX * TILE_PX - camX);
  const py = Math.floor(dungeonState.playerY * TILE_PX - camY);
  ctx.fillStyle = `rgba(173, 228, 255, ${pulse.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(px, py, TILE_PX * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(12, 18, 26, 0.9)';
  ctx.lineWidth = Math.max(1, TILE_PX * 0.08);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `${Math.max(14, Math.floor(cw * 0.018))}px monospace`;
  ctx.fillText('Dungeon - reach the blue stairs to exit', 18, 28);
  ctx.restore();
}

function resolveTileColor(tileType) {
  if (tileType === DUNGEON_TILE_TYPES.WALL) return '#1b1d23';
  if (tileType === DUNGEON_TILE_TYPES.CORRIDOR) return '#2f333c';
  if (tileType === DUNGEON_TILE_TYPES.FLOOR) return '#3a3f49';
  if (tileType === DUNGEON_TILE_TYPES.STAIRS_DOWN) return '#c8853b';
  if (tileType === DUNGEON_TILE_TYPES.STAIRS_UP) return '#4f84d1';
  return '#0f1116';
}
