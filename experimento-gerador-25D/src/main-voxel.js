import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { generate, DEFAULT_CONFIG } from '../../js/generator.js';
import { getMicroTile, MACRO_TILE_STRIDE } from '../../js/chunking.js';
import { computeTerrainRoleAndSprite } from '../../js/main/terrain-role-helpers.js';
import { TessellationEngine } from '../../js/tessellation-engine.js';

document.querySelector('#app').innerHTML = `
  <div id="viewport"></div>
  <aside class="hud">
    <h1>Gerador 25D (Three.js)</h1>
    <p>Terreno voxel 3D com sprites do 2D.</p>
    <label class="field">Seed<input id="seed-input" type="text" value="botw-25d-001" /></label>
    <button id="regen-btn" type="button">Regenerar</button>
    <p id="pick-info" class="hint">Clique no terreno para inspecionar tile.</p>
    <div id="perf-panel" class="perf-panel">
      <div><span>FPS now</span><strong id="fps-now">--</strong></div>
      <div><span>FPS 1s</span><strong id="fps-1s">--</strong></div>
      <div><span>FPS 5s</span><strong id="fps-5s">--</strong></div>
      <div><span>Frame ms</span><strong id="frame-ms">--</strong></div>
    </div>
    <p class="hint">Scroll: zoom | Botao direito: pan</p>
  </aside>
`;

const viewport = document.getElementById('viewport');
const seedInput = document.getElementById('seed-input');
const regenBtn = document.getElementById('regen-btn');
const pickInfo = document.getElementById('pick-info');
const fpsNowEl = document.getElementById('fps-now');
const fps1sEl = document.getElementById('fps-1s');
const fps5sEl = document.getElementById('fps-5s');
const frameMsEl = document.getElementById('frame-ms');

const settings = { microSpan: 140, stepHeight: 0.55, wallShade: 0.72 };
const TILE_PX = 16;
const atlasUrls = new Map();
const atlasTextures = new Map();
const pickMeshes = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let currentWorld = null;
let currentBounds = null;
let rendering = false;
let lastFrameTs = performance.now();
let lastPerfPaintTs = lastFrameTs;
const frameTimestamps = [];
const frameDurationsMs = [];
const FRAME_MS_WINDOW = 120;

const atlasModules = import.meta.glob('../../tilesets/**/*.png', { eager: true, import: 'default' });
for (const [k, v] of Object.entries(atlasModules)) {
  const marker = '/tilesets/';
  const i = k.indexOf(marker);
  if (i >= 0) {
    const key = `tilesets/${k.slice(i + marker.length)}`;
    atlasUrls.set(key.replace(/\\/g, '/'), v);
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#7ea8d8');
scene.fog = new THREE.Fog('#7ea8d8', 120, 420);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(80, 90, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.minDistance = 40;
controls.maxDistance = 260;
controls.minPolarAngle = Math.PI * 0.2;
controls.maxPolarAngle = Math.PI * 0.44;
controls.enableRotate = false;
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const idx = (w, x, y) => y * w + x;

async function textureFor(fileName) {
  if (!fileName) return null;
  if (atlasTextures.has(fileName)) return atlasTextures.get(fileName);
  let url = atlasUrls.get(fileName);
  if (!url) {
    const base = fileName.split('/').pop();
    for (const [k, v] of atlasUrls.entries()) {
      if (k.endsWith(`/${base}`) || k === base) {
        url = v;
        break;
      }
    }
  }
  if (!url) return null;
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  atlasTextures.set(fileName, tex);
  return tex;
}

function uvRect(texture, tileId, cols) {
  const w = texture.image.width;
  const h = texture.image.height;
  const sx = (tileId % cols) * TILE_PX;
  const sy = Math.floor(tileId / cols) * TILE_PX;
  return { u0: sx / w, u1: (sx + TILE_PX) / w, v0: 1 - (sy + TILE_PX) / h, v1: 1 - sy / h };
}

function pushFace(builder, a, b, c, d, uv, tint) {
  builder.p.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  builder.u.push(uv.u0, uv.v1, uv.u0, uv.v0, uv.u1, uv.v1, uv.u1, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0);
  builder.c.push(tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint);
}

async function buildTerrain(world) {
  pickMeshes.length = 0;
  terrainGroup.clear();
  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const span = clamp(Math.floor(settings.microSpan), 64, Math.min(microW, microH));
  const startX = Math.floor((microW - span) * 0.5);
  const startY = Math.floor((microH - span) * 0.5);
  currentBounds = { span, startX, startY };

  const cells = new Array(span * span);
  const needed = new Set();
  for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
    const mx = startX + x;
    const my = startY + y;
    const t = getMicroTile(mx, my, world);
    const role = computeTerrainRoleAndSprite(mx, my, world, t.heightStep);
    const set = role.set;
    const file = set?.file ? TessellationEngine.getImagePath(set.file).replace(/\\/g, '/') : null;
    if (file) needed.add(file);
    cells[idx(span, x, y)] = { mx, my, h: t.heightStep, biomeId: t.biomeId, role, file, cols: TessellationEngine.getTerrainSheetCols(set), sprite: role.spriteId ?? set?.centerId ?? 0 };
  }
  await Promise.all([...needed].map(textureFor));

  let minH = Infinity;
  for (const c of cells) minH = Math.min(minH, c.h);
  const floorY = (minH - 2) * settings.stepHeight;
  const half = span * 0.5;
  const builders = new Map();
  const getBuilder = (k) => { if (!builders.has(k)) builders.set(k, { p: [], u: [], c: [] }); return builders.get(k); };

  for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
    const cell = cells[idx(span, x, y)];
    if (!cell.file) continue;
    const tex = atlasTextures.get(cell.file);
    if (!tex) continue;
    const uv = uvRect(tex, cell.sprite, cell.cols);
    const b = getBuilder(cell.file);
    const x0 = x - half; const x1 = x0 + 1; const z0 = y - half; const z1 = z0 + 1; const y0 = cell.h * settings.stepHeight;
    pushFace(b, { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, uv, 1);
    const r = x + 1 < span ? cells[idx(span, x + 1, y)] : null;
    const d = y + 1 < span ? cells[idx(span, x, y + 1)] : null;
    const rh = r ? r.h * settings.stepHeight : floorY;
    const dh = d ? d.h * settings.stepHeight : floorY;
    if (Math.abs(y0 - rh) > 1e-6) pushFace(b, { x: x1, y: Math.min(y0, rh), z: z0 }, { x: x1, y: Math.max(y0, rh), z: z0 }, { x: x1, y: Math.min(y0, rh), z: z1 }, { x: x1, y: Math.max(y0, rh), z: z1 }, uv, settings.wallShade);
    if (Math.abs(y0 - dh) > 1e-6) pushFace(b, { x: x0, y: Math.min(y0, dh), z: z1 }, { x: x1, y: Math.min(y0, dh), z: z1 }, { x: x0, y: Math.max(y0, dh), z: z1 }, { x: x1, y: Math.max(y0, dh), z: z1 }, uv, settings.wallShade);
  }

  for (const [file, data] of builders.entries()) {
    const tex = atlasTextures.get(file);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(data.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(data.c, 3));
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    terrainGroup.add(mesh);
    pickMeshes.push(mesh);
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span + 20, span + 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#2d3a2f' }));
  floor.position.y = floorY - 0.02;
  terrainGroup.add(floor);
}

async function regenerate() {
  if (rendering) return;
  rendering = true;
  regenBtn.disabled = true;
  regenBtn.textContent = 'Gerando...';
  pickInfo.textContent = 'Processando terreno 3D...';
  currentWorld = generate(seedInput.value, { ...DEFAULT_CONFIG, cityCount: 16, gymCount: 8 });
  await buildTerrain(currentWorld);
  regenBtn.disabled = false;
  regenBtn.textContent = 'Regenerar';
  pickInfo.textContent = 'Clique no terreno para inspecionar tile.';
  rendering = false;
}

function pickAt(clientX, clientY) {
  if (!currentWorld || !currentBounds) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return;
  const lx = Math.floor(hits[0].point.x + currentBounds.span * 0.5);
  const ly = Math.floor(hits[0].point.z + currentBounds.span * 0.5);
  if (lx < 0 || ly < 0 || lx >= currentBounds.span || ly >= currentBounds.span) return;
  const mx = currentBounds.startX + lx;
  const my = currentBounds.startY + ly;
  const t = getMicroTile(mx, my, currentWorld);
  const role = computeTerrainRoleAndSprite(mx, my, currentWorld, t.heightStep);
  pickInfo.textContent = `mx:${mx} my:${my} | h:${t.heightStep} | biome:${t.biomeId} | set:${role.setName ?? '-'} | sprite:${role.spriteId ?? '-'}`;
}

const gui = new GUI({ title: 'Render Params' });
gui.add(settings, 'microSpan', 96, 220, 1).name('Visible Tiles').onFinishChange(() => currentWorld && regenerate());
gui.add(settings, 'stepHeight', 0.25, 1.2, 0.01).name('Step Height').onFinishChange(() => currentWorld && regenerate());

renderer.domElement.addEventListener('pointerdown', (e) => { if (e.button === 0 && !rendering) pickAt(e.clientX, e.clientY); });
regenBtn.addEventListener('click', () => regenerate().catch((e) => { console.error(e); pickInfo.textContent = 'Falha ao regenerar terreno.'; rendering = false; }));
seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') regenerate().catch((e2) => { console.error(e2); pickInfo.textContent = 'Falha ao regenerar terreno.'; rendering = false; }); });
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

function updatePerfOverlay(nowTs) {
  if (nowTs - lastPerfPaintTs < 250) return;
  lastPerfPaintTs = nowTs;

  while (frameTimestamps.length > 0 && nowTs - frameTimestamps[0] > 5000) {
    frameTimestamps.shift();
  }

  let count1s = 0;
  for (let i = frameTimestamps.length - 1; i >= 0; i--) {
    if (nowTs - frameTimestamps[i] <= 1000) count1s++;
    else break;
  }

  const fpsNow = frameDurationsMs.length > 0 ? 1000 / frameDurationsMs[frameDurationsMs.length - 1] : 0;
  const fps1s = count1s;
  const fps5s = frameTimestamps.length / 5;
  const meanMs = frameDurationsMs.length > 0
    ? frameDurationsMs.reduce((sum, v) => sum + v, 0) / frameDurationsMs.length
    : 0;

  fpsNowEl.textContent = fpsNow.toFixed(1);
  fps1sEl.textContent = fps1s.toFixed(0);
  fps5sEl.textContent = fps5s.toFixed(1);
  frameMsEl.textContent = meanMs.toFixed(2);
}

function animate(nowTs) {
  const dt = Math.max(0.0001, nowTs - lastFrameTs);
  lastFrameTs = nowTs;
  frameTimestamps.push(nowTs);
  frameDurationsMs.push(dt);
  if (frameDurationsMs.length > FRAME_MS_WINDOW) frameDurationsMs.shift();

  controls.update();
  renderer.render(scene, camera);
  updatePerfOverlay(nowTs);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
regenerate().catch((e) => { console.error(e); pickInfo.textContent = 'Falha ao gerar terreno 3D.'; rendering = false; });
