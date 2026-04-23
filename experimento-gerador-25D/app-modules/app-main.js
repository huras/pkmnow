import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.21/+esm';
import { generate, DEFAULT_CONFIG } from '../../js/generator.js';
import { getMicroTile, MACRO_TILE_STRIDE, foliageDensity } from '../../js/chunking.js';
import { computeTerrainRoleAndSprite } from '../../js/main/terrain-role-helpers.js';
import { TessellationEngine } from '../../js/tessellation-engine.js';
import { BIOMES } from '../../js/biomes.js';
import { OBJECT_SETS } from '../../js/tessellation-data.js';
import { resolveScatterVegetationItemKey } from '../../js/vegetation-channels.js';
import { validScatterOriginMicro } from '../../js/scatter-pass2-debug.js';
import { parseShape } from '../../js/tessellation-logic.js';
import { BERRY_TREE_TILES, getBerryTypeFromKey } from '../../js/main/berry-tree-system.js';
import {
  getTreeType,
  TREE_TILES,
  tileSurfaceAllowsScatterVegetation,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  getGrassVariant,
  GRASS_TILES,
  FOLIAGE_DENSITY_THRESHOLD,
} from '../../js/biome-tiles.js';
import { renderLayout, createSceneGraph } from './ui-scene.js';
import {
  TILE_PX,
  clamp,
  idx,
  nextFrame,
  textureFor,
  uvRect,
  pushFace,
  deterministic01,
  seedToInt,
  getTileUvRect,
  atlasColsFromPath,
  normalizedShape,
  clearGroup,
} from './utils.js';
import { createVegetationSystem } from './vegetation.js';
import { buildWorldMacroMesh, buildDetailTerrain, updateHoverMarker } from './terrain.js';
import { createProceduralSkySystem } from './sky.js';

export function startApp() {
  const ui = renderLayout();
  const settings = {
    microSpan: 96,
    stepHeight: 0.55,
    wallShade: 0.72,
    worldHeightScale: 10,
    detailsYOffset: -0.15,
    timeOfDay: 12,
    showVegetation: true,
    vegetationDensity: 1.0,
  };
  const debugSettings = { showAxes: true, axesSize: 24, wireframeOnly: false };
  const halfStride = Math.floor(MACRO_TILE_STRIDE / 2);
  const biomeColorById = new Map(Object.values(BIOMES).map((b) => [b.id, new THREE.Color(b.color)]));
  const atlasTextures = new Map();
  const pickMeshes = [];

  let currentWorld = null;
  let currentBounds = null;
  let rendering = false;
  let viewMode = 'world';
  let hoverMacro = null;
  let selectedMacro = null;
  let pendingMacroDown = null;
  let worldMesh = null;
  let detailFloorMesh = null;

  const perf = {
    lastFrameTs: performance.now(),
    lastPerfPaintTs: performance.now(),
    frameTimestamps: [],
    frameDurationsMs: [],
    FRAME_MS_WINDOW: 120,
  };

  const sceneBits = createSceneGraph(THREE, OrbitControls, ui.viewport, debugSettings);
  const skySystem = createProceduralSkySystem({
    THREE,
    scene: sceneBits.scene,
    camera: sceneBits.camera,
  });

  function applyTimeOfDay(hours) {
    const h = ((Number(hours) % 24) + 24) % 24;
    settings.timeOfDay = h;
    const t = ((h - 12) * Math.PI) / 12;
    const sunElev01 = Math.max(0, Math.cos(t));
    const sunSwing = Math.sin(t);

    // Orbit the light around the world center; low at dawn/dusk, high at noon.
    const orbitRadius = 280;
    const sx = sunSwing * orbitRadius;
    const sz = Math.cos(t) * orbitRadius * 0.62;
    const sy = 28 + sunElev01 * 300;
    sceneBits.sunLight.position.set(sx, sy, sz);

    // Brighter stylized curve (Nintendo-ish readability), especially around noon.
    sceneBits.sunLight.intensity = 0.35 + sunElev01 * 1.25;
    sceneBits.ambientLight.intensity = 0.34 + sunElev01 * 0.46;
    sceneBits.hemiLight.intensity = 0.26 + sunElev01 * 0.52;
    sceneBits.sunLight.shadow.intensity = 0.34 + sunElev01 * 0.22;
    skySystem.update(h, sceneBits.sunLight.position);
  }

  const textureForLocal = (filePath) => textureFor(THREE, atlasTextures, filePath);
  const vegetationSystem = createVegetationSystem({
    THREE,
    OBJECT_SETS,
    TessellationEngine,
    parseShape,
    BERRY_TREE_TILES,
    getBerryTypeFromKey,
    getTreeType,
    TREE_TILES,
    tileSurfaceAllowsScatterVegetation,
    TREE_DENSITY_THRESHOLD,
    TREE_NOISE_SCALE,
    getGrassVariant,
    GRASS_TILES,
    FOLIAGE_DENSITY_THRESHOLD,
    foliageDensity,
    getMicroTile,
    resolveScatterVegetationItemKey,
    validScatterOriginMicro,
    MACRO_TILE_STRIDE,
    textureFor: textureForLocal,
    settings,
    idx,
    nextFrame,
    seedToInt,
    deterministic01,
    getTileUvRect,
    atlasColsFromPath,
    normalizedShape,
    TILE_PX,
  });

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
    vegetationSystem.applyWireframeMode(debugSettings.wireframeOnly);
    if (detailFloorMesh) detailFloorMesh.visible = !debugSettings.wireframeOnly;
  }

  function setViewMode(mode) {
    viewMode = mode;
    sceneBits.worldGroup.visible = mode === 'world';
    sceneBits.detailGroup.visible = mode === 'detail';
    ui.worldBtn.disabled = mode === 'world';
    ui.detailBtn.disabled = mode === 'detail';
    if (mode === 'world') {
      ui.pickInfo.textContent = 'Hover macro tiles in World mode, click to open Detail.';
      sceneBits.camera.position.set(130, 150, 130);
      sceneBits.controls.target.set(0, 0, 0);
    } else {
      ui.pickInfo.textContent = 'Detail mode (micro tiles). Click to inspect.';
      sceneBits.camera.position.set(80, 90, 80);
      sceneBits.controls.target.set(0, 0, 0);
    }
  }

  async function rebuildDetail(centerMicroX, centerMicroY) {
    const result = await buildDetailTerrain({
      THREE,
      world: currentWorld,
      centerMicroX,
      centerMicroY,
      settings,
      detailGroup: sceneBits.detailGroup,
      pickMeshes,
      triCountEl: ui.triCountEl,
      getMicroTile,
      MACRO_TILE_STRIDE,
      computeTerrainRoleAndSprite,
      TessellationEngine,
      textureFor: textureForLocal,
      uvRect,
      pushFace,
      idx,
      clamp,
      nextFrame,
      buildVegetationBillboards: (args) => vegetationSystem.buildVegetationBillboards(args),
      applyWireframeMode,
      clearGroup,
      atlasTextures,
    });
    currentBounds = result.currentBounds;
    detailFloorMesh = result.detailFloorMesh;
  }

  async function rebuildCurrentDetail() {
    if (!currentWorld) return;
    const macroX = selectedMacro?.x ?? Math.floor(currentWorld.width * 0.5);
    const macroY = selectedMacro?.y ?? Math.floor(currentWorld.height * 0.5);
    await rebuildDetail(
      macroX * MACRO_TILE_STRIDE + halfStride,
      macroY * MACRO_TILE_STRIDE + halfStride,
    );
  }

  async function regenerate() {
    if (rendering) return;
    rendering = true;
    ui.regenBtn.disabled = true;
    ui.regenBtn.textContent = 'Gerando...';
    try {
      currentWorld = generate(ui.seedInput.value, { ...DEFAULT_CONFIG, cityCount: 16, gymCount: 8 });
      worldMesh = buildWorldMacroMesh({
        THREE,
        world: currentWorld,
        worldGroup: sceneBits.worldGroup,
        hoverMarker: sceneBits.hoverMarker,
        settings,
        biomeColorById,
        clearGroup,
        idx,
      });
      const centerMacroX = selectedMacro?.x ?? Math.floor(currentWorld.width * 0.5);
      const centerMacroY = selectedMacro?.y ?? Math.floor(currentWorld.height * 0.5);
      await rebuildDetail(
        centerMacroX * MACRO_TILE_STRIDE + halfStride,
        centerMacroY * MACRO_TILE_STRIDE + halfStride,
      );
      setViewMode(viewMode);
    } finally {
      ui.regenBtn.disabled = false;
      ui.regenBtn.textContent = 'Regenerar';
      rendering = false;
    }
  }

  function pickDetailAt(clientX, clientY) {
    if (!currentWorld || !currentBounds) return;
    const r = sceneBits.renderer.domElement.getBoundingClientRect();
    sceneBits.pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
    sceneBits.pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
    sceneBits.raycaster.setFromCamera(sceneBits.pointer, sceneBits.camera);
    const hits = sceneBits.raycaster.intersectObjects(pickMeshes, false);
    if (!hits.length) return;
    const lx = Math.floor(hits[0].point.x + currentBounds.span * 0.5);
    const ly = Math.floor(hits[0].point.z + currentBounds.span * 0.5);
    if (lx < 0 || ly < 0 || lx >= currentBounds.span || ly >= currentBounds.span) return;
    const mx = currentBounds.startX + lx;
    const my = currentBounds.startY + ly;
    const t = getMicroTile(mx, my, currentWorld);
    const role = computeTerrainRoleAndSprite(mx, my, currentWorld, t.heightStep);
    ui.pickInfo.textContent = `detail mx:${mx} my:${my} | h:${t.heightStep} | biome:${t.biomeId} | set:${role.setName ?? '-'} | sprite:${role.spriteId ?? '-'}`;
  }

  function pickMacroFromPoint(clientX, clientY) {
    if (!currentWorld || !worldMesh) return null;
    const r = sceneBits.renderer.domElement.getBoundingClientRect();
    sceneBits.pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
    sceneBits.pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
    sceneBits.raycaster.setFromCamera(sceneBits.pointer, sceneBits.camera);
    const hits = sceneBits.raycaster.intersectObject(worldMesh, false);
    if (!hits.length) return null;
    const halfW = (currentWorld.width - 1) * 0.5;
    const halfH = (currentWorld.height - 1) * 0.5;
    const x = clamp(Math.floor(hits[0].point.x + halfW), 0, currentWorld.width - 1);
    const y = clamp(Math.floor(hits[0].point.z + halfH), 0, currentWorld.height - 1);
    return { x, y };
  }

  function updatePerfOverlay(nowTs) {
    if (nowTs - perf.lastPerfPaintTs < 250) return;
    perf.lastPerfPaintTs = nowTs;
    while (perf.frameTimestamps.length > 0 && nowTs - perf.frameTimestamps[0] > 5000) perf.frameTimestamps.shift();
    let count1s = 0;
    for (let i = perf.frameTimestamps.length - 1; i >= 0; i--) {
      if (nowTs - perf.frameTimestamps[i] <= 1000) count1s++;
      else break;
    }
    const fpsNow = perf.frameDurationsMs.length > 0 ? 1000 / perf.frameDurationsMs[perf.frameDurationsMs.length - 1] : 0;
    const fps1s = count1s;
    const fps5s = perf.frameTimestamps.length / 5;
    const meanMs = perf.frameDurationsMs.length > 0 ? perf.frameDurationsMs.reduce((s, v) => s + v, 0) / perf.frameDurationsMs.length : 0;
    ui.fpsNowEl.textContent = fpsNow.toFixed(1);
    ui.fps1sEl.textContent = fps1s.toFixed(0);
    ui.fps5sEl.textContent = fps5s.toFixed(1);
    ui.frameMsEl.textContent = meanMs.toFixed(2);
  }

  function animate(nowTs) {
    const dt = Math.max(0.0001, nowTs - perf.lastFrameTs);
    perf.lastFrameTs = nowTs;
    perf.frameTimestamps.push(nowTs);
    perf.frameDurationsMs.push(dt);
    if (perf.frameDurationsMs.length > perf.FRAME_MS_WINDOW) perf.frameDurationsMs.shift();
    sceneBits.controls.update();
    vegetationSystem.faceCamera(sceneBits.camera);
    skySystem.tick(nowTs * 0.001);
    sceneBits.renderer.render(sceneBits.scene, sceneBits.camera);
    updatePerfOverlay(nowTs);
    requestAnimationFrame(animate);
  }

  const gui = new GUI({ title: 'Render Params' });
  gui.add(settings, 'microSpan', 64, 220, 1).name('Visible Tiles').onFinishChange(() => currentWorld && selectedMacro && rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride));
  gui.add(settings, 'stepHeight', 0.25, 1.2, 0.01).name('Step Height').onFinishChange(() => currentWorld && selectedMacro && rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride));
  gui.add(settings, 'detailsYOffset', -5.0, 5.0, 0.01).name('Details Y Offset').onChange(async () => {
    if (!currentWorld) return;
    worldMesh = buildWorldMacroMesh({
      THREE,
      world: currentWorld,
      worldGroup: sceneBits.worldGroup,
      hoverMarker: sceneBits.hoverMarker,
      settings,
      biomeColorById,
      clearGroup,
      idx,
    });
    if (hoverMacro) updateHoverMarker({
      currentWorld,
      mx: hoverMacro.x,
      my: hoverMacro.y,
      hoverMarker: sceneBits.hoverMarker,
      macroCoordEl: ui.macroCoordEl,
      settings,
      idx,
      clamp,
    });
    await rebuildCurrentDetail();
  });
  gui.add(settings, 'timeOfDay', 0, 24, 0.01).name('Time of Day').onChange(applyTimeOfDay);
  gui.add(settings, 'showVegetation').name('Show Vegetation').onChange((v) => vegetationSystem.setVisible(!!v));
  gui.add(settings, 'vegetationDensity', 0.25, 1.0, 0.01).name('Vegetation Density').onFinishChange(() => {
    if (currentWorld && selectedMacro) rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride);
  });
  gui.add(settings, 'worldHeightScale', 2, 80, 1).name('World Height Scale').onFinishChange(() => {
    if (!currentWorld) return;
    worldMesh = buildWorldMacroMesh({
      THREE,
      world: currentWorld,
      worldGroup: sceneBits.worldGroup,
      hoverMarker: sceneBits.hoverMarker,
      settings,
      biomeColorById,
      clearGroup,
      idx,
    });
    if (hoverMacro) updateHoverMarker({
      currentWorld,
      mx: hoverMacro.x,
      my: hoverMacro.y,
      hoverMarker: sceneBits.hoverMarker,
      macroCoordEl: ui.macroCoordEl,
      settings,
      idx,
      clamp,
    });
  });
  const dbg = gui.addFolder('Debug');
  dbg.add(debugSettings, 'showAxes').name('Show XYZ Axes').onChange((v) => { sceneBits.axesHelper.visible = !!v; });
  dbg.add(debugSettings, 'axesSize', 4, 120, 1).name('Axes Size').onChange((v) => sceneBits.axesHelper.scale.setScalar(Math.max(0.05, Number(v) / 24)));
  dbg.add(debugSettings, 'wireframeOnly').name('Wireframe Only').onChange(applyWireframeMode);

  sceneBits.renderer.domElement.addEventListener('pointermove', (e) => {
    if (viewMode !== 'world' || rendering) return;
    hoverMacro = pickMacroFromPoint(e.clientX, e.clientY);
    updateHoverMarker({
      currentWorld,
      mx: hoverMacro?.x,
      my: hoverMacro?.y,
      hoverMarker: sceneBits.hoverMarker,
      macroCoordEl: ui.macroCoordEl,
      settings,
      idx,
      clamp,
    });
  });

  sceneBits.renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || rendering) return;
    if (viewMode === 'world') {
      pendingMacroDown = pickMacroFromPoint(e.clientX, e.clientY);
      return;
    }
    pickDetailAt(e.clientX, e.clientY);
  });

  sceneBits.renderer.domElement.addEventListener('pointerup', async (e) => {
    if (e.button !== 0 || rendering) return;
    if (viewMode !== 'world' || !pendingMacroDown) return;
    const macroUp = pickMacroFromPoint(e.clientX, e.clientY);
    const isSameTile = macroUp && macroUp.x === pendingMacroDown.x && macroUp.y === pendingMacroDown.y;
    pendingMacroDown = null;
    if (!isSameTile) return;
    selectedMacro = macroUp;
    await rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride);
    setViewMode('detail');
    ui.pickInfo.textContent = `Selected macro ${selectedMacro.x},${selectedMacro.y}.`;
  });

  ui.worldBtn.addEventListener('click', () => setViewMode('world'));
  ui.detailBtn.addEventListener('click', async () => {
    if (!selectedMacro && currentWorld) selectedMacro = { x: Math.floor(currentWorld.width * 0.5), y: Math.floor(currentWorld.height * 0.5) };
    if (currentWorld && selectedMacro) await rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride);
    setViewMode('detail');
  });
  ui.regenBtn.addEventListener('click', () => regenerate().catch((e) => { console.error(e); ui.pickInfo.textContent = `Error: ${e?.message || e}`; rendering = false; }));
  ui.seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') regenerate().catch((e2) => { console.error(e2); ui.pickInfo.textContent = `Error: ${e2?.message || e2}`; rendering = false; }); });
  window.addEventListener('resize', () => {
    sceneBits.camera.aspect = window.innerWidth / window.innerHeight;
    sceneBits.camera.updateProjectionMatrix();
    sceneBits.renderer.setSize(window.innerWidth, window.innerHeight);
  });

  applyTimeOfDay(settings.timeOfDay);
  setViewMode('world');
  requestAnimationFrame(animate);
  regenerate().catch((e) => { console.error(e); ui.pickInfo.textContent = `Startup error: ${e?.message || e}`; rendering = false; });
}
