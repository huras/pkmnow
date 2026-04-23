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
  const vegetationBillboards = [];
  const vegetationMaterials = [];

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

  function addBillboard(texture, px, py, pz, width, height) {
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
    });
    mat.userData.baseMap = texture;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.set(px, py + height * 0.5, pz);
    mesh.scale.set(width, height, 1);
    vegetationBillboards.push(mesh);
    vegetationMaterials.push(mat);
    vegetationGroup.add(mesh);
  }

  async function buildVegetationBillboards({ cells, span, half, worldSeed, currentWorld, detailGroup }) {
    vegetationBillboards.length = 0;
    vegetationMaterials.length = 0;
    vegetationGroup = new THREE.Group();
    detailGroup.add(vegetationGroup);
    if (!settings.showVegetation) return;

    const seedInt = seedToInt(worldSeed);
    const microW = currentWorld.width * MACRO_TILE_STRIDE;
    const microH = currentWorld.height * MACRO_TILE_STRIDE;
    const originMemo = new Map();
    const getTile = (mx, my) => getMicroTile(mx, my, currentWorld);

    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const c = cells[idx(span, x, y)];
        const px = x - half + 0.5;
        const pz = y - half + 0.5;
        const py = c.h * settings.stepHeight + 0.05;

        if (!tileSurfaceAllowsScatterVegetation(c)) continue;
        if ((c.mx + c.my) % 3 !== 0) continue;
        const treeNoise = foliageDensity(c.mx, c.my, seedInt + 5555, TREE_NOISE_SCALE);
        if (treeNoise < TREE_DENSITY_THRESHOLD) continue;

        const right = x + 1 < span ? cells[idx(span, x + 1, y)] : getMicroTile(c.mx + 1, c.my, currentWorld);
        if (!right || right.heightStep !== c.h) continue;

        const treeType = getTreeType(c.biomeId, c.mx, c.my, seedInt);
        if (!treeType || c.h <= 0) continue;
        const noise = deterministic01(c.mx, c.my, seedInt + 9001);
        if (noise > settings.vegetationDensity) continue;

        const tex = await getTreeBillboardTexture(treeType);
        if (!tex) continue;
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.2,
          side: THREE.DoubleSide,
        });
        mat.userData.baseMap = tex;
        const spr = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        const baseScale = 2.2 + deterministic01(c.mx, c.my, seedInt + 1337) * 0.4;
        const width = baseScale;
        const height = baseScale * 1.5;
        spr.position.set(px + 0.5, py + height * 0.5, pz);
        spr.scale.set(width, height, 1);
        vegetationBillboards.push(spr);
        vegetationMaterials.push(mat);
        vegetationGroup.add(spr);
      }
      if (y % 10 === 0) await nextFrame();
    }

    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const c = cells[idx(span, x, y)];
        const px = x - half + 0.5;
        const pz = y - half + 0.5;
        const py = c.h * settings.stepHeight + 0.05;

        if (!tileSurfaceAllowsScatterVegetation(c)) continue;

        if (validScatterOriginMicro(c.mx, c.my, seedInt, microW, microH, getTile, originMemo)) {
          const itemKey = resolveScatterVegetationItemKey(c.mx, c.my, c, seedInt);
          if (itemKey) {
            const scatterNoise = deterministic01(c.mx, c.my, seedInt + 7011);
            if (scatterNoise <= settings.vegetationDensity) {
              const texInfo = await getObjectBillboardTexture(itemKey);
              if (texInfo?.texture) {
                const width = Math.max(0.9, texInfo.tilesW * 0.92);
                const height = Math.max(1.1, texInfo.tilesH * 0.92);
                addBillboard(texInfo.texture, px, py, pz, width, height);
                continue;
              }
            }
          }
        }

        const grassVariant = getGrassVariant(c.biomeId);
        const grassTiles = grassVariant ? GRASS_TILES[grassVariant] : null;
        const grassTileId = grassTiles?.original ?? grassTiles?.small ?? grassTiles?.grass2;
        if (!grassTileId || c.foliageDensity < FOLIAGE_DENSITY_THRESHOLD) continue;
        const grassNoise = deterministic01(c.mx, c.my, seedInt + 9123);
        if (grassNoise > settings.vegetationDensity) continue;

        const grassKey = `grass:${grassVariant}:${grassTileId}`;
        const grassMeta = objectBillboardTextureCache.get(grassKey);
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
          objectBillboardTextureCache.set(grassKey, { texture: out, tilesW: 1, tilesH: 1 });
        }
        const finalGrass = objectBillboardTextureCache.get(grassKey);
        if (finalGrass?.texture) addBillboard(finalGrass.texture, px, py, pz, 0.9, 1.0);
      }
      if (y % 10 === 0) await nextFrame();
    }
  }

  function applyWireframeMode(wireframeOnly) {
    for (const mat of vegetationMaterials) {
      if (!mat) continue;
      if (wireframeOnly) {
        mat.wireframe = true;
        mat.map = null;
        mat.color.set('#b8ffb8');
        mat.transparent = false;
        mat.alphaTest = 0;
      } else {
        mat.wireframe = false;
        mat.map = mat.userData.baseMap || null;
        mat.color.set('#ffffff');
        mat.transparent = true;
        mat.alphaTest = 0.2;
      }
      mat.needsUpdate = true;
    }
    if (vegetationGroup) vegetationGroup.visible = !!settings.showVegetation;
  }

  function faceCamera(camera) {
    for (const b of vegetationBillboards) b.quaternion.copy(camera.quaternion);
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
