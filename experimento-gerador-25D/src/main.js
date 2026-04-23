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

        gl_FragColor = vec4(finalColor, 1.0);
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
