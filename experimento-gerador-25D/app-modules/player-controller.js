import { getDexAnimMeta } from '../../js/pokemon/pmd-anim-metadata.js';
import { PMD_DEFAULT_MON_ANIMS, PMD_MON_SHEET } from '../../js/pokemon/pmd-default-timing.js';

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

export function createPlayerController({
  THREE,
  playerGroup,
  camera,
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
    return 25;
  })();

  const state = {
    active: false,
    visible: true,
    world: null,
    bounds: null,
    x: 0,
    y: 0,
    z: 0,
    vz: 0,
    grounded: true,
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
  };

  async function ensureSprites(dexId = state.dexId) {
    state.dexId = Math.max(1, Math.floor(Number(dexId) || 25));
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
    state.frameCtx = state.frameCanvas.getContext('2d');
    if (state.frameCtx) state.frameCtx.imageSmoothingEnabled = false;
    state.frameTex = new THREE.CanvasTexture(state.frameCanvas);
    state.frameTex.colorSpace = THREE.SRGBColorSpace;
    state.frameTex.magFilter = THREE.NearestFilter;
    state.frameTex.minFilter = THREE.NearestFilter;
    state.frameTex.generateMipmaps = false;

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
    const h = (frameH / 16) * PMD_MON_SHEET.scale;
    const w = (frameW / Math.max(1, frameH)) * h;
    state.mesh.scale.set(w, h, 1);
  }

  function drawCurrentFrame(force = false) {
    if (!state.mesh || !state.frameCtx) return;
    const moving = state.keys.size > 0;
    const tex = moving ? (state.walkTex || state.idleTex) : (state.idleTex || state.walkTex);
    const img = tex?.image;
    if (!img) return;

    const meta = moving ? state.walkMeta : state.idleMeta;
    const frameW = Math.max(1, Number(meta?.frameWidth) || PMD_MON_SHEET.frameW);
    const frameH = Math.max(1, Number(meta?.frameHeight) || PMD_MON_SHEET.frameH);
    if (state.frameCanvas.width !== frameW || state.frameCanvas.height !== frameH) {
      state.frameCanvas.width = frameW;
      state.frameCanvas.height = frameH;
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
    state.frameCtx.drawImage(
      img,
      frame * frameW,
      row * frameH,
      frameW,
      frameH,
      0,
      0,
      frameW,
      frameH,
    );
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
    const ix = (state.keys.has('KeyD') ? 1 : 0) + (state.keys.has('ArrowRight') ? 1 : 0) - (state.keys.has('KeyA') ? 1 : 0) - (state.keys.has('ArrowLeft') ? 1 : 0);
    const iy = (state.keys.has('KeyS') ? 1 : 0) + (state.keys.has('ArrowDown') ? 1 : 0) - (state.keys.has('KeyW') ? 1 : 0) - (state.keys.has('ArrowUp') ? 1 : 0);
    const len = Math.hypot(ix, iy);
    if (len < 1e-6) return { x: 0, y: 0, moving: false };
    return { x: ix / len, y: iy / len, moving: true };
  }

  function sampleGroundStep(mx, my) {
    if (!state.world) return 0;
    const t = getMicroTile(mx, my, state.world);
    return t?.heightStep ?? 0;
  }

  function updatePosition(dt) {
    const input = getInputVector();
    if (input.moving) {
      state.facing = facingFromInput(input.x, input.y, state.facing);
      state.animRow = DIR_TO_ROW[state.facing] || 0;
    }
    const speed = state.walkSpeed;
    const nx = state.x + input.x * speed * dt;
    const ny = state.y + input.y * speed * dt;
    if (state.bounds) {
      const minX = state.bounds.startX + 0.05;
      const minY = state.bounds.startY + 0.05;
      const maxX = state.bounds.startX + state.bounds.span - 0.05;
      const maxY = state.bounds.startY + state.bounds.span - 0.05;
      state.x = Math.max(minX, Math.min(maxX, nx));
      state.y = Math.max(minY, Math.min(maxY, ny));
    } else {
      state.x = nx;
      state.y = ny;
    }

    if (!state.grounded) {
      state.vz -= state.gravity * dt;
      state.z += state.vz * dt;
      if (state.z <= 0) {
        state.z = 0;
        state.vz = 0;
        state.grounded = true;
      }
    }
    updateAnim(dt, input.moving);
  }

  function syncMeshTransform() {
    if (!state.mesh || !state.bounds || !state.active) return;
    const lx = state.x - state.bounds.startX;
    const ly = state.y - state.bounds.startY;
    const half = state.bounds.span * 0.5;
    const tileMx = Math.floor(state.x);
    const tileMy = Math.floor(state.y);
    const hStep = sampleGroundStep(tileMx, tileMy);
    const groundY = hStep * settings.stepHeight + (settings.detailsYOffset ?? 0);
    state.mesh.position.set(
      lx - half,
      groundY + state.z,
      ly - half,
    );
  }

  function placeAt(mx, my) {
    state.x = mx + 0.5;
    state.y = my + 0.5;
    state.z = 0;
    state.vz = 0;
    state.grounded = true;
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

  return {
    async init() {
      await ensureSprites(state.dexId);
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
      if (!state.active || !state.grounded) return false;
      state.vz = state.jumpImpulse;
      state.grounded = false;
      return true;
    },
    onKeyDown(code) {
      state.keys.add(code);
    },
    onKeyUp(code) {
      state.keys.delete(code);
    },
    tick,
    faceCamera,
  };
}
