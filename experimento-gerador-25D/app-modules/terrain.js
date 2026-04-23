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

  const y00 = currentWorld.cells[idx(w, cx0, cy0)] * settings.worldHeightScale + 0.28;
  const y10 = currentWorld.cells[idx(w, cx1, cy0)] * settings.worldHeightScale + 0.28;
  const y11 = currentWorld.cells[idx(w, cx1, cy1)] * settings.worldHeightScale + 0.28;
  const y01 = currentWorld.cells[idx(w, cx0, cy1)] * settings.worldHeightScale + 0.28;

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
  const macroPos = (mx, my, yOffset = 0) => {
    const i = idx(w, mx, my);
    const y = world.cells[i] * settings.worldHeightScale + yOffset;
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
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, wireframe: false });
  const worldMesh = new THREE.Mesh(geom, mat);
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
  pushFace,
  idx,
  clamp,
  nextFrame,
  buildVegetationBillboards,
  applyWireframeMode,
  clearGroup,
  atlasTextures,
}) {
  pickMeshes.length = 0;
  clearGroup(detailGroup);
  const microW = world.width * MACRO_TILE_STRIDE;
  const microH = world.height * MACRO_TILE_STRIDE;
  const span = clamp(Math.floor(settings.microSpan), 64, Math.min(microW, microH));
  const startX = clamp(Math.floor(centerMicroX - span * 0.5), 0, microW - span);
  const startY = clamp(Math.floor(centerMicroY - span * 0.5), 0, microH - span);
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

  let minH = Infinity;
  for (const c of cells) minH = Math.min(minH, c.h);
  const floorY = (minH - 2) * settings.stepHeight;
  const half = span * 0.5;
  const builders = new Map();
  const getBuilder = (k) => {
    if (!builders.has(k)) builders.set(k, { p: [], u: [], c: [] });
    return builders.get(k);
  };

  for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
    const cell = cells[idx(span, x, y)];
    if (!cell.file) continue;
    const tex = atlasTextures.get(cell.file);
    if (!tex) continue;
    const uv = uvRect(tex, cell.sprite, cell.cols);
    const b = getBuilder(cell.file);
    const x0 = x - half;
    const x1 = x0 + 1;
    const z0 = y - half;
    const z1 = z0 + 1;
    const y0 = cell.h * settings.stepHeight;
    pushFace(b, { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, uv, 1);
    const r = x + 1 < span ? cells[idx(span, x + 1, y)] : null;
    const d = y + 1 < span ? cells[idx(span, x, y + 1)] : null;
    const rh = r ? r.h * settings.stepHeight : floorY;
    const dh = d ? d.h * settings.stepHeight : floorY;
    if (Math.abs(y0 - rh) > 1e-6) pushFace(b, { x: x1, y: Math.min(y0, rh), z: z0 }, { x: x1, y: Math.max(y0, rh), z: z0 }, { x: x1, y: Math.min(y0, rh), z: z1 }, { x: x1, y: Math.max(y0, rh), z: z1 }, uv, settings.wallShade);
    if (Math.abs(y0 - dh) > 1e-6) pushFace(b, { x: x0, y: Math.min(y0, dh), z: z1 }, { x: x1, y: Math.min(y0, dh), z: z1 }, { x: x0, y: Math.max(y0, dh), z: z1 }, { x: x1, y: Math.max(y0, dh), z: z1 }, uv, settings.wallShade);
  }

  let triTotal = 0;
  for (const [file, data] of builders.entries()) {
    const tex = atlasTextures.get(file);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(data.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(data.c, 3));
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide });
    m.userData.baseMap = tex;
    const mesh = new THREE.Mesh(g, m);
    detailGroup.add(mesh);
    pickMeshes.push(mesh);
    triTotal += Math.floor(g.getAttribute('position').count / 3);
  }

  const detailFloorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 20, span + 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#2d3a2f' }),
  );
  detailFloorMesh.position.y = floorY - 0.02;
  detailGroup.add(detailFloorMesh);
  await buildVegetationBillboards({ cells, span, half, worldSeed: world.seed, currentWorld: world, detailGroup });
  triCountEl.textContent = triTotal.toLocaleString('en-US');
  applyWireframeMode();

  return { currentBounds, detailFloorMesh };
}
