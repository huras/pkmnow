import {
  getBiome,
  getBiomeWithAnomalies,
  BIOMES,
  resolveWaterLevel,
  BEACH_ELEVATION_BAND
} from './biomes.js';
import { seededHash } from './tessellation-logic.js';

/** Play (micro) tiles per generator macro cell: terrain sampling, world bounds, minimap grid. */
export const MACRO_TILE_STRIDE = 18;
export const LAND_STEPS = 12;  // 14 degraus acima do nível do mar
export const WATER_STEPS = 5;  // 5 degraus abaixo do nível do mar

function lerp(a, b, t) {
    return a * (1 - t) + b * t;
}

function getMacroVal(grid, x, y, width, height) {
    const clampX = Math.max(0, Math.min(width - 1, x));
    const clampY = Math.max(0, Math.min(height - 1, y));
    return grid[clampY * width + clampX];
}

/**
 * Converte elevação contínua em degrau discreto (alinhado a `getBiome`: `waterLevel` + `BEACH_ELEVATION_BAND`).
 * Abaixo de `waterLevel`: -WATER_STEPS..-1 (mais negativo = mais fundo)
 * Faixa de praia [waterLevel, waterLevel + BEACH_ELEVATION_BAND): 0
 * Acima: 1..LAND_STEPS
 * @param {number} e — elevação 0..1
 * @param {number} [waterLevel] — nível do mar (0..1); se omitido, usa o mesmo fallback que `resolveWaterLevel({})`
 */
export function elevationToStep(e, waterLevel) {
    const wl = waterLevel !== undefined && waterLevel !== null ? Number(waterLevel) : resolveWaterLevel({});
    const w = Number.isFinite(wl) ? Math.max(1e-4, Math.min(0.98, wl)) : resolveWaterLevel({});
    const beachUpper = w + BEACH_ELEVATION_BAND;

    if (e < w) {
        const t = Math.min(1, Math.max(0, e / w));
        return -WATER_STEPS + Math.floor(t * WATER_STEPS);
    }
    if (e < beachUpper) return 0;
    const landLo = beachUpper;
    const denom = 1.0 - landLo;
    if (denom <= 1e-6) return LAND_STEPS;
    const t = (e - landLo) / denom;
    return Math.min(LAND_STEPS, 1 + Math.floor(t * LAND_STEPS));
}

/**
 * Funcao auxiliar para pegar apenas a altura de um micro-tile sem recursao.
 */
export function getHeightStepAt(mx, my, macroData) {
    const { width, height, cells, config } = macroData;
    const waterLevel = resolveWaterLevel(config || {});
    const gx = mx / MACRO_TILE_STRIDE;
    const gy = my / MACRO_TILE_STRIDE;
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
    return elevationToStep(e, waterLevel);
}

/**
 * Função Dinâmica e Determinística para gerar um Micro-Tile na hora.
 * NUNCA salva estado na memória. Usa a interpolação do Macro-Grid para computar infinito.
 */
export function getMicroTile(mx, my, macroData) {
    const { width, height, cells, temperature, moisture, anomaly, seed, config } = macroData;
    const waterLevel = resolveWaterLevel(config || {});

    // Interpolação Bilinear: Os centros macro ficam alinhados aos múltiplos de MACRO_TILE_STRIDE
    const gx = mx / MACRO_TILE_STRIDE;
    const gy = my / MACRO_TILE_STRIDE;

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
    let heightStep = elevationToStep(e, waterLevel);

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
            // Road corridor in local micro-tiles: centered on the macro cell, widths match the old stride-16
            // layout (4-tile spine + 1-tile pad). Fine for current MACRO_TILE_STRIDE; revisit if we want a
            // wider spine proportional to stride (e.g. floor(stride / 8)) for huge macro cells.
            const stride = MACRO_TILE_STRIDE;
            const localX = mx % stride;
            const localY = my % stride;
            /** Road spine half-width in micro-tiles (4-wide at stride 16: was [6,10)). Scales with stride. */
            const roadHalfInner = 2;
            const roadC = Math.floor(stride / 2);
            const roadInnerLo = roadC - roadHalfInner;
            const roadInnerHi = roadC + roadHalfInner;
            /** One tile wider band for elevation relief (was [5,11) at stride 16). */
            const roadPadLo = roadInnerLo - 1;
            const roadPadHi = roadInnerHi + 1;

            const myMask = macroData.roadMasks ? macroData.roadMasks[macroIdx] : 0xFFFFFFFF;
            const getMask = (nx, ny) => (macroData.roadMasks ? macroData.roadMasks[ny * width + nx] : 0xFFFFFFFF);

            const hasPathN = macroCY > 0 && (myMask & getMask(macroCX, macroCY - 1)) !== 0;
            const hasPathS = macroCY < height - 1 && (myMask & getMask(macroCX, macroCY + 1)) !== 0;
            const hasPathE = macroCX < width - 1 && (myMask & getMask(macroCX + 1, macroCY)) !== 0;
            const hasPathW = macroCX > 0 && (myMask & getMask(macroCX - 1, macroCY)) !== 0;

            const inCenter =
                localX >= roadInnerLo && localX < roadInnerHi && localY >= roadInnerLo && localY < roadInnerHi;
            const inN = hasPathN && localX >= roadInnerLo && localX < roadInnerHi && localY < roadInnerLo;
            const inS = hasPathS && localX >= roadInnerLo && localX < roadInnerHi && localY >= roadInnerHi;
            const inE = hasPathE && localY >= roadInnerLo && localY < roadInnerHi && localX >= roadInnerHi;
            const inW = hasPathW && localY >= roadInnerLo && localY < roadInnerHi && localX < roadInnerLo;

            const nlx_raw = ((mx % stride) + stride) % stride;
            const nly_raw = ((my % stride) + stride) % stride;

            const inCenterPadding =
                nlx_raw >= roadPadLo && nlx_raw < roadPadHi && nly_raw >= roadPadLo && nly_raw < roadPadHi;
            const inNPadding = hasPathN && nlx_raw >= roadPadLo && nlx_raw < roadPadHi && nly_raw < roadInnerLo;
            const inSPadding = hasPathS && nlx_raw >= roadPadLo && nlx_raw < roadPadHi && nly_raw >= roadInnerHi;
            const inEPadding = hasPathE && nly_raw >= roadPadLo && nly_raw < roadPadHi && nlx_raw >= roadInnerHi;
            const inWPadding = hasPathW && nly_raw >= roadPadLo && nly_raw < roadPadHi && nlx_raw < roadInnerLo;

            const isVerticalRoadArea = (hasPathN || hasPathS) && !hasPathE && !hasPathW;
            const isHorizontalRoadArea = (hasPathE || hasPathW) && !hasPathN && !hasPathS;

            if (inCenterPadding || inNPadding || inSPadding || inEPadding || inWPadding || isRoad) {
                // Determine stair feature BEFORE choosing snapped elevation to avoid 
                // road-straightening from "hiding" height plateaus

                // Stair detection needs axis-locking (to stay straight) but not full-snapping
                const getH_Axis = (dx, dy, axisLockX, axisLockY) => {
                    const nmx = mx + dx, nmy = my + dy;
                    const ntx = tx + dx / MACRO_TILE_STRIDE;
                    const nty = ty + dy / MACRO_TILE_STRIDE;
                    const nsx = ntx * ntx * (3 - 2 * ntx);
                    const nsy = nty * nty * (3 - 2 * nty);

                    let nx = nsx, ny = nsy;
                    if (axisLockX) nx = 0.5;
                    if (axisLockY) ny = 0.5;

                    return elevationToStep(lerp(lerp(e00, e10, nx), lerp(e01, e11, nx), ny), waterLevel);
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
                heightStep = elevationToStep(e, waterLevel);
            }

            if (inCenter || inN || inS || inE || inW) {
                isRoad = true;

                if (isCity) {
                    bId = isTown ? BIOMES.TOWN_STREET.id : BIOMES.CITY_STREET.id;
                } else {
                    bId = BIOMES.BEACH.id;
                }

                // Feature Detection: Bridges remain (Stairs already handled above)
                if (e < waterLevel) {
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
