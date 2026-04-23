import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
const HEIGHT_SCALE = 6;

function buildWorldMesh(world) {
  terrainGroup.clear();

  const width = world.width;
  const height = world.height;
  const halfW = (width - 1) * 0.5;
  const halfH = (height - 1) * 0.5;

  const geometry = new THREE.PlaneGeometry(width - 1, height - 1, width - 1, height - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const elevation = world.cells[idx];

      positions.setY(idx, elevation * HEIGHT_SCALE);

      const biomeColor = biomeColorById.get(world.biomes[idx]) || fallbackBiomeColor;
      colors[idx * 3] = biomeColor.r;
      colors[idx * 3 + 1] = biomeColor.g;
      colors[idx * 3 + 2] = biomeColor.b;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  terrainGroup.add(terrainMesh);

  const points = [];
  for (const path of world.paths) {
    if (!path || path.length < 2) continue;
    for (const cell of path) {
      const idx = cell.y * width + cell.x;
      const yPos = world.cells[idx] * HEIGHT_SCALE + 0.35;
      points.push(new THREE.Vector3(cell.x - halfW, yPos, cell.y - halfH));
    }
  }
  if (points.length > 1) {
    const roadGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const roadMaterial = new THREE.LineBasicMaterial({ color: '#c9b16b', transparent: true, opacity: 0.8 });
    terrainGroup.add(new THREE.Line(roadGeometry, roadMaterial));
  }

  for (const node of world.graph.nodes) {
    const idx = node.y * width + node.x;
    const yPos = world.cells[idx] * HEIGHT_SCALE + 1.0;
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
  const world = generate(seedInput.value, {
    ...DEFAULT_CONFIG,
    cityCount: 16,
    gymCount: 8,
  });
  buildWorldMesh(world);
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
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

regenerate();
animate();
