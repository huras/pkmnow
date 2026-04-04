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

    // Altura baseada no step (0.38, 0.44, 0.50, etc)
    const heightStep = elevationToStep(e);

    const macroCX = Math.floor(gx);
    const macroCY = Math.floor(gy);

    if (macroCX >= 0 && macroCX < width && macroCY >= 0 && macroCY < height) {
        const macroIdx = macroCY * width + macroCX;

        if (macroData.graph) {
            // Verifica em um raio 1x1 de células macro para permitir que cidades vazem para chunks vizinhos
            for (let ny = macroCY - 1; ny <= macroCY + 1; ny++) {
                for (let nx = macroCX - 1; nx <= macroCX + 1; nx++) {
                    const city = macroData.graph.nodes.find(n => n.x === nx && n.y === ny);
                    if (city) {
                        const centerX = nx * CHUNK_SIZE + CHUNK_SIZE / 2;
                        const centerY = ny * CHUNK_SIZE + CHUNK_SIZE / 2;

                        if (Math.abs(mx - centerX) < 11 && Math.abs(my - centerY) < 11) {
                            isCity = true;
                            bId = BIOMES.CITY.id;

                            const dx = mx - centerX;
                            const dy = my - centerY;

                            // 1. PokéCenter (5x6)
                            if (dx >= -8 && dx < -3 && dy >= -8 && dy < -2) {
                                urbanBuilding = { type: 'urban-pokecenter [5x6]', ox: centerX - 8, oy: centerY - 8 };
                            }
                            // 2. PokéMart (4x5)
                            else if (dx >= 2 && dx < 6 && dy >= -7 && dy < -2) {
                                urbanBuilding = { type: 'urban-pokemart [4x5]', ox: centerX + 2, oy: centerY - 7 };
                            }
                            // 3. House (4x5)
                            else if (dx >= -7 && dx < -3 && dy >= 2 && dy < 7) {
                                urbanBuilding = { type: 'urban-house-red [4x5]', ox: centerX - 7, oy: centerY + 2 };
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
            }
        }
    }

    return {
        biomeId: bId,
        elevation: e,
        heightStep,
        isCity,
        isRoad,
        urbanBuilding
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
