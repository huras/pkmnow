import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.21/+esm';
import { generate, DEFAULT_CONFIG } from '../js/generator.js';
import { getMicroTile, MACRO_TILE_STRIDE } from '../js/chunking.js';
import { computeTerrainRoleAndSprite } from '../js/main/terrain-role-helpers.js';
import { TessellationEngine } from '../js/tessellation-engine.js';
import { BIOMES } from '../js/biomes.js';

document.querySelector('#app').innerHTML = `
  <div id="viewport"></div>
  <aside class="hud">
    <h1>Gerador 25D (Three.js)</h1>
    <p>World map macro + detail micro.</p>
    <label class="field">Seed<input id="seed-input" type="text" value="botw-25d-001" /></label>
    <div style="display:flex;gap:8px;">
      <button id="regen-btn" type="button">Regenerar</button>
      <button id="world-btn" type="button">World Map</button>
      <button id="detail-btn" type="button">Detail View</button>
    </div>
    <p id="pick-info" class="hint">Hover macro tiles in World mode, click to open Detail.</p>
    <div class="perf-panel">
      <div><span>FPS now</span><strong id="fps-now">--</strong></div>
      <div><span>FPS 1s</span><strong id="fps-1s">--</strong></div>
      <div><span>FPS 5s</span><strong id="fps-5s">--</strong></div>
      <div><span>Frame ms</span><strong id="frame-ms">--</strong></div>
      <div><span>Triangles</span><strong id="tri-count">--</strong></div>
      <div><span>Macro</span><strong id="macro-coord">--</strong></div>
    </div>
  </aside>
`;

const viewport = document.getElementById('viewport');
const seedInput = document.getElementById('seed-input');
const regenBtn = document.getElementById('regen-btn');
const worldBtn = document.getElementById('world-btn');
const detailBtn = document.getElementById('detail-btn');
const pickInfo = document.getElementById('pick-info');
const fpsNowEl = document.getElementById('fps-now');
const fps1sEl = document.getElementById('fps-1s');
const fps5sEl = document.getElementById('fps-5s');
const frameMsEl = document.getElementById('frame-ms');
const triCountEl = document.getElementById('tri-count');
const macroCoordEl = document.getElementById('macro-coord');

const settings = { microSpan: 96, stepHeight: 0.55, wallShade: 0.72, worldHeightScale: 10 };
const debugSettings = { showAxes: true, axesSize: 24, wireframeOnly: false };

const TILE_PX = 16;
const atlasTextures = new Map();
const pickMeshes = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let currentWorld = null;
let currentBounds = null;
let rendering = false;
let viewMode = 'world';
let hoverMacro = null;
let selectedMacro = null;
let pendingMacroDown = null;

let worldMesh = null;
let detailFloorMesh = null;
let lastFrameTs = performance.now();
let lastPerfPaintTs = lastFrameTs;
const frameTimestamps = [];
const frameDurationsMs = [];
const FRAME_MS_WINDOW = 120;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#7ea8d8');
scene.fog = new THREE.Fog('#7ea8d8', 120, 420);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(130, 150, 130);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.minDistance = 40;
controls.maxDistance = 500;
controls.minPolarAngle = Math.PI * 0.15;
controls.maxPolarAngle = Math.PI * 0.48;
controls.enableRotate = true;

const worldGroup = new THREE.Group();
const detailGroup = new THREE.Group();
scene.add(worldGroup);
scene.add(detailGroup);

const axesHelper = new THREE.AxesHelper(debugSettings.axesSize);
axesHelper.visible = debugSettings.showAxes;
scene.add(axesHelper);

const hoverMarkerGeom = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(1, 0, 1),
  new THREE.Vector3(0, 0, 1),
]);
const hoverMarker = new THREE.LineLoop(
  hoverMarkerGeom,
  new THREE.LineBasicMaterial({ color: '#ffff66' }),
);
hoverMarker.visible = false;
worldGroup.add(hoverMarker);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const idx = (w, x, y) => y * w + x;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const halfStride = Math.floor(MACRO_TILE_STRIDE / 2);
const biomeColorById = new Map(Object.values(BIOMES).map((b) => [b.id, new THREE.Color(b.color)]));

function resolveTextureUrl(filePath) {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('tilesets/')) return `../${normalized}`;
  return `../tilesets/${normalized.split('/').pop()}`;
}

async function textureFor(filePath) {
  if (!filePath) return null;
  if (atlasTextures.has(filePath)) return atlasTextures.get(filePath);
  const tex = await new THREE.TextureLoader().loadAsync(resolveTextureUrl(filePath));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  atlasTextures.set(filePath, tex);
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

function clearGroup(group) {
  for (const child of group.children) {
    if (child.geometry) child.geometry.dispose?.();
    if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
  }
  group.clear();
}

function applyWireframeMode() {
  for (const mesh of pickMeshes) {
    const mat = mesh.material;
    if (!mat) continue;
    if (debugSettings.wireframeOnly) {
      mat.wireframe = true;
      mat.map = null;
      mat.vertexColors = false;
      mat.color.set('#ffffff');
      mat.transparent = false;
    } else {
      mat.wireframe = false;
      mat.map = mat.userData.baseMap || null;
      mat.vertexColors = true;
      mat.color.set('#ffffff');
      mat.transparent = true;
    }
    mat.needsUpdate = true;
  }
  if (detailFloorMesh) detailFloorMesh.visible = !debugSettings.wireframeOnly;
}

function setViewMode(mode) {
  viewMode = mode;
  worldGroup.visible = mode === 'world';
  detailGroup.visible = mode === 'detail';
  worldBtn.disabled = mode === 'world';
  detailBtn.disabled = mode === 'detail';
  if (mode === 'world') {
    pickInfo.textContent = 'Hover macro tiles in World mode, click to open Detail.';
    camera.position.set(130, 150, 130);
    controls.target.set(0, 0, 0);
  } else {
    pickInfo.textContent = 'Detail mode (micro tiles). Click to inspect.';
    camera.position.set(80, 90, 80);
    controls.target.set(0, 0, 0);
  }
}

function updateHoverMarker(mx, my) {
  if (!currentWorld || mx == null || my == null) {
    hoverMarker.visible = false;
    macroCoordEl.textContent = '--';
    return;
  }
  const halfW = (currentWorld.width - 1) * 0.5;
  const halfH = (currentWorld.height - 1) * 0.5;
  const w = currentWorld.width;
  const h = currentWorld.height;
  const cx0 = clamp(mx, 0, w - 1);
  const cy0 = clamp(my, 0, h - 1);
  const cx1 = clamp(mx + 1, 0, w - 1);
  const cy1 = clamp(my + 1, 0, h - 1);

  const y00 = currentWorld.cells[idx(w, cx0, cy0)] * settings.worldHeightScale + 0.28;
  const y10 = currentWorld.cells[idx(w, cx1, cy0)] * settings.worldHeightScale + 0.28;
  const y11 = currentWorld.cells[idx(w, cx1, cy1)] * settings.worldHeightScale + 0.28;
  const y01 = currentWorld.cells[idx(w, cx0, cy1)] * settings.worldHeightScale + 0.28;

  const px0 = mx - halfW;
  const pz0 = my - halfH;
  const pos = hoverMarker.geometry.getAttribute('position');
  pos.setXYZ(0, px0, y00, pz0);
  pos.setXYZ(1, px0 + 1, y10, pz0);
  pos.setXYZ(2, px0 + 1, y11, pz0 + 1);
  pos.setXYZ(3, px0, y01, pz0 + 1);
  pos.needsUpdate = true;
  hoverMarker.position.set(0, 0, 0);
  hoverMarker.visible = true;
  macroCoordEl.textContent = `${mx},${my}`;
}

function buildWorldMacroMesh(world) {
  clearGroup(worldGroup);
  worldGroup.add(hoverMarker);
  const w = world.width;
  const h = world.height;
  const halfW = (w - 1) * 0.5;
  const halfH = (h - 1) * 0.5;
  const macroPos = (mx, my, yOffset = 0) => {
    const i = idx(w, mx, my);
    const y = world.cells[i] * settings.worldHeightScale + yOffset;
    return new THREE.Vector3(mx - halfW, y, my - halfH);
  };
  const geom = new THREE.PlaneGeometry(w - 1, h - 1, w - 1, h - 1);
  geom.rotateX(-Math.PI / 2);
  const positions = geom.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(w, x, y);
    positions.setY(i, world.cells[i] * settings.worldHeightScale);
    const color = biomeColorById.get(world.biomes[i]) || new THREE.Color('#888888');
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, wireframe: false });
  worldMesh = new THREE.Mesh(geom, mat);
  worldGroup.add(worldMesh);

  // Roads overlay as line segments above terrain.
  const roadSeg = [];
  for (const p of world.paths || []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      const va = macroPos(a.x, a.y, 0.45);
      const vb = macroPos(b.x, b.y, 0.45);
      roadSeg.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
    }
  }
  if (roadSeg.length > 0) {
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(roadSeg, 3));
    const rm = new THREE.LineBasicMaterial({
      color: '#ffe187',
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const roads = new THREE.LineSegments(rg, rm);
    roads.renderOrder = 20;
    worldGroup.add(roads);
  }

  // City markers above terrain (white=city, red=gym).
  for (const n of world.graph?.nodes || []) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(n.isGym ? 0.9 : 0.65, 10, 10),
      new THREE.MeshBasicMaterial({
        color: n.isGym ? '#ff4f4f' : '#ffffff',
        depthTest: false,
        depthWrite: false,
      }),
    );
    const p = macroPos(n.x, n.y, 0.9);
    marker.position.copy(p);
    marker.renderOrder = 21;
    worldGroup.add(marker);
  }
}

async function buildDetailTerrain(world, centerMicroX, centerMicroY) {
  pickMeshes.length = 0;
  clearGroup(detailGroup);
  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const span = clamp(Math.floor(settings.microSpan), 64, Math.min(microW, microH));
  const startX = clamp(Math.floor(centerMicroX - span * 0.5), 0, microW - span);
  const startY = clamp(Math.floor(centerMicroY - span * 0.5), 0, microH - span);
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
    cells[idx(span, x, y)] = { h: t.heightStep, file, cols: TessellationEngine.getTerrainSheetCols(set), sprite: role.spriteId ?? set?.centerId ?? 0 };
    if (x === span - 1 && y % 8 === 0) await nextFrame();
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

  let triTotal = 0;
  for (const [file, data] of builders.entries()) {
    const tex = atlasTextures.get(file);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(data.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(data.c, 3));
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide });
    m.userData.baseMap = tex;
    const mesh = new THREE.Mesh(g, m);
    detailGroup.add(mesh);
    pickMeshes.push(mesh);
    triTotal += Math.floor(g.getAttribute('position').count / 3);
  }

  detailFloorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 20, span + 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#2d3a2f' }),
  );
  detailFloorMesh.position.y = floorY - 0.02;
  detailGroup.add(detailFloorMesh);
  triCountEl.textContent = triTotal.toLocaleString('en-US');
  applyWireframeMode();
}

async function regenerate() {
  if (rendering) return;
  rendering = true;
  regenBtn.disabled = true;
  regenBtn.textContent = 'Gerando...';
  try {
    currentWorld = generate(seedInput.value, { ...DEFAULT_CONFIG, cityCount: 16, gymCount: 8 });
    buildWorldMacroMesh(currentWorld);
    const centerMacroX = selectedMacro?.x ?? Math.floor(currentWorld.width * 0.5);
    const centerMacroY = selectedMacro?.y ?? Math.floor(currentWorld.height * 0.5);
    await buildDetailTerrain(
      currentWorld,
      centerMacroX * MACRO_TILE_STRIDE + halfStride,
      centerMacroY * MACRO_TILE_STRIDE + halfStride,
    );
    setViewMode(viewMode);
  } finally {
    regenBtn.disabled = false;
    regenBtn.textContent = 'Regenerar';
    rendering = false;
  }
}

function pickDetailAt(clientX, clientY) {
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
  pickInfo.textContent = `detail mx:${mx} my:${my} | h:${t.heightStep} | biome:${t.biomeId} | set:${role.setName ?? '-'} | sprite:${role.spriteId ?? '-'}`;
}

function pickMacroFromPoint(clientX, clientY) {
  if (!currentWorld || !worldMesh) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(worldMesh, false);
  if (!hits.length) return null;
  const halfW = (currentWorld.width - 1) * 0.5;
  const halfH = (currentWorld.height - 1) * 0.5;
  const x = clamp(Math.floor(hits[0].point.x + halfW), 0, currentWorld.width - 1);
  const y = clamp(Math.floor(hits[0].point.z + halfH), 0, currentWorld.height - 1);
  return { x, y };
}

function updatePerfOverlay(nowTs) {
  if (nowTs - lastPerfPaintTs < 250) return;
  lastPerfPaintTs = nowTs;
  while (frameTimestamps.length > 0 && nowTs - frameTimestamps[0] > 5000) frameTimestamps.shift();
  let count1s = 0;
  for (let i = frameTimestamps.length - 1; i >= 0; i--) {
    if (nowTs - frameTimestamps[i] <= 1000) count1s++;
    else break;
  }
  const fpsNow = frameDurationsMs.length > 0 ? 1000 / frameDurationsMs[frameDurationsMs.length - 1] : 0;
  const fps1s = count1s;
  const fps5s = frameTimestamps.length / 5;
  const meanMs = frameDurationsMs.length > 0 ? frameDurationsMs.reduce((s, v) => s + v, 0) / frameDurationsMs.length : 0;
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

const gui = new GUI({ title: 'Render Params' });
gui.add(settings, 'microSpan', 64, 220, 1).name('Visible Tiles').onFinishChange(() => currentWorld && selectedMacro && buildDetailTerrain(currentWorld, selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride));
gui.add(settings, 'stepHeight', 0.25, 1.2, 0.01).name('Step Height').onFinishChange(() => currentWorld && selectedMacro && buildDetailTerrain(currentWorld, selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride));
gui.add(settings, 'worldHeightScale', 2, 80, 1).name('World Height Scale').onFinishChange(() => {
  if (!currentWorld) return;
  buildWorldMacroMesh(currentWorld);
  if (hoverMacro) updateHoverMarker(hoverMacro.x, hoverMacro.y);
});
const dbg = gui.addFolder('Debug');
dbg.add(debugSettings, 'showAxes').name('Show XYZ Axes').onChange((v) => { axesHelper.visible = !!v; });
dbg.add(debugSettings, 'axesSize', 4, 120, 1).name('Axes Size').onChange((v) => axesHelper.scale.setScalar(Math.max(0.05, Number(v) / 24)));
dbg.add(debugSettings, 'wireframeOnly').name('Wireframe Only').onChange(applyWireframeMode);

renderer.domElement.addEventListener('pointermove', (e) => {
  if (viewMode !== 'world' || rendering) return;
  hoverMacro = pickMacroFromPoint(e.clientX, e.clientY);
  updateHoverMarker(hoverMacro?.x, hoverMacro?.y);
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || rendering) return;
  if (viewMode === 'world') {
    pendingMacroDown = pickMacroFromPoint(e.clientX, e.clientY);
    return;
  }
  pickDetailAt(e.clientX, e.clientY);
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  if (e.button !== 0 || rendering) return;
  if (viewMode !== 'world') return;
  if (!pendingMacroDown) return;

  const macroUp = pickMacroFromPoint(e.clientX, e.clientY);
  const isSameTile =
    macroUp &&
    macroUp.x === pendingMacroDown.x &&
    macroUp.y === pendingMacroDown.y;
  pendingMacroDown = null;
  if (!isSameTile) return;

  selectedMacro = macroUp;
  await buildDetailTerrain(
    currentWorld,
    selectedMacro.x * MACRO_TILE_STRIDE + halfStride,
    selectedMacro.y * MACRO_TILE_STRIDE + halfStride,
  );
  setViewMode('detail');
  pickInfo.textContent = `Selected macro ${selectedMacro.x},${selectedMacro.y}.`;
});

worldBtn.addEventListener('click', () => setViewMode('world'));
detailBtn.addEventListener('click', async () => {
  if (!selectedMacro && currentWorld) selectedMacro = { x: Math.floor(currentWorld.width * 0.5), y: Math.floor(currentWorld.height * 0.5) };
  if (currentWorld && selectedMacro) await buildDetailTerrain(currentWorld, selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride);
  setViewMode('detail');
});
regenBtn.addEventListener('click', () => regenerate().catch((e) => { console.error(e); pickInfo.textContent = `Error: ${e?.message || e}`; rendering = false; }));
seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') regenerate().catch((e2) => { console.error(e2); pickInfo.textContent = `Error: ${e2?.message || e2}`; rendering = false; }); });
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

setViewMode('world');
requestAnimationFrame(animate);
regenerate().catch((e) => { console.error(e); pickInfo.textContent = `Startup error: ${e?.message || e}`; rendering = false; });
