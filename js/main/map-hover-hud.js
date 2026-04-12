import { BIOMES } from '../biomes.js';
import { getEncounters } from '../ecodex.js';

export const MAP_HOVER_MIN_INTERVAL_MS = 33;

/**
 * @param {number} gx
 * @param {number} gy
 * @param {{
 *   currentData: object,
 *   infoBar: HTMLElement,
 *   canvas: HTMLCanvasElement,
 *   render: typeof import('../render.js').render,
 *   getSettings: () => object,
 *   updateView: () => void
 * }} deps
 */
export function renderMapHoverDetails(gx, gy, deps) {
  const { currentData, infoBar, canvas, render, getSettings } = deps;
  if (!currentData) return;

  if (gx >= 0 && gx < currentData.width && gy >= 0 && gy < currentData.height) {
    const idx = gy * currentData.width + gx;
    const val = currentData.cells[idx];
    const imp = currentData.cellImportance ? currentData.cellImportance[idx] : 0;
    const traffic = currentData.roadTraffic ? currentData.roadTraffic[idx] : 0;

    const city = currentData.graph.nodes.find((n) => n.x === gx && n.y === gy);
    let routeName = '';
    if (traffic > 0 && currentData.paths) {
      const activePath = currentData.paths.find((p) => p.some((cell) => cell.x === gx && cell.y === gy));
      if (activePath) routeName = activePath.name || `Rota (Importância ${activePath.importance})`;
    }

    const temp = currentData.temperature ? currentData.temperature[idx] : 0;
    const moist = currentData.moisture ? currentData.moisture[idx] : 0;
    const bId = currentData.biomes ? currentData.biomes[idx] : 0;
    const biome = Object.values(BIOMES).find((b) => b.id === bId) || { name: 'Desconhecido' };
    const anom = currentData.anomaly ? currentData.anomaly[idx] : 0;
    const encounters = getEncounters(bId);
    const encounterText = encounters.slice(0, 3).join(', ');

    const landmark = currentData.landmarks ? currentData.landmarks.find((l) => l.x === gx && l.y === gy) : null;

    let mainInfo = '';
    if (city) {
      mainInfo = `<span style="color:#ff5b5b; font-weight:bold; margin-left:10px;">🏙️ ${city.name}</span>`;
    } else if (landmark) {
      mainInfo = `<span style="color:#00ffff; font-weight:bold; margin-left:10px;">✨ ${landmark.name}</span>`;
    } else if (routeName) {
      mainInfo = `<span style="color:#ffd700; font-weight:bold; margin-left:10px;">🛣️ ${routeName}</span>`;
    }

    infoBar.innerHTML = `
      <span class="biome-name">${biome.name}</span>
      <span><span class="label">Elev</span><b>${val.toFixed(2)}</b></span>
      <span><span class="label">Temp</span><b>${temp.toFixed(2)}</b></span>
      <span><span class="label">Humid</span><b>${moist.toFixed(2)}</b></span>
      <span title="${encounters.join(', ')}"><span class="label">Eco</span><b style="color:#8ceda1">${encounterText}</b></span>
      ${mainInfo}
    `;

    render(canvas, currentData, { hover: { x: gx, y: gy }, settings: getSettings() });
  } else {
    deps.updateView();
  }
}
