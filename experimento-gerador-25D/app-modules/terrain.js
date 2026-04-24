const workerState = {
  worker: null,
  seq: 1,
  pending: new Map(),
  activeVersion: null,
};

function getChunkMesherWorker() {
  if (workerState.worker) return workerState.worker;
  const worker = new Worker(new URL('./chunk-mesher-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const msg = event.data || {};
    const pending = workerState.pending.get(msg.requestId);
    if (!pending) return;
    workerState.pending.delete(msg.requestId);
    if (msg.type === 'build-result') {
      if (!msg.ok) pending.resolve(null);
      else pending.resolve(msg.payload);
      return;
    }
    pending.resolve(msg);
  };
  worker.onerror = (err) => {
    console.error('chunk mesher worker error', err);
  };
  workerState.worker = worker;
  return worker;
}

function requestWorker(worker, type, payload) {
  return new Promise((resolve, reject) => {
    const requestId = workerState.seq++;
    workerState.pending.set(requestId, { resolve, reject });
    worker.postMessage({ requestId, type, payload });
  });
}

export function updateHoverMarker({
  currentWorld,
  mx,
  my,
  hoverMarker,
  macroCoordEl,
  settings,
  idx,
  clamp,
}) {
  if (!currentWorld || mx == null || my == null) {
    hoverMarker.visible = false;
    macroCoordEl.textContent = '--';
    return;
  }
  const halfW = (currentWorld.width - 1) * 0.5;
  const halfH = (currentWorld.height - 1) * 0.5;
  const w = currentWorld.width;
  const h = currentWorld.height;
  const cx0 = clamp(mx, 0, w - 1);
  const cy0 = clamp(my, 0, h - 1);
  const cx1 = clamp(mx + 1, 0, w - 1);
  const cy1 = clamp(my + 1, 0, h - 1);

  const detailLift = settings.detailsYOffset ?? 0;
  const y00 = currentWorld.cells[idx(w, cx0, cy0)] * settings.worldHeightScale + detailLift + 0.28;
  const y10 = currentWorld.cells[idx(w, cx1, cy0)] * settings.worldHeightScale + detailLift + 0.28;
  const y11 = currentWorld.cells[idx(w, cx1, cy1)] * settings.worldHeightScale + detailLift + 0.28;
  const y01 = currentWorld.cells[idx(w, cx0, cy1)] * settings.worldHeightScale + detailLift + 0.28;

  const px0 = mx - halfW;
  const pz0 = my - halfH;
  const pos = hoverMarker.geometry.getAttribute('position');
  pos.setXYZ(0, px0, y00, pz0);
  pos.setXYZ(1, px0 + 1, y10, pz0);
  pos.setXYZ(2, px0 + 1, y11, pz0 + 1);
  pos.setXYZ(3, px0, y01, pz0 + 1);
  pos.needsUpdate = true;
  hoverMarker.position.set(0, 0, 0);
  hoverMarker.visible = true;
  macroCoordEl.textContent = `${mx},${my}`;
}

export function buildWorldMacroMesh({
  THREE,
  world,
  worldGroup,
  hoverMarker,
  settings,
  biomeColorById,
  clearGroup,
  idx,
}) {
  clearGroup(worldGroup);
  worldGroup.add(hoverMarker);
  const w = world.width;
  const h = world.height;
  const halfW = (w - 1) * 0.5;
  const halfH = (h - 1) * 0.5;
  const detailLift = settings.detailsYOffset ?? 0;
  const macroPos = (mx, my, yOffset = 0) => {
    const i = idx(w, mx, my);
    const y = world.cells[i] * settings.worldHeightScale + detailLift + yOffset;
    return new THREE.Vector3(mx - halfW, y, my - halfH);
  };
  const geom = new THREE.PlaneGeometry(w - 1, h - 1, w - 1, h - 1);
  geom.rotateX(-Math.PI / 2);
  const positions = geom.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(w, x, y);
    positions.setY(i, world.cells[i] * settings.worldHeightScale);
    const color = biomeColorById.get(world.biomes[i]) || new THREE.Color('#888888');
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, wireframe: false });
  const worldMesh = new THREE.Mesh(geom, mat);
  worldMesh.receiveShadow = true;
  worldGroup.add(worldMesh);

  const roadSeg = [];
  for (const p of world.paths || []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      const va = macroPos(a.x, a.y, 0.45);
      const vb = macroPos(b.x, b.y, 0.45);
      roadSeg.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
    }
  }
  if (roadSeg.length > 0) {
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(roadSeg, 3));
    const rm = new THREE.LineBasicMaterial({
      color: '#ffe187',
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const roads = new THREE.LineSegments(rg, rm);
    roads.renderOrder = 20;
    worldGroup.add(roads);
  }

  for (const n of world.graph?.nodes || []) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(n.isGym ? 0.9 : 0.65, 10, 10),
      new THREE.MeshBasicMaterial({
        color: n.isGym ? '#ff4f4f' : '#ffffff',
        depthTest: false,
        depthWrite: false,
      }),
    );
    marker.position.copy(macroPos(n.x, n.y, 0.9));
    marker.renderOrder = 21;
    marker.castShadow = true;
    marker.receiveShadow = true;
    worldGroup.add(marker);
  }

  return worldMesh;
}

export async function buildDetailTerrain({
  THREE,
  world,
  centerMicroX,
  centerMicroY,
  settings,
  detailGroup,
  pickMeshes,
  triCountEl,
  getMicroTile,
  MACRO_TILE_STRIDE,
  computeTerrainRoleAndSprite,
  TessellationEngine,
  textureFor,
  uvRect,
  idx,
  clamp,
  nextFrame,
  buildVegetationBillboards,
  applyWireframeMode,
  clearGroup,
  atlasTextures,
}) {
  const DETAIL_CHUNK_SIZE = 24;
  const EPS = 1e-6;
  const pushFaceStretched = (builder, a, b, c, d, uv, tint) => {
    builder.p.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    builder.u.push(uv.u0, uv.v1, uv.u0, uv.v0, uv.u1, uv.v1, uv.u1, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0);
    builder.c.push(tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint);
  };
  const lerp3 = (p0, p1, t) => ({
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  });
  const bilerp3 = (a, b, c, d, u, v) => {
    const ab = lerp3(a, b, u);
    const cd = lerp3(c, d, u);
    return lerp3(ab, cd, v);
  };
  const pushFaceTiled = (builder, a, b, c, d, uv, tint, tilesU = 1, tilesV = 1) => {
    const tu = Math.max(1, Math.floor(tilesU));
    const tv = Math.max(1, Math.floor(tilesV));
    for (let vy = 0; vy < tv; vy++) {
      const v0 = vy / tv;
      const v1 = (vy + 1) / tv;
      for (let ux = 0; ux < tu; ux++) {
        const u0 = ux / tu;
        const u1 = (ux + 1) / tu;
        const p00 = bilerp3(a, b, c, d, u0, v0);
        const p10 = bilerp3(a, b, c, d, u1, v0);
        const p01 = bilerp3(a, b, c, d, u0, v1);
        const p11 = bilerp3(a, b, c, d, u1, v1);
        pushFaceStretched(builder, p00, p10, p01, p11, uv, tint);
      }
    }
  };
  pickMeshes.length = 0;
  clearGroup(detailGroup);
  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const span = clamp(Math.floor(settings.microSpan), 64, Math.min(microW, microH));
  const startX = clamp(Math.floor(centerMicroX - span * 0.5), 0, microW - span);
  const startY = clamp(Math.floor(centerMicroY - span * 0.5), 0, microH - span);
  const runtimeVersion = `${world.seed}:${startX}:${startY}:${span}:${settings.stepHeight}:${settings.wallShade}`;
  const currentBounds = { span, startX, startY };

  const cells = new Array(span * span);
  const needed = new Set();
  for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
    const mx = startX + x;
    const my = startY + y;
    const t = getMicroTile(mx, my, world);
    const role = computeTerrainRoleAndSprite(mx, my, world, t.heightStep);
    const set = role.set;
    const file = set?.file ? TessellationEngine.getImagePath(set.file).replace(/\\/g, '/') : null;
    if (file) needed.add(file);
    cells[idx(span, x, y)] = {
      h: t.heightStep,
      heightStep: t.heightStep,
      file,
      cols: TessellationEngine.getTerrainSheetCols(set),
      sprite: role.spriteId ?? set?.centerId ?? 0,
      biomeId: t.biomeId,
      isRoad: t.isRoad,
      isCity: t.isCity,
      foliageDensity: t.foliageDensity ?? 0,
      berryPatchDensity: t.berryPatchDensity ?? 0,
      mx,
      my,
    };
    if (x === span - 1 && y % 8 === 0) await nextFrame();
  }
  await Promise.all([...needed].map(textureFor));
  const fileById = [...needed];
  const fileIdByPath = new Map(fileById.map((f, i) => [f, i]));

  let minH = Infinity;
  for (const c of cells) minH = Math.min(minH, c.h);
  const floorY = (minH - 2) * settings.stepHeight;
  const half = span * 0.5;
  const fileIdByCell = new Int16Array(span * span);
  const spriteByCell = new Uint16Array(span * span);
  const colsByCell = new Uint16Array(span * span);
  const heightByCell = new Float32Array(span * span);
  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) {
      const i = idx(span, x, y);
      const cell = cells[i];
      fileIdByCell[i] = cell.file ? fileIdByPath.get(cell.file) : -1;
      spriteByCell[i] = cell.sprite || 0;
      colsByCell[i] = cell.cols || 1;
      heightByCell[i] = Number(cell.h) || 0;
    }
  }
  const atlasMetaByFileId = fileById.map((file) => {
    const tex = atlasTextures.get(file);
    const w = tex?.image?.width || 1;
    const h = tex?.image?.height || 1;
    return { w, h };
  });
  const chunkCols = Math.ceil(span / DETAIL_CHUNK_SIZE);
  const chunkRows = Math.ceil(span / DETAIL_CHUNK_SIZE);
  const chunkModels = [];

  for (let chunkY = 0; chunkY < chunkRows; chunkY++) {
    for (let chunkX = 0; chunkX < chunkCols; chunkX++) {
      const x0 = chunkX * DETAIL_CHUNK_SIZE;
      const y0 = chunkY * DETAIL_CHUNK_SIZE;
      const x1 = Math.min(span, x0 + DETAIL_CHUNK_SIZE);
      const y1 = Math.min(span, y0 + DETAIL_CHUNK_SIZE);
      chunkModels.push({ key: `${chunkX},${chunkY}`, chunkX, chunkY, x0, y0, x1, y1 });
    }
  }

  async function buildChunkMesh(chunk, lod = 0) {
    let chunkMergedFaceCount = 0;
    let chunkPreFaceEstimate = 0;
    const builders = new Map();
    const getBuilder = (file) => {
      if (!builders.has(file)) builders.set(file, { p: [], u: [], c: [] });
      return builders.get(file);
    };
    const visitedTop = new Uint8Array(span * span);
    const visitedWallRight = new Uint8Array(span * span);
    const visitedWallDown = new Uint8Array(span * span);
    const inChunk = (x, y) => x >= chunk.x0 && x < chunk.x1 && y >= chunk.y0 && y < chunk.y1;
    const topKeyAt = (x, y) => {
      if (!inChunk(x, y)) return null;
      const cell = cells[idx(span, x, y)];
      if (!cell?.file) return null;
      return `${cell.file}|${cell.sprite}|${cell.cols}|${cell.h}`;
    };
    const rightWallKeyAt = (x, y) => {
      if (lod > 0) return null;
      if (!inChunk(x, y)) return null;
      const cell = cells[idx(span, x, y)];
      if (!cell?.file) return null;
      const py0 = cell.h * settings.stepHeight;
      const right = x + 1 < span ? cells[idx(span, x + 1, y)] : null;
      const rightH = right ? right.h * settings.stepHeight : floorY;
      if (Math.abs(py0 - rightH) <= EPS) return null;
      return `${cell.file}|${cell.sprite}|${cell.cols}|${Math.min(py0, rightH)}|${Math.max(py0, rightH)}`;
    };
    const downWallKeyAt = (x, y) => {
      if (lod > 0) return null;
      if (!inChunk(x, y)) return null;
      const cell = cells[idx(span, x, y)];
      if (!cell?.file) return null;
      const py0 = cell.h * settings.stepHeight;
      const down = y + 1 < span ? cells[idx(span, x, y + 1)] : null;
      const downH = down ? down.h * settings.stepHeight : floorY;
      if (Math.abs(py0 - downH) <= EPS) return null;
      return `${cell.file}|${cell.sprite}|${cell.cols}|${Math.min(py0, downH)}|${Math.max(py0, downH)}`;
    };
    const pushChunkFace = (builder, a, b, c, d, uv, tint) => {
      chunkMergedFaceCount++;
      pushFaceStretched(builder, a, b, c, d, uv, tint);
    };

    for (let y = chunk.y0; y < chunk.y1; y++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const cell = cells[idx(span, x, y)];
        if (!cell?.file) continue;
        chunkPreFaceEstimate++;
        const py0 = cell.h * settings.stepHeight;
        const right = x + 1 < span ? cells[idx(span, x + 1, y)] : null;
        const down = y + 1 < span ? cells[idx(span, x, y + 1)] : null;
        const rightH = right ? right.h * settings.stepHeight : floorY;
        const downH = down ? down.h * settings.stepHeight : floorY;
        if (Math.abs(py0 - rightH) > EPS) chunkPreFaceEstimate++;
        if (Math.abs(py0 - downH) > EPS) chunkPreFaceEstimate++;
      }
    }

    for (let y = chunk.y0; y < chunk.y1; y++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const flatI = idx(span, x, y);
        if (visitedTop[flatI]) continue;
        const key = topKeyAt(x, y);
        if (!key) continue;
        const cell = cells[flatI];
        const tex = atlasTextures.get(cell.file);
        if (!tex) continue;
        const uv = uvRect(tex, cell.sprite, cell.cols);
        let runW = 1;
        while (x + runW < chunk.x1 && !visitedTop[idx(span, x + runW, y)] && topKeyAt(x + runW, y) === key) runW++;
        let runH = 1;
        while (y + runH < chunk.y1) {
          let rowOk = true;
          for (let xx = x; xx < x + runW; xx++) {
            const rowI = idx(span, xx, y + runH);
            if (visitedTop[rowI] || topKeyAt(xx, y + runH) !== key) {
              rowOk = false;
              break;
            }
          }
          if (!rowOk) break;
          runH++;
        }
        for (let yy = y; yy < y + runH; yy++) {
          for (let xx = x; xx < x + runW; xx++) visitedTop[idx(span, xx, yy)] = 1;
        }
        const b = getBuilder(cell.file);
        const px0 = x - half;
        const px1 = px0 + runW;
        const pz0 = y - half;
        const pz1 = pz0 + runH;
        const py0 = cell.h * settings.stepHeight;
        pushFaceTiled(
          b,
          { x: px0, y: py0, z: pz0 },
          { x: px1, y: py0, z: pz0 },
          { x: px0, y: py0, z: pz1 },
          { x: px1, y: py0, z: pz1 },
          uv,
          1,
          runW,
          runH,
        );
        chunkMergedFaceCount++;
      }
    }

    for (let y = chunk.y0; y < chunk.y1; y++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const flatI = idx(span, x, y);
        if (visitedWallRight[flatI]) continue;
        const key = rightWallKeyAt(x, y);
        if (!key) continue;
        const cell = cells[flatI];
        const tex = atlasTextures.get(cell.file);
        if (!tex) continue;
        const uv = uvRect(tex, cell.sprite, cell.cols);
        const py0 = cell.h * settings.stepHeight;
        const right = x + 1 < span ? cells[idx(span, x + 1, y)] : null;
        const rightH = right ? right.h * settings.stepHeight : floorY;
        const minY = Math.min(py0, rightH);
        const maxY = Math.max(py0, rightH);
        let runH = 1;
        while (y + runH < chunk.y1 && !visitedWallRight[idx(span, x, y + runH)] && rightWallKeyAt(x, y + runH) === key) runH++;
        for (let yy = y; yy < y + runH; yy++) visitedWallRight[idx(span, x, yy)] = 1;
        const b = getBuilder(cell.file);
        const px = x - half + 1;
        const pz0 = y - half;
        const pz1 = pz0 + runH;
        const wallSteps = Math.max(1, Math.round((maxY - minY) / Math.max(EPS, settings.stepHeight)));
        pushFaceTiled(
          b,
          { x: px, y: minY, z: pz0 },
          { x: px, y: maxY, z: pz0 },
          { x: px, y: minY, z: pz1 },
          { x: px, y: maxY, z: pz1 },
          uv,
          settings.wallShade,
          wallSteps,
          runH,
        );
        chunkMergedFaceCount++;
      }
    }

    for (let y = chunk.y0; y < chunk.y1; y++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const flatI = idx(span, x, y);
        if (visitedWallDown[flatI]) continue;
        const key = downWallKeyAt(x, y);
        if (!key) continue;
        const cell = cells[flatI];
        const tex = atlasTextures.get(cell.file);
        if (!tex) continue;
        const uv = uvRect(tex, cell.sprite, cell.cols);
        const py0 = cell.h * settings.stepHeight;
        const down = y + 1 < span ? cells[idx(span, x, y + 1)] : null;
        const downH = down ? down.h * settings.stepHeight : floorY;
        const minY = Math.min(py0, downH);
        const maxY = Math.max(py0, downH);
        let runW = 1;
        while (x + runW < chunk.x1 && !visitedWallDown[idx(span, x + runW, y)] && downWallKeyAt(x + runW, y) === key) runW++;
        for (let xx = x; xx < x + runW; xx++) visitedWallDown[idx(span, xx, y)] = 1;
        const b = getBuilder(cell.file);
        const px0 = x - half;
        const px1 = px0 + runW;
        const pz = y - half + 1;
        const wallSteps = Math.max(1, Math.round((maxY - minY) / Math.max(EPS, settings.stepHeight)));
        pushFaceTiled(
          b,
          { x: px0, y: minY, z: pz },
          { x: px1, y: minY, z: pz },
          { x: px0, y: maxY, z: pz },
          { x: px1, y: maxY, z: pz },
          uv,
          settings.wallShade,
          runW,
          wallSteps,
        );
        chunkMergedFaceCount++;
      }
    }

    let triCount = 0;
    const meshes = [];
    for (const [file, data] of builders.entries()) {
      const tex = atlasTextures.get(file);
      if (!tex) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(data.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(data.c, 3));
      g.computeVertexNormals();
      const m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide });
      m.userData.baseMap = tex;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.detailChunk = { chunkX: chunk.chunkX, chunkY: chunk.chunkY };
      meshes.push(mesh);
      triCount += Math.floor(g.getAttribute('position').count / 3);
    }
    return {
      key: chunk.key,
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      lod,
      meshes,
      triCount,
      mergedFaceCount: chunkMergedFaceCount,
      preTriEstimate: chunkPreFaceEstimate * 2,
    };
  }

  async function initWorkerDataset() {
    try {
      const worker = getChunkMesherWorker();
      if (workerState.activeVersion === runtimeVersion) return true;
      const payload = {
        version: runtimeVersion,
        span,
        half,
        floorY,
        stepHeight: settings.stepHeight,
        wallShade: settings.wallShade,
        eps: EPS,
        atlasMetaByFileId,
        fileById,
        fileIdByCell,
        spriteByCell,
        colsByCell,
        heightByCell,
      };
      await requestWorker(worker, 'init-dataset', payload);
      workerState.activeVersion = runtimeVersion;
      return true;
    } catch (err) {
      console.error('Failed to initialize chunk worker dataset, using fallback.', err);
      return false;
    }
  }

  function buildMeshesFromWorkerPayload(payload) {
    const meshes = [];
    if (!payload?.builders?.length) return meshes;
    for (const entry of payload.builders) {
      const file = payload.fileById?.[entry.fileId];
      if (!file) continue;
      const tex = atlasTextures.get(file);
      if (!tex) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(entry.p), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(entry.u), 2));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(entry.c), 3));
      g.computeVertexNormals();
      const m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide });
      m.userData.baseMap = tex;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.detailChunk = { chunkX: payload.chunkX, chunkY: payload.chunkY };
      meshes.push(mesh);
    }
    return meshes;
  }

  const detailFloorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 20, span + 20).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#2d3a2f' }),
  );
  detailFloorMesh.position.y = floorY - 0.02;
  detailFloorMesh.receiveShadow = true;
  detailGroup.add(detailFloorMesh);
  await buildVegetationBillboards({ cells, span, half, worldSeed: world.seed, currentWorld: world, detailGroup });
  triCountEl.textContent = '0';
  applyWireframeMode();
  const workerReady = await initWorkerDataset();

  return {
    currentBounds,
    detailFloorMesh,
    chunkRuntime: {
      chunkSize: DETAIL_CHUNK_SIZE,
      chunkCols,
      chunkRows,
      chunks: chunkModels,
      async buildChunkByKey(chunkKey, lod = 0) {
        const chunk = chunkModels.find((c) => c.key === chunkKey);
        if (!chunk) return null;
        if (workerReady) {
          try {
            const payload = await requestWorker(getChunkMesherWorker(), 'build-chunk', { version: runtimeVersion, chunk, lod });
            if (payload) {
              return {
                key: payload.key,
                chunkX: payload.chunkX,
                chunkY: payload.chunkY,
                lod: payload.lod ?? lod,
                meshes: buildMeshesFromWorkerPayload(payload),
                triCount: payload.triCount || 0,
                mergedFaceCount: payload.mergedFaceCount || 0,
                preTriEstimate: payload.preTriEstimate || 0,
              };
            }
          } catch (err) {
            console.error('Worker chunk build failed, fallback to main thread.', err);
          }
        }
        return buildChunkMesh(chunk, lod);
      },
    },
    meshStats: {
      chunkCountRendered: 0,
      mergedFaceCount: 0,
      preTriEstimate: 0,
      postTriEstimate: 0,
    },
  };
}
