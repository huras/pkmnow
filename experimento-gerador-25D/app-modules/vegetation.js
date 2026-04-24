export function createVegetationSystem(deps) {
  const {
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
  const chunkVegetationGroups = new Set();
  const treeBillboardTextureCache = new Map();
  const objectBillboardTextureCache = new Map();
  const vegetationMaterials = [];
  const litMats = [];
  const depthMats = [];

  const camRight = new THREE.Vector3(1, 0, 0);
  const camUp = new THREE.Vector3(0, 1, 0);
  
  function patchBillboardVertexShader(shader) {
    shader.uniforms.cameraRight = { value: camRight.clone() };
    shader.uniforms.cameraUp = { value: camUp.clone() };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 center;
attribute vec2 offset;
uniform vec3 cameraRight;
uniform vec3 cameraUp;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = normalize(cross(cameraRight, cameraUp));`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = center + cameraRight * offset.x + cameraUp * offset.y;`,
      );
  }

  function makeBillboardLitMaterial(texture) {
    const mat = new THREE.MeshLambertMaterial({
      map: texture,
      alphaTest: 0.2,
      transparent: false,
      side: THREE.DoubleSide,
    });
    mat.userData.baseMap = texture;
    mat.onBeforeCompile = (shader) => {
      patchBillboardVertexShader(shader);
      mat.userData.shader = shader;
    };
    vegetationMaterials.push(mat);
    litMats.push(mat);
    return mat;
  }

  function makeBillboardDepthMaterial(texture) {
    const mat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: texture,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      patchBillboardVertexShader(shader);
      mat.userData.shader = shader;
    };
    depthMats.push(mat);
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

  function buildMeshesFromBatches(textureBatches) {
    const meshes = [];
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
      const m = makeBillboardLitMaterial(batch.texture);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.customDepthMaterial = makeBillboardDepthMaterial(batch.texture);
      meshes.push(mesh);
    }
    return meshes;
  }

  function flushBatches(textureBatches) {
    if (!vegetationGroup) return;
    const meshes = buildMeshesFromBatches(textureBatches);
    for (const mesh of meshes) vegetationGroup.add(mesh);
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
    const isBerryTree = String(itemKey).toLowerCase().includes('berry-tree-');

    if (isBerryTree) {
      const berryType = getBerryTypeFromKey(itemKey);
      const berryCacheKey = `berry:${berryType}:stage2:anim0`;
      if (objectBillboardTextureCache.has(berryCacheKey)) return objectBillboardTextureCache.get(berryCacheKey);

      const objSet = OBJECT_SETS[itemKey];
      const atlasPath = TessellationEngine.getImagePath(objSet.file).replace(/\\/g, '/');
      const atlasTex = await textureFor(atlasPath);
      if (!atlasTex?.image) return null;
      const cols = atlasColsFromPath(atlasPath);

      // Use a full mature frame by default (top + bottom) so berry trees render as 2x1.
      const frame = BERRY_TREE_TILES[berryType]?.[2]?.[0];
      const ids = Array.isArray(frame) ? frame : [];
      if (!ids.length) return null;

      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = ids.length >= 2 ? 32 : 16;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = false;

      const topId = ids.length >= 2 ? ids[0] : null;
      const bottomId = ids.length >= 2 ? ids[1] : ids[0];
      if (topId != null) {
        const sx = (topId % cols) * TILE_PX;
        const sy = Math.floor(topId / cols) * TILE_PX;
        ctx.drawImage(atlasTex.image, sx, sy, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
      }
      if (bottomId != null) {
        const sx = (bottomId % cols) * TILE_PX;
        const sy = Math.floor(bottomId / cols) * TILE_PX;
        const dy = ids.length >= 2 ? 16 : 0;
        ctx.drawImage(atlasTex.image, sx, sy, TILE_PX, TILE_PX, 0, dy, TILE_PX, TILE_PX);
      }

      const out = new THREE.CanvasTexture(canvas);
      out.colorSpace = THREE.SRGBColorSpace;
      out.magFilter = THREE.NearestFilter;
      out.minFilter = THREE.NearestFilter;
      out.generateMipmaps = false;

      const meta = { texture: out, tilesW: 1, tilesH: ids.length >= 2 ? 2 : 1 };
      objectBillboardTextureCache.set(berryCacheKey, meta);
      return meta;
    }

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
    litMats.length = 0;
    depthMats.length = 0;
    const textureBatches = new Map();
    const treeRoots = new Set();

    const seedInt = seedToInt(worldSeed);
    const microW = currentWorld.width * MACRO_TILE_STRIDE;
    const microH = currentWorld.height * MACRO_TILE_STRIDE;
    const detailLift = settings.detailsYOffset ?? 0;
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
        const py = c.h * settings.stepHeight + detailLift + 0.05;
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
        const py = c.h * settings.stepHeight + detailLift + 0.05;

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

  async function buildChunkVegetation({
    chunk,
    worldSeed,
    currentWorld,
    offsetX,
    offsetY,
    lod = 0,
  }) {
    if (!settings.showVegetation || !chunk || !currentWorld) return [];
    // Keep far rings cheap: only render vegetation in near/mid rings.
    if (lod > 1) return [];

    const textureBatches = new Map();
    const treeRoots = new Set();
    const seedInt = seedToInt(worldSeed);
    const microW = currentWorld.width * MACRO_TILE_STRIDE;
    const microH = currentWorld.height * MACRO_TILE_STRIDE;
    const detailLift = settings.detailsYOffset ?? 0;
    const originMemo = new Map();
    const getTile = (mx, my) => getMicroTile(mx, my, currentWorld);
    const x0 = chunk.x0;
    const x1 = chunk.x1;
    const y0 = chunk.y0;
    const y1 = chunk.y1;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = getMicroTile(x, y, currentWorld);
        const c = {
          ...t,
          mx: x,
          my: y,
          h: t.heightStep,
          heightStep: t.heightStep,
          biomeId: t.biomeId,
          foliageDensity: foliageDensity(x, y, seedInt + 1117, TREE_NOISE_SCALE),
        };
        if (!tileSurfaceAllowsScatterVegetation(c)) continue;
        if ((c.mx + c.my) % 3 !== 0) continue;
        const treeNoise = foliageDensity(c.mx, c.my, seedInt + 5555, TREE_NOISE_SCALE);
        if (treeNoise < TREE_DENSITY_THRESHOLD) continue;
        const rightT = getMicroTile(c.mx + 1, c.my, currentWorld);
        if (!rightT || rightT.heightStep !== c.h) continue;
        const treeType = getTreeType(c.biomeId, c.mx, c.my, seedInt);
        if (!treeType || c.h <= 0) continue;
        if (deterministic01(c.mx, c.my, seedInt + 9001) > settings.vegetationDensity) continue;
        const tex = await getTreeBillboardTexture(treeType);
        if (!tex) continue;
        const batch = getBatch(textureBatches, tex);
        const px = c.mx - offsetX + 1.0;
        const pz = c.my - offsetY + 0.5;
        const py = c.h * settings.stepHeight + detailLift + 0.05;
        const baseScale = 2.2 + deterministic01(c.mx, c.my, seedInt + 1337) * 0.4;
        pushQuad(batch, px, py, pz, baseScale, baseScale * 1.5);
        treeRoots.add(`${c.mx},${c.my}`);
      }
      if ((y - y0) % 10 === 0) await nextFrame();
    }

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = getMicroTile(x, y, currentWorld);
        const c = {
          ...t,
          mx: x,
          my: y,
          h: t.heightStep,
          heightStep: t.heightStep,
          biomeId: t.biomeId,
          foliageDensity: foliageDensity(x, y, seedInt + 2221, TREE_NOISE_SCALE),
        };
        if (!tileSurfaceAllowsScatterVegetation(c)) continue;
        if (treeRoots.has(`${c.mx},${c.my}`)) continue;
        const px = c.mx - offsetX + 0.5;
        const pz = c.my - offsetY + 0.5;
        const py = c.h * settings.stepHeight + detailLift + 0.05;
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
      if ((y - y0) % 10 === 0) await nextFrame();
    }

    const meshes = buildMeshesFromBatches(textureBatches);
    const group = new THREE.Group();
    group.visible = !!settings.showVegetation;
    for (const mesh of meshes) group.add(mesh);
    chunkVegetationGroups.add(group);
    return [group];
  }

  function applyWireframeMode(wireframeOnly) {
    for (const mat of vegetationMaterials) {
      if (!mat) continue;
      mat.wireframe = !!wireframeOnly;
      mat.map = wireframeOnly ? null : (mat.userData.baseMap || null);
      mat.color.set(wireframeOnly ? '#b8ffb8' : '#ffffff');
      mat.alphaTest = wireframeOnly ? 0.0 : 0.2;
      mat.needsUpdate = true;
    }
    if (vegetationGroup) vegetationGroup.visible = !!settings.showVegetation;
  }

  function faceCamera(camera) {
    camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    for (const mat of litMats) {
      const shader = mat.userData.shader;
      if (!shader) continue;
      shader.uniforms.cameraRight.value.copy(camRight);
      shader.uniforms.cameraUp.value.copy(camUp);
    }
    for (const mat of depthMats) {
      const shader = mat.userData.shader;
      if (!shader) continue;
      shader.uniforms.cameraRight.value.copy(camRight);
      shader.uniforms.cameraUp.value.copy(camUp);
    }
  }

  function setVisible(visible) {
    if (vegetationGroup) vegetationGroup.visible = !!visible;
    for (const group of chunkVegetationGroups) group.visible = !!visible;
  }

  return {
    buildVegetationBillboards,
    buildChunkVegetation,
    applyWireframeMode,
    faceCamera,
    setVisible,
  };
}
