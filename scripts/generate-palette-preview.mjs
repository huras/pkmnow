import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function usage() {
  console.log('Usage: node scripts/generate-palette-preview.mjs <image.png>');
  process.exit(1);
}

const inputRel = process.argv[2];
if (!inputRel) usage();
if (!inputRel.toLowerCase().endsWith('.png')) {
  console.error('Only PNG is supported.');
  process.exit(1);
}

const inputAbs = join(root, inputRel);
if (!existsSync(inputAbs)) {
  console.error('Image not found:', inputAbs);
  process.exit(1);
}

const rawInputBuffer = readFileSync(inputAbs);
const imageDataUrl = `data:image/png;base64,${rawInputBuffer.toString('base64')}`;
const png = PNG.sync.read(rawInputBuffer);
const colorStats = new Map();
for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]},${png.data[i + 3]}`;
    const current = colorStats.get(key) ?? { count: 0, sumX: 0, sumY: 0 };
    current.count += 1;
    current.sumX += x;
    current.sumY += y;
    colorStats.set(key, current);
  }
}

const colors = [...colorStats.keys()].sort((a, b) => {
  const aa = a.split(',').map(Number);
  const bb = b.split(',').map(Number);
  for (let i = 0; i < 4; i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return 0;
});

const colorEntries = colors.map((key) => {
  const stats = colorStats.get(key);
  return {
    key,
    ...stats,
    avgX: stats.sumX / stats.count,
    avgY: stats.sumY / stats.count
  };
});

function dist(a, b) {
  const dx = a.avgX - b.avgX;
  const dy = a.avgY - b.avgY;
  return Math.hypot(dx, dy);
}

function groupByCentroidDistance(entries) {
  if (entries.length <= 1) return [entries];
  let total = 0;
  let n = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      total += dist(entries[i], entries[j]);
      n++;
    }
  }

  const avgPairDistance = n > 0 ? total / n : 0;
  const threshold = Math.max(12, avgPairDistance * 0.38);
  const groups = [];

  for (const entry of entries) {
    let target = null;
    let best = Infinity;
    for (const group of groups) {
      const cx = group.sumX / group.totalCount;
      const cy = group.sumY / group.totalCount;
      const d = Math.hypot(entry.avgX - cx, entry.avgY - cy);
      if (d < best) {
        best = d;
        target = group;
      }
    }

    if (target && best <= threshold) {
      target.items.push(entry);
      target.totalCount += entry.count;
      target.sumX += entry.avgX * entry.count;
      target.sumY += entry.avgY * entry.count;
    } else {
      groups.push({
        items: [entry],
        totalCount: entry.count,
        sumX: entry.avgX * entry.count,
        sumY: entry.avgY * entry.count
      });
    }
  }

  return groups
    .map((group) => ({
      ...group,
      centerX: group.sumX / group.totalCount,
      centerY: group.sumY / group.totalCount,
      items: group.items.sort((a, b) => b.count - a.count)
    }))
    .sort((a, b) => b.totalCount - a.totalCount);
}

function renderCard(entry) {
  const [r, g, b, a] = entry.key.split(',').map(Number);
  const alpha = (a / 255).toFixed(4);
  const hex = `#${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${b
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}${a.toString(16).padStart(2, '0').toUpperCase()}`;
  return `<button class="card" type="button" data-color="${entry.key}" title="Toggle highlight for ${entry.key}">
  <div class="swatch-wrap"><div class="swatch" style="background: rgba(${r},${g},${b},${alpha});"></div></div>
  <code>${entry.key}</code>
  <code>${hex}</code>
  <code>px: ${entry.count}</code>
  <code>avg: (${entry.avgX.toFixed(1)}, ${entry.avgY.toFixed(1)})</code>
</button>`;
}

const flatCards = colorEntries
  .map((entry) => {
    const [r, g, b, a] = entry.key.split(',').map(Number);
    const alpha = (a / 255).toFixed(4);
    const hex = `#${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${b
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()}${a.toString(16).padStart(2, '0').toUpperCase()}`;
    return `<button class="card" type="button" data-color="${entry.key}" title="Toggle highlight for ${entry.key}">
  <div class="swatch-wrap"><div class="swatch" style="background: rgba(${r},${g},${b},${alpha});"></div></div>
  <code>${entry.key}</code>
  <code>${hex}</code>
  <code>px: ${entry.count}</code>
  <code>avg: (${entry.avgX.toFixed(1)}, ${entry.avgY.toFixed(1)})</code>
</button>`;
  })
  .join('\n');

const grouped = groupByCentroidDistance(colorEntries);
const groupedSections = grouped
  .map((group, idx) => {
    const cards = group.items.map((entry) => renderCard(entry)).join('\n');
    return `<section class="group">
  <h2>Group ${idx + 1}</h2>
  <div class="group-meta">center: (${group.centerX.toFixed(1)}, ${group.centerY.toFixed(1)}) | colors: ${group.items.length} | pixels: ${group.totalCount}</div>
  <div class="grid">
${cards}
  </div>
</section>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Palette Preview</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; background: #121212; color: #eaeaea; margin: 20px; }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 38vw);
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .right-panel { position: static !important; }
    }
    .left-panel { min-width: 0; }
    .right-panel {
      position: sticky;
      top: 16px;
      align-self: start;
    }
    h1 { margin: 0 0 8px; }
    .meta { color: #bdbdbd; margin-bottom: 16px; }
    .toolbar { display: flex; gap: 10px; align-items: center; margin: 8px 0 14px; flex-wrap: wrap; }
    .toolbar button { background: #262626; color: #ededed; border: 1px solid #3a3a3a; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    .toolbar button:hover { background: #303030; }
    .viewer { margin: 0; }
    .viewer canvas {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      border: 1px solid #333;
      border-radius: 8px;
      width: 100%;
      height: auto;
      max-height: calc(100vh - 80px);
      object-fit: contain;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
    .group { margin-bottom: 24px; }
    h2 { margin: 12px 0 8px; }
    .group-meta { color: #a8a8a8; margin-bottom: 10px; }
    .card { background: #1b1b1b; border: 1px solid #2b2b2b; border-radius: 10px; padding: 10px; text-align: left; color: inherit; cursor: pointer; }
    .card.active { outline: 2px solid #ff00ff; border-color: #ff00ff; }
    .swatch-wrap {
      height: 56px; border-radius: 8px; margin-bottom: 8px; padding: 1px;
      background-image:
        linear-gradient(45deg, #8f8f8f 25%, transparent 25%),
        linear-gradient(-45deg, #8f8f8f 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #8f8f8f 75%),
        linear-gradient(-45deg, transparent 75%, #8f8f8f 75%);
      background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;
    }
    .swatch { width: 100%; height: 100%; border-radius: 7px; }
    code { display: block; margin-top: 4px; background: #101010; border: 1px solid #2a2a2a; border-radius: 6px; padding: 4px 6px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="layout">
    <main class="left-panel">
      <h1>Palette Preview</h1>
      <div class="meta">${inputRel} - ${png.width}x${png.height} - ${colors.length} unique colors</div>
      <div class="toolbar">
        <button id="clear-selection" type="button">Clear selection</button>
        <span>Click a color card to toggle magenta highlight on image.</span>
      </div>
      <h2>Grouped by average spatial distance</h2>
${groupedSections}
      <h2>All colors (flat list)</h2>
      <div class="grid">
${flatCards}
      </div>
    </main>
    <aside class="right-panel">
      <div class="viewer">
        <canvas id="image-canvas" width="${png.width}" height="${png.height}"></canvas>
      </div>
    </aside>
  </div>
  <script>
    const imageSrc = ${JSON.stringify(imageDataUrl)};
    const canvas = document.getElementById('image-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const clearBtn = document.getElementById('clear-selection');
    const cards = Array.from(document.querySelectorAll('.card[data-color]'));
    const selectedColors = new Set();
    let original = null;

    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      original = ctx.getImageData(0, 0, canvas.width, canvas.height);
      repaint();
    };
    image.src = imageSrc;

    function repaint() {
      if (!original) return;
      const next = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
      const data = next.data;
      for (let i = 0; i < data.length; i += 4) {
        const key = data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + data[i + 3];
        if (selectedColors.has(key)) {
          data[i] = 255;
          data[i + 1] = 0;
          data[i + 2] = 255;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(next, 0, 0);
    }

    function syncActiveState() {
      for (const card of cards) {
        const key = card.dataset.color;
        card.classList.toggle('active', selectedColors.has(key));
      }
    }

    for (const card of cards) {
      card.addEventListener('click', () => {
        const key = card.dataset.color;
        if (selectedColors.has(key)) selectedColors.delete(key);
        else selectedColors.add(key);
        syncActiveState();
        repaint();
      });
    }

    clearBtn.addEventListener('click', () => {
      selectedColors.clear();
      syncActiveState();
      repaint();
    });
  </script>
</body>
</html>`;

const outputRel = inputRel.replace(/\.png$/i, '_palette_preview.html');
const outputAbs = join(root, outputRel);
writeFileSync(outputAbs, html, 'utf8');
console.log(outputRel);
