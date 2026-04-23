export function renderLayout() {
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

  return {
    viewport: document.getElementById('viewport'),
    seedInput: document.getElementById('seed-input'),
    regenBtn: document.getElementById('regen-btn'),
    worldBtn: document.getElementById('world-btn'),
    detailBtn: document.getElementById('detail-btn'),
    pickInfo: document.getElementById('pick-info'),
    fpsNowEl: document.getElementById('fps-now'),
    fps1sEl: document.getElementById('fps-1s'),
    fps5sEl: document.getElementById('fps-5s'),
    frameMsEl: document.getElementById('frame-ms'),
    triCountEl: document.getElementById('tri-count'),
    macroCoordEl: document.getElementById('macro-coord'),
  };
}

export function createSceneGraph(THREE, OrbitControls, viewport, debugSettings) {
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

  return {
    renderer,
    scene,
    camera,
    controls,
    worldGroup,
    detailGroup,
    axesHelper,
    hoverMarker,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
  };
}
