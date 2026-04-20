import { generate, DEFAULT_CONFIG } from '../generator.js';
import { render, loadTilesetImages } from '../render.js';
import { imageCache } from '../image-cache.js';
import { BIOMES } from '../biomes.js';
import { MACRO_TILE_STRIDE, getMicroTile } from '../chunking.js';
import { initWeatherSystem, tickWeather, getActiveWeatherParams, getWeatherTarget } from '../main/weather-system.js';
import { initEarthquakeLayer, tickEarthquakeLayer } from '../main/earthquake-layer.js';
import { getWindDirectionRad, getWindFeltIntensity } from '../main/wind-state.js';
import { resetWildPokemonManager, syncWildPokemonWindow, updateWildPokemon, getWildPokemonEntities } from '../wild-pokemon/index.js';
import { resetThrownMapDetailEntities } from '../main/thrown-map-detail-entities.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { summonDebugWildPokemon } from '../wild-pokemon/wild-spawn-window.js';
import { advanceWildPokemonAnim, DIRECTION_ROW_MAP, getFacingFromAngle } from '../wild-pokemon/wild-motion-ai.js';

const canvas = document.getElementById('background-canvas');
const splashContainer = document.getElementById('splash-container');
const mainMenu = document.getElementById('main-menu');
const pressStart = document.getElementById('press-start');
const loadingBar = document.getElementById('loading-bar');
const biomeNameEl = document.getElementById('biome-name');
const biomeSwatchEl = document.getElementById('biome-swatch');
const biomeInfoEl = document.getElementById('biome-info');

let currentData = null;
let gameTime = 0;
let lastCycleTime = 0;
const CYCLE_INTERVAL = 10000; // 10 seconds

const CONFIG = {
  ...DEFAULT_CONFIG,
  cityCount: 5, // Simpler map for background
};

async function init() {
  await loadTilesetImages(imageCache);
  
  // Initialize systems
  initWeatherSystem({ preset: 'clear', intensity01: 0.5 });
  initEarthquakeLayer({ intensity01: 0 });
  
  startSplashSequence();
}

function startSplashSequence() {
  setTimeout(() => {
    splashContainer.style.opacity = '0';
    setTimeout(() => {
      splashContainer.style.display = 'none';
      showMainMenu();
    }, 1000);
  }, 4000);
}

function showMainMenu() {
  mainMenu.classList.add('visible');
  cycleBiome();
  requestAnimationFrame(loop);
}

function cycleBiome() {
  const seed = Math.random().toString(36).substring(7);
  currentData = generate(seed, CONFIG);
  
  resetWildPokemonManager();
  resetThrownMapDetailEntities();
  
  // Find a nice spot in the map (near center or random city)
  let targetX = currentData.width * MACRO_TILE_STRIDE / 2;
  let targetY = currentData.height * MACRO_TILE_STRIDE / 2;
  
  // Find a nice route (inter-city path) instead of just a city
  let selectedPath = null;
  let pathIndex = 0;
  let pathDirection = 1;
  
  const hasPaths = currentData.paths && currentData.paths.length > 0;
  if (hasPaths) {
    // Prefer longer paths for better visual movement
    const longPaths = currentData.paths.filter(p => p.length > 12);
    selectedPath = longPaths.length > 0 
      ? longPaths[Math.floor(Math.random() * longPaths.length)]
      : currentData.paths[Math.floor(Math.random() * currentData.paths.length)];
    
    // Start at a random point in the path
    pathIndex = Math.floor(Math.random() * selectedPath.length);
    pathDirection = Math.random() > 0.5 ? 1 : -1;
    
    const pt = selectedPath[pathIndex];
    targetX = pt.x * MACRO_TILE_STRIDE;
    targetY = pt.y * MACRO_TILE_STRIDE;
  } else if (currentData.graph.nodes.length > 0) {
    const node = currentData.graph.nodes[Math.floor(Math.random() * currentData.graph.nodes.length)];
    targetX = node.x * MACRO_TILE_STRIDE;
    targetY = node.y * MACRO_TILE_STRIDE;
  }

  // Set fake player for camera tracking and spawning
  // Randomize player pokemon species from a pool of common "protagonist" mons or biome-specific
  const bId = currentData.biomes[Math.floor(targetY / MACRO_TILE_STRIDE) * currentData.width + Math.floor(targetX / MACRO_TILE_STRIDE)];
  const pool = getEncounters(bId);
  let playerDex = 25; // Pikachu default
  if (pool && pool.length > 0) {
    const species = pool[Math.floor(Math.random() * pool.length)];
    playerDex = encounterNameToDex(species) || 25;
  }

  window.fakePlayer = {
    x: targetX,
    y: targetY,
    z: 0,
    visualX: targetX,
    visualY: targetY,
    grounded: true,
    dexId: playerDex,
    facing: 'down',
    animMoving: false,
    _walkPhase: 0,
    _wanderAngle: Math.random() * Math.PI * 2,
    _wanderTimer: 0,
    selectedPath,
    pathIndex,
    pathDirection
  };

  // Spawn some random pokemon near the selected route or roads
  spawnPokemonNearRoads(targetX, targetY);
  // spawnPokemonInCities(); // REMOVED: User requested no inner-city entities

  // Update biome info UI
  const bio = Object.values(BIOMES).find(b => b.id === bId);
  if (bio) {
    biomeNameEl.textContent = bio.name;
    biomeSwatchEl.style.backgroundColor = bio.color;
    biomeInfoEl.classList.add('visible');
  }

  // Reset loading bar
  loadingBar.style.transition = 'none';
  loadingBar.style.width = '0%';
  setTimeout(() => {
    loadingBar.style.transition = 'width 10s linear';
    loadingBar.style.width = '100%';
  }, 50);

  lastCycleTime = performance.now();
}

function spawnPokemonNearRoads(centerX, centerY) {
  if (!currentData) return;

  const w = currentData.width;
  const h = currentData.height;
  
  // Find all road tiles in a larger area around the player
  const roadTiles = [];
  const radius = 25; // Larger radius to populate the route ahead/behind
  const mx = Math.floor(centerX / MACRO_TILE_STRIDE);
  const my = Math.floor(centerY / MACRO_TILE_STRIDE);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const rx = mx + dx;
      const ry = my + dy;
      if (rx < 0 || rx >= w || ry < 0 || ry >= h) continue;
      const idx = ry * w + rx;
      if (currentData.roadTraffic[idx] > 0) {
        roadTiles.push({ x: rx, y: ry });
      }
    }
  }

  // Spawn a decent amount of pokemon along the roads
  const numToSpawn = 15 + Math.floor(Math.random() * 10);
  for (let i = 0; i < numToSpawn; i++) {
    let spawnX, spawnY;
    if (roadTiles.length > 0) {
      const road = roadTiles[Math.floor(Math.random() * roadTiles.length)];
      // Offset slightly to be "walking along" or "standing by" the road
      const offX = (Math.random() * 2 - 1) * 0.9;
      const offY = (Math.random() * 2 - 1) * 0.9;
      spawnX = road.x * MACRO_TILE_STRIDE + offX;
      spawnY = road.y * MACRO_TILE_STRIDE + offY;
    } else {
      // Fallback if no roads found (shouldn't happen on inter-city routes)
      spawnX = centerX + (Math.random() * 2 - 1) * 8;
      spawnY = centerY + (Math.random() * 2 - 1) * 8;
    }

    const bx = Math.floor(spawnX / MACRO_TILE_STRIDE);
    const by = Math.floor(spawnY / MACRO_TILE_STRIDE);
    if (bx < 0 || bx >= w || by < 0 || by >= h) continue;

    const bId = currentData.biomes[by * w + bx];
    const pool = getEncounters(bId);
    if (pool && pool.length > 0) {
      const species = pool[Math.floor(Math.random() * pool.length)];
      const dex = encounterNameToDex(species);
      if (dex) {
        summonDebugWildPokemon(dex, currentData, spawnX, spawnY);
      }
    }
  }
}

function spawnPokemonInCities() {
  // NO OP: User requested no inner-city entities in the splash background
  return;
}

function updateFakePlayer(dt) {
  if (!window.fakePlayer) return;
  const p = window.fakePlayer;
  
  // Use path following if a path was selected (inter-city routes)
  if (p.selectedPath && p.selectedPath.length > 0) {
    const targetPt = p.selectedPath[p.pathIndex];
    const tx = targetPt.x * MACRO_TILE_STRIDE;
    const ty = targetPt.y * MACRO_TILE_STRIDE;
    
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dist = Math.hypot(dx, dy);
    
    if (dist < 0.15) {
      // Reached waypoint, advance to next
      p.pathIndex += p.pathDirection;
      
      // Ping-pong at ends
      if (p.pathIndex < 0 || p.pathIndex >= p.selectedPath.length) {
        p.pathDirection *= -1;
        p.pathIndex += p.pathDirection * 2;
        p.pathIndex = Math.max(0, Math.min(p.selectedPath.length - 1, p.pathIndex));
      }
    } else {
      const walkSpeed = 1.8;
      const vx = (dx / dist) * walkSpeed;
      const vy = (dy / dist) * walkSpeed;
      
      p.x += vx * dt;
      p.y += vy * dt;
      p.visualX = p.x;
      p.visualY = p.y;
      
      p.facing = getFacingFromAngle(Math.atan2(vy, vx));
      p.animMoving = true;
      p._walkPhase += dt * 60;
    }
    
    advanceWildPokemonAnim(p, dt);
    return;
  }

  // Fallback: simple random wander (legacy behavior)
  p._wanderTimer -= dt;
  if (p._wanderTimer <= 0) {
    p._wanderTimer = 2 + Math.random() * 3;
    p._wanderAngle = Math.random() * Math.PI * 2;
    p.animMoving = Math.random() > 0.3;
  }

  if (p.animMoving) {
    const speed = 1.5;
    const vx = Math.cos(p._wanderAngle) * speed;
    const vy = Math.sin(p._wanderAngle) * speed;
    
    p.x += vx * dt;
    p.y += vy * dt;
    p.visualX = p.x;
    p.visualY = p.y;

    const deg = (p._wanderAngle * 180) / Math.PI;
    const normalized = (deg + 360 + 22.5) % 360;
    const index = Math.floor(normalized / 45);
    const dirs = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
    p.facing = dirs[index];
    
    p._walkPhase += dt * 60;
    advanceWildPokemonAnim(p, dt);
  } else {
    p.animFrame = 0;
    advanceWildPokemonAnim(p, dt);
  }
}

function loop(t) {
  const dt = (t - (window._lastT || t)) / 1000;
  window._lastT = t;
  gameTime += dt;

  if (!currentData) {
    requestAnimationFrame(loop);
    return;
  }

  if (t - lastCycleTime > CYCLE_INTERVAL) {
    cycleBiome();
  }

  updateFakePlayer(dt);
  tickWeather(dt, gameTime);
  tickEarthquakeLayer(dt, gameTime);
  
  // Update pokemon
  updateWildPokemon(dt, currentData, window.fakePlayer.x, window.fakePlayer.y);

  const weather = getActiveWeatherParams();
  const weatherTarget = getWeatherTarget();

  const settings = {
    viewType: 'terrain',
    appMode: 'play',
    player: window.fakePlayer,
    time: gameTime,
    dayPhase: 'Day',
    worldHours: 12,
    dayCycleTint: { r: 255, g: 255, b: 255 },
    weatherPreset: weatherTarget.preset,
    weatherCloudIntensity01: weatherTarget.cloudIntensity01,
    weatherPrecipIntensity01: weatherTarget.precipIntensity01,
    weatherCloudPresence: weather.cloudPresence,
    weatherCloudThreshold: weather.cloudThreshold,
    weatherCloudMinMul: weather.cloudMinMul,
    weatherCloudMaxMul: weather.cloudMaxMul,
    weatherCloudAlphaMul: weather.cloudAlphaMul,
    weatherRainIntensity: weather.rainIntensity,
    weatherScreenTint: weather.screenTint,
    weatherWindIntensity: getWindFeltIntensity(),
    weatherWindDirRad: getWindDirectionRad(),
    weatherEarthquakeIntensity: 0,
    weatherVolumetricMode: weather.weatherMode,
    weatherVolumetricParticleDensity: weather.volumetricParticleDensity,
    weatherVolumetricVolumeDepth: weather.volumetricVolumeDepth,
    weatherVolumetricFallSpeed: weather.volumetricFallSpeed,
    weatherVolumetricWindCarry: weather.volumetricWindCarry,
    weatherVolumetricTurbulence: weather.volumetricTurbulence,
    weatherVolumetricAbsorptionBias: weather.volumetricAbsorptionBias,
    weatherVolumetricSplashBias: weather.volumetricSplashBias
  };

  render(canvas, currentData, { settings });

  requestAnimationFrame(loop);
}

// Event Listeners
pressStart.addEventListener('click', () => {
  mainMenu.classList.add('transitioning');
  setTimeout(() => {
    window.location.href = 'play.html';
  }, 1000);
});

document.getElementById('play-btn').addEventListener('click', () => {
  window.location.href = 'play.html';
});

// Resize canvas
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

init();
