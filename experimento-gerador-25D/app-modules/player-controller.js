import { getDexAnimMeta } from '../../js/pokemon/pmd-anim-metadata.js';
import { PMD_DEFAULT_MON_ANIMS, PMD_MON_SHEET } from '../../js/pokemon/pmd-default-timing.js';
import { getPokemonConfig } from '../../js/pokemon/pokemon-config.js';
import { canWalkMicroTile, pivotCellHeightTraversalOk, isCliffDrop, okHeightStepTransition } from '../../js/walkability.js';
import { speciesHasFlyingType } from '../../js/pokemon/pokemon-type-helpers.js';

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

/** Flight tuning (3D): tweak these two values to change fly speed. */
const FLIGHT_HORIZONTAL_SPEED_MULT = 6.0;
const FLIGHT_VERTICAL_SPEED = 16.8;

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

function facingFromInput(ix, iy, prev = 'down') {
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

export function createPlayerController({
  THREE,
  playerGroup,
  camera,
  controls,
  settings,
  textureFor,
  getMicroTile,
}) {
  const savedDex = (() => {
    try {
      const raw = Number(localStorage.getItem('pkmn_player_dex_id'));
      if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
    } catch {
      /* noop */
    }
    return 150;
  })();

  const state = {
    active: false,
    visible: true,
    world: null,
    bounds: null,
    x: 0,
    y: 0,
    worldY: 0,
    vz: 0,
    grounded: true,
    jumpsUsed: 0,
    maxAirJumps: 2,
    flightActive: false,
    facing: 'down',
    animRow: 0,
    animFrame: 0,
    idleTick: 0,
    walkTick: 0,
    keys: new Set(),
    walkSpeed: 4.2,
    jumpImpulse: 4.5,
    gravity: 9.8,
    dexId: savedDex,
    walkTex: null,
    idleTex: null,
    walkMeta: null,
    idleMeta: null,
    frameCanvas: null,
    frameCtx: null,
    frameTex: null,
    mesh: null,
    lastFrameKey: '',
    helperLookAt: new THREE.Vector3(),
    moveForward: new THREE.Vector3(),
    moveRight: new THREE.Vector3(),
    movingNow: false,
    frameLift01Cache: new Map(),
    frameGroundLiftWorld: 0,
    logicalGroundY: 0,
    speciesHeightTiles: null,
  };

  function createFrameTextureFromCanvas() {
    if (!state.frameCanvas) return null;
    const tex = new THREE.CanvasTexture(state.frameCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  async function ensureSprites(dexId = state.dexId) {
    state.dexId = Math.max(1, Math.floor(Number(dexId) || 150));
    const id = padDex3(state.dexId);
    const walkPath = `tilesets/pokemon/${id}_walk.png`;
    const idlePath = `tilesets/pokemon/${id}_idle.png`;

    let walkTex = null;
    let idleTex = null;
    try {
      walkTex = await textureFor(walkPath);
    } catch {
      walkTex = await textureFor('tilesets/gengar_walk.png');
    }
    try {
      idleTex = await textureFor(idlePath);
    } catch {
      idleTex = await textureFor('tilesets/gengar_idle.png');
    }
    state.walkTex = walkTex;
    state.idleTex = idleTex || walkTex;

    const meta = getDexAnimMeta(state.dexId);
    const speciesCfg = getPokemonConfig(state.dexId);
    state.speciesHeightTiles = Number(speciesCfg?.heightTiles) || null;
    state.walkMeta = meta?.walk || {
      frameWidth: PMD_MON_SHEET.frameW,
      frameHeight: PMD_MON_SHEET.frameH,
      durations: PMD_DEFAULT_MON_ANIMS.Walk,
    };
    state.idleMeta = meta?.idle || {
      frameWidth: PMD_MON_SHEET.frameW,
      frameHeight: PMD_MON_SHEET.frameH,
      durations: PMD_DEFAULT_MON_ANIMS.Idle,
    };

    const frameW = Math.max(1, Number(state.idleMeta.frameWidth) || PMD_MON_SHEET.frameW);
    const frameH = Math.max(1, Number(state.idleMeta.frameHeight) || PMD_MON_SHEET.frameH);

    state.frameCanvas = document.createElement('canvas');
    state.frameCanvas.width = frameW;
    state.frameCanvas.height = frameH;
    state.frameCtx = state.frameCanvas.getContext('2d', { willReadFrequently: true });
    if (state.frameCtx) state.frameCtx.imageSmoothingEnabled = false;
    state.frameTex = createFrameTextureFromCanvas();

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({
      map: state.frameTex,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
    });
    state.mesh = new THREE.Mesh(geo, mat);
    state.mesh.castShadow = true;
    state.mesh.receiveShadow = false;
    state.mesh.renderOrder = 15;
    playerGroup.add(state.mesh);
    drawCurrentFrame(true);
    updateMeshScale(frameW, frameH);
    state.mesh.visible = false;
  }

  function updateMeshScale(frameW, frameH) {
    if (!state.mesh) return;
    const metaHeightTiles = Number(state.idleMeta?.heightTiles ?? state.walkMeta?.heightTiles);
    const targetHeightTiles = Number.isFinite(metaHeightTiles) && metaHeightTiles > 0
      ? metaHeightTiles
      : (Number.isFinite(state.speciesHeightTiles) && state.speciesHeightTiles > 0 ? state.speciesHeightTiles : null);
    // Prefer authored species height; fallback preserves old behavior.
    const h = targetHeightTiles ?? ((frameH / 16) * PMD_MON_SHEET.scale);
    const w = (frameW / Math.max(1, frameH)) * h;
    state.mesh.scale.set(w, h, 1);
  }

  function drawCurrentFrame(force = false) {
    if (!state.mesh || !state.frameCtx) return;
    const moving = !!state.movingNow;
    const tex = moving ? (state.walkTex || state.idleTex) : (state.idleTex || state.walkTex);
    const img = tex?.image;
    if (!img) return;

    const meta = moving ? state.walkMeta : state.idleMeta;
    const frameW = Math.max(1, Number(meta?.frameWidth) || PMD_MON_SHEET.frameW);
    const frameH = Math.max(1, Number(meta?.frameHeight) || PMD_MON_SHEET.frameH);
    if (state.frameCanvas.width !== frameW || state.frameCanvas.height !== frameH) {
      state.frameCanvas.width = frameW;
      state.frameCanvas.height = frameH;
      state.frameCtx = state.frameCanvas.getContext('2d', { willReadFrequently: true });
      if (state.frameCtx) state.frameCtx.imageSmoothingEnabled = false;
      if (state.frameTex) state.frameTex.dispose();
      state.frameTex = createFrameTextureFromCanvas();
      if (state.mesh?.material) {
        state.mesh.material.map = state.frameTex;
        state.mesh.material.needsUpdate = true;
      }
      updateMeshScale(frameW, frameH);
    }
    const framesAcross = Math.max(1, Math.floor((img.width || frameW) / frameW));
    const frame = Math.max(0, Math.min(framesAcross - 1, state.animFrame));
    const rowMax = Math.max(0, Math.floor((img.height || frameH) / frameH) - 1);
    const row = Math.max(0, Math.min(rowMax, state.animRow));
    const key = `${moving ? 'walk' : 'idle'}:${frame}:${row}:${img.width}x${img.height}`;
    if (!force && key === state.lastFrameKey) return;
    state.lastFrameKey = key;

    state.frameCtx.clearRect(0, 0, frameW, frameH);
    const srcX = frame * frameW;
    const srcY = row * frameH;
    if (srcX + frameW <= (img.width || 0) && srcY + frameH <= (img.height || 0)) {
      state.frameCtx.drawImage(
        img,
        srcX,
        srcY,
        frameW,
        frameH,
        0,
        0,
        frameW,
        frameH,
      );
    }
    if (!state.frameLift01Cache.has(key)) {
      const lift01 = computeOpaqueBottomLift01(state.frameCtx, frameW, frameH);
      state.frameLift01Cache.set(key, lift01);
    }
    const lift01 = state.frameLift01Cache.get(key) || 0;
    state.frameGroundLiftWorld = lift01 * (state.mesh?.scale.y || 0);
    state.frameTex.needsUpdate = true;
  }

  function updateAnim(dt, moving) {
    const meta = moving ? state.walkMeta : state.idleMeta;
    const seq = (meta?.durations && meta.durations.length) ? meta.durations : (moving ? PMD_DEFAULT_MON_ANIMS.Walk : PMD_DEFAULT_MON_ANIMS.Idle);
    const total = seq.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      state.animFrame = 0;
      return;
    }
    if (moving) {
      state.walkTick = (state.walkTick + dt * 60) % total;
      state.animFrame = pickSequenceFrame(seq, state.walkTick);
      state.idleTick = 0;
    } else {
      state.idleTick = (state.idleTick + dt * 60) % total;
      state.animFrame = pickSequenceFrame(seq, state.idleTick);
      state.walkTick = 0;
    }
  }

  function getInputVector() {
    const inputRight =
      (state.keys.has('KeyD') ? 1 : 0) +
      (state.keys.has('ArrowRight') ? 1 : 0) -
      (state.keys.has('KeyA') ? 1 : 0) -
      (state.keys.has('ArrowLeft') ? 1 : 0);
    const inputForward =
      (state.keys.has('KeyW') ? 1 : 0) +
      (state.keys.has('ArrowUp') ? 1 : 0) -
      (state.keys.has('KeyS') ? 1 : 0) -
      (state.keys.has('ArrowDown') ? 1 : 0);
    if (Math.abs(inputRight) < 1e-6 && Math.abs(inputForward) < 1e-6) {
      return { x: 0, y: 0, moving: false, faceX: 0, faceY: 0 };
    }

    // Camera-relative movement on horizontal plane (XZ), mapped to world micro axes (x,y).
    state.moveForward.copy(controls.target).sub(camera.position).setY(0);
    if (state.moveForward.lengthSq() < 1e-8) {
      state.moveForward.set(0, 0, 1);
    } else {
      state.moveForward.normalize();
    }
    state.moveRight.set(state.moveForward.z, 0, -state.moveForward.x).normalize();

    // In this world-axis convention, strafe sign must be inverted to match expected A(left)/D(right).
    const worldX = -state.moveRight.x * inputRight + state.moveForward.x * inputForward;
    const worldY = -state.moveRight.z * inputRight + state.moveForward.z * inputForward;
    const len = Math.hypot(worldX, worldY);
    if (len < 1e-6) {
      return {
        x: 0,
        y: 0,
        moving: false,
        faceX: inputRight,
        // W should map to "up" row in PMD facing map.
        faceY: -inputForward,
      };
    }
    return {
      x: worldX / len,
      y: worldY / len,
      moving: true,
      faceX: inputRight,
      // W should map to "up" row in PMD facing map.
      faceY: -inputForward,
    };
  }

  function sampleGroundStep(mx, my) {
    if (!state.world) return 0;
    const t = getMicroTile(mx, my, state.world);
    return t?.heightStep ?? 0;
  }

  function groundYAtWorldXY(wx, wy) {
    const mx = Math.floor(wx);
    const my = Math.floor(wy);
    const hStep = sampleGroundStep(mx, my);
    return hStep * settings.stepHeight + (settings.detailsYOffset ?? 0);
  }

  function canWalkAt(nx, ny, ox, oy, isAirborne) {
    if (!state.world) return false;
    if (isAirborne) {
      // Match 2D behavior: airborne probes do not enforce source-height traversal constraints.
      return canWalkMicroTile(nx, ny, state.world, undefined, undefined, undefined, true, false, false);
    }
    if (!canWalkMicroTile(nx, ny, state.world, ox, oy, undefined, false, false, false)) return false;
    return pivotCellHeightTraversalOk(nx, ny, ox, oy, state.world, false);
  }

  function updatePosition(dt) {
    const input = getInputVector();
    if (input.moving) {
      // Facing follows local input intent (W/S = up/down), movement remains camera-relative.
      state.facing = facingFromInput(input.faceX, input.faceY, state.facing);
      state.animRow = DIR_TO_ROW[state.facing] || 0;
    }
    const ox = state.x;
    const oy = state.y;
    const prevGroundY = groundYAtWorldXY(ox, oy);
    const speed = state.walkSpeed * (state.flightActive ? FLIGHT_HORIZONTAL_SPEED_MULT : 1);
    const ax = input.x * speed * dt;
    const ay = input.y * speed * dt;
    const isAirborne = !state.grounded || state.flightActive;
    let nx = ox;
    let ny = oy;

    if (Math.abs(ax) > 1e-7 || Math.abs(ay) > 1e-7) {
      if (canWalkAt(ox + ax, oy + ay, ox, oy, isAirborne)) {
        nx = ox + ax;
        ny = oy + ay;
      } else if (canWalkAt(ox + ax, oy, ox, oy, isAirborne)) {
        nx = ox + ax;
      } else if (canWalkAt(ox, oy + ay, ox, oy, isAirborne)) {
        ny = oy + ay;
      } else {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) * 0.5;
          const tx = ox + ax * mid;
          const ty = oy + ay * mid;
          if (canWalkAt(tx, ty, ox, oy, isAirborne)) lo = mid;
          else hi = mid;
        }
        nx = ox + ax * lo;
        ny = oy + ay * lo;
      }
    }

    if (state.bounds) {
      const minX = 0.05;
      const minY = 0.05;
      const maxX = state.bounds.width - 0.05;
      const maxY = state.bounds.height - 0.05;
      state.x = Math.max(minX, Math.min(maxX, nx));
      state.y = Math.max(minY, Math.min(maxY, ny));
    } else {
      state.x = nx;
      state.y = ny;
    }

    const groundY = groundYAtWorldXY(state.x, state.y);
    state.logicalGroundY = groundY;

    // If we were grounded and walked onto a lower surface without a valid ramp/stair connector,
    // do NOT snap Y instantly — enter freefall from the previous elevation.
    if (state.grounded && state.world && (Math.abs(state.x - ox) > 1e-7 || Math.abs(state.y - oy) > 1e-7)) {
      const step = Math.max(1e-4, Number(settings.stepHeight) || 0.55);
      const drop = prevGroundY - groundY;
      const cliff = isCliffDrop(ox, oy, state.x, state.y, state.world);
      const bigDrop = drop > step * 1.25;

      const smx = Math.floor(ox);
      const smy = Math.floor(oy);
      const dmx = Math.floor(state.x);
      const dmy = Math.floor(state.y);
      const srcTile = getMicroTile(smx, smy, state.world);
      const dstTile = getMicroTile(dmx, dmy, state.world);
      const supportedStepDown =
        !!srcTile &&
        !!dstTile &&
        dstTile.heightStep < srcTile.heightStep &&
        okHeightStepTransition(srcTile, dstTile);

      if ((cliff || bigDrop || drop > 1e-4) && !supportedStepDown) {
        state.grounded = false;
        state.vz = 0;
      }
    }

    if (state.flightActive) {
      const up = state.keys.has('Space') ? FLIGHT_VERTICAL_SPEED : 0;
      const down = (state.keys.has('ShiftLeft') || state.keys.has('ShiftRight')) ? FLIGHT_VERTICAL_SPEED : 0;
      state.vz = 0;
      state.worldY = Math.max(groundY, state.worldY + (up - down) * dt);
      state.grounded = state.worldY <= groundY + 1e-5;
    } else if (state.grounded) {
      state.worldY = groundY;
      state.vz = 0;
    } else {
      state.vz -= state.gravity * dt;
      state.worldY += state.vz * dt;
      if (state.vz <= 0 && state.worldY <= groundY) {
        state.worldY = groundY;
        state.vz = 0;
        state.grounded = true;
        state.jumpsUsed = 0;
      }
    }
    const moved = Math.hypot(state.x - ox, state.y - oy) > 0.0008;
    state.movingNow = moved;
    updateAnim(dt, moved);
  }

  function syncMeshTransform() {
    if (!state.mesh || !state.bounds || !state.active) return;
    const tileMx = Math.floor(state.x);
    const tileMy = Math.floor(state.y);
    const hStep = sampleGroundStep(tileMx, tileMy);
    const groundY = hStep * settings.stepHeight + (settings.detailsYOffset ?? 0);
    state.logicalGroundY = groundY;
    state.mesh.position.set(
      state.x - state.bounds.offsetX,
      state.worldY - state.frameGroundLiftWorld,
      state.y - state.bounds.offsetY,
    );
  }

  function placeAt(mx, my) {
    state.x = mx + 0.5;
    state.y = my + 0.5;
    state.vz = 0;
    state.grounded = true;
    state.jumpsUsed = 0;
    state.flightActive = false;
    state.worldY = groundYAtWorldXY(state.x, state.y);
    state.active = true;
    state.mesh.visible = !!state.visible;
    syncMeshTransform();
  }

  function tick(dt) {
    if (!state.active || !state.mesh || !state.world || !state.bounds) return;
    updatePosition(dt);
    drawCurrentFrame();
    syncMeshTransform();
  }

  function faceCamera() {
    if (!state.mesh || !state.mesh.visible) return;
    state.helperLookAt.set(camera.position.x, state.mesh.position.y, camera.position.z);
    state.mesh.lookAt(state.helperLookAt);
  }

  function applyLightingTuning() {
    if (!state.mesh?.material) return;
    const mat = state.mesh.material;
    const tint = new THREE.Color(settings.entityTint || '#ffffff');
    const brightness = Math.max(0, Number(settings.entityBrightness) || 0);
    tint.multiplyScalar(brightness);
    mat.color.copy(tint);
    mat.emissive.set(settings.entityEmissive || '#000000');
    mat.emissiveIntensity = Math.max(0, Number(settings.entityEmissiveIntensity) || 0);
    mat.alphaTest = Math.min(1, Math.max(0, Number(settings.entityAlphaTest) || 0.25));
    mat.needsUpdate = true;
    state.mesh.castShadow = settings.entityCastShadow !== false;
    state.mesh.receiveShadow = !!settings.entityReceiveShadow;
  }

  return {
    async init() {
      await ensureSprites(state.dexId);
      applyLightingTuning();
    },
    setContext(world, bounds) {
      state.world = world;
      state.bounds = bounds;
      if (state.active) syncMeshTransform();
    },
    setVisible(v) {
      state.visible = !!v;
      if (state.mesh) state.mesh.visible = !!v && state.active;
    },
    placeAt,
    jump() {
      if (!state.active) return false;
      if (state.flightActive) return false;
      if (state.grounded) state.jumpsUsed = 0;
      if (state.jumpsUsed >= state.maxAirJumps) return false;
      state.vz = state.jumpImpulse;
      state.grounded = false;
      state.jumpsUsed += 1;
      return true;
    },
    onKeyDown(code) {
      state.keys.add(code);
    },
    onKeyUp(code) {
      state.keys.delete(code);
    },
    isActive() {
      return !!state.active;
    },
    toggleFlight() {
      if (!state.active) return false;
      if (!speciesHasFlyingType(state.dexId)) return false;
      state.flightActive = !state.flightActive;
      if (state.flightActive) {
        state.vz = 0;
        state.grounded = false;
        state.jumpsUsed = 0;
      }
      return state.flightActive;
    },
    isFlightActive() {
      return !!state.flightActive;
    },
    getWorldMicroPosition() {
      if (!state.active) return null;
      return { x: state.x, y: state.y };
    },
    getAnchorPosition() {
      if (!state.active || !state.mesh) return null;
      return {
        x: state.mesh.position.x,
        // Keep camera follow height stable: logical terrain height + jump, not sprite frame visual offsets.
        y: state.worldY + 1.6,
        z: state.mesh.position.z,
      };
    },
    applyLightingTuning,
    tick,
    faceCamera,
  };
}
