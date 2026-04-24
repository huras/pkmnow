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
import { createPlayerController } from './player-controller.js';

export function startApp() {
  const ui = renderLayout();
  const settings = {
    microSpan: 350,
    stepHeight: 0.55,
    wallShade: 0.72,
    worldHeightScale: 10,
    detailsYOffset: -0.15,
    timeOfDay: 12,
    showVegetation: true,
    vegetationDensity: 1.0,
    followPlayerCamera: true,
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
  let pendingDetailDown = null;
  let worldMesh = null;
  let detailFloorMesh = null;
  const detailStream = {
    runtime: null,
    cache: new Map(),
    wanted: new Set(),
    queue: [],
    building: false,
    version: 0,
    radiusNear: 3,
    radiusFar: 5,
    unloadMargin: 1,
    lastUpdateTs: 0,
  };

  const perf = {
    lastFrameTs: performance.now(),
    lastPerfPaintTs: performance.now(),
    frameTimestamps: [],
    frameDurationsMs: [],
    FRAME_MS_WINDOW: 120,
  };
  const followTmpTarget = new THREE.Vector3();
  const followTmpDelta = new THREE.Vector3();

  function updateFollowCamera() {
    if (viewMode !== 'detail' || !settings.followPlayerCamera || !playerController.isActive()) return;
    const anchor = playerController.getAnchorPosition();
    if (!anchor) return;
    followTmpTarget.set(anchor.x, anchor.y, anchor.z);
    followTmpDelta.copy(followTmpTarget).sub(sceneBits.controls.target);
    if (followTmpDelta.lengthSq() < 1e-8) return;
    sceneBits.controls.target.addScaledVector(followTmpDelta, 0.22);
    sceneBits.camera.position.addScaledVector(followTmpDelta, 0.22);
  }

  const sceneBits = createSceneGraph(THREE, OrbitControls, ui.viewport, debugSettings);
  const textureForLocal = (filePath) => textureFor(THREE, atlasTextures, filePath);
  const skySystem = createProceduralSkySystem({
    THREE,
    scene: sceneBits.scene,
    camera: sceneBits.camera,
  });
  const playerController = createPlayerController({
    THREE,
    playerGroup: sceneBits.playerGroup,
    camera: sceneBits.camera,
    controls: sceneBits.controls,
    settings,
    textureFor: textureForLocal,
    getMicroTile,
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
    // Keep soft edges, but restore stronger contact/readability on terrain/details.
    sceneBits.sunLight.shadow.intensity = 0.72 + sunElev01 * 0.18;
    skySystem.update(h, sceneBits.sunLight.position);
  }

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
    sceneBits.playerGroup.visible = mode === 'detail';
    playerController.setVisible(mode === 'detail');
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

  function removeChunkMeshesFromScene(record) {
    if (!record?.attached || !Array.isArray(record.meshes)) return;
    for (const mesh of record.meshes) {
      sceneBits.detailGroup.remove(mesh);
      const pickIdx = pickMeshes.indexOf(mesh);
      if (pickIdx >= 0) pickMeshes.splice(pickIdx, 1);
    }
    record.attached = false;
  }

  function addChunkMeshesToScene(record) {
    if (!record || record.attached || !Array.isArray(record.meshes)) return;
    for (const mesh of record.meshes) {
      sceneBits.detailGroup.add(mesh);
      pickMeshes.push(mesh);
    }
    record.attached = true;
  }

  function clearDetailStream() {
    for (const record of detailStream.cache.values()) {
      removeChunkMeshesFromScene(record);
      if (Array.isArray(record.meshes)) {
        for (const mesh of record.meshes) {
          mesh.geometry?.dispose?.();
          if (mesh.material && !Array.isArray(mesh.material)) mesh.material.dispose?.();
        }
      }
    }
    detailStream.cache.clear();
    detailStream.wanted.clear();
    detailStream.queue = [];
    detailStream.building = false;
  }

  function refreshMeshingHud() {
    let chunksRendered = 0;
    let mergedFaces = 0;
    let preTri = 0;
    let postTri = 0;
    for (const record of detailStream.cache.values()) {
      if (!record?.attached) continue;
      chunksRendered++;
      mergedFaces += record.mergedFaceCount || 0;
      preTri += record.preTriEstimate || 0;
      postTri += record.triCount || 0;
    }
    ui.triCountEl.textContent = postTri.toLocaleString('en-US');
    if (ui.meshingStatsEl) {
      ui.meshingStatsEl.textContent = `chunks:${chunksRendered} | merged:${mergedFaces} | tri pre/post:${preTri}/${postTri}`;
    }
  }

  function computeStreamCenterChunk() {
    if (!currentBounds || !detailStream.runtime) return { cx: 0, cy: 0 };
    const half = currentBounds.span * 0.5;
    const anchor = playerController.isActive() ? playerController.getAnchorPosition() : null;
    const localX = (anchor ? anchor.x : sceneBits.controls.target.x) + half;
    const localY = (anchor ? anchor.z : sceneBits.controls.target.z) + half;
    const cx = clamp(
      Math.floor(localX / detailStream.runtime.chunkSize),
      0,
      detailStream.runtime.chunkCols - 1,
    );
    const cy = clamp(
      Math.floor(localY / detailStream.runtime.chunkSize),
      0,
      detailStream.runtime.chunkRows - 1,
    );
    return { cx, cy };
  }

  function makeCacheKey(chunkKey, lod) {
    return `${chunkKey}|lod${lod}`;
  }

  function enqueueChunkBuild(chunkKey, lod) {
    const cacheKey = makeCacheKey(chunkKey, lod);
    if (!chunkKey || detailStream.queue.some((q) => q.cacheKey === cacheKey)) return;
    detailStream.queue.push({ chunkKey, lod, cacheKey });
  }

  async function pumpChunkBuildQueue() {
    if (!detailStream.runtime || detailStream.building) return;
    while (detailStream.queue.length > 0) {
      const next = detailStream.queue.shift();
      if (!next) return;
      const { chunkKey, lod, cacheKey } = next;
      const existing = detailStream.cache.get(cacheKey);
      if (existing?.state === 'ready') {
        if (detailStream.wanted.has(cacheKey)) addChunkMeshesToScene(existing);
        continue;
      }
      if (existing?.state === 'building') return;
      detailStream.cache.set(cacheKey, { state: 'building', attached: false, chunkKey, lod });
      detailStream.building = true;
      const runVersion = detailStream.version;
      try {
        const built = await detailStream.runtime.buildChunkByKey(chunkKey, lod);
        if (runVersion !== detailStream.version) return;
        detailStream.building = false;
        if (!built) {
          detailStream.cache.delete(cacheKey);
          continue;
        }
        const record = { ...built, state: 'ready', attached: false, chunkKey, lod };
        detailStream.cache.set(cacheKey, record);
        if (detailStream.wanted.has(cacheKey)) addChunkMeshesToScene(record);
        refreshMeshingHud();
        applyWireframeMode();
        return;
      } catch (err) {
        detailStream.building = false;
        detailStream.cache.delete(cacheKey);
        console.error('Chunk build failed:', cacheKey, err);
        return;
      }
    }
  }

  function updateChunkStreaming(force = false) {
    if (!detailStream.runtime || !currentBounds || viewMode !== 'detail') return;
    const now = performance.now();
    if (!force && now - detailStream.lastUpdateTs < 120) return;
    detailStream.lastUpdateTs = now;

    const center = computeStreamCenterChunk();
    const nextWanted = new Set();
    const wantedLodByChunk = new Map();
    for (let y = center.cy - detailStream.radiusFar; y <= center.cy + detailStream.radiusFar; y++) {
      if (y < 0 || y >= detailStream.runtime.chunkRows) continue;
      for (let x = center.cx - detailStream.radiusFar; x <= center.cx + detailStream.radiusFar; x++) {
        if (x < 0 || x >= detailStream.runtime.chunkCols) continue;
        const dx = Math.abs(x - center.cx);
        const dy = Math.abs(y - center.cy);
        const dist = Math.max(dx, dy);
        const lod = dist <= detailStream.radiusNear ? 0 : 1;
        const chunkKey = `${x},${y}`;
        wantedLodByChunk.set(chunkKey, lod);
        nextWanted.add(makeCacheKey(chunkKey, lod));
      }
    }
    detailStream.wanted = nextWanted;

    for (const [cacheKey, record] of detailStream.cache.entries()) {
      const [sx, sy] = String(record.chunkKey || '').split(',').map((v) => Number(v));
      const dx = Math.abs(sx - center.cx);
      const dy = Math.abs(sy - center.cy);
      const withinDetach = Math.max(dx, dy) <= detailStream.radiusFar + detailStream.unloadMargin;
      const wantedLod = wantedLodByChunk.get(record.chunkKey);
      const lodMismatch = Number.isFinite(wantedLod) && wantedLod !== record.lod;
      if (!nextWanted.has(cacheKey) && !withinDetach) {
        removeChunkMeshesFromScene(record);
      } else if (lodMismatch) {
        removeChunkMeshesFromScene(record);
      }
    }

    for (const cacheKey of nextWanted) {
      const [chunkKey, lodToken] = cacheKey.split('|lod');
      const lod = Number(lodToken) || 0;
      const record = detailStream.cache.get(cacheKey);
      if (!record) {
        enqueueChunkBuild(chunkKey, lod);
        continue;
      }
      if (record.state === 'ready') addChunkMeshesToScene(record);
    }

    refreshMeshingHud();
    void pumpChunkBuildQueue();
  }

  async function rebuildDetail(centerMicroX, centerMicroY) {
    detailStream.version++;
    clearDetailStream();
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
    detailStream.runtime = result.chunkRuntime || null;
    refreshMeshingHud();
    updateChunkStreaming(true);
    playerController.setContext(currentWorld, currentBounds);
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
    return { mx, my, t, role };
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
    const zoomDist = sceneBits.camera.position.distanceTo(sceneBits.controls.target);
    const camRotDegX = THREE.MathUtils.radToDeg(sceneBits.camera.rotation.x);
    const camRotDegY = THREE.MathUtils.radToDeg(sceneBits.camera.rotation.y);
    const camRotDegZ = THREE.MathUtils.radToDeg(sceneBits.camera.rotation.z);
    ui.fpsNowEl.textContent = fpsNow.toFixed(1);
    ui.fps1sEl.textContent = fps1s.toFixed(0);
    ui.fps5sEl.textContent = fps5s.toFixed(1);
    ui.frameMsEl.textContent = meanMs.toFixed(2);
    ui.zoomDistEl.textContent = zoomDist.toFixed(1);
    ui.camRotXEl.textContent = camRotDegX.toFixed(1);
    ui.camRotYEl.textContent = camRotDegY.toFixed(1);
    ui.camRotZEl.textContent = camRotDegZ.toFixed(1);
  }

  function animate(nowTs) {
    const dt = Math.max(0.0001, nowTs - perf.lastFrameTs);
    const dtSec = dt * 0.001;
    perf.lastFrameTs = nowTs;
    perf.frameTimestamps.push(nowTs);
    perf.frameDurationsMs.push(dt);
    if (perf.frameDurationsMs.length > perf.FRAME_MS_WINDOW) perf.frameDurationsMs.shift();
    sceneBits.controls.update();
    updateFollowCamera();
    updateChunkStreaming(false);
    void pumpChunkBuildQueue();
    playerController.tick(dtSec);
    playerController.faceCamera();
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
  gui.add(settings, 'followPlayerCamera').name('Camera Follow Player');
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
    pendingDetailDown = pickDetailAt(e.clientX, e.clientY) || null;
  });

  sceneBits.renderer.domElement.addEventListener('pointerup', async (e) => {
    if (e.button !== 0 || rendering) return;
    if (viewMode === 'world') {
      if (!pendingMacroDown) return;
      const macroUp = pickMacroFromPoint(e.clientX, e.clientY);
      const isSameTile = macroUp && macroUp.x === pendingMacroDown.x && macroUp.y === pendingMacroDown.y;
      pendingMacroDown = null;
      if (!isSameTile) return;
      selectedMacro = macroUp;
      await rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride);
      setViewMode('detail');
      ui.pickInfo.textContent = `Selected macro ${selectedMacro.x},${selectedMacro.y}.`;
      return;
    }
    if (viewMode === 'detail') {
      if (!pendingDetailDown) return;
      const detailUp = pickDetailAt(e.clientX, e.clientY);
      const isSameTile = detailUp && detailUp.mx === pendingDetailDown.mx && detailUp.my === pendingDetailDown.my;
      const picked = pendingDetailDown;
      pendingDetailDown = null;
      if (!isSameTile) return;
      playerController.placeAt(picked.mx, picked.my);
      ui.pickInfo.textContent = `Player spawned at mx:${picked.mx} my:${picked.my}. Use WASD/Arrows to move, Space to jump.`;
    }
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
  window.addEventListener('keydown', (e) => {
    const isMoveKey = e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD'
      || e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'ArrowDown' || e.code === 'ArrowRight';
    if (viewMode !== 'detail') return;
    if (isMoveKey || e.code === 'Space') e.preventDefault();
    if (isMoveKey) playerController.onKeyDown(e.code);
    if (e.code === 'Space' && !e.repeat) playerController.jump();
  });
  window.addEventListener('keyup', (e) => {
    if (viewMode !== 'detail') return;
    playerController.onKeyUp(e.code);
  });

  applyTimeOfDay(settings.timeOfDay);
  setViewMode('world');
  requestAnimationFrame(animate);
  playerController.init()
    .then(() => regenerate())
    .catch((e) => { console.error(e); ui.pickInfo.textContent = `Startup error: ${e?.message || e}`; rendering = false; });
}
