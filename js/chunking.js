import { getBiome, getBiomeWithAnomalies, BIOMES } from './biomes.js';
import { seededHash } from './tessellation-logic.js';

export const CHUNK_SIZE = 16;
export const LAND_STEPS = 12;  // 14 degraus acima do nível do mar
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
 * Funcao auxiliar para pegar apenas a altura de um micro-tile sem recursao.
 */
export function getHeightStepAt(mx, my, macroData) {
    const { width, height, cells } = macroData;
    const gx = mx / CHUNK_SIZE;
    const gy = my / CHUNK_SIZE;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const tx = gx - ix;
    const ty = gy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);

    const e00 = getMacroVal(cells, ix, iy, width, height);
    const e10 = getMacroVal(cells, ix + 1, iy, width, height);
    const e01 = getMacroVal(cells, ix, iy + 1, width, height);
    const e11 = getMacroVal(cells, ix + 1, iy + 1, width, height);
    const e = lerp(lerp(e00, e10, sx), lerp(e01, e11, sx), sy);
    return elevationToStep(e);
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
    let heightStep = elevationToStep(e);

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

    const organicX = Math.floor(mx / 64);
    const organicY = Math.floor(my / 64);
    const jitter4x4 = (seededHash(organicX, organicY, seed + 123) - 0.5) * 0.02;
    m += jitter4x4;
    t += jitter4x4;

    // Organic edges: add jitter to interpolation coordinates (fx, fy) based on local noise
    const edgeNoiseScale = 0.15;
    const edgeJitterX = (seededHash(mx, my, seed + 555) - 0.5) * edgeNoiseScale;
    const edgeJitterY = (seededHash(mx, my, seed + 666) - 0.5) * edgeNoiseScale;
    const jfx = Math.max(0, Math.min(1, fx + edgeJitterX));
    const jfy = Math.max(0, Math.min(1, fy + edgeJitterY));

    // Anomaly (interpolated for organic special biomes)
    const a00 = getMacroVal(anomaly, ix, iy, width, height);
    const a10 = getMacroVal(anomaly, ix + 1, iy, width, height);
    const a01 = getMacroVal(anomaly, ix, iy + 1, width, height);
    const a11 = getMacroVal(anomaly, ix + 1, iy + 1, width, height);
    const a = lerp(lerp(a00, a10, jfx), lerp(a01, a11, jfx), jfy);

    let biomeObj = getBiomeWithAnomalies(e, t, m, a, config);
    let bId = biomeObj.id;
    let isCity = false;
    let isTown = false; // High scope
    let isRoad = false;
    let urbanBuilding = null;
    let roadFeature = null;

    const macroCX = Math.floor(gx);
    const macroCY = Math.floor(gy);

    if (macroCX >= 0 && macroCX < width && macroCY >= 0 && macroCY < height) {
        const macroIdx = macroCY * width + macroCX;
        const macroBiomeId = macroData.biomes[macroIdx];

        // Se o bioma macro for um bioma "especial" (posicionado manualmente ou via regra especial), 
        // nós deixamos a resolução orgânica acima (getBiomeWithAnomalies) cuidar disso, 
        // pois ela agora usa o ruído de anomalia interpolado.

        // ── City detection via pre-computed cityData (O(1) Set lookups) ──
        if (macroData.cityData) {
            const tileKey = `${mx},${my}`;
            const cd = macroData.cityData;

            if (cd.footprintSet.has(tileKey)) {
                isCity = true;

                // Find which layout this tile belongs to (for isTown / building lookup)
                // Use fast distance check against layouts
                let matchedLayout = null;
                for (const layout of cd.layouts) {
                    const ddx = mx - layout.cx, ddy = my - layout.cy;
                    if (ddx * ddx + ddy * ddy <= layout.radius * layout.radius) {
                        matchedLayout = layout;
                        break;
                    }
                }

                if (matchedLayout) {
                    isTown = matchedLayout.isTown;

                    // Terracing: override elevation to city's dominant height
                    heightStep = matchedLayout.dominantHeight;
                    e = 0.5; // Neutral land elevation (avoids water)

                    // Building detection
                    if (cd.buildingFootprintSet.has(tileKey)) {
                        // Check which building this tile is part of
                        const poke = matchedLayout.poke;
                        const mart = matchedLayout.mart;

                        if (mx >= poke.ox && mx < poke.ox + 5 && my >= poke.oy && my < poke.oy + 6) {
                            urbanBuilding = { type: 'pokecenter', ox: poke.ox, oy: poke.oy };
                        } else if (mx >= mart.ox && mx < mart.ox + 4 && my >= mart.oy && my < mart.oy + 5) {
                            urbanBuilding = { type: 'pokemart', ox: mart.ox, oy: mart.oy };
                        } else {
                            for (const house of matchedLayout.houses) {
                                if (mx >= house.ox && mx < house.ox + 4 && my >= house.oy && my < house.oy + 5) {
                                    urbanBuilding = { type: 'house', ox: house.ox, oy: house.oy, variantIndex: house.variantIndex };
                                    break;
                                }
                            }
                        }
                    }

                    // Inner-city path vs general city ground biome
                    const isPathTile = cd.pathTilesSet.has(tileKey);
                    const dx = mx - matchedLayout.cx;
                    const dy = my - matchedLayout.cy;
                    const inMainStreetH = dy >= -2 && dy < 2;
                    const inMainStreetV = dx >= -2 && dx < 2;

                    if (urbanBuilding) {
                        bId = isTown ? BIOMES.TOWN.id : BIOMES.CITY.id;
                    } else if (isPathTile || inMainStreetH || inMainStreetV) {
                        bId = isTown ? BIOMES.TOWN_STREET.id : BIOMES.CITY_STREET.id;
                    } else {
                        bId = isTown ? BIOMES.TOWN.id : BIOMES.CITY.id;
                    }
                }
            } else {
                // Terracing around city edges: clamp height smoothly
                // Check if near any city layout (within terracing radius)
                for (const layout of cd.layouts) {
                    const ddx = mx - layout.cx, ddy = my - layout.cy;
                    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
                    const terraceRadius = layout.radius + 20;
                    if (dist <= terraceRadius && dist > layout.radius) {
                        const distFromEdge = dist - layout.radius;
                        const maxDelta = Math.floor(distFromEdge / 6);
                        const maxH = layout.dominantHeight + maxDelta;
                        const minH = Math.max(1, layout.dominantHeight - maxDelta);
                        if (heightStep > maxH) heightStep = maxH;
                        if (heightStep < minH && heightStep >= 1) heightStep = minH;
                        break;
                    }
                }
            }
        }

        if (macroData.roadTraffic && macroData.roadTraffic[macroIdx] > 0) {
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

            // --- ORTHOGONAL RELIEF STRAIGHTENING (5-10 range for padding) ---
            // --- ORTHOGONAL RELIEF STRAIGHTENING (5-10 range for padding) ---
            const nlx_raw = ((mx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const nly_raw = ((my % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

            const inCenterPadding = nlx_raw >= 5 && nlx_raw < 11 && nly_raw >= 5 && nly_raw < 11;
            const inNPadding = hasPathN && nlx_raw >= 5 && nlx_raw < 11 && nly_raw < 6;
            const inSPadding = hasPathS && nlx_raw >= 5 && nlx_raw < 11 && nly_raw >= 10;
            const inEPadding = hasPathE && nly_raw >= 5 && nly_raw < 11 && nlx_raw >= 10;
            const inWPadding = hasPathW && nly_raw >= 5 && nly_raw < 11 && nlx_raw < 6;

            const isVerticalRoadArea = (hasPathN || hasPathS) && !hasPathE && !hasPathW;
            const isHorizontalRoadArea = (hasPathE || hasPathW) && !hasPathN && !hasPathS;

            if (inCenterPadding || inNPadding || inSPadding || inEPadding || inWPadding || isRoad) {
                // Determine stair feature BEFORE choosing snapped elevation to avoid 
                // road-straightening from "hiding" height plateaus

                // Stair detection needs axis-locking (to stay straight) but not full-snapping
                const getH_Axis = (dx, dy, axisLockX, axisLockY) => {
                    const nmx = mx + dx, nmy = my + dy;
                    const ntx = tx + dx / CHUNK_SIZE;
                    const nty = ty + dy / CHUNK_SIZE;
                    const nsx = ntx * ntx * (3 - 2 * ntx);
                    const nsy = nty * nty * (3 - 2 * nty);

                    let nx = nsx, ny = nsy;
                    if (axisLockX) nx = 0.5;
                    if (axisLockY) ny = 0.5;

                    return elevationToStep(lerp(lerp(e00, e10, nx), lerp(e01, e11, nx), ny));
                };

                // 1. Horizontal Jumps (stair columns): lock Y to macro-center to keep the column straight
                const hCurW = getH_Axis(0, 0, false, true);
                const hW = getH_Axis(-1, 0, false, true);
                const hE = getH_Axis(1, 0, false, true);

                // 2. Vertical Jumps (stair rows): lock X to macro-center to keep the row straight
                const hCurN = getH_Axis(0, 0, true, false);
                const hN = getH_Axis(0, -1, true, false);
                const hS = getH_Axis(0, 1, true, false);

                if (hCurW > hE && (hasPathE || hasPathW)) roadFeature = 'stair-rl';
                else if (hCurW > hW && (hasPathE || hasPathW)) roadFeature = 'stair-lr';
                else if (hCurN > hS && (hasPathN || hasPathS)) roadFeature = 'stair-ns';
                else if (hCurN > hN && (hasPathN || hasPathS)) roadFeature = 'stair-sn';

                // Final Elevation Application: 
                // Flatten road ONLY if no stair is bridging the gap here.
                if (roadFeature) {
                    // Stair is present: follow the slope straight along the road axis
                    if (isVerticalRoadArea || roadFeature.includes('-ns') || roadFeature.includes('-sn')) {
                        // vertical road or vertical stair (NS step)
                        e = lerp(lerp(e00, e10, 0.5), lerp(e01, e11, 0.5), sy);
                    } else if (isHorizontalRoadArea || roadFeature.includes('-lr') || roadFeature.includes('-rl')) {
                        // horizontal road or horizontal stair (EW step)
                        e = lerp(lerp(e00, e10, sx), lerp(e01, e11, sx), 0.5);
                    } else {
                        // Crossroads/Transition: follow slope to be safe
                        e = lerp(lerp(e00, e10, sx), lerp(e01, e11, sx), sy);
                    }
                } else {
                    // Normal road: snap to perfectly flat terrace
                    if (isVerticalRoadArea) { e = lerp(lerp(e00, e10, 0.5), lerp(e01, e11, 0.5), sy); }
                    else if (isHorizontalRoadArea) { e = lerp(lerp(e00, e10, sx), lerp(e01, e11, sx), 0.5); }
                    else if (inCenterPadding) { e = lerp(lerp(e00, e10, 0.5), lerp(e01, e11, 0.5), 0.5); }
                }
                heightStep = elevationToStep(e);
            }

            if (inCenter || inN || inS || inE || inW) {
                isRoad = true;

                if (isCity) {
                    bId = isTown ? BIOMES.TOWN_STREET.id : BIOMES.CITY_STREET.id;
                } else {
                    bId = BIOMES.BEACH.id;
                }

                // Feature Detection: Bridges remain (Stairs already handled above)
                if (e < SEA_LEVEL) {
                    roadFeature = 'wooden-bridge';
                    heightStep = 8;
                }
            }

        }
    }

    // New Layered Terrain Data
    const fDensity = foliageDensity(mx, my, seed + 9992, 0.08); // Restaurado para 0.08
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
