import { getBiome, BIOMES } from './biomes.js';
import { seededHash } from './tessellation-logic.js';

export const CHUNK_SIZE = 16;
export const LAND_STEPS = 32;  // 14 degraus acima do nível do mar
export const WATER_STEPS = 5;  // 5 degraus abaixo do nível do mar
export const SEA_LEVEL = 0.3;
export const BEACH_UPPER = 0.32;

function lerp(a, b, t) {
    return a * (1 - t) + b * t;
}

function getMacroVal(grid, x, y, width, height) {
    const clampX = Math.max(0, Math.min(width - 1, x));
    const clampY = Math.max(0, Math.min(height - 1, y));
    return grid[clampY * width + clampX];
}

/**
 * Converte elevação contínua em degrau discreto.
 * Abaixo de SEA_LEVEL: retorna -1..-WATER_STEPS (mais negativo = mais fundo)
 * Beach: retorna 0
 * Acima: retorna 1..LAND_STEPS
 */
export function elevationToStep(e) {
    if (e < SEA_LEVEL) {
        // Mapeia 0..SEA_LEVEL para -WATER_STEPS..-1
        const t = e / SEA_LEVEL; // 0..1
        return -WATER_STEPS + Math.floor(t * WATER_STEPS);
    }
    if (e < BEACH_UPPER) return 0; // Praia
    // Mapeia BEACH_UPPER..1.0 para 1..LAND_STEPS
    const t = (e - BEACH_UPPER) / (1.0 - BEACH_UPPER);
    return Math.min(LAND_STEPS, 1 + Math.floor(t * LAND_STEPS));
}

/**
 * Função Dinâmica e Determinística para gerar um Micro-Tile na hora.
 * NUNCA salva estado na memória. Usa a interpolação do Macro-Grid para computar infinito.
 */
export function getMicroTile(mx, my, macroData) {
    const { width, height, cells, temperature, moisture, anomaly, seed, config } = macroData;

    // Interpolação Bilinear: Os centros macro ficam alinhados aos múltiplos de CHUNK_SIZE
    const gx = mx / CHUNK_SIZE;
    const gy = my / CHUNK_SIZE;

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const tx = gx - ix;
    const ty = gy - iy;

    // Smoothstep: Hermite interpolation for straighter height plateaus
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);

    // Linear factors for biomes to keep them slightly more organic
    const fx = tx;
    const fy = ty;

    // Elevation
    const e00 = getMacroVal(cells, ix, iy, width, height);
    const e10 = getMacroVal(cells, ix + 1, iy, width, height);
    const e01 = getMacroVal(cells, ix, iy + 1, width, height);
    const e11 = getMacroVal(cells, ix + 1, iy + 1, width, height);

    const eTop = lerp(e00, e10, sx);
    const eBot = lerp(e01, e11, sx);
    let e = lerp(eTop, eBot, sy);

    const noiseVal = (seededHash(mx, my, seed) - 0.5);

    // Umidade e Temperatura com ruído mínimo apenas para evitar linhas retas perfeitas
    const biomeNoise = noiseVal * 0.005;
    const m00 = getMacroVal(moisture, ix, iy, width, height);
    const m10 = getMacroVal(moisture, ix + 1, iy, width, height);
    const m01 = getMacroVal(moisture, ix, iy + 1, width, height);
    const m11 = getMacroVal(moisture, ix + 1, iy + 1, width, height);
    let m = lerp(lerp(m00, m10, fx), lerp(m01, m11, fx), fy) + biomeNoise;

    const t00 = getMacroVal(temperature, ix, iy, width, height);
    const t10 = getMacroVal(temperature, ix + 1, iy, width, height);
    const t01 = getMacroVal(temperature, ix, iy + 1, width, height);
    const t11 = getMacroVal(temperature, ix + 1, iy + 1, width, height);
    let t = lerp(lerp(t00, t10, fx), lerp(t01, t11, fx), fy) + biomeNoise;

    const organicX = Math.floor(mx / 4);
    const organicY = Math.floor(my / 4);
    const jitter4x4 = (seededHash(organicX, organicY, seed + 123) - 0.5) * 0.02;
    m += jitter4x4;
    t += jitter4x4;

    let biomeObj = getBiome(e, t, m);
    let bId = biomeObj.id;
    let isCity = false;
    let isRoad = false;
    let urbanBuilding = null;
    let roadFeature = null;
    let heightStep = elevationToStep(e);

    const macroCX = Math.floor(gx);
    const macroCY = Math.floor(gy);

    if (macroCX >= 0 && macroCX < width && macroCY >= 0 && macroCY < height) {
        const macroIdx = macroCY * width + macroCX;
        const macroBiomeId = macroData.biomes[macroIdx];

        // Se o bioma macro for um bioma "especial" (posicionado manualmente ou via regra especial), 
        // forçamos o micro-tile a respeitá-lo para evitar que suma no modo Play.
        const specialBiomes = [BIOMES.VOLCANO.id, BIOMES.ARCANE.id, BIOMES.GHOST_WOODS.id];
        if (specialBiomes.includes(macroBiomeId)) {
            bId = macroBiomeId;
        }

        if (macroData.graph) {
            // Verifica em um raio 3x3 de células macro para permitir que cidades vazem para chunks vizinhos (raio 45 tiles)
            for (let ny = macroCY - 3; ny <= macroCY + 3; ny++) {
                for (let nx = macroCX - 3; nx <= macroCX + 3; nx++) {
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    const city = macroData.graph.nodes.find(n => n.x === nx && n.y === ny);
                    if (city) {
                        const centerX = nx * CHUNK_SIZE + CHUNK_SIZE / 2;
                        const centerY = ny * CHUNK_SIZE + CHUNK_SIZE / 2;

                        const distSq = (mx - centerX) ** 2 + (my - centerY) ** 2;
                        const cityRadius = 45;

                        if (distSq < cityRadius * cityRadius) {
                            isCity = true;
                            bId = BIOMES.CITY.id;

                            const dx = mx - centerX;
                            const dy = my - centerY;

                            // Building Layout (Deterministic)
                            // 1. PokéCenter (5x6) - Top Left (Keep near center)
                            if (dx >= -9 && dx < -4 && dy >= -9 && dy < -3) {
                                urbanBuilding = { type: 'urban-pokecenter [5x6]', ox: centerX - 9, oy: centerY - 9 };
                            }
                            // 2. PokéMart (4x5) - Top Right (Keep near center)
                            else if (dx >= 3 && dx < 7 && dy >= -8 && dy < -3) {
                                urbanBuilding = { type: 'urban-pokemart [4x5]', ox: centerX + 3, oy: centerY - 8 };
                            }
                            // 3. Grid of Houses (4x5 each)
                            else {
                                const gridX = Math.floor((dx + 60) / 6);
                                const gridY = Math.floor((dy + 60) / 8);
                                const hox = gridX * 6 - 60;
                                const hoy = gridY * 8 - 60;

                                const inCenterMartZone = dy < -2 && Math.abs(dx) < 14;
                                const inHorizontalStreet = dy >= -2 && dy < 2;
                                const inVerticalStreet = dx >= -2 && dx < 2;

                                if (!inCenterMartZone && !inHorizontalStreet && !inVerticalStreet && Math.abs(dx) < 42 && Math.abs(dy) < 42) {
                                    // Boundary Safety: Check if the entire house (4x5) fits in the city pavement
                                    const corners = [
                                        { x: hox, y: hoy },
                                        { x: hox + 4, y: hoy },
                                        { x: hox, y: hoy + 5 },
                                        { x: hox + 4, y: hoy + 5 }
                                    ];
                                    const allCornersIn = corners.every(c => (c.x**2 + c.y**2) < (cityRadius - 1)**2);

                                    if (allCornersIn) {
                                        const lDx = dx - hox;
                                        const lDy = dy - hoy;
                                        if (lDx >= 0 && lDx < 4 && lDy >= 0 && lDy < 5) {
                                            urbanBuilding = { type: 'urban-house-red [4x5]', ox: centerX + hox, oy: centerY + hoy };
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
                if (isCity) break;
            }
        }

        if (!isCity && macroData.roadTraffic && macroData.roadTraffic[macroIdx] > 0) {
            const localX = mx % CHUNK_SIZE;
            const localY = my % CHUNK_SIZE;

            const myMask = macroData.roadMasks ? macroData.roadMasks[macroIdx] : 0xFFFFFFFF;
            const getMask = (nx, ny) => (macroData.roadMasks ? macroData.roadMasks[ny * width + nx] : 0xFFFFFFFF);

            const hasPathN = macroCY > 0 && (myMask & getMask(macroCX, macroCY - 1)) !== 0;
            const hasPathS = macroCY < height - 1 && (myMask & getMask(macroCX, macroCY + 1)) !== 0;
            const hasPathE = macroCX < width - 1 && (myMask & getMask(macroCX + 1, macroCY)) !== 0;
            const hasPathW = macroCX > 0 && (myMask & getMask(macroCX - 1, macroCY)) !== 0;

            const inCenter = localX >= 6 && localX < 10 && localY >= 6 && localY < 10;
            const inN = hasPathN && localX >= 6 && localX < 10 && localY < 6;
            const inS = hasPathS && localX >= 6 && localX < 10 && localY >= 10;
            const inE = hasPathE && localY >= 6 && localY < 10 && localX >= 10;
            const inW = hasPathW && localY >= 6 && localY < 10 && localX < 6;

            if (inCenter || inN || inS || inE || inW) {
                isRoad = true;
                bId = BIOMES.BEACH.id;

                // Feature Detection: Bridges and Stairs
                if (e < SEA_LEVEL) {
                    roadFeature = 'wooden-bridge';

                    // Force bridge height to beach level (8) to avoid diving underwater
                    heightStep = 8;
                } else {
                    // Stair logic: Compare heightStep with neighbors
                    const eps = 0.5 / CHUNK_SIZE;
                    const getH = (dx, dy) => elevationToStep(lerp(lerp(e00, e10, sx + dx), lerp(e01, e11, sx + dx), sy + dy));
                    const h = heightStep;
                    const hW = getH(-eps, 0), hE = getH(eps, 0);
                    const hN = getH(0, -eps), hS = getH(0, eps);

                    if (hW < hE && (hasPathE || hasPathW)) roadFeature = 'stair-lr';
                    else if (hE < hW && (hasPathE || hasPathW)) roadFeature = 'stair-rl';
                    else if (hN < hS && (hasPathN || hasPathS)) roadFeature = 'stair-sn';
                    else if (hS < hN && (hasPathN || hasPathS)) roadFeature = 'stair-ns';
                }
            }
        }
    }

    // New Layered Terrain Data
    const fDensity = foliageDensity(mx, my, seed + 9992, 0.08); // FOLIAGE_NOISE_SCALE - Reduzido de 0.25 para blobs maiores
    const fType = seededHash(mx, my, seed + 9993);

    return {
        biomeId: bId,
        elevation: e,
        heightStep,
        isCity,
        isRoad,
        urbanBuilding,
        roadFeature,
        foliageDensity: fDensity,
        foliageType: fType
    };
}

export function foliageDensity(mx, my, seed, scale) {
    const gx = mx * scale;
    const gy = my * scale;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const tx = gx - ix;
    const ty = gy - iy;

    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);

    const v00 = seededHash(ix, iy, seed + 7777);
    const v10 = seededHash(ix + 1, iy, seed + 7777);
    const v01 = seededHash(ix, iy + 1, seed + 7777);
    const v11 = seededHash(ix + 1, iy + 1, seed + 7777);

    return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

export function foliageType(mx, my, seed) {
    return seededHash(mx, my, seed + 8888);
}
