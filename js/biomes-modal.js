import { BIOMES } from './biomes.js';
import { 
  BIOME_TO_TERRAIN, 
  BIOME_VEGETATION, 
  BIOME_TO_FOLIAGE, 
  getGrassVariant, 
  getGrassParams,
  getTreeType,
  NO_TREE_BIOMES,
  TREE_DENSITY_THRESHOLD,
  FOLIAGE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  FOLIAGE_NOISE_SCALE,
  TREE_TILES,
  GRASS_TILES
} from './biome-tiles.js';
import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';
import { TessellationEngine } from './tessellation-engine.js';
import { imageCache } from './image-cache.js';
import { parseShape, getRoleForCell } from './tessellation-logic.js';
import { drawTerrainCellFromSheet, getConcConvATerrainTileSpec } from './render/conc-conv-a-terrain-blit.js';

export class BiomesModal {
  constructor() {
    this.modal = document.getElementById('biomesModal');
    this.grid = document.getElementById('biomesGrid');
    this.closeBtn = document.getElementById('btnCloseBiomes');
    this.openBtn = document.getElementById('btnBiomes');

    if (this.openBtn) {
      this.openBtn.onclick = () => this.open();
    }
    if (this.closeBtn) {
      this.closeBtn.onclick = () => this.close();
    }

    window.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  open() {
    this.render();
    this.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  render() {
    this.grid.innerHTML = '';

    const categories = {
      "Água": [BIOMES.OCEAN, BIOMES.BEACH],
      "Clima": [BIOMES.GRASSLAND, BIOMES.FOREST, BIOMES.JUNGLE, BIOMES.SAVANNA, BIOMES.DESERT],
      "Frio / Montanha": [BIOMES.TAIGA, BIOMES.TUNDRA, BIOMES.SNOW, BIOMES.ICE, BIOMES.MOUNTAIN, BIOMES.PEAK],
      "Especiais": [BIOMES.ARCANE, BIOMES.GHOST_WOODS, BIOMES.VOLCANO, BIOMES.FLOWER_FIELDS],
      "Civilização": [BIOMES.CITY, BIOMES.CITY_STREET, BIOMES.TOWN, BIOMES.TOWN_STREET]
    };

    for (const [catName, biomes] of Object.entries(categories)) {
      const sectionContainer = document.createElement('div');
      sectionContainer.className = 'biome-category-title';
      sectionContainer.innerHTML = `<h3>${catName}</h3>`;
      this.grid.appendChild(sectionContainer);

      biomes.forEach(biome => {
        const card = this.createBiomeCard(biome);
        this.grid.appendChild(card);
      });
    }
  }

  createBiomeCard(biome) {
    const card = document.createElement('div');
    card.className = 'biome-card';

    const terrainSetName = BIOME_TO_TERRAIN[biome.id];
    const foliageSetName = BIOME_TO_FOLIAGE[biome.id];
    const vegetation = BIOME_VEGETATION[biome.id] || [];
    const grassParams = getGrassParams(biome.id);
    
    // Get ALL variants
    const treeTypes = this.getAllTreeTypes(biome.id);
    const foliageTiles = this.getAllFoliageTiles(biome.id);

    card.innerHTML = `
      <div class="biome-card-header" style="border-left: 4px solid ${biome.color}">
        <div class="biome-name-title">${biome.name}</div>
        <div class="biome-id-badge">#${biome.id}</div>
      </div>
      
      <div class="biome-card-body">
        
        <!-- VISUAL PREVIEWS (SET BASE) -->
        <div class="biome-visual-row">
          <div class="biome-preview-box">
            <div class="box-label">Terreno (Base)</div>
            <canvas id="terrain-${biome.id}" width="112" height="112" class="pixel-canvas"></canvas>
            <div class="box-footer">${terrainSetName || 'N/A'}</div>
          </div>
          
          ${foliageSetName ? `
          <div class="biome-preview-box">
            <div class="box-label">Pele (Tesselação)</div>
            <canvas id="foliage-${biome.id}" width="112" height="112" class="pixel-canvas"></canvas>
            <div class="box-footer">${foliageSetName}</div>
          </div>
          ` : ''}
        </div>

        <!-- TREE VARIATIONS GALLERY -->
        ${treeTypes.length > 0 ? `
        <div class="biome-gallery-section">
          <div class="biome-info-label">Variantes de Árvores</div>
          <div class="biome-gallery-row tree-gallery" id="tree-gallery-${biome.id}">
            <!-- Canvases drawn via JS -->
          </div>
        </div>
        ` : ''}

        <!-- FOLIAGE TILES GALLERY -->
        ${foliageTiles.length > 0 ? `
        <div class="biome-gallery-section">
          <div class="biome-info-label">Variações de Pele (Detalhes)</div>
          <div class="biome-gallery-row" id="foliage-gallery-${biome.id}">
            <!-- Canvases drawn via JS -->
          </div>
        </div>
        ` : ''}

        <!-- VEGETATION GALLERY -->
        <div class="biome-gallery-section">
          <div class="biome-info-label">Vegetação Principal (Scatter)</div>
          <div class="biome-gallery-row" id="veg-gallery-${biome.id}">
            <!-- Sprites drawn via JS -->
          </div>
        </div>

        <!-- TECHNICAL PARAMS -->
        <div class="biome-param-grid">
           <div class="biome-param-item">
              <span class="biome-param-name">Grama Escala</span>
              <span class="biome-param-value">${grassParams.scale.toFixed(2)}</span>
           </div>
           <div class="biome-param-item">
              <span class="biome-param-name">Grama Threshold</span>
              <span class="biome-param-value">${grassParams.threshold.toFixed(2)}</span>
           </div>
           <div class="biome-param-item">
              <span class="biome-param-name">Árvore Noise</span>
              <span class="biome-param-value">${treeTypes.length > 0 ? TREE_NOISE_SCALE.toFixed(2) : '--'}</span>
           </div>
           <div class="biome-param-item">
              <span class="biome-param-name">Foliage Noise</span>
              <span class="biome-param-value">${FOLIAGE_NOISE_SCALE.toFixed(2)}</span>
           </div>
        </div>

      </div>
    `;

    // Draw all variants
    this.drawTerrainSample(card.querySelector(`#terrain-${biome.id}`), terrainSetName);
    if (foliageSetName) this.drawTerrainSample(card.querySelector(`#foliage-${biome.id}`), foliageSetName);
    
    // Draw tree gallery
    const treeGallery = card.querySelector(`#tree-gallery-${biome.id}`);
    if (treeGallery) {
      treeTypes.forEach(type => {
        const canvas = document.createElement('canvas');
        canvas.title = type;
        treeGallery.appendChild(canvas);
        this.drawTreeSample(canvas, type);
      });
    }

    // Draw foliage tiles gallery
    const foliageGallery = card.querySelector(`#foliage-gallery-${biome.id}`);
    if (foliageGallery) {
      foliageTiles.forEach(tile => {
        const canvas = document.createElement('canvas');
        canvas.title = tile.name;
        foliageGallery.appendChild(canvas);
        this.drawFoliageTile(canvas, tile.id);
      });
    }

    this.drawVegetationGallery(card.querySelector(`#veg-gallery-${biome.id}`), vegetation);

    return card;
  }

  getAllTreeTypes(biomeId) {
    if (NO_TREE_BIOMES.has(biomeId)) return [];
    const types = new Set();
    // Simulate 20 random points to find all variants defined in logic
    for (let i = 0; i < 1.0; i += 0.05) {
      const type = getTreeType(biomeId, i * 100, (1-i) * 100, 12345);
      if (type) types.add(type);
    }
    return Array.from(types);
  }

  getAllFoliageTiles(biomeId) {
    const variant = getGrassVariant(biomeId);
    if (!variant || !GRASS_TILES[variant]) return [];
    
    const tiles = GRASS_TILES[variant];
    return Object.entries(tiles)
      .filter(([name]) => !name.includes('Top')) // Filter out animation tops for clarity
      .map(([name, id]) => ({ name, id }));
  }

  drawTerrainSample(canvas, setName) {
    if (!canvas || !setName) return;
    const ctx = canvas.getContext('2d');
    const set = TERRAIN_SETS[setName];
    if (!set) return;

    const imgPath = TessellationEngine.getImagePath(set.file);
    const img = imageCache.get(imgPath);
    if (!img) return;

    const sheetCols = TessellationEngine.getTerrainSheetCols(set);
    ctx.imageSmoothingEnabled = false;

    // Define uma máscara de "Ilha Orgânica" 7x7
    // 1 = Terra (do bioma), 0 = Vazio (transparente)
    const landMask = [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 0, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 0, 1, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0]
    ];

    const isLandAt = (r, c) => {
      if (r < 0 || r >= 7 || c < 0 || c >= 7) return false;
      return landMask[r][c] === 1;
    };

    // Renderiza a grade calculando o papel exato para cada célula
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (!isLandAt(r, c)) continue;

        // Determina o papel (role) usando a mesma função do jogo
        const role = getRoleForCell(r, c, 7, 7, isLandAt, set.type);
        const spec = getConcConvATerrainTileSpec(set, role);
        drawTerrainCellFromSheet(ctx, img, sheetCols, 16, spec.tileId, c * 16, r * 16, 16, 16, spec.flipX);
      }
    }
  }

  drawTreeSample(canvas, treeType) {
    if (!canvas || !treeType) return;
    const ctx = canvas.getContext('2d');
    const ids = TREE_TILES[treeType];
    if (!ids) return;

    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    if (!natureImg) return;

    const cols = 57;
    const scale = 2;
    // As árvores no projeto costumam ser 2x3 (base=2 tiles, top=4 tiles)
    const treeW = 2;
    const treeH = 3;
    
    canvas.width = treeW * 16 * scale;
    canvas.height = treeH * 16 * scale;
    ctx.imageSmoothingEnabled = false;

    // Renderiza a base (2 tiles na base)
    ids.base.forEach((tileId, i) => {
      ctx.drawImage(
        natureImg,
        (tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16,
        i * 16 * scale, (treeH - 1) * 16 * scale, 16 * scale, 16 * scale
      );
    });

    // Renderiza o topo (4 tiles, 2 por linha acima da base)
    ids.top.forEach((tileId, i) => {
      const col = i % 2;
      const row = 1 - Math.floor(i / 2); // Linhas acima da base: 1 e 0
      ctx.drawImage(
        natureImg,
        (tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16,
        col * 16 * scale, row * 16 * scale, 16 * scale, 16 * scale
      );
    });
  }

  drawVegetationGallery(container, items) {
    if (!container || !items.length) {
       if (container) container.innerHTML = '<span class="biome-tag" style="opacity: 0.5;">Nenhuma</span>';
       return;
    }

    items.forEach(itemKey => {
      const objSet = OBJECT_SETS[itemKey];
      if (!objSet) return;

      const grid = TessellationEngine.getObjectGrid(itemKey);
      if (!grid || grid.length === 0) return;

      const rows = grid.length;
      const colsInGrid = grid[0].length;

      const canvas = document.createElement('canvas');
      // Escala 2x para clareza (16px -> 24px ou similar, mas manter consistência)
      const scale = 2;
      canvas.width = colsInGrid * 16 * scale;
      canvas.height = rows * 16 * scale;
      canvas.className = 'gallery-sprite';
      canvas.title = itemKey;
      container.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      const imgPath = TessellationEngine.getImagePath(objSet.file);
      const img = imageCache.get(imgPath);
      if (!img) return;

      const sheetCols = imgPath.includes('caves') ? 50 : 57;
      ctx.imageSmoothingEnabled = false;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < colsInGrid; c++) {
          const tileId = grid[r][c];
          if (tileId === null) continue;

          ctx.drawImage(
            img,
            (tileId % sheetCols) * 16, Math.floor(tileId / sheetCols) * 16, 16, 16,
            c * 16 * scale, r * 16 * scale, 16 * scale, 16 * scale
          );
        }
      }
    });
  }

  drawFoliageTile(canvas, tileId) {
    if (!canvas || tileId == null) return;
    const ctx = canvas.getContext('2d');
    const natureImg = imageCache.get('tilesets/flurmimons_tileset___nature_by_flurmimon_d9leui9.png');
    if (!natureImg) return;

    canvas.width = 32;
    canvas.height = 32;
    ctx.imageSmoothingEnabled = false;

    const cols = 57;
    ctx.drawImage(
      natureImg,
      (tileId % cols) * 16, Math.floor(tileId / cols) * 16, 16, 16,
      0, 0, 32, 32
    );
  }
}
