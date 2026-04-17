import { imageCache } from './image-cache.js';
import { entitiesByKey } from './wild-pokemon/wild-core-state.js';
import { updateWildMotion, setEmotion } from './wild-pokemon/wild-motion-ai.js';
import { scenarioOrchestrator } from './wild-pokemon/wild-scenario-orchestrator.js';
import { WILD_SOCIAL_SCENARIOS } from './wild-pokemon/wild-scenario-data.js';
import { drawWildSpeechBubbleOverlay } from './render/render-speech-bubble.js';
import { getResolvedSheets, ensurePokemonSheetsLoaded } from './pokemon/pokemon-asset-loader.js';
import { resolvePmdFrameSpecForSlice, resolveCanonicalPmdH } from './pokemon/pmd-layout-metrics.js';
import { PMD_MON_SHEET } from './pokemon/pmd-default-timing.js';
import { POKEMON_HEIGHTS } from './pokemon/pokemon-config.js';
import { rollNature } from './wild-pokemon/wild-natures.js';
import { ensurePokemondbItemIconInCache, getPokemondbItemIconPath } from './social/pokemondb-item-icon-paths.js';

const TILE_W = 32; 
const TILE_H = 32;

// --- ROBUST Mock Environment for getMicroTile ---
const MW = 32; // Macro Width
const MH = 32; // Macro Height
const macroSize = MW * MH;

const mockData = {
  width: MW,
  height: MH,
  seed: 12345,
  // Buffers expected by getMicroTile in chunking.js
  cells: new Float32Array(macroSize).fill(0.6), // elevation (land)
  temperature: new Float32Array(macroSize).fill(0.5),
  moisture: new Float32Array(macroSize).fill(0.5),
  anomaly: new Float32Array(macroSize).fill(0),
  biomes: new Uint8Array(macroSize).fill(1), // All grass
  config: {}, // Optional timing/water levels
  cityData: null,
  roadTraffic: null
};

class Simulation {
    constructor() {
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.lastTime = performance.now();
        this.showNatures = true;
        this.showDiagnostics = true;
        this.groupIdCounter = 1;
        this.isRunning = false;
        this.lastError = null;

        this.init();
    }

    async init() {
        try {
            this.addLog('Loading essential assets...');
            // Pre-load common test subjects
            await Promise.all([
                ensurePokemonSheetsLoaded(imageCache, 1), // Bulbasaur
                ensurePokemonSheetsLoaded(imageCache, 4), // Charmander
                ensurePokemonSheetsLoaded(imageCache, 7), // Squirtle
                ensurePokemonSheetsLoaded(imageCache, 16), // Pidgey
                ensurePokemondbItemIconInCache('cheri-berry'),
                ensurePokemondbItemIconInCache('big-mushroom'),
                ensurePokemondbItemIconInCache('sun-stone')
            ]);
            this.addLog('Assets ready.');

            this.setupListeners();
            this.isRunning = true;
            this.loop();
        } catch (err) {
            console.error(err);
            this.lastError = err;
            this.addLog(`Initialization Error: ${err.message}`, 'ERR');
        }
    }

    setupListeners() {
        document.getElementById('spawn-bulbasaur').onclick = () => this.spawnGroup(1);
        document.getElementById('spawn-charmander').onclick = () => this.spawnGroup(4);
        document.getElementById('spawn-pidgey').onclick = () => this.spawnGroup(16);
        document.getElementById('clear-all').onclick = () => {
            entitiesByKey.clear();
            scenarioOrchestrator.activeScenarios.clear();
            this.addLog('Cleared all entities.');
        };
        document.getElementById('trigger-flower').onclick = () => this.triggerScenario('flower_discovery');
        
        const exploreBtn = document.createElement('button');
        exploreBtn.textContent = 'Force Explore';
        exploreBtn.onclick = () => {
            const leader = [...entitiesByKey.values()].find(e => e.isLeader);
            if (leader) {
                leader.groupPhase = 'EXPLORE';
                leader.groupPhaseTimer = 30;
                this.addLog('Forced phase: EXPLORE');
            }
        };
        document.querySelector('.btn-group').appendChild(exploreBtn);

        document.getElementById('show-natures').onchange = (e) => this.showNatures = e.target.checked;
        
        // Add diagnostic toggle if missing in HTML (we'll just use it via code for now)
        window.toggleDiagnostics = () => {
            this.showDiagnostics = !this.showDiagnostics;
            this.addLog(`Diagnostics: ${this.showDiagnostics ? 'ON' : 'OFF'}`);
        };
    }

    addLog(msg, type = 'SYS') {
        const log = document.getElementById('log');
        if (!log) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        const color = type === 'SYS' ? 'var(--accent-color)' : (type === 'ERR' ? '#ff4f4f' : '#ffcc4f');
        entry.innerHTML = `<span class="badge" style="background:${color}">${type}</span>${msg}`;
        log.prepend(entry);
    }

    spawnGroup(dexId) {
        const leaderKey = `sim:${Date.now()}`;
        const groupId = `grp:${this.groupIdCounter++}`;
        const centerX = 12;
        const centerY = 10;

        this.addLog(`Spawning group ${groupId} (Dex: ${dexId})`, 'INFO');

        for (let i = 0; i < 3; i++) {
            const key = i === 0 ? leaderKey : `${leaderKey}:${i}`;
            const entity = {
                key,
                dexId,
                x: centerX + (Math.random() - 0.5) * 4,
                y: centerY + (Math.random() - 0.5) * 4,
                vx: 0,
                vy: 0,
                z: 0,
                vz: 0,
                spawnPhase: 1.0,
                grounded: true,
                animRow: 0,
                animFrame: 0,
                facing: 'down',
                aiState: 'wander',
                nature: rollNature(key, mockData.seed),
                groupId,
                isLeader: i === 0,
                groupLeaderKey: leaderKey,
                groupMemberIndex: i,
                groupSize: 3,
                groupCohesionSec: 9999,
                groupHomeX: centerX,
                groupHomeY: centerY,
                behavior: { archetype: 'neutral' },
                recentNearbyEvents: [],
                socialMemory: { affinity: 0, threat: 0, curiosity: 0, reactionCooldown: 0 }
            };
            entitiesByKey.set(key, entity);
        }
    }

    triggerScenario(scenarioId) {
        const leader = [...entitiesByKey.values()].find(e => e.isLeader);
        if (!leader) {
            this.addLog('Spawn a group first!', 'WARN');
            return;
        }

        const groupMembers = [...entitiesByKey.values()]
            .filter(e => e.groupId === leader.groupId)
            .sort((a, b) => a.groupMemberIndex - b.groupMemberIndex);

        this.addLog(`Triggering scenario: ${scenarioId}`);
        scenarioOrchestrator.startScenario(leader.groupId, scenarioId, groupMembers);
        leader.groupPhase = 'SCENIC';
    }

    loop() {
        if (!this.isRunning) return;
        
        try {
            const now = performance.now();
            const dt = Math.min(0.05, (now - this.lastTime) / 1000);
            this.lastTime = now;

            this.update(dt);
            this.draw();
        } catch (err) {
            this.isRunning = false;
            this.lastError = err;
            console.error("Simulation Loop Crash:", err);
            this.addLog(`LOOP CRASH: ${err.message}`, 'ERR');
            this.drawError(err);
        }

        requestAnimationFrame(() => this.loop());
    }

    update(dt) {
        for (const entity of entitiesByKey.values()) {
            updateWildMotion(entity, dt, mockData, -999, -999); 
        }
        scenarioOrchestrator.update(dt);
    }

    draw() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#2d4c2d';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for(let x=0; x<canvas.width; x+=TILE_W) {
            ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
        }
        for(let y=0; y<canvas.height; y+=TILE_H) {
            ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
        }

        // Phase HUD
        const leader = [...entitiesByKey.values()].find(e => e.isLeader);
        if (leader) {
            ctx.fillStyle = 'white';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`GROUP PHASE: ${leader.groupPhase}`, 10, 20);
            ctx.fillText(`PHASE TIMER: ${Math.ceil(leader.groupPhaseTimer || 0)}s`, 10, 35);
        }

        // Layer 0: World Items (Discovery)
        for (const state of scenarioOrchestrator.activeScenarios.values()) {
            if (state.itemSlug && state.focusPoint) {
                this.drawWorldItem(state.itemSlug, state.focusPoint.x, state.focusPoint.y);
            }
        }

        const entities = [...entitiesByKey.values()].sort((a,b) => a.y - b.y);
        
        // Layer 1: Characters
        for(const ent of entities) {
            this.drawEntity(ent);
        }

        // Layer 2: Bubbles & HUD
        for(const ent of entities) {
            const tx = ent.x * TILE_W;
            const ty = ent.y * TILE_H - (ent.z || 0) * TILE_H;

            // Nature Label
            if (this.showNatures) {
                ctx.fillStyle = 'white';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(ent.nature.toUpperCase(), tx, ty - 45);
            }

            // Speech Bubble
            if (ent.speechBubble) {
                const targetHeightTiles = POKEMON_HEIGHTS[ent.dexId] || 1.1;
                const pivotY = targetHeightTiles * TILE_H * PMD_MON_SHEET.pivotYFrac;

                drawWildSpeechBubbleOverlay(
                    ctx, 
                    { cx: tx, cy: ty, pivotY, dexId: ent.dexId, speechBubble: ent.speechBubble },
                    0, imageCache, TILE_W, TILE_H, (n) => Math.round(n)
                );
            }
        }
    }

    drawEntity(ent) {
        const { ctx } = this;
        const tx = ent.x * TILE_W;
        const ty = ent.y * TILE_H - (ent.z || 0) * TILE_H;

        const { walk, idle } = getResolvedSheets(imageCache, ent.dexId);
        const moving = Math.hypot(ent.vx, ent.vy) > 0.05;
        const sheet = moving ? (walk || idle) : idle;

        if (this.showDiagnostics) {
            ctx.fillStyle = ent.isLeader ? 'rgba(255, 200, 0, 0.3)' : 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(tx - 16, ty - 16, 32, 32);
            ctx.strokeStyle = ent.isLeader ? '#ffcc00' : '#ffffff';
            ctx.strokeRect(tx - 16, ty - 16, 32, 32);
        }

        if (sheet && sheet.naturalWidth > 0) {
            const { sw, sh, animCols } = resolvePmdFrameSpecForSlice(sheet, ent.dexId, moving ? 'walk' : 'idle');
            const targetHeightTiles = POKEMON_HEIGHTS[ent.dexId] || 1.1;
            const canonicalH = resolveCanonicalPmdH(idle, walk, ent.dexId);
            const scale = (targetHeightTiles * TILE_H) / canonicalH;

            const dw = sw * scale;
            const dh = sh * scale;
            const pivotY = dh * PMD_MON_SHEET.pivotYFrac;

            const frame = Math.floor(performance.now() / 150) % animCols;
            ctx.drawImage(sheet, frame * sw, (ent.animRow || 0) * sh, sw, sh, tx - dw * 0.5, ty - pivotY, dw, dh);
        } else {
            // Circle Fallback
            ctx.fillStyle = '#ff3366';
            ctx.beginPath(); ctx.arc(tx, ty - 16, 12, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'white';
            ctx.font = '8px sans-serif';
            ctx.fillText("NO SPRITE", tx, ty - 12);
        }
    }

    async drawWorldItem(slug, x, y) {
        const { ctx } = this;
        const tx = x * TILE_W;
        const ty = y * TILE_H;

        const path = await getPokemondbItemIconPath(slug);
        const img = path ? imageCache.get(path) : null;

        if (img && img.naturalWidth) {
            const floatY = Math.sin(performance.now() / 300) * 4;
            const size = 24;
            
            // Item Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.beginPath();
            ctx.ellipse(tx, ty + 8, 10, 5, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.drawImage(img, tx - size/2, ty - size/2 + floatY, size, size);
        }
    }

    drawError(err) {
        const { ctx, canvas } = this;
        ctx.fillStyle = 'rgba(200, 0, 0, 0.8)';
        ctx.fillRect(50, canvas.height/2 - 100, canvas.width - 100, 200);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText("SIMULATION CRASHED", canvas.width/2, canvas.height/2 - 60);
        ctx.font = '12px monospace';
        ctx.fillText(err.message, canvas.width/2, canvas.height/2 - 20);
        ctx.font = '10px monospace';
        const lines = err.stack?.split('\n').slice(0, 5) || [];
        lines.forEach((l, i) => ctx.fillText(l.trim(), canvas.width/2, canvas.height/2 + 10 + i * 15));
    }
}

window.sim = new Simulation();
