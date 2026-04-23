export function createVegetationSystem(deps) {
  const {
    THREE,
    OBJECT_SETS,
    TessellationEngine,
    parseShape,
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
    textureFor,
    settings,
    idx,
    nextFrame,
    seedToInt,
    deterministic01,
    getTileUvRect,
    atlasColsFromPath,
    normalizedShape,
    TILE_PX,
  } = deps;

  let vegetationGroup = null;
  const treeBillboardTextureCache = new Map();
  const objectBillboardTextureCache = new Map();
  const vegetationMaterials = [];
  const shaderMats = [];

  const camRight = new THREE.Vector3(1, 0, 0);
  const camUp = new THREE.Vector3(0, 1, 0);

  function makeBillboardShaderMaterial(texture) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        cameraRight: { value: camRight.clone() },
        cameraUp: { value: camUp.clone() },
        useTexture: { value: true },
        flatColor: { value: new THREE.Color('#ffffff') },
        alphaCut: { value: 0.2 },
      },
      vertexShader: `
        attribute vec3 center;
        attribute vec2 offset;
        varying vec2 vUv;
        uniform vec3 cameraRight;
        uniform vec3 cameraUp;
        void main() {
          vec3 worldPos = center + cameraRight * offset.x + cameraUp * offset.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
          vUv = uv;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D map;
        uniform bool useTexture;
        uniform vec3 flatColor;
        uniform float alphaCut;
        void main() {
          if (useTexture) {
            vec4 tex = texture2D(map, vUv);
            if (tex.a < alphaCut) discard;
            gl_FragColor = tex;
          } else {
            gl_FragColor = vec4(flatColor, 1.0);
          }
        }
      `,
      // Cutout pipeline (discard by alpha) so depth buffer handles ordering correctly.
      // This avoids classic transparent-sorting artifacts between many billboards.
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      wireframe: false,
    });
    vegetationMaterials.push(mat);
    shaderMats.push(mat);
    return mat;
  }

  function pushQuad(batch, cx, cy, cz, width, height) {
    const hw = width * 0.5;
    const h = height;
    const off = [
      [-hw, 0],
      [hw, 0],
      [-hw, h],
      [hw, 0],
      [hw, h],
      [-hw, h],
    ];
    const uv = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (let i = 0; i < 6; i++) {
      batch.center.push(cx, cy, cz);
      batch.offset.push(off[i][0], off[i][1]);
      batch.uv.push(uv[i][0], uv[i][1]);
    }
  }

  function flushBatches(textureBatches) {
    for (const batch of textureBatches.values()) {
      if (batch.center.length === 0) continue;
      const g = new THREE.BufferGeometry();
      // Three.js uses `position` count to issue draw calls, even with custom attrs/shader billboarding.
      g.setAttribute('position', new THREE.Float32BufferAttribute(batch.center, 3));
      g.setAttribute('center', new THREE.Float32BufferAttribute(batch.center, 3));
      g.setAttribute('offset', new THREE.Float32BufferAttribute(batch.offset, 2));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const m = makeBillboardShaderMaterial(batch.texture);
      const mesh = new THREE.Mesh(g, m);
      vegetationGroup.add(mesh);
    }
  }

  async function getTreeBillboardTexture(treeType) {
    if (!treeType || !TREE_TILES[treeType]) return null;
    if (treeBillboardTextureCache.has(treeType)) return treeBillboardTextureCache.get(treeType);

    const naturePath = 'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png';
    const natureTex = await textureFor(naturePath);
    if (!natureTex?.image) return null;

    const cols = 57;
    const spec = TREE_TILES[treeType];
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    for (let i = 0; i < 2; i++) {
      const uv = getTileUvRect(spec.top[i + 2], cols);
      ctx.drawImage(natureTex.image, uv.sx, uv.sy, uv.sw, uv.sh, i * 16, 0, 16, 16);
    }
    for (let i = 0; i < 2; i++) {
      const uv = getTileUvRect(spec.top[i], cols);
      ctx.drawImage(natureTex.image, uv.sx, uv.sy, uv.sw, uv.sh, i * 16, 16, 16, 16);
    }
    for (let i = 0; i < 2; i++) {
      const uv = getTileUvRect(spec.base[i], cols);
      ctx.drawImage(natureTex.image, uv.sx, uv.sy, uv.sw, uv.sh, i * 16, 32, 16, 16);
    }

    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    out.magFilter = THREE.NearestFilter;
    out.minFilter = THREE.NearestFilter;
    out.generateMipmaps = false;
    treeBillboardTextureCache.set(treeType, out);
    return out;
  }

  async function getObjectBillboardTexture(itemKey) {
    if (!itemKey || !OBJECT_SETS[itemKey]) return null;
    if (objectBillboardTextureCache.has(itemKey)) return objectBillboardTextureCache.get(itemKey);

    const objSet = OBJECT_SETS[itemKey];
    const atlasPath = TessellationEngine.getImagePath(objSet.file).replace(/\\/g, '/');
    const atlasTex = await textureFor(atlasPath);
    if (!atlasTex?.image) return null;

    const cols = atlasColsFromPath(atlasPath);
    const { cols: shapeCols } = parseShape(normalizedShape(objSet.shape));
    const base = objSet.parts?.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
    const top = objSet.parts?.find((p) => p.role === 'top' || p.role === 'tops');

    const placements = [];
    if (base?.ids?.length) {
      for (let i = 0; i < base.ids.length; i++) {
        placements.push({ id: base.ids[i], x: i % shapeCols, y: Math.floor(i / shapeCols) });
      }
    }
    if (top?.ids?.length) {
      const topRows = Math.ceil(top.ids.length / shapeCols);
      for (let i = 0; i < top.ids.length; i++) {
        const ox = i % shapeCols;
        const oy = Math.floor(i / shapeCols);
        placements.push({ id: top.ids[i], x: ox, y: oy - topRows });
      }
    }
    if (placements.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of placements) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const tilesW = maxX - minX + 1;
    const tilesH = maxY - minY + 1;
    const canvas = document.createElement('canvas');
    canvas.width = tilesW * TILE_PX;
    canvas.height = tilesH * TILE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    for (const p of placements) {
      const sx = (p.id % cols) * TILE_PX;
      const sy = Math.floor(p.id / cols) * TILE_PX;
      const dx = (p.x - minX) * TILE_PX;
      const dy = (p.y - minY) * TILE_PX;
      ctx.drawImage(atlasTex.image, sx, sy, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);
    }

    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    out.magFilter = THREE.NearestFilter;
    out.minFilter = THREE.NearestFilter;
    out.generateMipmaps = false;

    const meta = { texture: out, tilesW, tilesH };
    objectBillboardTextureCache.set(itemKey, meta);
    return meta;
  }

  function getBatch(textureBatches, texture) {
    const key = texture.uuid;
    if (!textureBatches.has(key)) {
      textureBatches.set(key, { texture, center: [], offset: [], uv: [] });
    }
    return textureBatches.get(key);
  }

  async function buildVegetationBillboards({ cells, span, half, worldSeed, currentWorld, detailGroup }) {
    vegetationGroup = new THREE.Group();
    detailGroup.add(vegetationGroup);
    if (!settings.showVegetation) return;

    vegetationMaterials.length = 0;
    shaderMats.length = 0;
    const textureBatches = new Map();
    const treeRoots = new Set();

    const seedInt = seedToInt(worldSeed);
    const microW = currentWorld.width * MACRO_TILE_STRIDE;
    const microH = currentWorld.height * MACRO_TILE_STRIDE;
    const originMemo = new Map();
    const getTile = (mx, my) => getMicroTile(mx, my, currentWorld);

    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const c = cells[idx(span, x, y)];
        if (!tileSurfaceAllowsScatterVegetation(c)) continue;
        if ((c.mx + c.my) % 3 !== 0) continue;
        const treeNoise = foliageDensity(c.mx, c.my, seedInt + 5555, TREE_NOISE_SCALE);
        if (treeNoise < TREE_DENSITY_THRESHOLD) continue;
        const right = x + 1 < span ? cells[idx(span, x + 1, y)] : getMicroTile(c.mx + 1, c.my, currentWorld);
        if (!right || right.heightStep !== c.h) continue;

        const treeType = getTreeType(c.biomeId, c.mx, c.my, seedInt);
        if (!treeType || c.h <= 0) continue;
        if (deterministic01(c.mx, c.my, seedInt + 9001) > settings.vegetationDensity) continue;

        const tex = await getTreeBillboardTexture(treeType);
        if (!tex) continue;
        const batch = getBatch(textureBatches, tex);
        const px = x - half + 1.0;
        const pz = y - half + 0.5;
        const py = c.h * settings.stepHeight + 0.05;
        const baseScale = 2.2 + deterministic01(c.mx, c.my, seedInt + 1337) * 0.4;
        pushQuad(batch, px, py, pz, baseScale, baseScale * 1.5);
        treeRoots.add(`${c.mx},${c.my}`);
      }
      if (y % 10 === 0) await nextFrame();
    }

    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const c = cells[idx(span, x, y)];
        if (!tileSurfaceAllowsScatterVegetation(c)) continue;
        if (treeRoots.has(`${c.mx},${c.my}`)) continue;
        const px = x - half + 0.5;
        const pz = y - half + 0.5;
        const py = c.h * settings.stepHeight + 0.05;

        if (validScatterOriginMicro(c.mx, c.my, seedInt, microW, microH, getTile, originMemo)) {
          const itemKey = resolveScatterVegetationItemKey(c.mx, c.my, c, seedInt);
          if (itemKey && deterministic01(c.mx, c.my, seedInt + 7011) <= settings.vegetationDensity) {
            const texInfo = await getObjectBillboardTexture(itemKey);
            if (texInfo?.texture) {
              const batch = getBatch(textureBatches, texInfo.texture);
              const w = Math.max(0.9, texInfo.tilesW * 0.92);
              const h = Math.max(1.1, texInfo.tilesH * 0.92);
              pushQuad(batch, px, py, pz, w, h);
              continue;
            }
          }
        }

        const grassVariant = getGrassVariant(c.biomeId);
        const grassTiles = grassVariant ? GRASS_TILES[grassVariant] : null;
        const grassTileId = grassTiles?.original ?? grassTiles?.small ?? grassTiles?.grass2;
        if (!grassTileId || c.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) continue;
        if (deterministic01(c.mx, c.my, seedInt + 9123) > settings.vegetationDensity) continue;

        const grassKey = `grass:${grassVariant}:${grassTileId}`;
        let grassMeta = objectBillboardTextureCache.get(grassKey);
        if (!grassMeta) {
          const canvas = document.createElement('canvas');
          canvas.width = 16;
          canvas.height = 16;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.imageSmoothingEnabled = false;
          const naturePath = 'tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png';
          const natureTex = await textureFor(naturePath);
          if (!natureTex?.image) continue;
          const cols = 57;
          const sx = (grassTileId % cols) * 16;
          const sy = Math.floor(grassTileId / cols) * 16;
          ctx.drawImage(natureTex.image, sx, sy, 16, 16, 0, 0, 16, 16);
          const out = new THREE.CanvasTexture(canvas);
          out.colorSpace = THREE.SRGBColorSpace;
          out.magFilter = THREE.NearestFilter;
          out.minFilter = THREE.NearestFilter;
          out.generateMipmaps = false;
          grassMeta = { texture: out, tilesW: 1, tilesH: 1 };
          objectBillboardTextureCache.set(grassKey, grassMeta);
        }
        const batch = getBatch(textureBatches, grassMeta.texture);
        pushQuad(batch, px, py, pz, 0.9, 1.0);
      }
      if (y % 10 === 0) await nextFrame();
    }

    flushBatches(textureBatches);
  }

  function applyWireframeMode(wireframeOnly) {
    for (const mat of vegetationMaterials) {
      if (!mat) continue;
      mat.wireframe = !!wireframeOnly;
      mat.uniforms.useTexture.value = !wireframeOnly;
      mat.uniforms.flatColor.value.set(wireframeOnly ? '#b8ffb8' : '#ffffff');
      mat.uniforms.alphaCut.value = wireframeOnly ? 0.0 : 0.2;
      mat.needsUpdate = true;
    }
    if (vegetationGroup) vegetationGroup.visible = !!settings.showVegetation;
  }

  function faceCamera(camera) {
    camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    for (const mat of shaderMats) {
      mat.uniforms.cameraRight.value.copy(camRight);
      mat.uniforms.cameraUp.value.copy(camUp);
    }
  }

  function setVisible(visible) {
    if (vegetationGroup) vegetationGroup.visible = !!visible;
  }

  return {
    buildVegetationBillboards,
    applyWireframeMode,
    faceCamera,
    setVisible,
  };
}
