import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://unpkg.com/three@0.161.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.161.0/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.161.0/examples/jsm/postprocessing/ShaderPass.js';
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
    microSpan: 64,
    stepHeight: 0.75,
    wallShade: 0.72,
    worldHeightScale: 10,
    detailsYOffset: -0.15,
    timeOfDay: 12,
    timeFlowEnabled: true,
    dayLengthMinutes: 20,
    showVegetation: true,
    vegetationDensity: 1.0,
    followPlayerCamera: true,
    cameraFocusStrength: 0.22,
    cameraLookAhead: 1.6,
    playerFocusBlur: true,
    playerFocusBlurStrength: 0.25,
    playerFocusBlurRadius: 1.3,
    playerFocusBlurMoveBoost: 1.2,
    playerFocusBlurFalloff: 'smooth',
    playerFocusBlurEllipseX: 3.66,
    playerFocusBlurEllipseY: 1.39,
    billboardTint: '#ffffff',
    billboardBrightness: 1.58,
    billboardEmissive: '#000000',
    billboardEmissiveIntensity: 0.0,
    billboardAlphaTest: 0.2,
    billboardCastShadow: true,
    billboardReceiveShadow: true,
    entityTint: '#ffffff',
    entityBrightness: 1.61,
    entityEmissive: '#000000',
    entityEmissiveIntensity: 0.0,
    entityAlphaTest: 0.25,
    entityCastShadow: true,
    entityReceiveShadow: false,
  };
  const debugSettings = {
    showAxes: true,
    axesSize: 24,
    wireframeOnly: false,
    showLodColors: false,
  };
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
    radiusCull: 7,
    unloadMargin: 1,
    lastUpdateTs: 0,
    buildBudgetMs: 6,
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
  const followVelRaw = new THREE.Vector2();
  const followVelSmoothed = new THREE.Vector2();
  const blurTmpAnchor = new THREE.Vector3();
  const blurTmpNdc = new THREE.Vector3();
  const blurLastAnchor = new THREE.Vector3();
  let blurAnchorReady = false;
  let blurMotion01 = 0;
  let followPrevWorldPos = null;

  function updateFollowCamera(dtSec) {
    if (viewMode !== 'detail' || !settings.followPlayerCamera || !playerController.isActive()) {
      followPrevWorldPos = null;
      followVelRaw.set(0, 0);
      followVelSmoothed.multiplyScalar(0.8);
      return;
    }
    const anchor = playerController.getAnchorPosition();
    if (!anchor) return;
    const worldPos = playerController.getWorldMicroPosition();
    if (worldPos && followPrevWorldPos) {
      const invDt = 1 / Math.max(1e-4, dtSec || 0.016);
      followVelRaw.set(
        (worldPos.x - followPrevWorldPos.x) * invDt,
        (worldPos.y - followPrevWorldPos.y) * invDt,
      );
    } else {
      followVelRaw.set(0, 0);
    }
    followPrevWorldPos = worldPos ? { x: worldPos.x, y: worldPos.y } : null;
    followVelSmoothed.lerp(followVelRaw, 0.18);
    const speed = followVelSmoothed.length();
    const leadDist = Math.min(Number(settings.cameraLookAhead) || 0, speed * 0.08);
    let leadX = 0;
    let leadZ = 0;
    if (speed > 1e-4 && leadDist > 0) {
      leadX = (followVelSmoothed.x / speed) * leadDist;
      leadZ = (followVelSmoothed.y / speed) * leadDist;
    }
    followTmpTarget.set(anchor.x + leadX, anchor.y, anchor.z + leadZ);
    followTmpDelta.copy(followTmpTarget).sub(sceneBits.controls.target);
    if (followTmpDelta.lengthSq() < 1e-8) return;
    const focusStrength = clamp(Number(settings.cameraFocusStrength) || 0.22, 0.01, 1.0);
    sceneBits.controls.target.addScaledVector(followTmpDelta, focusStrength);
    sceneBits.camera.position.addScaledVector(followTmpDelta, focusStrength);
  }

  const sceneBits = createSceneGraph(THREE, OrbitControls, ui.viewport, debugSettings);
  const focusBlurShader = {
    uniforms: {
      tDiffuse: { value: null },
      center: { value: new THREE.Vector2(0.5, 0.5) },
      strength: { value: 0.0 },
      radius: { value: 0.5 },
      aspect: { value: window.innerWidth / Math.max(1, window.innerHeight) },
      linearFalloff: { value: 0.0 },
      ellipseScale: { value: new THREE.Vector2(1.8, 1.0) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 center;
      uniform float strength;
      uniform float radius;
      uniform float aspect;
      uniform float linearFalloff;
      uniform vec2 ellipseScale;
      varying vec2 vUv;
      void main() {
        vec2 toCenter = vUv - center;
        vec2 ellipse = vec2(
          toCenter.x * aspect / max(ellipseScale.x, 1e-4),
          toCenter.y / max(ellipseScale.y, 1e-4)
        );
        float d = length(ellipse);
        float falloff = linearFalloff > 0.5 ? clamp(d / max(radius, 1e-5), 0.0, 1.0) : smoothstep(0.0, radius, d);
        float blur = falloff * strength;
        if (blur <= 0.0001) {
          gl_FragColor = texture2D(tDiffuse, vUv);
          return;
        }
        vec2 off = vec2(blur * 0.012);
        vec4 col = texture2D(tDiffuse, vUv) * 0.28;
        col += texture2D(tDiffuse, vUv + vec2( off.x, 0.0)) * 0.12;
        col += texture2D(tDiffuse, vUv + vec2(-off.x, 0.0)) * 0.12;
        col += texture2D(tDiffuse, vUv + vec2(0.0,  off.y)) * 0.12;
        col += texture2D(tDiffuse, vUv + vec2(0.0, -off.y)) * 0.12;
        col += texture2D(tDiffuse, vUv + vec2( off.x,  off.y)) * 0.09;
        col += texture2D(tDiffuse, vUv + vec2(-off.x,  off.y)) * 0.09;
        col += texture2D(tDiffuse, vUv + vec2( off.x, -off.y)) * 0.09;
        col += texture2D(tDiffuse, vUv + vec2(-off.x, -off.y)) * 0.09;
        gl_FragColor = col;
      }
    `,
  };
  const composer = new EffectComposer(sceneBits.renderer);
  composer.addPass(new RenderPass(sceneBits.scene, sceneBits.camera));
  const focusBlurPass = new ShaderPass(focusBlurShader);
  focusBlurPass.enabled = !!settings.playerFocusBlur;
  composer.addPass(focusBlurPass);
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
    const anchorX = viewMode === 'detail' ? sceneBits.controls.target.x : 0;
    const anchorZ = viewMode === 'detail' ? sceneBits.controls.target.z : 0;
    sceneBits.sunLight.position.set(anchorX + sx, sy, anchorZ + sz);
    sceneBits.sunLight.target.position.set(anchorX, 0, anchorZ);
    sceneBits.sunLight.target.updateMatrixWorld();

    // Brighter stylized curve (Nintendo-ish readability), especially around noon.
    sceneBits.sunLight.intensity = 0.5 + sunElev01 * 1.45;
    sceneBits.ambientLight.intensity = 0.14 + sunElev01 * 0.24;
    sceneBits.hemiLight.intensity = 0.1 + sunElev01 * 0.22;
    // Stronger readable contact shadows on terrain/details.
    sceneBits.sunLight.shadow.intensity = 0.9 + sunElev01 * 0.1;
    skySystem.update(h, sceneBits.sunLight.position);
  }

  function updateTimeOfDayFlow(dtSec) {
    if (!settings.timeFlowEnabled) return;
    const dayLengthSec = Math.max(1, Number(settings.dayLengthMinutes) * 60);
    const hoursPerSecond = 24 / dayLengthSec;
    applyTimeOfDay(settings.timeOfDay + (dtSec * hoursPerSecond));
  }

  function updatePlayerFocusBlur(dtSec) {
    focusBlurPass.enabled = !!settings.playerFocusBlur;
    if (!focusBlurPass.enabled) return;
    const anchor = playerController.getAnchorPosition();
    if (anchor) {
      blurTmpAnchor.set(anchor.x, anchor.y, anchor.z);
      if (blurAnchorReady) {
        const speed = blurTmpAnchor.distanceTo(blurLastAnchor) / Math.max(1e-4, dtSec);
        const target01 = THREE.MathUtils.clamp(speed * 0.16, 0, 1);
        blurMotion01 += (target01 - blurMotion01) * 0.16;
      }
      blurLastAnchor.copy(blurTmpAnchor);
      blurAnchorReady = true;
      blurTmpNdc.copy(blurTmpAnchor).project(sceneBits.camera);
      focusBlurPass.uniforms.center.value.set(
        THREE.MathUtils.clamp((blurTmpNdc.x + 1) * 0.5, 0, 1),
        THREE.MathUtils.clamp((blurTmpNdc.y + 1) * 0.5, 0, 1),
      );
    } else {
      blurAnchorReady = false;
      blurMotion01 += (0 - blurMotion01) * 0.12;
      focusBlurPass.uniforms.center.value.set(0.5, 0.5);
    }
    const baseStrength = Math.max(0, Number(settings.playerFocusBlurStrength) || 0);
    const moveBoost = Math.max(0, Number(settings.playerFocusBlurMoveBoost) || 0);
    focusBlurPass.uniforms.strength.value = baseStrength * (1 + blurMotion01 * moveBoost);
    focusBlurPass.uniforms.radius.value = Math.max(0.1, Number(settings.playerFocusBlurRadius) || 0.5);
    focusBlurPass.uniforms.aspect.value = sceneBits.camera.aspect;
    focusBlurPass.uniforms.linearFalloff.value = settings.playerFocusBlurFalloff === 'linear' ? 1.0 : 0.0;
    focusBlurPass.uniforms.ellipseScale.value.set(
      Math.max(0.1, Number(settings.playerFocusBlurEllipseX) || 1.8),
      Math.max(0.1, Number(settings.playerFocusBlurEllipseY) || 1.0),
    );
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
  vegetationSystem.applyLightingTuning();

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
      } else if (debugSettings.showLodColors) {
        const lod = Number(mesh.userData?.lod) || 0;
        mat.wireframe = false;
        mat.map = null;
        mat.vertexColors = false;
        mat.color.set(lod === 0 ? '#66ff88' : lod === 1 ? '#66aaff' : '#c58cff');
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
      sceneBits.camera.position.set(0, 7.216, 8.304);
      sceneBits.controls.target.set(0, 0, 0);
      sceneBits.camera.rotation.set(THREE.MathUtils.degToRad(-41), 0, 0);
    }
  }

  function removeChunkMeshesFromScene(record) {
    if (!record?.attached) return;
    const terrainMeshes = Array.isArray(record.meshes) ? record.meshes : [];
    const vegetationMeshes = Array.isArray(record.vegetationMeshes) ? record.vegetationMeshes : [];
    for (const mesh of terrainMeshes) {
      sceneBits.detailGroup.remove(mesh);
      const pickIdx = pickMeshes.indexOf(mesh);
      if (pickIdx >= 0) pickMeshes.splice(pickIdx, 1);
    }
    for (const veg of vegetationMeshes) sceneBits.detailGroup.remove(veg);
    record.attached = false;
  }

  function addChunkMeshesToScene(record) {
    if (!record || record.attached) return;
    const terrainMeshes = Array.isArray(record.meshes) ? record.meshes : [];
    const vegetationMeshes = Array.isArray(record.vegetationMeshes) ? record.vegetationMeshes : [];
    for (const mesh of terrainMeshes) {
      mesh.userData.lod = record.lod || 0;
      sceneBits.detailGroup.add(mesh);
      pickMeshes.push(mesh);
    }
    for (const veg of vegetationMeshes) {
      veg.userData.lod = record.lod || 0;
      sceneBits.detailGroup.add(veg);
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
      if (Array.isArray(record.vegetationMeshes)) {
        for (const veg of record.vegetationMeshes) {
          if (!veg?.children) continue;
          for (const mesh of veg.children) {
            mesh.geometry?.dispose?.();
            if (mesh.material && !Array.isArray(mesh.material)) mesh.material.dispose?.();
          }
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
    let lod0Chunks = 0;
    let lod1Chunks = 0;
    let lod2Chunks = 0;
    let mergedFaces = 0;
    let preTri = 0;
    let postTri = 0;
    for (const record of detailStream.cache.values()) {
      if (!record?.attached) continue;
      chunksRendered++;
      if ((record.lod || 0) === 0) lod0Chunks++;
      else if ((record.lod || 0) === 1) lod1Chunks++;
      else lod2Chunks++;
      mergedFaces += record.mergedFaceCount || 0;
      preTri += record.preTriEstimate || 0;
      postTri += record.triCount || 0;
    }
    ui.triCountEl.textContent = postTri.toLocaleString('en-US');
    if (ui.meshingStatsEl) {
      ui.meshingStatsEl.textContent = `chunks:${chunksRendered} | merged:${mergedFaces} | tri pre/post:${preTri}/${postTri}`;
    }
    if (ui.lodStatsEl) {
      const center = computeStreamCenterChunk();
      ui.lodStatsEl.textContent = `center:${center.cx},${center.cy}=LOD0 | active L0/L1/L2:${lod0Chunks}/${lod1Chunks}/${lod2Chunks} | ring:${detailStream.radiusNear}/${detailStream.radiusFar}/${detailStream.radiusCull}`;
    }
  }

  function computeStreamCenterChunk() {
    if (!currentBounds || !detailStream.runtime) return { cx: 0, cy: 0 };
    const worldPos = playerController.getWorldMicroPosition();
    const localX = worldPos ? worldPos.x : (sceneBits.controls.target.x + currentBounds.offsetX);
    const localY = worldPos ? worldPos.y : (sceneBits.controls.target.z + currentBounds.offsetY);
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
    const center = computeStreamCenterChunk();
    const [cx, cy] = String(chunkKey).split(',').map((v) => Number(v));
    const dist = Math.max(Math.abs(cx - center.cx), Math.abs(cy - center.cy));
    const priority = (lod * 1000) + dist;
    detailStream.queue.push({ chunkKey, lod, cacheKey, priority });
    detailStream.queue.sort((a, b) => a.priority - b.priority);
  }

  async function pumpChunkBuildQueue() {
    if (!detailStream.runtime || detailStream.building) return;
    const budgetStart = performance.now();
    while (detailStream.queue.length > 0) {
      if (performance.now() - budgetStart > detailStream.buildBudgetMs) return;
      const next = detailStream.queue.shift();
      if (!next) return;
      const { chunkKey, lod, cacheKey } = next;
      const existing = detailStream.cache.get(cacheKey);
      if (existing?.state === 'ready') {
        if (detailStream.wanted.has(cacheKey)) addChunkMeshesToScene(existing);
        continue;
      }
      if (existing?.state === 'building') continue;
      detailStream.cache.set(cacheKey, { state: 'building', attached: false, chunkKey, lod });
      detailStream.building = true;
      const runVersion = detailStream.version;
      try {
        const built = await detailStream.runtime.buildChunkByKey(chunkKey, lod);
        if (runVersion !== detailStream.version) {
          detailStream.cache.delete(cacheKey);
          continue;
        }
        if (!built) {
          detailStream.cache.delete(cacheKey);
          continue;
        }
        const chunkVegetation = await vegetationSystem.buildChunkVegetation({
          chunk: built.chunk || null,
          lod,
          worldSeed: ui.seedInput.value,
          currentWorld,
          offsetX: currentBounds?.offsetX ?? 0,
          offsetY: currentBounds?.offsetY ?? 0,
        });
        if (runVersion !== detailStream.version) {
          detailStream.cache.delete(cacheKey);
          continue;
        }
        const record = {
          ...built,
          vegetationMeshes: chunkVegetation || [],
          state: 'ready',
          attached: false,
          chunkKey,
          lod,
        };
        detailStream.cache.set(cacheKey, record);
        if (detailStream.wanted.has(cacheKey)) addChunkMeshesToScene(record);
        refreshMeshingHud();
        applyWireframeMode();
        continue;
      } catch (err) {
        detailStream.cache.delete(cacheKey);
        console.error('Chunk build failed:', cacheKey, err);
      } finally {
        detailStream.building = false;
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
    for (let y = center.cy - detailStream.radiusCull; y <= center.cy + detailStream.radiusCull; y++) {
      if (y < 0 || y >= detailStream.runtime.chunkRows) continue;
      for (let x = center.cx - detailStream.radiusCull; x <= center.cx + detailStream.radiusCull; x++) {
        if (x < 0 || x >= detailStream.runtime.chunkCols) continue;
        const dx = Math.abs(x - center.cx);
        const dy = Math.abs(y - center.cy);
        const dist = Math.max(dx, dy);
        const lod = dist <= detailStream.radiusNear ? 0 : dist <= detailStream.radiusFar ? 1 : 2;
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
      const withinDetach = Math.max(dx, dy) <= detailStream.radiusCull + detailStream.unloadMargin;
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
    playerController.setContext(currentWorld, currentBounds);
    if (currentBounds) {
      const spawnMx = clamp(Math.floor(centerMicroX), 0, currentBounds.width - 1);
      const spawnMy = clamp(Math.floor(centerMicroY), 0, currentBounds.height - 1);
      playerController.placeAt(spawnMx, spawnMy);
      ui.pickInfo.textContent = `Player spawned at selected macro center mx:${spawnMx} my:${spawnMy}. Use WASD/Arrows to move, Space to jump, F to fly.`;
    }
    refreshMeshingHud();
    updateChunkStreaming(true);
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
      // Lazy detail build: only rebuild immediately if user is already in Detail mode.
      if (viewMode === 'detail') {
        await rebuildDetail(
          centerMacroX * MACRO_TILE_STRIDE + halfStride,
          centerMacroY * MACRO_TILE_STRIDE + halfStride,
        );
      } else {
        detailStream.version++;
        clearDetailStream();
        currentBounds = null;
        detailFloorMesh = null;
        if (ui.triCountEl) ui.triCountEl.textContent = '--';
        if (ui.meshingStatsEl) ui.meshingStatsEl.textContent = '--';
        if (ui.lodStatsEl) ui.lodStatsEl.textContent = '--';
      }
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
    const mx = Math.floor(hits[0].point.x + currentBounds.offsetX);
    const my = Math.floor(hits[0].point.z + currentBounds.offsetY);
    if (mx < 0 || my < 0 || mx >= currentBounds.width || my >= currentBounds.height) return;
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
    updateTimeOfDayFlow(dtSec);
    updateFollowCamera(dtSec);
    updatePlayerFocusBlur(dtSec);
    updateChunkStreaming(false);
    void pumpChunkBuildQueue();
    playerController.tick(dtSec);
    playerController.faceCamera();
    vegetationSystem.faceCamera(sceneBits.camera);
    skySystem.tick(nowTs * 0.001);
    composer.render();
    updatePerfOverlay(nowTs);
    requestAnimationFrame(animate);
  }

  const gui = new GUI({ title: 'Render Params' });
  gui.add(settings, 'microSpan', 64, 220, 1).name('Visible Tiles').onFinishChange(() => currentWorld && selectedMacro && rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride));
  gui.add(settings, 'stepHeight', 0.25, 20, 0.01).name('Step Height').onFinishChange(() => currentWorld && selectedMacro && rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride));
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
  gui.add(settings, 'timeFlowEnabled').name('Time Flow');
  gui.add(settings, 'dayLengthMinutes', 1, 180, 1).name('Day Length (min)');
  gui.add(settings, 'timeOfDay', 0, 24, 0.01).name('Time of Day').listen().onChange(applyTimeOfDay);
  gui.add(settings, 'showVegetation').name('Show Vegetation').onChange((v) => vegetationSystem.setVisible(!!v));
  gui.add(settings, 'followPlayerCamera').name('Camera Follow Player');
  gui.add(settings, 'cameraFocusStrength', 0.05, 0.5, 0.01).name('Cam Focus Strength');
  gui.add(settings, 'cameraLookAhead', 0, 4, 0.05).name('Cam Look Ahead');
  const camFx = gui.addFolder('Camera FX');
  camFx.add(settings, 'playerFocusBlur').name('Player Focus Blur');
  camFx.add(settings, 'playerFocusBlurStrength', 0, 0.9, 0.01).name('Blur Strength');
  camFx.add(settings, 'playerFocusBlurRadius', 0.1, 2.0, 0.01).name('Blur Radius');
  camFx.add(settings, 'playerFocusBlurEllipseX', 0.2, 4.0, 0.01).name('Blur Ellipse X');
  camFx.add(settings, 'playerFocusBlurEllipseY', 0.2, 4.0, 0.01).name('Blur Ellipse Y');
  camFx.add(settings, 'playerFocusBlurMoveBoost', 0, 3, 0.01).name('Move Boost');
  camFx.add(settings, 'playerFocusBlurFalloff', ['smooth', 'linear']).name('Blur Falloff');
  const billFx = gui.addFolder('Billboard Lighting');
  billFx.addColor(settings, 'billboardTint').name('Tint').onChange(() => vegetationSystem.applyLightingTuning());
  billFx.add(settings, 'billboardBrightness', 0, 2.5, 0.01).name('Brightness').onChange(() => vegetationSystem.applyLightingTuning());
  billFx.addColor(settings, 'billboardEmissive').name('Emissive').onChange(() => vegetationSystem.applyLightingTuning());
  billFx.add(settings, 'billboardEmissiveIntensity', 0, 3.0, 0.01).name('Emissive Intensity').onChange(() => vegetationSystem.applyLightingTuning());
  billFx.add(settings, 'billboardAlphaTest', 0, 0.8, 0.01).name('Alpha Cut').onChange(() => vegetationSystem.applyLightingTuning());
  billFx.add(settings, 'billboardCastShadow').name('Cast Shadow').onChange(() => vegetationSystem.applyLightingTuning());
  billFx.add(settings, 'billboardReceiveShadow').name('Receive Shadow').onChange(() => vegetationSystem.applyLightingTuning());
  const entityFx = gui.addFolder('Pokemon/Entity Lighting');
  entityFx.addColor(settings, 'entityTint').name('Tint').onChange(() => playerController.applyLightingTuning());
  entityFx.add(settings, 'entityBrightness', 0, 2.5, 0.01).name('Brightness').onChange(() => playerController.applyLightingTuning());
  entityFx.addColor(settings, 'entityEmissive').name('Emissive').onChange(() => playerController.applyLightingTuning());
  entityFx.add(settings, 'entityEmissiveIntensity', 0, 3.0, 0.01).name('Emissive Intensity').onChange(() => playerController.applyLightingTuning());
  entityFx.add(settings, 'entityAlphaTest', 0, 0.8, 0.01).name('Alpha Cut').onChange(() => playerController.applyLightingTuning());
  entityFx.add(settings, 'entityCastShadow').name('Cast Shadow').onChange(() => playerController.applyLightingTuning());
  entityFx.add(settings, 'entityReceiveShadow').name('Receive Shadow').onChange(() => playerController.applyLightingTuning());
  gui.add(settings, 'vegetationDensity', 0.25, 1.0, 0.01).name('Vegetation Density').onFinishChange(() => {
    if (currentWorld && selectedMacro) rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride);
  });
  gui.add(detailStream, 'buildBudgetMs', 2, 14, 1).name('Build Budget (ms)');
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
  dbg.add(debugSettings, 'showLodColors').name('Show LOD Colors').onChange(applyWireframeMode);

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
      ui.pickInfo.textContent = `Player spawned at mx:${picked.mx} my:${picked.my}. Use WASD/Arrows to move, Space to jump, F to fly.`;
    }
  });

  ui.worldBtn.addEventListener('click', () => setViewMode('world'));
  ui.detailBtn.addEventListener('click', async () => {
    if (!selectedMacro && currentWorld) selectedMacro = { x: Math.floor(currentWorld.width * 0.5), y: Math.floor(currentWorld.height * 0.5) };
    if (currentWorld && selectedMacro && !currentBounds) {
      ui.pickInfo.textContent = 'Building detail map...';
      await rebuildDetail(selectedMacro.x * MACRO_TILE_STRIDE + halfStride, selectedMacro.y * MACRO_TILE_STRIDE + halfStride);
    }
    setViewMode('detail');
  });
  ui.regenBtn.addEventListener('click', () => regenerate().catch((e) => { console.error(e); ui.pickInfo.textContent = `Error: ${e?.message || e}`; rendering = false; }));
  ui.seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') regenerate().catch((e2) => { console.error(e2); ui.pickInfo.textContent = `Error: ${e2?.message || e2}`; rendering = false; }); });
  window.addEventListener('resize', () => {
    sceneBits.camera.aspect = window.innerWidth / window.innerHeight;
    sceneBits.camera.updateProjectionMatrix();
    sceneBits.renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    focusBlurPass.uniforms.aspect.value = sceneBits.camera.aspect;
  });
  window.addEventListener('keydown', (e) => {
    const isMoveKey = e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD'
      || e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'ArrowDown' || e.code === 'ArrowRight';
    if (viewMode !== 'detail') return;
    const isFlightVerticalKey = e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight';
    if (isMoveKey || isFlightVerticalKey || e.code === 'KeyF') e.preventDefault();
    if (isMoveKey) playerController.onKeyDown(e.code);
    if (isFlightVerticalKey) playerController.onKeyDown(e.code);
    if (e.code === 'KeyF' && !e.repeat) playerController.toggleFlight();
    if (e.code === 'Space' && !e.repeat && !playerController.isFlightActive()) playerController.jump();
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
