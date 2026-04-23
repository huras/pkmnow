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
  heightScale: 14,
  landTerraces: 26,
  waterTerraces: 14,
  cliffSharpness: 1.32,
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

function getBiomeColor(world, x, y) {
  const idx = y * world.width + x;
  return biomeColorById.get(world.biomes[idx]) || fallbackBiomeColor;
}

function pushTri(positions, colors, a, b, c, color) {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < 3; i++) {
    colors.push(color.r, color.g, color.b);
  }
}

function pushQuad(positions, colors, a, b, c, d, color) {
  pushTri(positions, colors, a, b, c, color);
  pushTri(positions, colors, a, c, d, color);
}

function buildChunkGeometry(world, xStart, yStart, xEnd, yEnd, sampleStride) {
  const positions = [];
  const colors = [];
  const halfW = world.width * 0.5;
  const halfH = world.height * 0.5;

  const getNeighborHeight = (x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return TERRAIN_BOTTOM_Y;
    return getTerracedHeightY(world, x, y);
  };

  for (let y = yStart; y < yEnd; y += sampleStride) {
    for (let x = xStart; x < xEnd; x += sampleStride) {
      const h = getTerracedHeightY(world, x, y);
      const baseColor = getBiomeColor(world, x, y);
      const topColor = baseColor.clone().offsetHSL(0, 0, 0.07);
      const sideColor = baseColor.clone().multiplyScalar(0.72);

      const x0 = x - halfW;
      const x1 = x0 + sampleStride;
      const z0 = y - halfH;
      const z1 = z0 + sampleStride;

      // Top face
      pushQuad(
        positions,
        colors,
        new THREE.Vector3(x0, h, z0),
        new THREE.Vector3(x1, h, z0),
        new THREE.Vector3(x1, h, z1),
        new THREE.Vector3(x0, h, z1),
        topColor,
      );

      // North wall
      const nH = getNeighborHeight(x, y - sampleStride);
      if (h > nH + 0.001) {
        pushQuad(
          positions,
          colors,
          new THREE.Vector3(x0, h, z0),
          new THREE.Vector3(x1, h, z0),
          new THREE.Vector3(x1, nH, z0),
          new THREE.Vector3(x0, nH, z0),
          sideColor,
        );
      }

      // South wall
      const sH = getNeighborHeight(x, y + sampleStride);
      if (h > sH + 0.001) {
        pushQuad(
          positions,
          colors,
          new THREE.Vector3(x1, h, z1),
          new THREE.Vector3(x0, h, z1),
          new THREE.Vector3(x0, sH, z1),
          new THREE.Vector3(x1, sH, z1),
          sideColor,
        );
      }

      // West wall
      const wH = getNeighborHeight(x - sampleStride, y);
      if (h > wH + 0.001) {
        pushQuad(
          positions,
          colors,
          new THREE.Vector3(x0, h, z1),
          new THREE.Vector3(x0, h, z0),
          new THREE.Vector3(x0, wH, z0),
          new THREE.Vector3(x0, wH, z1),
          sideColor,
        );
      }

      // East wall
      const eH = getNeighborHeight(x + sampleStride, y);
      if (h > eH + 0.001) {
        pushQuad(
          positions,
          colors,
          new THREE.Vector3(x1, h, z0),
          new THREE.Vector3(x1, h, z1),
          new THREE.Vector3(x1, eH, z1),
          new THREE.Vector3(x1, eH, z0),
          sideColor,
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
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
  terrainMaterialNear = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  terrainMaterialFar = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0,
    flatShading: true,
  });

  for (let y = 0; y < height; y += CHUNK_SIZE) {
    for (let x = 0; x < width; x += CHUNK_SIZE) {
      const xEnd = Math.min(width, x + CHUNK_SIZE);
      const yEnd = Math.min(height, y + CHUNK_SIZE);
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
  gui.add(renderSettings, 'heightScale', 16, 90, 1).name('Height Scale').onFinishChange(() => {
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
  gui.add(renderSettings, 'nearLodDistance', 40, 140, 1).name('Near LOD Dist');
  gui.add(renderSettings, 'farLodDistance', 80, 260, 1).name('Far Cull Dist');
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
