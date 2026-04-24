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
    <label class="field">
      Seed
      <input id="seed-input" type="text" value="botw-25d-001" />
    </label>
    <button id="regen-btn" type="button">Regenerar</button>
    <p id="pick-info" class="hint">Clique no terreno para inspecionar tile.</p>
    <p class="hint">Scroll: zoom | Botao direito: pan</p>
  </aside>
`;

const viewport = document.getElementById('viewport');
const seedInput = document.getElementById('seed-input');
const regenBtn = document.getElementById('regen-btn');
const pickInfo = document.getElementById('pick-info');

const settings = {
  microSpan: 140,
  stepHeight: 0.55,
  wallShade: 0.72,
};

const TILE_PX = 16;
const atlasUrls = new Map();
const atlasTextures = new Map();
const pickMeshes = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let currentWorld = null;
let currentBounds = null;
let rendering = false;

const atlasModules = import.meta.glob('../../tilesets/*.png', { eager: true, import: 'default' });
for (const [k, v] of Object.entries(atlasModules)) {
  const fileName = k.split('/').pop();
  if (fileName) atlasUrls.set(fileName, v);
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
  const url = atlasUrls.get(fileName);
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

  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) {
      const mx = startX + x;
      const my = startY + y;
      const tile = getMicroTile(mx, my, world);
      const role = computeTerrainRoleAndSprite(mx, my, world, tile.heightStep);
      const set = role.set;
      const file = set?.file ? TessellationEngine.getImagePath(set.file).split('/').pop() : null;
      if (file) needed.add(file);
      cells[idx(span, x, y)] = {
        mx,
        my,
        h: tile.heightStep,
        biomeId: tile.biomeId,
        role,
        file,
        cols: TessellationEngine.getTerrainSheetCols(set),
        sprite: role.spriteId ?? set?.centerId ?? 0,
      };
    }
  }

  await Promise.all([...needed].map(textureFor));

  let minH = Infinity;
  for (const c of cells) minH = Math.min(minH, c.h);
  const floorY = (minH - 2) * settings.stepHeight;
  const half = span * 0.5;

  const builders = new Map();
  const getBuilder = (k) => {
    if (!builders.has(k)) builders.set(k, { p: [], u: [], c: [] });
    return builders.get(k);
  };

  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) {
      const cell = cells[idx(span, x, y)];
      if (!cell.file) continue;
      const tex = atlasTextures.get(cell.file);
      if (!tex) continue;
      const uv = uvRect(tex, cell.sprite, cell.cols);
      const b = getBuilder(cell.file);

      const x0 = x - half;
      const x1 = x0 + 1;
      const z0 = y - half;
      const z1 = z0 + 1;
      const y0 = cell.h * settings.stepHeight;

      pushFace(b, { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, uv, 1);

      const right = x + 1 < span ? cells[idx(span, x + 1, y)] : null;
      const down = y + 1 < span ? cells[idx(span, x, y + 1)] : null;
      const rh = right ? right.h * settings.stepHeight : floorY;
      const dh = down ? down.h * settings.stepHeight : floorY;

      if (Math.abs(y0 - rh) > 1e-6) {
        pushFace(
          b,
          { x: x1, y: Math.min(y0, rh), z: z0 },
          { x: x1, y: Math.max(y0, rh), z: z0 },
          { x: x1, y: Math.min(y0, rh), z: z1 },
          { x: x1, y: Math.max(y0, rh), z: z1 },
          uv,
          settings.wallShade,
        );
      }

      if (Math.abs(y0 - dh) > 1e-6) {
        pushFace(
          b,
          { x: x0, y: Math.min(y0, dh), z: z1 },
          { x: x1, y: Math.min(y0, dh), z: z1 },
          { x: x0, y: Math.max(y0, dh), z: z1 },
          { x: x1, y: Math.max(y0, dh), z: z1 },
          uv,
          settings.wallShade,
        );
      }
    }
  }

  for (const [file, data] of builders.entries()) {
    const tex = atlasTextures.get(file);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(data.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(data.c, 3));
    const m = new THREE.MeshBasicMaterial({
      map: tex,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    terrainGroup.add(mesh);
    pickMeshes.push(mesh);
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 20, span + 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#2d3a2f' }),
  );
  floor.position.y = floorY - 0.02;
  terrainGroup.add(floor);
}

async function regenerate() {
  if (rendering) return;
  rendering = true;
  regenBtn.disabled = true;
  regenBtn.textContent = 'Gerando...';
  pickInfo.textContent = 'Processando terreno 3D...';

  currentWorld = generate(seedInput.value, {
    ...DEFAULT_CONFIG,
    cityCount: 16,
    gymCount: 8,
  });

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
  const tile = getMicroTile(mx, my, currentWorld);
  const role = computeTerrainRoleAndSprite(mx, my, currentWorld, tile.heightStep);
  pickInfo.textContent = `mx:${mx} my:${my} | h:${tile.heightStep} | biome:${tile.biomeId} | set:${role.setName ?? '-'} | sprite:${role.spriteId ?? '-'}`;
}

const gui = new GUI({ title: 'Render Params' });
gui.add(settings, 'microSpan', 96, 220, 1).name('Visible Tiles').onFinishChange(() => {
  if (currentWorld) regenerate();
});
gui.add(settings, 'stepHeight', 0.25, 1.2, 0.01).name('Step Height').onFinishChange(() => {
  if (currentWorld) regenerate();
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || rendering) return;
  pickAt(e.clientX, e.clientY);
});

regenBtn.addEventListener('click', () => {
  regenerate().catch((e) => {
    console.error(e);
    pickInfo.textContent = 'Falha ao regenerar terreno.';
    rendering = false;
  });
});

seedInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  regenerate().catch((err) => {
    console.error(err);
    pickInfo.textContent = 'Falha ao regenerar terreno.';
    rendering = false;
  });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
regenerate().catch((e) => {
  console.error(e);
  pickInfo.textContent = 'Falha ao gerar terreno 3D.';
  rendering = false;
});
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
    <p id="pick-info" class="hint">Shift + clique para inspecionar tile.</p>
    <p class="hint">Scroll: zoom | Botao direito: pan</p>
  </aside>
`;

const viewport = document.getElementById('viewport');
const seedInput = document.getElementById('seed-input');
const regenBtn = document.getElementById('regen-btn');
const pickInfo = document.getElementById('pick-info');

const settings = { microSpan: 140, stepHeight: 0.55, wallShade: 0.72 };
const TILE_PX = 16;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const atlasUrls = new Map();
const atlasTextures = new Map();
const pickMeshes = [];
let currentWorld = null;
let currentBounds = null;
let rendering = false;

const atlasModules = import.meta.glob('../../tilesets/*.png', { eager: true, import: 'default' });
for (const [k, v] of Object.entries(atlasModules)) atlasUrls.set(k.split('/').pop(), v);

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
  const url = atlasUrls.get(fileName);
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
    const mx = startX + x; const my = startY + y;
    const t = getMicroTile(mx, my, world);
    const role = computeTerrainRoleAndSprite(mx, my, world, t.heightStep);
    const set = role.set;
    const file = set?.file ? TessellationEngine.getImagePath(set.file).split('/').pop() : null;
    if (file) needed.add(file);
    cells[idx(span, x, y)] = { mx, my, h: t.heightStep, role, file, cols: TessellationEngine.getTerrainSheetCols(set), sprite: role.spriteId ?? set?.centerId ?? 0 };
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
    const x0 = x - half, x1 = x0 + 1, z0 = y - half, z1 = z0 + 1, y0 = cell.h * settings.stepHeight;
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
  pickInfo.textContent = 'Shift + clique para inspecionar tile.';
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

new GUI({ title: 'Render Params' })
  .add(settings, 'microSpan', 96, 220, 1).name('Visible Tiles').onFinishChange(() => currentWorld && regenerate());
new GUI({ title: 'Terrain Params' })
  .add(settings, 'stepHeight', 0.25, 1.2, 0.01).name('Step Height').onFinishChange(() => currentWorld && regenerate());

renderer.domElement.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.shiftKey && !rendering) pickAt(e.clientX, e.clientY); });
regenBtn.addEventListener('click', () => regenerate().catch((e) => { console.error(e); pickInfo.textContent = 'Falha ao regenerar terreno.'; rendering = false; }));
seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') regenerate().catch((err) => { console.error(err); pickInfo.textContent = 'Falha ao regenerar terreno.'; rendering = false; }); });
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

(function animate() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate); })();
regenerate().catch((e) => { console.error(e); pickInfo.textContent = 'Falha ao gerar terreno 3D.'; rendering = false; });
/*
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
    <p>Terreno voxel 3D com sprites do tileset 2D.</p>
    <label class="field">
      Seed
      <input id="seed-input" type="text" value="botw-25d-001" />
    </label>
    <button id="regen-btn" type="button">Regenerar</button>
    <p id="pick-info" class="hint">Shift + clique para inspecionar tile.</p>
    <p class="hint">Scroll: zoom | Botao direito: pan</p>
  </aside>
`;

const viewport = document.getElementById('viewport');
const seedInput = document.getElementById('seed-input');
const regenBtn = document.getElementById('regen-btn');
const pickInfo = document.getElementById('pick-info');

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
controls.update();

const terrainGroup = new THREE.Group();
scene.add(terrainGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const renderSettings = {
  microSpan: 180,
  chunkSize: 24,
  stepHeight: 0.55,
  wallShade: 0.72,
};

const TILE_PX = 16;
const atlasUrlsByFileName = new Map();
const atlasTexturesByFileName = new Map();
const interactiveMeshes = [];

let currentWorld = null;
let currentRenderBounds = null;
let frameId = null;
let regenerating = false;

const atlasModules = import.meta.glob('../../tilesets/*.png', { eager: true, import: 'default' });
for (const [pathKey, url] of Object.entries(atlasModules)) {
  const fileName = pathKey.split('/').pop();
  if (fileName) atlasUrlsByFileName.set(fileName, url);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function idxFor(span, x, y) {
  return y * span + x;
}

function getCell(cells, span, lx, ly) {
  if (lx < 0 || lx >= span || ly < 0 || ly >= span) return null;
  return cells[idxFor(span, lx, ly)];
}

function getTilesetFileNameFromSet(set) {
  if (!set?.file) return null;
  const imagePath = TessellationEngine.getImagePath(set.file);
  const parts = imagePath.split('/');
  return parts[parts.length - 1] || null;
}

async function getTextureForFileName(fileName) {
  if (!fileName) return null;
  if (atlasTexturesByFileName.has(fileName)) return atlasTexturesByFileName.get(fileName);
  const url = atlasUrlsByFileName.get(fileName);
  if (!url) return null;

  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexturesByFileName.set(fileName, texture);
  return texture;
}

function clearTerrain() {
  interactiveMeshes.length = 0;
  for (const child of terrainGroup.children) {
    child.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose?.();
        if (obj.material && !Array.isArray(obj.material)) {
          obj.material.dispose?.();
        }
      }
    });
  }
  terrainGroup.clear();
}

async function buildCellData(world, span, startX, startY) {
  const cells = new Array(span * span);
  const neededTextureFiles = new Set();

  for (let ly = 0; ly < span; ly++) {
    for (let lx = 0; lx < span; lx++) {
      const mx = startX + lx;
      const my = startY + ly;
      const tile = getMicroTile(mx, my, world);
      const roleData = computeTerrainRoleAndSprite(mx, my, world, tile.heightStep);
      const set = roleData.set;
      const spriteId = roleData.spriteId ?? set?.centerId ?? 0;
      const sheetCols = TessellationEngine.getTerrainSheetCols(set);
      const textureFile = getTilesetFileNameFromSet(set);
      if (textureFile) neededTextureFiles.add(textureFile);

      cells[idxFor(span, lx, ly)] = {
        mx,
        my,
        biomeId: tile.biomeId,
        heightStep: tile.heightStep,
        setName: roleData.setName,
        set,
        spriteId,
        sheetCols,
        textureFile,
      };
    }
  }

  await Promise.all(Array.from(neededTextureFiles, (fileName) => getTextureForFileName(fileName)));
  return cells;
}

function uvRectForTile(texture, tileId, cols) {
  const texW = texture.image.width;
  const texH = texture.image.height;
  const sx = (tileId % cols) * TILE_PX;
  const sy = Math.floor(tileId / cols) * TILE_PX;
  const u0 = sx / texW;
  const u1 = (sx + TILE_PX) / texW;
  const v1 = 1 - sy / texH;
  const v0 = 1 - (sy + TILE_PX) / texH;
  return { u0, v0, u1, v1 };
}

function pushFace(builder, a, b, c, d, uv, tint = 1) {
  const { positions, uvs, colors } = builder;
  positions.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
  uvs.push(uv.u0, uv.v1, uv.u0, uv.v0, uv.u1, uv.v1);
  colors.push(tint, tint, tint, tint, tint, tint, tint, tint, tint);

  positions.push(b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  uvs.push(uv.u1, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0);
  colors.push(tint, tint, tint, tint, tint, tint, tint, tint, tint);
}

function getOrCreateBuilder(builders, textureFile) {
  if (!builders.has(textureFile)) {
    builders.set(textureFile, { positions: [], uvs: [], colors: [] });
  }
  return builders.get(textureFile);
}

function buildChunkMeshes(cells, span, chunkX, chunkY, chunkSize, baseFloorY) {
  const builders = new Map();
  const xEnd = Math.min(span, chunkX + chunkSize);
  const yEnd = Math.min(span, chunkY + chunkSize);
  const halfSpan = span * 0.5;
  const hScale = renderSettings.stepHeight;

  for (let ly = chunkY; ly < yEnd; ly++) {
    for (let lx = chunkX; lx < xEnd; lx++) {
      const cell = getCell(cells, span, lx, ly);
      if (!cell || !cell.textureFile || !cell.set) continue;
      const texture = atlasTexturesByFileName.get(cell.textureFile);
      if (!texture) continue;

      const uvTop = uvRectForTile(texture, cell.spriteId, cell.sheetCols);
      const builder = getOrCreateBuilder(builders, cell.textureFile);

      const x0 = lx - halfSpan;
      const x1 = x0 + 1;
      const z0 = ly - halfSpan;
      const z1 = z0 + 1;
      const topY = cell.heightStep * hScale;

      pushFace(
        builder,
        { x: x0, y: topY, z: z0 },
        { x: x1, y: topY, z: z0 },
        { x: x0, y: topY, z: z1 },
        { x: x1, y: topY, z: z1 },
        uvTop,
        1.0,
      );

      const right = getCell(cells, span, lx + 1, ly);
      const rightTopY = right ? right.heightStep * hScale : baseFloorY;
      if (Math.abs(topY - rightTopY) > 1e-6) {
        const owner = topY >= rightTopY ? cell : right;
        const ownerTexFile = owner?.textureFile || cell.textureFile;
        const ownerTex = atlasTexturesByFileName.get(ownerTexFile);
        const ownerCols = owner?.sheetCols ?? cell.sheetCols;
        const ownerSpriteId = owner?.spriteId ?? cell.spriteId;
        const uvWall = ownerTex ? uvRectForTile(ownerTex, ownerSpriteId, ownerCols) : uvTop;
        const wallBuilder = getOrCreateBuilder(builders, ownerTexFile);
        const hi = Math.max(topY, rightTopY);
        const lo = Math.min(topY, rightTopY);
        pushFace(
          wallBuilder,
          { x: x1, y: lo, z: z0 },
          { x: x1, y: hi, z: z0 },
          { x: x1, y: lo, z: z1 },
          { x: x1, y: hi, z: z1 },
          uvWall,
          renderSettings.wallShade,
        );
      }

      const down = getCell(cells, span, lx, ly + 1);
      const downTopY = down ? down.heightStep * hScale : baseFloorY;
      if (Math.abs(topY - downTopY) > 1e-6) {
        const owner = topY >= downTopY ? cell : down;
        const ownerTexFile = owner?.textureFile || cell.textureFile;
        const ownerTex = atlasTexturesByFileName.get(ownerTexFile);
        const ownerCols = owner?.sheetCols ?? cell.sheetCols;
        const ownerSpriteId = owner?.spriteId ?? cell.spriteId;
        const uvWall = ownerTex ? uvRectForTile(ownerTex, ownerSpriteId, ownerCols) : uvTop;
        const wallBuilder = getOrCreateBuilder(builders, ownerTexFile);
        const hi = Math.max(topY, downTopY);
        const lo = Math.min(topY, downTopY);
        pushFace(
          wallBuilder,
          { x: x0, y: lo, z: z1 },
          { x: x1, y: lo, z: z1 },
          { x: x0, y: hi, z: z1 },
          { x: x1, y: hi, z: z1 },
          uvWall,
          renderSettings.wallShade,
        );
      }
    }
  }

  const meshes = [];
  for (const [textureFile, data] of builders.entries()) {
    const texture = atlasTexturesByFileName.get(textureFile);
    if (!texture || data.positions.length === 0) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    meshes.push(mesh);
  }

  return meshes;
}

async function buildWorldMesh(world) {
  clearTerrain();

  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const span = clamp(Math.floor(renderSettings.microSpan), 32, Math.min(microW, microH));
  const startX = clamp(Math.floor((microW - span) * 0.5), 0, microW - span);
  const startY = clamp(Math.floor((microH - span) * 0.5), 0, microH - span);
  currentRenderBounds = { span, startX, startY };

  const cells = await buildCellData(world, span, startX, startY);
  let minStep = Infinity;
  for (const c of cells) {
    if (c.heightStep < minStep) minStep = c.heightStep;
  }
  const baseFloorY = (minStep - 2) * renderSettings.stepHeight;

  const chunkSize = clamp(Math.floor(renderSettings.chunkSize), 8, 48);
  for (let y = 0; y < span; y += chunkSize) {
    for (let x = 0; x < span; x += chunkSize) {
      const chunkMeshes = buildChunkMeshes(cells, span, x, y, chunkSize, baseFloorY);
      for (const mesh of chunkMeshes) {
        terrainGroup.add(mesh);
        interactiveMeshes.push(mesh);
      }
    }
  }

  const floorGeo = new THREE.PlaneGeometry(span + 32, span + 32, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshBasicMaterial({ color: '#2d3a2f' });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = baseFloorY - 0.02;
  terrainGroup.add(floor);
}

async function regenerate() {
  if (regenerating) return;
  regenerating = true;
  regenBtn.disabled = true;
  regenBtn.textContent = 'Gerando...';
  pickInfo.textContent = 'Processando terreno 3D...';

  currentWorld = generate(seedInput.value, {
    ...DEFAULT_CONFIG,
    cityCount: 16,
    gymCount: 8,
  });

  try {
    await buildWorldMesh(currentWorld);
    pickInfo.textContent = 'Shift + clique para inspecionar tile.';
  } finally {
    regenBtn.disabled = false;
    regenBtn.textContent = 'Regenerar';
    regenerating = false;
  }
}

function setupGui() {
  const gui = new GUI({ title: 'Render Params' });
  gui.add(renderSettings, 'microSpan', 96, 320, 1).name('Visible Tiles').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
  gui.add(renderSettings, 'chunkSize', 8, 40, 1).name('Chunk Size').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
  gui.add(renderSettings, 'stepHeight', 0.25, 1.2, 0.01).name('Step Height').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
  gui.add(renderSettings, 'wallShade', 0.35, 1.0, 0.01).name('Wall Shade').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
}

function handlePointerPick(clientX, clientY) {
  if (!currentWorld || !currentRenderBounds || interactiveMeshes.length === 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactiveMeshes, false);
  if (hits.length === 0) return;

  const hit = hits[0];
  const { span, startX, startY } = currentRenderBounds;
  const localX = Math.floor(hit.point.x + span * 0.5);
  const localY = Math.floor(hit.point.z + span * 0.5);
  if (localX < 0 || localX >= span || localY < 0 || localY >= span) return;

  const mx = startX + localX;
  const my = startY + localY;
  const tile = getMicroTile(mx, my, currentWorld);
  const role = computeTerrainRoleAndSprite(mx, my, currentWorld, tile.heightStep);
  pickInfo.textContent = `mx:${mx} my:${my} | h:${tile.heightStep} | biome:${tile.biomeId} | set:${role.setName ?? '-'} | sprite:${role.spriteId ?? '-'}`;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.shiftKey || regenerating) return;
  handlePointerPick(event.clientX, event.clientY);
});

regenBtn.addEventListener('click', () => {
  regenerate().catch((err) => {
    console.error(err);
    pickInfo.textContent = 'Falha ao regenerar terreno. Veja console.';
  });
});

seedInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  regenerate().catch((err) => {
    console.error(err);
    pickInfo.textContent = 'Falha ao regenerar terreno. Veja console.';
  });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  frameId = requestAnimationFrame(animate);
}

setupGui();
regenerate().catch((err) => {
  console.error(err);
  pickInfo.textContent = 'Falha ao gerar terreno 3D. Veja console.';
});
animate();

window.addEventListener('beforeunload', () => {
  if (frameId !== null) cancelAnimationFrame(frameId);
});
*/
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
    <p>Terreno voxel 3D com sprites do tileset 2D.</p>
    <label class="field">
      Seed
      <input id="seed-input" type="text" value="botw-25d-001" />
    </label>
    <button id="regen-btn" type="button">Regenerar</button>
    <p id="pick-info" class="hint">Shift + clique para inspecionar tile.</p>
    <p class="hint">Scroll: zoom | Botao direito: pan</p>
  </aside>
`;

const viewport = document.getElementById('viewport');
const seedInput = document.getElementById('seed-input');
const regenBtn = document.getElementById('regen-btn');
const pickInfo = document.getElementById('pick-info');

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
controls.update();

const terrainGroup = new THREE.Group();
scene.add(terrainGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const renderSettings = {
  microSpan: 180,
  chunkSize: 24,
  stepHeight: 0.55,
  wallShade: 0.72,
};

const TILE_PX = 16;
const atlasUrlsByFileName = new Map();
const atlasTexturesByFileName = new Map();
const interactiveMeshes = [];

let currentWorld = null;
let currentRenderBounds = null;
let frameId = null;
let regenerating = false;

const atlasModules = import.meta.glob('../../tilesets/*.png', { eager: true, import: 'default' });
for (const [pathKey, url] of Object.entries(atlasModules)) {
  const fileName = pathKey.split('/').pop();
  if (fileName) atlasUrlsByFileName.set(fileName, url);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function idxFor(span, x, y) {
  return y * span + x;
}

function getCell(cells, span, lx, ly) {
  if (lx < 0 || lx >= span || ly < 0 || ly >= span) return null;
  return cells[idxFor(span, lx, ly)];
}

function getTilesetFileNameFromSet(set) {
  if (!set?.file) return null;
  const imagePath = TessellationEngine.getImagePath(set.file);
  const parts = imagePath.split('/');
  return parts[parts.length - 1] || null;
}

async function getTextureForFileName(fileName) {
  if (!fileName) return null;
  if (atlasTexturesByFileName.has(fileName)) return atlasTexturesByFileName.get(fileName);
  const url = atlasUrlsByFileName.get(fileName);
  if (!url) return null;

  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexturesByFileName.set(fileName, texture);
  return texture;
}

function clearTerrain() {
  interactiveMeshes.length = 0;
  for (const child of terrainGroup.children) {
    child.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose?.();
        if (obj.material && !Array.isArray(obj.material)) {
          obj.material.dispose?.();
        }
      }
    });
  }
  terrainGroup.clear();
}

async function buildCellData(world, span, startX, startY) {
  const cells = new Array(span * span);
  const neededTextureFiles = new Set();

  for (let ly = 0; ly < span; ly++) {
    for (let lx = 0; lx < span; lx++) {
      const mx = startX + lx;
      const my = startY + ly;
      const tile = getMicroTile(mx, my, world);
      const roleData = computeTerrainRoleAndSprite(mx, my, world, tile.heightStep);
      const set = roleData.set;
      const spriteId = roleData.spriteId ?? set?.centerId ?? 0;
      const sheetCols = TessellationEngine.getTerrainSheetCols(set);
      const textureFile = getTilesetFileNameFromSet(set);
      if (textureFile) neededTextureFiles.add(textureFile);

      cells[idxFor(span, lx, ly)] = {
        mx,
        my,
        biomeId: tile.biomeId,
        heightStep: tile.heightStep,
        setName: roleData.setName,
        set,
        spriteId,
        sheetCols,
        textureFile,
      };
    }
  }

  await Promise.all(Array.from(neededTextureFiles, (fileName) => getTextureForFileName(fileName)));
  return cells;
}

function uvRectForTile(texture, tileId, cols) {
  const texW = texture.image.width;
  const texH = texture.image.height;
  const sx = (tileId % cols) * TILE_PX;
  const sy = Math.floor(tileId / cols) * TILE_PX;
  const u0 = sx / texW;
  const u1 = (sx + TILE_PX) / texW;
  const v1 = 1 - sy / texH;
  const v0 = 1 - (sy + TILE_PX) / texH;
  return { u0, v0, u1, v1 };
}

function pushFace(builder, a, b, c, d, uv, tint = 1) {
  const { positions, uvs, colors } = builder;

  positions.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
  uvs.push(uv.u0, uv.v1, uv.u0, uv.v0, uv.u1, uv.v1);
  colors.push(tint, tint, tint, tint, tint, tint, tint, tint, tint);

  positions.push(b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  uvs.push(uv.u1, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0);
  colors.push(tint, tint, tint, tint, tint, tint, tint, tint, tint);
}

function getOrCreateBuilder(builders, textureFile) {
  if (!builders.has(textureFile)) {
    builders.set(textureFile, { positions: [], uvs: [], colors: [] });
  }
  return builders.get(textureFile);
}

function buildChunkMeshes(cells, span, chunkX, chunkY, chunkSize, baseFloorY) {
  const builders = new Map();
  const xEnd = Math.min(span, chunkX + chunkSize);
  const yEnd = Math.min(span, chunkY + chunkSize);
  const halfSpan = span * 0.5;
  const hScale = renderSettings.stepHeight;

  for (let ly = chunkY; ly < yEnd; ly++) {
    for (let lx = chunkX; lx < xEnd; lx++) {
      const cell = getCell(cells, span, lx, ly);
      if (!cell || !cell.textureFile || !cell.set) continue;

      const texture = atlasTexturesByFileName.get(cell.textureFile);
      if (!texture) continue;
      const uvTop = uvRectForTile(texture, cell.spriteId, cell.sheetCols);
      const builder = getOrCreateBuilder(builders, cell.textureFile);

      const x0 = lx - halfSpan;
      const x1 = x0 + 1;
      const z0 = ly - halfSpan;
      const z1 = z0 + 1;
      const topY = cell.heightStep * hScale;

      pushFace(
        builder,
        { x: x0, y: topY, z: z0 },
        { x: x1, y: topY, z: z0 },
        { x: x0, y: topY, z: z1 },
        { x: x1, y: topY, z: z1 },
        uvTop,
        1.0,
      );

      const right = getCell(cells, span, lx + 1, ly);
      const rightTopY = right ? right.heightStep * hScale : baseFloorY;
      if (Math.abs(topY - rightTopY) > 1e-6) {
        const owner = topY >= rightTopY ? cell : right;
        const ownerTexFile = owner?.textureFile || cell.textureFile;
        const ownerTex = atlasTexturesByFileName.get(ownerTexFile);
        const ownerCols = owner?.sheetCols ?? cell.sheetCols;
        const ownerSpriteId = owner?.spriteId ?? cell.spriteId;
        const uvWall = ownerTex ? uvRectForTile(ownerTex, ownerSpriteId, ownerCols) : uvTop;
        const wallBuilder = getOrCreateBuilder(builders, ownerTexFile);
        const hi = Math.max(topY, rightTopY);
        const lo = Math.min(topY, rightTopY);
        pushFace(
          wallBuilder,
          { x: x1, y: lo, z: z0 },
          { x: x1, y: hi, z: z0 },
          { x: x1, y: lo, z: z1 },
          { x: x1, y: hi, z: z1 },
          uvWall,
          renderSettings.wallShade,
        );
      }

      const down = getCell(cells, span, lx, ly + 1);
      const downTopY = down ? down.heightStep * hScale : baseFloorY;
      if (Math.abs(topY - downTopY) > 1e-6) {
        const owner = topY >= downTopY ? cell : down;
        const ownerTexFile = owner?.textureFile || cell.textureFile;
        const ownerTex = atlasTexturesByFileName.get(ownerTexFile);
        const ownerCols = owner?.sheetCols ?? cell.sheetCols;
        const ownerSpriteId = owner?.spriteId ?? cell.spriteId;
        const uvWall = ownerTex ? uvRectForTile(ownerTex, ownerSpriteId, ownerCols) : uvTop;
        const wallBuilder = getOrCreateBuilder(builders, ownerTexFile);
        const hi = Math.max(topY, downTopY);
        const lo = Math.min(topY, downTopY);
        pushFace(
          wallBuilder,
          { x: x0, y: lo, z: z1 },
          { x: x1, y: lo, z: z1 },
          { x: x0, y: hi, z: z1 },
          { x: x1, y: hi, z: z1 },
          uvWall,
          renderSettings.wallShade,
        );
      }
    }
  }

  const meshes = [];
  for (const [textureFile, data] of builders.entries()) {
    const texture = atlasTexturesByFileName.get(textureFile);
    if (!texture || data.positions.length === 0) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    meshes.push(mesh);
  }

  return meshes;
}

async function buildWorldMesh(world) {
  clearTerrain();

  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const span = clamp(Math.floor(renderSettings.microSpan), 32, Math.min(microW, microH));
  const startX = clamp(Math.floor((microW - span) * 0.5), 0, microW - span);
  const startY = clamp(Math.floor((microH - span) * 0.5), 0, microH - span);
  currentRenderBounds = { span, startX, startY };

  const cells = await buildCellData(world, span, startX, startY);
  let minStep = Infinity;
  for (const c of cells) {
    if (c.heightStep < minStep) minStep = c.heightStep;
  }
  const baseFloorY = (minStep - 2) * renderSettings.stepHeight;

  const chunkSize = clamp(Math.floor(renderSettings.chunkSize), 8, 48);
  for (let y = 0; y < span; y += chunkSize) {
    for (let x = 0; x < span; x += chunkSize) {
      const chunkMeshes = buildChunkMeshes(cells, span, x, y, chunkSize, baseFloorY);
      for (const mesh of chunkMeshes) {
        terrainGroup.add(mesh);
        interactiveMeshes.push(mesh);
      }
    }
  }

  const floorGeo = new THREE.PlaneGeometry(span + 32, span + 32, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshBasicMaterial({ color: '#2d3a2f' });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = baseFloorY - 0.02;
  terrainGroup.add(floor);
}

async function regenerate() {
  if (regenerating) return;
  regenerating = true;
  regenBtn.disabled = true;
  regenBtn.textContent = 'Gerando...';
  pickInfo.textContent = 'Processando terreno 3D...';

  currentWorld = generate(seedInput.value, {
    ...DEFAULT_CONFIG,
    cityCount: 16,
    gymCount: 8,
  });

  try {
    await buildWorldMesh(currentWorld);
    pickInfo.textContent = 'Shift + clique para inspecionar tile.';
  } finally {
    regenBtn.disabled = false;
    regenBtn.textContent = 'Regenerar';
    regenerating = false;
  }
}

function setupGui() {
  const gui = new GUI({ title: 'Render Params' });
  gui.add(renderSettings, 'microSpan', 96, 320, 1).name('Visible Tiles').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
  gui.add(renderSettings, 'chunkSize', 8, 40, 1).name('Chunk Size').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
  gui.add(renderSettings, 'stepHeight', 0.25, 1.2, 0.01).name('Step Height').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
  gui.add(renderSettings, 'wallShade', 0.35, 1.0, 0.01).name('Wall Shade').onFinishChange(() => {
    if (currentWorld) regenerate();
  });
}

function handlePointerPick(clientX, clientY) {
  if (!currentWorld || !currentRenderBounds || interactiveMeshes.length === 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactiveMeshes, false);
  if (hits.length === 0) return;

  const hit = hits[0];
  const { span, startX, startY } = currentRenderBounds;
  const localX = Math.floor(hit.point.x + span * 0.5);
  const localY = Math.floor(hit.point.z + span * 0.5);
  if (localX < 0 || localX >= span || localY < 0 || localY >= span) return;

  const mx = startX + localX;
  const my = startY + localY;
  const tile = getMicroTile(mx, my, currentWorld);
  const role = computeTerrainRoleAndSprite(mx, my, currentWorld, tile.heightStep);
  pickInfo.textContent = `mx:${mx} my:${my} | h:${tile.heightStep} | biome:${tile.biomeId} | set:${role.setName ?? '-'} | sprite:${role.spriteId ?? '-'}`;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.shiftKey || regenerating) return;
  handlePointerPick(event.clientX, event.clientY);
});

regenBtn.addEventListener('click', () => {
  regenerate().catch((err) => {
    console.error(err);
    pickInfo.textContent = 'Falha ao regenerar terreno. Veja console.';
  });
});

seedInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  regenerate().catch((err) => {
    console.error(err);
    pickInfo.textContent = 'Falha ao regenerar terreno. Veja console.';
  });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  frameId = requestAnimationFrame(animate);
}

setupGui();
regenerate().catch((err) => {
  console.error(err);
  pickInfo.textContent = 'Falha ao gerar terreno 3D. Veja console.';
});
animate();

window.addEventListener('beforeunload', () => {
  if (frameId !== null) cancelAnimationFrame(frameId);
});
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { generate, DEFAULT_CONFIG } from '../../js/generator.js';
import { BIOMES } from '../../js/biomes.js';

document.querySelector('#app').innerHTML = `
  <div id="viewport"></div>
  <aside class="hud">
    <h1>Gerador 25D (Three.js)</h1>
    <p>Render experimental consumindo o mesmo engine procedural.</p>
    <label class="field">
      Seed
      <input id="seed-input" type="text" value="botw-25d-001" />
    </label>
    <button id="regen-btn" type="button">Regenerar</button>
    <p class="hint">Scroll: zoom | Botao direito: pan</p>
  </aside>
`;

const viewport = document.getElementById('viewport');
const seedInput = document.getElementById('seed-input');
const regenBtn = document.getElementById('regen-btn');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b9d8ff');
scene.fog = new THREE.Fog('#b9d8ff', 120, 500);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(140, 120, 140);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.minDistance = 60;
controls.maxDistance = 320;
controls.minPolarAngle = Math.PI * 0.2;
controls.maxPolarAngle = Math.PI * 0.42;
controls.enableRotate = false;
controls.update();

scene.add(new THREE.AmbientLight('#ffffff', 0.7));
const sun = new THREE.DirectionalLight('#fff4d6', 1.1);
sun.position.set(120, 160, 80);
scene.add(sun);

const terrainGroup = new THREE.Group();
scene.add(terrainGroup);

const biomeColorById = new Map(
  Object.values(BIOMES).map((biome) => [biome.id, new THREE.Color(biome.color)]),
);
const fallbackBiomeColor = new THREE.Color('#6ea96e');
const CHUNK_SIZE = 32;
const TERRAIN_BOTTOM_Y = -14;

const renderSettings = {
  heightScale: 7,
  landTerraces: 26,
  waterTerraces: 14,
  cliffSharpness: 1.32,
  wallShade: 0.58,
  nearLodDistance: 85,
  farLodDistance: 150,
};

let currentWorld = null;
let frameId = null;
let terrainMaterialNear = null;
let terrainMaterialFar = null;

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function toTerracedElevation(elevation01, world) {
  const wl = world.config?.waterLevel ?? DEFAULT_CONFIG.waterLevel;
  const elev = clamp01(elevation01);
  if (elev < wl) {
    const t = wl > 1e-6 ? elev / wl : 0;
    const stepped = Math.floor(t * renderSettings.waterTerraces) / Math.max(1, renderSettings.waterTerraces);
    return stepped * wl;
  }

  const above = 1 - wl;
  const raw = above > 1e-6 ? (elev - wl) / above : 1;
  const shaped = Math.pow(clamp01(raw), renderSettings.cliffSharpness);
  const stepped = Math.floor(shaped * renderSettings.landTerraces) / Math.max(1, renderSettings.landTerraces);
  return wl + stepped * above;
}

function getWorldElevationAt(world, x, y) {
  const clampedX = Math.max(0, Math.min(world.width - 1, x));
  const clampedY = Math.max(0, Math.min(world.height - 1, y));
  const idx = clampedY * world.width + clampedX;
  return world.cells[idx];
}

function getTerracedHeightY(world, x, y) {
  const terraced = toTerracedElevation(getWorldElevationAt(world, x, y), world);
  return terraced * renderSettings.heightScale;
}

function getCellTerracedHeightY(world, x, y, sampleStride = 1) {
  const centerX = Math.round(x + sampleStride * 0.5);
  const centerY = Math.round(y + sampleStride * 0.5);
  return getTerracedHeightY(world, centerX, centerY);
}

function shadeColor(color, factor) {
  return {
    r: color.r * factor,
    g: color.g * factor,
    b: color.b * factor,
  };
}

function createTerrainShaderMaterial(detailFactor) {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      uLightDir: { value: new THREE.Vector3(0.72, 1.0, 0.5).normalize() },
      uFogColor: { value: scene.fog.color.clone() },
      uFogNear: { value: scene.fog.near },
      uFogFar: { value: scene.fog.far },
      uDetailFactor: { value: detailFactor },
    },
    vertexShader: `
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vColor = color;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uLightDir;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uDetailFactor;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      vec3 linearToSrgbFast(vec3 c) {
        return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
      }
      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 lightDir = normalize(uLightDir);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);

        float ndl = max(dot(normal, lightDir), 0.0);
        float toon = floor(ndl * 3.5) / 3.5;

        vec3 baseColor = mix(vColor * 0.82, vColor * 1.1, uDetailFactor);
        vec3 lit = baseColor * (0.46 + toon * 0.68);

        float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.2);
        lit += rim * 0.14 * baseColor;

        float fogDepth = length(cameraPosition - vWorldPos);
        float fogFactor = smoothstep(uFogNear, uFogFar, fogDepth);
        vec3 finalColor = mix(lit, uFogColor, fogFactor);

        gl_FragColor = vec4(linearToSrgbFast(finalColor), 1.0);
      }
    `,
  });
}

function buildChunkGeometry(world, xStart, yStart, xEnd, yEnd, sampleStride) {
  const positions = [];
  const normals = [];
  const colors = [];
  const halfW = (world.width - 1) * 0.5;
  const halfH = (world.height - 1) * 0.5;
  const eps = 0.001;

  function pushVertex(px, py, pz, nx, ny, nz, color) {
    positions.push(px, py, pz);
    normals.push(nx, ny, nz);
    colors.push(color.r, color.g, color.b);
  }

  function pushTri(a, b, c, normal, color) {
    pushVertex(a.x, a.y, a.z, normal.x, normal.y, normal.z, color);
    pushVertex(b.x, b.y, b.z, normal.x, normal.y, normal.z, color);
    pushVertex(c.x, c.y, c.z, normal.x, normal.y, normal.z, color);
  }

  function pushQuad(a, b, c, d, normal, color) {
    // Force triangle winding to match the provided normal so backface culling
    // does not randomly hide top faces depending on local axis ordering.
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const dot = cx * normal.x + cy * normal.y + cz * normal.z;

    if (dot >= 0) {
      pushTri(a, b, c, normal, color);
      pushTri(c, b, d, normal, color);
    } else {
      pushTri(a, c, b, normal, color);
      pushTri(c, d, b, normal, color);
    }
  }

  for (let gy = yStart; gy < yEnd; gy += sampleStride) {
    for (let gx = xStart; gx < xEnd; gx += sampleStride) {
      const idx = gy * world.width + gx;
      const topColor = biomeColorById.get(world.biomes[idx]) || fallbackBiomeColor;
      const wallColor = shadeColor(topColor, renderSettings.wallShade);

      const x0 = gx - halfW;
      const x1 = gx + sampleStride - halfW;
      const z0 = gy - halfH;
      const z1 = gy + sampleStride - halfH;

      const h = getCellTerracedHeightY(world, gx, gy, sampleStride);
      const p00 = { x: x0, y: h, z: z0 };
      const p10 = { x: x1, y: h, z: z0 };
      const p01 = { x: x0, y: h, z: z1 };
      const p11 = { x: x1, y: h, z: z1 };

      // Flat top per cell (voxel-like terrace), matching terrain-steps reference style.
      pushQuad(p00, p10, p01, p11, { x: 0, y: 1, z: 0 }, topColor);

      const rightX = gx + sampleStride;
      const hasRight = rightX < world.width - 1;
      const rightHeight = hasRight
        ? getCellTerracedHeightY(world, rightX, gy, sampleStride)
        : TERRAIN_BOTTOM_Y;
      if (Math.abs(h - rightHeight) > eps) {
        const topY = Math.max(h, rightHeight);
        const botY = Math.min(h, rightHeight);
        const normalX = h > rightHeight ? 1 : -1;
        const a = { x: x1, y: botY, z: z0 };
        const b = { x: x1, y: topY, z: z0 };
        const c = { x: x1, y: botY, z: z1 };
        const d = { x: x1, y: topY, z: z1 };
        pushQuad(a, b, c, d, { x: normalX, y: 0, z: 0 }, wallColor);
      }

      const bottomYCell = gy + sampleStride;
      const hasBottom = bottomYCell < world.height - 1;
      const bottomHeight = hasBottom
        ? getCellTerracedHeightY(world, gx, bottomYCell, sampleStride)
        : TERRAIN_BOTTOM_Y;
      if (Math.abs(h - bottomHeight) > eps) {
        const topY = Math.max(h, bottomHeight);
        const botY = Math.min(h, bottomHeight);
        const normalZ = h > bottomHeight ? 1 : -1;
        const a = { x: x0, y: botY, z: z1 };
        const b = { x: x1, y: botY, z: z1 };
        const c = { x: x0, y: topY, z: z1 };
        const d = { x: x1, y: topY, z: z1 };
        pushQuad(a, b, c, d, { x: 0, y: 0, z: normalZ }, wallColor);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function buildChunkLod(world, xStart, yStart, xEnd, yEnd) {
  const lod = new THREE.LOD();
  lod.autoUpdate = false;

  const nearGeometry = buildChunkGeometry(world, xStart, yStart, xEnd, yEnd, 1);
  const farGeometry = buildChunkGeometry(world, xStart, yStart, xEnd, yEnd, 2);

  const nearMesh = new THREE.Mesh(nearGeometry, terrainMaterialNear);
  const farMesh = new THREE.Mesh(farGeometry, terrainMaterialFar);
  nearMesh.frustumCulled = true;
  farMesh.frustumCulled = true;

  lod.addLevel(nearMesh, 0);
  lod.addLevel(farMesh, renderSettings.nearLodDistance);

  const cx = (xStart + xEnd) * 0.5 - (world.width - 1) * 0.5;
  const cz = (yStart + yEnd) * 0.5 - (world.height - 1) * 0.5;
  const dist = Math.hypot(cx, cz);
  lod.position.set(0, 0, 0);
  lod.userData.centerDist = dist;
  return lod;
}

function buildTerrainFloor(world) {
  const floorGeo = new THREE.PlaneGeometry(world.width + 100, world.height + 100, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: '#4b5d44',
    roughness: 1,
    metalness: 0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = TERRAIN_BOTTOM_Y;
  terrainGroup.add(floor);
}

function buildWorldMesh(world) {
  terrainGroup.clear();

  const width = world.width;
  const height = world.height;
  const halfW = (width - 1) * 0.5;
  const halfH = (height - 1) * 0.5;
  terrainMaterialNear = createTerrainShaderMaterial(1.0);
  terrainMaterialFar = createTerrainShaderMaterial(0.72);

  for (let y = 0; y < height - 1; y += CHUNK_SIZE) {
    for (let x = 0; x < width - 1; x += CHUNK_SIZE) {
      const xEnd = Math.min(width - 1, x + CHUNK_SIZE);
      const yEnd = Math.min(height - 1, y + CHUNK_SIZE);
      const chunkLod = buildChunkLod(world, x, y, xEnd, yEnd);
      terrainGroup.add(chunkLod);
    }
  }
  buildTerrainFloor(world);

  const points = [];
  for (const path of world.paths) {
    if (!path || path.length < 2) continue;
    for (const cell of path) {
      const yPos = getTerracedHeightY(world, cell.x, cell.y) + 0.35;
      points.push(new THREE.Vector3(cell.x - halfW, yPos, cell.y - halfH));
    }
  }
  if (points.length > 1) {
    const roadGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const roadMaterial = new THREE.LineBasicMaterial({ color: '#c9b16b', transparent: true, opacity: 0.8 });
    terrainGroup.add(new THREE.Line(roadGeometry, roadMaterial));
  }

  for (const node of world.graph.nodes) {
    const yPos = getTerracedHeightY(world, node.x, node.y) + 1.0;
    const markerGeo = new THREE.SphereGeometry(node.isGym ? 1.3 : 0.9, 10, 10);
    const markerMat = new THREE.MeshStandardMaterial({
      color: node.isGym ? '#ff4b4b' : '#ffffff',
      emissive: node.isGym ? '#7a1515' : '#2f2f2f',
      emissiveIntensity: 0.4,
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(node.x - halfW, yPos, node.y - halfH);
    terrainGroup.add(marker);
  }

  controls.target.set(0, 0, 0);
  camera.lookAt(0, 0, 0);
  controls.update();
}

function regenerate() {
  currentWorld = generate(seedInput.value, {
    ...DEFAULT_CONFIG,
    cityCount: 16,
    gymCount: 8,
  });
  buildWorldMesh(currentWorld);
}

function setupGui() {
  const gui = new GUI({ title: 'Render Params' });
  gui.add(renderSettings, 'heightScale', 24, 90, 1).name('Height Scale').onFinishChange(() => {
    if (currentWorld) buildWorldMesh(currentWorld);
  });
  gui.add(renderSettings, 'landTerraces', 8, 40, 1).name('Land Steps').onFinishChange(() => {
    if (currentWorld) buildWorldMesh(currentWorld);
  });
  gui.add(renderSettings, 'waterTerraces', 4, 24, 1).name('Water Steps').onFinishChange(() => {
    if (currentWorld) buildWorldMesh(currentWorld);
  });
  gui.add(renderSettings, 'cliffSharpness', 0.75, 2.0, 0.01).name('Cliff Sharpness').onFinishChange(() => {
    if (currentWorld) buildWorldMesh(currentWorld);
  });
  gui.add(renderSettings, 'wallShade', 0.25, 1.0, 0.01).name('Wall Shade').onFinishChange(() => {
    if (currentWorld) buildWorldMesh(currentWorld);
  });
}

function updateTerrainLod() {
  const cameraDist = camera.position.distanceTo(controls.target);
  for (const child of terrainGroup.children) {
    if (!(child instanceof THREE.LOD)) continue;
    // Hide very distant chunks to reduce draw calls.
    if (child.userData.centerDist > cameraDist + renderSettings.farLodDistance) {
      child.visible = false;
      continue;
    }
    child.visible = true;
    child.update(camera);
  }
}

regenBtn.addEventListener('click', regenerate);
seedInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') regenerate();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  controls.update();
  updateTerrainLod();
  renderer.render(scene, camera);
  frameId = requestAnimationFrame(animate);
}

setupGui();
regenerate();
animate();

window.addEventListener('beforeunload', () => {
  if (frameId !== null) cancelAnimationFrame(frameId);
});
