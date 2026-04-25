import { getEncounters } from '../../js/ecodex.js';
import { encounterNameToDex } from '../../js/pokemon/gen1-name-to-dex.js';
import { getDexAnimMeta } from '../../js/pokemon/pmd-anim-metadata.js';
import { PMD_DEFAULT_MON_ANIMS, PMD_MON_SHEET } from '../../js/pokemon/pmd-default-timing.js';
import { getPokemonConfig } from '../../js/pokemon/pokemon-config.js';
import { canWalkMicroTile } from '../../js/walkability.js';

const DIR_TO_ROW = {
  down: 0,
  'down-right': 1,
  right: 2,
  'up-right': 3,
  up: 4,
  'up-left': 5,
  left: 6,
  'down-left': 7,
};

function padDex3(dex) {
  return String(Math.max(1, Math.floor(Number(dex) || 1))).padStart(3, '0');
}

function pickSequenceFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return Math.max(0, seq.length - 1);
}

function facingFromVector(ix, iy, prev = 'down') {
  if (Math.abs(ix) < 1e-5 && Math.abs(iy) < 1e-5) return prev;
  const ax = Math.abs(ix);
  const ay = Math.abs(iy);
  const major = Math.max(ax, ay, 1e-6);
  const slip = 0.32;
  if (ax <= slip * major) return iy < 0 ? 'up' : 'down';
  if (ay <= slip * major) return ix < 0 ? 'left' : 'right';
  if (ix > 0 && iy < 0) return 'up-right';
  if (ix < 0 && iy < 0) return 'up-left';
  if (ix > 0 && iy > 0) return 'down-right';
  return 'down-left';
}

function distSq(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0);
  const dy = (a?.y || 0) - (b?.y || 0);
  return dx * dx + dy * dy;
}

function computeOpaqueBottomLift01(ctx, w, h) {
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    let bottomOpaqueY = -1;
    for (let y = h - 1; y >= 0; y--) {
      const rowStart = y * w * 4;
      for (let x = 0; x < w; x++) {
        const a = data[rowStart + x * 4 + 3];
        if (a > 8) {
          bottomOpaqueY = y;
          break;
        }
      }
      if (bottomOpaqueY >= 0) break;
    }
    if (bottomOpaqueY < 0) return 0;
    const liftPx = Math.max(0, (h - 1) - bottomOpaqueY);
    return liftPx / Math.max(1, h);
  } catch {
    return 0;
  }
}

export function createWildPokemonSystem({
  THREE,
  wildGroup,
  settings,
  textureFor,
  getMicroTile,
}) {
  const state = {
    world: null,
    bounds: null,
    visible: true,
    entities: new Map(),
    nextId: 1,
    speciesCache: new Map(),
    spawnAccumulator: 0,
    shadowTexture: null,
    helperLookAt: new THREE.Vector3(),
    randSeed: 1,
  };

  function rand() {
    state.randSeed = (state.randSeed * 1664525 + 1013904223) >>> 0;
    return state.randSeed / 0x100000000;
  }

  function getShadowTexture() {
    if (state.shadowTexture) return state.shadowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.28)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    state.shadowTexture = new THREE.CanvasTexture(canvas);
    state.shadowTexture.colorSpace = THREE.SRGBColorSpace;
    return state.shadowTexture;
  }

  async function ensureSpeciesAssets(dexId) {
    const dex = Math.max(1, Math.floor(Number(dexId) || 1));
    if (state.speciesCache.has(dex)) return state.speciesCache.get(dex);
    const id = padDex3(dex);
    let walkTex = null;
    let idleTex = null;
    try {
      walkTex = await textureFor(`tilesets/pokemon/${id}_walk.png`);
    } catch {
      walkTex = await textureFor('tilesets/gengar_walk.png');
    }
    try {
      idleTex = await textureFor(`tilesets/pokemon/${id}_idle.png`);
    } catch {
      idleTex = walkTex;
    }
    const meta = getDexAnimMeta(dex);
    const speciesCfg = getPokemonConfig(dex);
    const walkMeta = meta?.walk || {
      frameWidth: PMD_MON_SHEET.frameW,
      frameHeight: PMD_MON_SHEET.frameH,
      durations: PMD_DEFAULT_MON_ANIMS.Walk,
    };
    const idleMeta = meta?.idle || {
      frameWidth: PMD_MON_SHEET.frameW,
      frameHeight: PMD_MON_SHEET.frameH,
      durations: PMD_DEFAULT_MON_ANIMS.Idle,
    };
    const cached = {
      dex,
      walkTex,
      idleTex: idleTex || walkTex,
      walkMeta,
      idleMeta,
      speciesHeightTiles: Number(speciesCfg?.heightTiles) || null,
    };
    state.speciesCache.set(dex, cached);
    return cached;
  }

  function groundYAt(mx, my) {
    if (!state.world) return 0;
    const t = getMicroTile(Math.floor(mx), Math.floor(my), state.world);
    const hStep = t?.heightStep ?? 0;
    return hStep * settings.stepHeight + (settings.detailsYOffset ?? 0);
  }

  function applyEntityScale(ent) {
    const frameW = Math.max(1, Number(ent.idleMeta?.frameWidth) || PMD_MON_SHEET.frameW);
    const frameH = Math.max(1, Number(ent.idleMeta?.frameHeight) || PMD_MON_SHEET.frameH);
    const metaHeightTiles = Number(ent.idleMeta?.heightTiles ?? ent.walkMeta?.heightTiles);
    const targetHeightTiles = Number.isFinite(metaHeightTiles) && metaHeightTiles > 0
      ? metaHeightTiles
      : (Number.isFinite(ent.speciesHeightTiles) && ent.speciesHeightTiles > 0 ? ent.speciesHeightTiles : null);
    const h = targetHeightTiles ?? ((frameH / 16) * PMD_MON_SHEET.scale);
    const w = (frameW / Math.max(1, frameH)) * h;
    ent.mesh.scale.set(w, h, 1);
    ent.shadowMesh.scale.set(w * 0.8, w * 0.8, 1);
  }

  function drawFrame(ent, force = false) {
    if (!ent.frameCtx || !ent.frameCanvas) return;
    const moving = !!ent.moving;
    const img = moving ? ent.walkTex?.image : ent.idleTex?.image;
    if (!img) return;
    const meta = moving ? ent.walkMeta : ent.idleMeta;
    const frameW = Math.max(1, Number(meta?.frameWidth) || PMD_MON_SHEET.frameW);
    const frameH = Math.max(1, Number(meta?.frameHeight) || PMD_MON_SHEET.frameH);
    const row = DIR_TO_ROW[ent.facing] ?? 0;
    const framesAcross = Math.max(1, Math.floor((img.width || frameW) / frameW));
    const frame = Math.max(0, Math.min(framesAcross - 1, ent.animFrame));
    const rowMax = Math.max(0, Math.floor((img.height || frameH) / frameH) - 1);
    const safeRow = Math.max(0, Math.min(rowMax, row));
    const key = `${moving ? 'walk' : 'idle'}:${frame}:${safeRow}:${img.width}x${img.height}`;
    if (!force && key === ent.lastFrameKey) return;
    ent.lastFrameKey = key;
    ent.frameCtx.clearRect(0, 0, frameW, frameH);
    const srcX = frame * frameW;
    const srcY = safeRow * frameH;
    if (srcX + frameW <= (img.width || 0) && srcY + frameH <= (img.height || 0)) {
      ent.frameCtx.drawImage(img, srcX, srcY, frameW, frameH, 0, 0, frameW, frameH);
    }
    if (!ent.frameLift01Cache.has(key)) {
      ent.frameLift01Cache.set(key, computeOpaqueBottomLift01(ent.frameCtx, frameW, frameH));
    }
    const lift01 = ent.frameLift01Cache.get(key) || 0;
    ent.frameGroundLiftWorld = lift01 * ent.mesh.scale.y;
    ent.frameTex.needsUpdate = true;
  }

  function updateAnim(ent, dt) {
    const meta = ent.moving ? ent.walkMeta : ent.idleMeta;
    const seq = (meta?.durations && meta.durations.length)
      ? meta.durations
      : (ent.moving ? PMD_DEFAULT_MON_ANIMS.Walk : PMD_DEFAULT_MON_ANIMS.Idle);
    const total = seq.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      ent.animFrame = 0;
      return;
    }
    if (ent.moving) {
      ent.walkTick = (ent.walkTick + dt * 60) % total;
      ent.animFrame = pickSequenceFrame(seq, ent.walkTick);
      ent.idleTick = 0;
    } else {
      ent.idleTick = (ent.idleTick + dt * 60) % total;
      ent.animFrame = pickSequenceFrame(seq, ent.idleTick);
      ent.walkTick = 0;
    }
  }

  function syncTransform(ent) {
    if (!state.bounds) return;
    ent.worldY = groundYAt(ent.x, ent.y);
    ent.mesh.position.set(
      ent.x - state.bounds.offsetX,
      ent.worldY - ent.frameGroundLiftWorld,
      ent.y - state.bounds.offsetY,
    );
    ent.shadowMesh.position.set(
      ent.x - state.bounds.offsetX,
      ent.worldY + 0.012,
      ent.y - state.bounds.offsetY,
    );
  }

  function applyLightingToEntity(ent) {
    const mat = ent.mesh?.material;
    if (!mat) return;
    const tint = new THREE.Color(settings.entityTint || '#ffffff');
    tint.multiplyScalar(Math.max(0, Number(settings.entityBrightness) || 0));
    mat.color.copy(tint);
    mat.emissive.set(settings.entityEmissive || '#000000');
    mat.emissiveIntensity = Math.max(0, Number(settings.entityEmissiveIntensity) || 0);
    mat.alphaTest = Math.min(1, Math.max(0, Number(settings.entityAlphaTest) || 0.25));
    mat.needsUpdate = true;
    ent.mesh.castShadow = settings.entityCastShadow !== false;
    ent.mesh.receiveShadow = !!settings.entityReceiveShadow;
  }

  function canOccupy(mx, my) {
    if (!state.world || !state.bounds) return false;
    if (mx < 0 || my < 0 || mx >= state.bounds.width || my >= state.bounds.height) return false;
    return canWalkMicroTile(mx, my, state.world);
  }

  async function spawnOneNear(playerPos) {
    if (!state.world || !state.bounds || !playerPos) return false;
    const spawnRadius = Math.max(8, Number(settings.wildSpawnRadius) || 28);
    const minDist = 6;
    const maxTries = 32;
    for (let i = 0; i < maxTries; i++) {
      const a = rand() * Math.PI * 2;
      const r = minDist + rand() * Math.max(1, spawnRadius - minDist);
      const x = playerPos.x + Math.cos(a) * r;
      const y = playerPos.y + Math.sin(a) * r;
      const mx = Math.floor(x);
      const my = Math.floor(y);
      if (!canOccupy(mx, my)) continue;
      if ([...state.entities.values()].some((ent) => distSq(ent, { x, y }) < 9)) continue;
      const tile = getMicroTile(mx, my, state.world);
      const encounters = getEncounters(tile?.biomeId);
      if (!Array.isArray(encounters) || !encounters.length) continue;
      const pickName = encounters[Math.floor(rand() * encounters.length)];
      const dex = Number(encounterNameToDex(pickName)) || 25;
      const assets = await ensureSpeciesAssets(dex);
      const frameW = Math.max(1, Number(assets.idleMeta?.frameWidth) || PMD_MON_SHEET.frameW);
      const frameH = Math.max(1, Number(assets.idleMeta?.frameHeight) || PMD_MON_SHEET.frameH);
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = frameW;
      frameCanvas.height = frameH;
      const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });
      if (frameCtx) frameCtx.imageSmoothingEnabled = false;
      const frameTex = new THREE.CanvasTexture(frameCanvas);
      frameTex.colorSpace = THREE.SRGBColorSpace;
      frameTex.magFilter = THREE.NearestFilter;
      frameTex.minFilter = THREE.NearestFilter;
      frameTex.generateMipmaps = false;

      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      const mat = new THREE.MeshLambertMaterial({
        map: frameTex,
        transparent: true,
        alphaTest: 0.25,
        side: THREE.DoubleSide,
      });
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
          vec4 mvCenter = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
          mvPosition.z = mvCenter.z;
          gl_Position = projectionMatrix * mvPosition;
          gl_Position.z -= 0.0006 * gl_Position.w;`
        );
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 14;
      const shadowGeo = new THREE.PlaneGeometry(1, 1);
      shadowGeo.rotateX(-Math.PI / 2);
      const shadowMat = new THREE.MeshBasicMaterial({
        map: getShadowTexture(),
        transparent: true,
        depthWrite: false,
        color: '#000000',
        opacity: 0.45,
      });
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.renderOrder = 1;

      const ent = {
        key: `wild-${state.nextId++}`,
        dexId: dex,
        x: x + 0.5,
        y: y + 0.5,
        worldY: 0,
        facing: 'down',
        moving: false,
        targetX: null,
        targetY: null,
        decisionTimer: 0.2 + rand() * 1.0,
        idleTick: 0,
        walkTick: 0,
        animFrame: 0,
        frameGroundLiftWorld: 0,
        frameLift01Cache: new Map(),
        lastFrameKey: '',
        mesh,
        shadowMesh,
        frameCanvas,
        frameCtx,
        frameTex,
        walkTex: assets.walkTex,
        idleTex: assets.idleTex,
        walkMeta: assets.walkMeta,
        idleMeta: assets.idleMeta,
        speciesHeightTiles: assets.speciesHeightTiles,
      };
      applyEntityScale(ent);
      drawFrame(ent, true);
      syncTransform(ent);
      applyLightingToEntity(ent);
      mesh.visible = !!state.visible;
      shadowMesh.visible = !!state.visible;
      wildGroup.add(mesh);
      wildGroup.add(shadowMesh);
      state.entities.set(ent.key, ent);
      return true;
    }
    return false;
  }

  function despawnEntity(ent) {
    if (!ent) return;
    if (ent.mesh) {
      wildGroup.remove(ent.mesh);
      ent.mesh.geometry?.dispose();
      ent.mesh.material?.map?.dispose();
      ent.mesh.material?.dispose();
    }
    if (ent.shadowMesh) {
      wildGroup.remove(ent.shadowMesh);
      ent.shadowMesh.geometry?.dispose();
      ent.shadowMesh.material?.dispose();
    }
  }

  function clearAll() {
    for (const ent of state.entities.values()) despawnEntity(ent);
    state.entities.clear();
  }

  function updateEntityRoam(ent, dt) {
    ent.decisionTimer -= dt;
    if (ent.decisionTimer <= 0 && !ent.moving) {
      ent.decisionTimer = 0.6 + rand() * 2.2;
      if (rand() < 0.65) {
        const a = rand() * Math.PI * 2;
        const d = 1.5 + rand() * 4.5;
        ent.targetX = ent.x + Math.cos(a) * d;
        ent.targetY = ent.y + Math.sin(a) * d;
        ent.moving = true;
      }
    }
    if (!ent.moving || !Number.isFinite(ent.targetX) || !Number.isFinite(ent.targetY)) return;
    const dx = ent.targetX - ent.x;
    const dy = ent.targetY - ent.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) {
      ent.moving = false;
      ent.targetX = null;
      ent.targetY = null;
      return;
    }
    const step = Math.max(0.1, Number(settings.wildMoveSpeed) || 2.4) * dt;
    const nx = ent.x + (dx / Math.max(1e-5, len)) * Math.min(step, len);
    const ny = ent.y + (dy / Math.max(1e-5, len)) * Math.min(step, len);
    const mx = Math.floor(nx);
    const my = Math.floor(ny);
    if (!canOccupy(mx, my)) {
      ent.moving = false;
      ent.targetX = null;
      ent.targetY = null;
      return;
    }
    ent.facing = facingFromVector(dx, dy, ent.facing);
    ent.x = nx;
    ent.y = ny;
  }

  return {
    setContext(world, bounds) {
      state.world = world;
      state.bounds = bounds;
    },
    setVisible(v) {
      state.visible = !!v;
      for (const ent of state.entities.values()) {
        ent.mesh.visible = state.visible;
        ent.shadowMesh.visible = state.visible;
      }
    },
    resetAround(x, y) {
      clearAll();
      state.spawnAccumulator = 0;
      state.randSeed = (((Math.floor(x) + 1) * 73856093) ^ ((Math.floor(y) + 1) * 19349663)) >>> 0;
    },
    applyLightingTuning() {
      for (const ent of state.entities.values()) applyLightingToEntity(ent);
    },
    async tick(dt, playerPos) {
      if (!state.visible || !state.world || !state.bounds || !playerPos || !settings.wildEnabled) return;
      const maxCount = Math.max(0, Math.floor(Number(settings.wildMaxCount) || 0));
      const despawnRadius = Math.max(8, Number(settings.wildDespawnRadius) || 52);
      const despawnSq = despawnRadius * despawnRadius;
      for (const ent of [...state.entities.values()]) {
        if (distSq(ent, playerPos) > despawnSq) {
          state.entities.delete(ent.key);
          despawnEntity(ent);
        }
      }
      for (const ent of state.entities.values()) {
        updateEntityRoam(ent, dt);
        updateAnim(ent, dt);
        drawFrame(ent, false);
        syncTransform(ent);
      }
      if (state.entities.size >= maxCount) return;
      state.spawnAccumulator += dt;
      const interval = Math.max(0.05, Number(settings.wildRespawnIntervalSec) || 1.0);
      if (state.spawnAccumulator < interval) return;
      state.spawnAccumulator = 0;
      await spawnOneNear(playerPos);
    },
    faceCamera(camera) {
      if (!state.visible) return;
      for (const ent of state.entities.values()) {
        if (!ent.mesh?.visible) continue;
        state.helperLookAt.set(camera.position.x, ent.mesh.position.y, camera.position.z);
        ent.mesh.lookAt(state.helperLookAt);
      }
    },
    clear: clearAll,
  };
}

