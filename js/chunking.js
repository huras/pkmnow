import { getBiome, BIOMES } from './biomes.js';
import { seededHash } from './tessellation-logic.js';

export const CHUNK_SIZE = 16;
export const LAND_STEPS = 9;   // 9 degraus acima do nível do mar
export const WATER_STEPS = 5;  // 5 degraus abaixo do nível do mar
export const SEA_LEVEL = 0.3;
export const BEACH_UPPER = 0.35;

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
    const fx = gx - ix;
    const fy = gy - iy;
    
    // Elevacao
    const e00 = getMacroVal(cells, ix, iy, width, height);
    const e10 = getMacroVal(cells, ix + 1, iy, width, height);
    const e01 = getMacroVal(cells, ix, iy + 1, width, height);
    const e11 = getMacroVal(cells, ix + 1, iy + 1, width, height);
    
    const eTop = lerp(e00, e10, fx);
    const eBot = lerp(e01, e11, fx);
    let e = lerp(eTop, eBot, fy);
    
    // O grande truque orgânico: Reduzimos o jitter para zero (ou quase zero)
    // para manter o visual limpo e os platôs estáveis, usando apenas a interpolação macro.
    const noiseVal = (seededHash(mx, my, seed) - 0.5);
    const microNoise = noiseVal * 0.002; // Praticamente zero jitter
    e += microNoise;

    // Umidade e Temperatura com ruído mínimo apenas para evitar linhas retas perfeitas
    const biomeNoise = noiseVal * 0.005; 
    const m00 = getMacroVal(moisture, ix, iy, width, height);
    const m10 = getMacroVal(moisture, ix + 1, iy, width, height);
    const m01 = getMacroVal(moisture, ix, iy + 1, width, height);
    const m11 = getMacroVal(moisture, ix + 1, iy + 1, width, height);
    let m = lerp(lerp(m00, m10, fx), lerp(m01, m11, fx), fy) + biomeNoise;

    // Temperatura
    const t00 = getMacroVal(temperature, ix, iy, width, height);
    const t10 = getMacroVal(temperature, ix + 1, iy, width, height);
    const t01 = getMacroVal(temperature, ix, iy + 1, width, height);
    const t11 = getMacroVal(temperature, ix + 1, iy + 1, width, height);
    let t = lerp(lerp(t00, t10, fx), lerp(t01, t11, fx), fy) + biomeNoise;
    
    // Para biomas, podemos opcionalmente usar um ruído de escala maior (ex: 4x4)
    // para que a borda mude de forma mais "bloco" e menos "pixel".
    const organicX = Math.floor(mx / 4);
    const organicY = Math.floor(my / 4);
    const jitter4x4 = (seededHash(organicX, organicY, seed + 123) - 0.5) * 0.02;
    m += jitter4x4;
    t += jitter4x4;
    
    let biomeObj = getBiome(e, t, m);
    let bId = biomeObj.id;

    // Stepped height
    const heightStep = elevationToStep(e);

    // ----- OVERRIDES DISCRETOS: Cidades e Caminhos -----
    const macroCX = Math.floor(mx / CHUNK_SIZE);
    const macroCY = Math.floor(my / CHUNK_SIZE);
    
    let isCity = false;
    let isRoad = false;

    if (macroCX >= 0 && macroCX < width && macroCY >= 0 && macroCY < height) {
        const macroIdx = macroCY * width + macroCX;
        
        if (macroData.graph) {
            const city = macroData.graph.nodes.find(n => n.x === macroCX && n.y === macroCY);
            if (city) {
                const localX = mx % CHUNK_SIZE;
                const localY = my % CHUNK_SIZE;
                if (localX >= 3 && localX < 13 && localY >= 3 && localY < 13) {
                    isCity = true;
                    bId = BIOMES.DESERT.id;
                }
            }
        }
        
        if (!isCity && macroData.roadTraffic && macroData.roadTraffic[macroIdx] > 0) {
            const localX = mx % CHUNK_SIZE;
            const localY = my % CHUNK_SIZE;
            
            const hasPathN = macroCY>0 && macroData.roadTraffic[(macroCY-1)*width + macroCX] > 0;
            const hasPathS = macroCY<height-1 && macroData.roadTraffic[(macroCY+1)*width + macroCX] > 0;
            const hasPathE = macroCX<width-1 && macroData.roadTraffic[macroCY*width + macroCX+1] > 0;
            const hasPathW = macroCX>0 && macroData.roadTraffic[macroCY*width + macroCX-1] > 0;

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
        isRoad
    };
}

/**
 * Ruído de densidade de folhagem para um ponto micro.
 * Retorna 0.0 .. 1.0. Usado para decidir se colocar grama/árvore.
 */
export function foliageDensity(mx, my, seed, scale) {
    return seededHash(mx * scale | 0, my * scale | 0, seed + 7777);
}

/**
 * Ruído de tipo de folhagem para um ponto micro.
 * Retorna 0.0 .. 1.0. Usado para escolher QUAL grama/árvore.
 */
export function foliageType(mx, my, seed) {
    return seededHash(mx, my, seed + 8888);
}
