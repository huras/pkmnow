import { getBiome, BIOMES } from './biomes.js';
import { seededHash } from './tessellation-logic.js';

export const CHUNK_SIZE = 16;

function lerp(a, b, t) {
  const ft = t * Math.PI;
  const f = (1 - Math.cos(ft)) * 0.5;
  return a * (1 - f) + b * f;
}

function getMacroVal(grid, x, y, width, height) {
    const clampX = Math.max(0, Math.min(width - 1, x));
    const clampY = Math.max(0, Math.min(height - 1, y));
    return grid[clampY * width + clampX];
}

/**
 * Função Dinâmica e Determinística para gerar um Micro-Tile na hora.
 * NUNCA salva estado na memória. Usa a interpolação do Macro-Grid para computar infinito.
 */
export function getMicroTile(mx, my, macroData) {
    const { width, height, cells, temperature, moisture, anomaly, seed } = macroData;
    
    // Interpolação Bilinear: Os centros macro ficam deslocados CHUNK_SIZE/2
    const gx = (mx - CHUNK_SIZE / 2) / CHUNK_SIZE;
    const gy = (my - CHUNK_SIZE / 2) / CHUNK_SIZE;
    
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
    
    // O grande truque orgânico: Ruído na borda do Micro-Grid para fragmentá-la
    const microNoise = (seededHash(mx, my, seed) - 0.5) * 0.08; 
    e += microNoise;

    // Umidade
    const m00 = getMacroVal(moisture, ix, iy, width, height);
    const m10 = getMacroVal(moisture, ix + 1, iy, width, height);
    const m01 = getMacroVal(moisture, ix, iy + 1, width, height);
    const m11 = getMacroVal(moisture, ix + 1, iy + 1, width, height);
    let m = lerp(lerp(m00, m10, fx), lerp(m01, m11, fx), fy) + microNoise * 0.5;

    // Temperatura
    const t00 = getMacroVal(temperature, ix, iy, width, height);
    const t10 = getMacroVal(temperature, ix + 1, iy, width, height);
    const t01 = getMacroVal(temperature, ix, iy + 1, width, height);
    const t11 = getMacroVal(temperature, ix + 1, iy + 1, width, height);
    let t = lerp(lerp(t00, t10, fx), lerp(t01, t11, fx), fy) + microNoise * 0.5;
    
    let biomeObj = getBiome(e, t, m);
    let bId = biomeObj.id;

    // ----- OVERS RIDES DISCRETOS: Cidades e Caminhos -----
    const macroCX = Math.floor(mx / CHUNK_SIZE);
    const macroCY = Math.floor(my / CHUNK_SIZE);
    
    if (macroCX >= 0 && macroCX < width && macroCY >= 0 && macroCY < height) {
        const macroIdx = macroCY * width + macroCX;
        
        let isCity = false;
        if (macroData.graph) {
            // Buscando O(N) nas cidades é meio custoso por pixel. 
            // O ideal é passarmos um array de tipo `cityArea`, mas para o MVP dinâmico faremos aqui:
            const city = macroData.graph.nodes.find(n => n.x === macroCX && n.y === macroCY);
            if (city) {
                const localX = mx % CHUNK_SIZE;
                const localY = my % CHUNK_SIZE;
                // Uma quadratura central pra cidade
                if (localX >= 3 && localX < 13 && localY >= 3 && localY < 13) {
                    isCity = true;
                    bId = BIOMES.DESERT.id; // Placeholder de areia p/ Cidade
                }
            }
        }
        
        // Caminho procedural transformado em corredores de terra no micro-grid
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
                // Se o bioma for oceano, mantemos ponte (por simplificacao, usamos DESERT que tem autotiling com areia)
                bId = BIOMES.BEACH.id; 
            }
        }
    }

    return {
        biomeId: bId,
        elevation: e
    };
}
