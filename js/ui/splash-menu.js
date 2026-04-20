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
import {
  applyI18nDom,
  getBiomeNameById,
  getLocale,
  getSupportedLocales,
  initI18n,
  onLocaleChanged,
  setLocale
} from '../i18n/index.js';

const canvas = document.getElementById('background-canvas');
const splashContainer = document.getElementById('splash-container');
const mainMenu = document.getElementById('main-menu');
const pressStart = document.getElementById('press-start');
const loadingBar = document.getElementById('loading-bar');
const biomeNameEl = document.getElementById('biome-name');
const biomeSwatchEl = document.getElementById('biome-swatch');
const biomeInfoEl = document.getElementById('biome-info');
const splashLanguageSelect = /** @type {HTMLSelectElement | null} */ (
  document.getElementById('splash-language-select')
);

let currentData = null;
let gameTime = 0;
let lastCycleTime = 0;
let trackedPokemon = null;
const CYCLE_INTERVAL = 14000; // 14 seconds for better observation

const CONFIG = {
  ...DEFAULT_CONFIG,
  cityCount: 5, // Simpler map for background
};

function refreshCurrentBiomeLabel() {
  if (!currentData || !window.fakePlayer) return;
  const bx = Math.floor(window.fakePlayer.x / MACRO_TILE_STRIDE);
  const by = Math.floor(window.fakePlayer.y / MACRO_TILE_STRIDE);
  if (bx < 0 || by < 0 || bx >= currentData.width || by >= currentData.height) return;
  const biomeId = currentData.biomes[by * currentData.width + bx];
  biomeNameEl.textContent = getBiomeNameById(biomeId);
}

function syncSplashLanguageSelect() {
  if (!splashLanguageSelect) return;
  splashLanguageSelect.textContent = '';
  const labels = {
    'pt-BR': 'Portugues (BR)',
    'en-US': 'English (US)',
    'ja-JP': '日本語'
  };
  for (const locale of getSupportedLocales()) {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = labels[locale] || locale;
    splashLanguageSelect.appendChild(option);
  }
  splashLanguageSelect.value = getLocale();
}

async function init() {
  initI18n();
  applyI18nDom(document);
  syncSplashLanguageSelect();
  splashLanguageSelect?.addEventListener('change', () => {
    setLocale(splashLanguageSelect.value);
  });
  onLocaleChanged(() => {
    applyI18nDom(document);
    syncSplashLanguageSelect();
    refreshCurrentBiomeLabel();
  });
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
  
  // Pick a random road tile from the whole map
  const roadTiles = [];
  for (let i = 0; i < currentData.roadTraffic.length; i++) {
    if (currentData.roadTraffic[i] > 0) {
      roadTiles.push({
        x: i % currentData.width,
        y: Math.floor(i / currentData.width)
      });
    }
  }

  let spawnX, spawnY;
  if (roadTiles.length > 0) {
    const road = roadTiles[Math.floor(Math.random() * roadTiles.length)];
    spawnX = road.x * MACRO_TILE_STRIDE + 0.5;
    spawnY = road.y * MACRO_TILE_STRIDE + 0.5;
  } else {
    spawnX = currentData.width * MACRO_TILE_STRIDE / 2;
    spawnY = currentData.height * MACRO_TILE_STRIDE / 2;
  }

  // Initial spawn around this point to have candidates
  spawnPokemonNearRoads(spawnX, spawnY);
  
  const entities = getWildPokemonEntities();
  if (entities.length > 0) {
    trackedPokemon = entities[Math.floor(Math.random() * entities.length)];
  } else {
    trackedPokemon = null;
  }

  const targetX = trackedPokemon ? trackedPokemon.x : spawnX;
  const targetY = trackedPokemon ? trackedPokemon.y : spawnY;
  const bId = currentData.biomes[Math.floor(targetY / MACRO_TILE_STRIDE) * currentData.width + Math.floor(targetX / MACRO_TILE_STRIDE)];

  // Spawn some random pokemon near the selected route or roads
  spawnPokemonNearRoads(targetX, targetY);
  // spawnPokemonInCities(); // REMOVED: User requested no inner-city entities

  // Update biome info UI
  const bio = Object.values(BIOMES).find(b => b.id === bId);
  if (bio) {
    biomeNameEl.textContent = getBiomeNameById(bio.id);
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

// updateFakePlayer REMOVED: Camera now follows wild pokemon directly.

function loop(t) {
  const dt = (t - (window._lastT || t)) / 1000;
  window._lastT = t;
  gameTime += dt;

  if (!currentData) {
    requestAnimationFrame(loop);
    return;
  }

  if (t - lastCycleTime > CYCLE_INTERVAL || (trackedPokemon && trackedPokemon.isDespawning)) {
    cycleBiome();
  }

  const focusX = trackedPokemon ? trackedPokemon.x : (currentData.width * MACRO_TILE_STRIDE / 2);
  const focusY = trackedPokemon ? trackedPokemon.y : (currentData.height * MACRO_TILE_STRIDE / 2);

  tickWeather(dt, gameTime);
  tickEarthquakeLayer(dt, gameTime);
  
  // Update pokemon around the focus point, but ignore player reactions (to allow normal wild behavior)
  updateWildPokemon(dt, currentData, focusX, focusY, { ignorePlayer: true });

  const weather = getActiveWeatherParams();
  const weatherTarget = getWeatherTarget();

  const settings = {
    viewType: 'terrain',
    appMode: 'play',
    player: trackedPokemon ? {
      ...trackedPokemon,
      visualX: trackedPokemon.visualX ?? trackedPokemon.x,
      visualY: trackedPokemon.visualY ?? trackedPokemon.y,
      z: trackedPokemon.z ?? 0,
      grounded: true,
      animMoving: true
    } : { x: focusX, y: focusY, z: 0 },
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
