import { player, setPlayerSpecies, updatePlayer, applyPlayerWorldResumePosition, tryJumpPlayer } from '../../js/player.js';
import { render, loadTilesetImages } from '../../js/render.js';
import { imageCache } from '../../js/image-cache.js';
import { ensurePokemonSheetsLoaded } from '../../js/pokemon/pokemon-asset-loader.js';
import { playInputState } from '../../js/main/play-input-state.js';
import { DungeonGenerator } from './dungeon-generator.js';
import { TILE_TYPES } from './tile-map.js';
import { MACRO_TILE_STRIDE } from '../../js/chunking.js';
import { BIOMES } from '../../js/biomes.js';

import { PluginRegistry } from '../../js/core/plugin-registry.js';
import { TERRAIN_SETS } from '../../js/tessellation-data.js';
import { WALKABLE_SURFACE_TERRAIN_TILE_IDS, WALL_ROLES } from '../../js/walkability.js';

// Create a walkable version of the cave rock terrain (engine blocks anything starting with "altura ")
if (TERRAIN_SETS["altura Pedra"] && !TERRAIN_SETS["dungeon_rock"]) {
    const set = { ...TERRAIN_SETS["altura Pedra"] };
    TERRAIN_SETS["dungeon_rock"] = set;
    
    // Manually inject these IDs into the walkable set (which was pre-computed at load time)
    if (set.centerId != null) WALKABLE_SURFACE_TERRAIN_TILE_IDS.add(set.centerId);
    if (set.roles) {
        for (const [role, id] of Object.entries(set.roles)) {
            if (!WALL_ROLES.has(role)) {
                WALKABLE_SURFACE_TERRAIN_TILE_IDS.add(id);
            }
        }
    }
}

// Register a dedicated Dungeon biome for the engine to use correct textures
PluginRegistry.registerBiome('DUNGEON', {
    id: 100,
    name: 'Dungeon',
    color: '#333',
    terrain: 'dungeon_rock' 
});

/**
 * Mystery Dungeon - Powered by the main engine
 */
class MysteryDungeonApp {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Logical resolution
        this.logicalWidth = 480;
        this.logicalHeight = 320;
        
        this.lastTime = performance.now();
        this.isRunning = false;
        
        this.dungeonMap = null;
        this.worldData = null;

        this.init();
    }

    async init() {
        this.setupCanvas();
        window.addEventListener('resize', () => this.setupCanvas());
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // 1. Load Essential Tilesets
        await loadTilesetImages();
        
        // 2. Set Player Species (Charmander for testing)
        setPlayerSpecies(4); 
        await ensurePokemonSheetsLoaded(imageCache, player.dexId);
        
        // 3. Generate Dungeon
        const gen = new DungeonGenerator(40, 40);
        this.dungeonMap = gen.generate();
        
        // 4. Wrap Dungeon in WorldData format for the main engine
        this.worldData = this.wrapDungeonForEngine(this.dungeonMap);
        
        // 5. Spawn Player
        this.spawnPlayer();
        
        this.start();
    }

    wrapDungeonForEngine(dm) {
        // Create a much larger macro grid (20x20 macro tiles)
        const macroW = 20;
        const macroH = 20;
        const macroSize = macroW * macroH;
        const totalMW = macroW * MACRO_TILE_STRIDE;
        const totalMH = macroH * MACRO_TILE_STRIDE;
        
        // Calculate offsets to center the dungeon (dm.width x dm.height)
        const offsetX = Math.floor((totalMW - dm.width) / 2);
        const offsetY = Math.floor((totalMH - dm.height) / 2);
        
        const worldData = {
            width: macroW,
            height: macroH,
            seed: 12345,
            cells: new Float32Array(macroSize).fill(0.5),
            temperature: new Float32Array(macroSize).fill(0.5),
            moisture: new Float32Array(macroSize).fill(0.5),
            anomaly: new Float32Array(macroSize).fill(0),
            biomes: new Int32Array(macroSize).fill(100), // Use DUNGEON biome ID
            config: { waterLevel: 0.2 },
            noFoliage: true, 
            microTiles: new Array(totalMW * totalMH),
            offsetX: offsetX, // Store offsets for spawnPlayer
            offsetY: offsetY
        };

        for (let y = 0; y < dm.height; y++) {
            for (let x = 0; x < dm.width; x++) {
                const type = dm.get(x, y);
                const isWall = type === TILE_TYPES.WALL || type === TILE_TYPES.VOID;
                
                const worldX = x + offsetX;
                const worldY = y + offsetY;
                
                worldData.microTiles[worldY * totalMW + worldX] = {
                    biomeId: 100, // DUNGEON
                    heightStep: isWall ? 2 : 1,
                    elevation: 0.5,
                    isRoad: false,
                    isCity: false,
                    foliageDensity: 0,
                    foliageType: 0,
                    berryPatchDensity: 0
                };
            }
        }

        return worldData;
    }

    spawnPlayer() {
        const { offsetX, offsetY } = this.worldData;
        // Find a random floor tile relative to the dungeon center
        for (let y = 0; y < this.dungeonMap.height; y++) {
            for (let x = 0; x < this.dungeonMap.width; x++) {
                if (this.dungeonMap.get(x, y) === TILE_TYPES.FLOOR) {
                    applyPlayerWorldResumePosition(x + offsetX + 0.5, y + offsetY + 0.5, 0);
                    return;
                }
            }
        }
    }

    handleKeyDown(e) {
        if (e.code === 'ArrowUp' || e.code === 'KeyW') player.inputY = -1;
        if (e.code === 'ArrowDown' || e.code === 'KeyS') player.inputY = 1;
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') player.inputX = -1;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') player.inputX = 1;
        
        if (e.code === 'Space') {
            playInputState.spaceHeld = true;
            tryJumpPlayer(player);
        }
        if (e.shiftKey) playInputState.shiftLeftHeld = true;
    }

    handleKeyUp(e) {
        if (e.code === 'ArrowUp' || e.code === 'KeyW') if (player.inputY < 0) player.inputY = 0;
        if (e.code === 'ArrowDown' || e.code === 'KeyS') if (player.inputY > 0) player.inputY = 0;
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') if (player.inputX < 0) player.inputX = 0;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') if (player.inputX > 0) player.inputX = 0;
        
        if (e.code === 'Space') playInputState.spaceHeld = false;
        if (!e.shiftKey) playInputState.shiftLeftHeld = false;
    }

    setupCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    start() {
        this.isRunning = true;
        requestAnimationFrame((t) => this.loop(t));
    }

    loop(time) {
        const dt = Math.min(0.1, (time - this.lastTime) / 1000);
        this.lastTime = time;

        // Use the REAL player update logic
        updatePlayer(dt, this.worldData, time / 1000);

        // Use the REAL renderer
        render(this.canvas, this.worldData, {
            settings: {
                appMode: 'play',
                player: player,
                time: time / 1000,
                viewType: 'biomes'
            }
        });

        requestAnimationFrame((t) => this.loop(t));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new MysteryDungeonApp();
});
