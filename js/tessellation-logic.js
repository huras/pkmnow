/**
 * Extraído de tileset-browser.js
 * Lógica pura de cálculo de papéis (roles) para a tesselação de 13-roles.
 */

/** Folhas solo 5×3 (IN_* / EDGE_*): suavizar buracos minúsculos na máscara. */
function isConcConvThreeByThreeStyle(setType) {
  return setType === 'conc-conv-a' || setType === 'conc-conv-b' || setType === 'conc-conv-c';
}

/**
 * Trata células “não-terra” que são só ruído 1×1 ou bloco 2×2 cercado por terra como terra
 * para o autotile 3×3 — evita IN_* / EDGE_* espúrios (altura, chunk, máscara de folhagem).
 */
export function landPredicateFillSmallNoiseHoles(r, c, isLandRaw) {
  const L = (rr, cc) => !!isLandRaw(rr, cc);
  if (L(r, c)) return true;

  const n = L(r - 1, c);
  const s = L(r + 1, c);
  const w = L(r, c - 1);
  const e = L(r, c + 1);
  if (n && s && w && e) return true;

  for (let r0 = r - 1; r0 <= r; r0++) {
    for (let c0 = c - 1; c0 <= c; c0++) {
      if (L(r0, c0) || L(r0 + 1, c0) || L(r0, c0 + 1) || L(r0 + 1, c0 + 1)) continue;
      const ringOk =
        L(r0 - 1, c0) &&
        L(r0 - 1, c0 + 1) &&
        L(r0 + 2, c0) &&
        L(r0 + 2, c0 + 1) &&
        L(r0, c0 - 1) &&
        L(r0 + 1, c0 - 1) &&
        L(r0, c0 + 2) &&
        L(r0 + 1, c0 + 2);
      if (ringOk) return true;
    }
  }
  return false;
}

export function getRoleForCell(r, c, rows, cols, isLandAtFunc, setType) {
  if (setType === 'seamless-horizontal-single-piece-a' || setType === 'seamless-vertical-single-piece-a') {
    return 'SEAMLESS_TILE';
  }

  const landAt = isConcConvThreeByThreeStyle(setType)
    ? (rr, cc) => landPredicateFillSmallNoiseHoles(rr, cc, isLandAtFunc)
    : isLandAtFunc;

  const n  = landAt(r - 1, c);
  const s  = landAt(r + 1, c);
  const w  = landAt(r, c - 1);
  const e  = landAt(r, c + 1);

  if (setType === 'extentable-vertical-three-piece-a') {
    if (!n) return 'TOP_EXTREMITY';
    if (!s) return 'BOTTOM_EXTREMITY';
    return 'SEAMLESS_CENTER';
  }
  if (setType === 'extentable-horizontal-three-piece-a') {
    if (!w) return 'LEFT_EXTREMITY';
    if (!e) return 'RIGHT_EXTREMITY';
    return 'SEAMLESS_CENTER';
  }

  const nw = landAt(r - 1, c - 1);
  const ne = landAt(r - 1, c + 1);
  const sw = landAt(r + 1, c - 1);
  const se = landAt(r + 1, c + 1);

  // Todos os 4 vizinhos cardinais são terra
  if (n && s && w && e) {
    if (setType === 'conc-conv-d') return 'CENTER';
    if (!nw) return 'IN_NW';
    if (!ne) return 'IN_NE';
    if (!sw) return 'IN_SW';
    if (!se) return 'IN_SE';
    return 'CENTER';
  }

  // Tiles de borda — apenas um lado cardinal exposto à água
  if (!n && s && w && e) return 'EDGE_N';
  if (n && !s && w && e) return 'EDGE_S';
  if (n && s && !w && e) return 'EDGE_W';
  if (n && s && w && !e) return 'EDGE_E';

  // Quinas externas — dois lados cardinais adjacentes expostos
  if (!n && !w && s && e)  return 'OUT_NW';
  if (!n && !e && s && w)  return 'OUT_NE';
  if (!s && !w && n && e)  return 'OUT_SW';
  if (!s && !e && n && w)  return 'OUT_SE';


  // Fallbacks para pontas e pontes finas
  if (!n && !w && !e && s) return 'EDGE_N'; 
  if (!s && !w && !e && n) return 'EDGE_S'; 
  if (!w && !n && !s && e) return 'EDGE_W'; 
  if (!e && !n && !s && w) return 'EDGE_E'; 

  return 'CENTER';
}

/** Cantos internos conc-conv (a/b/c): só estes quatro; não há IN_EDGE_E / IN_EDGE_W. */
const TERRAIN_INNER_CORNER_ROLES = new Set(['IN_NE', 'IN_NW', 'IN_SE', 'IN_SW']);

export function isTerrainInnerCornerRole(role) {
  if (role == null || role === '') return false;
  return TERRAIN_INNER_CORNER_ROLES.has(String(role));
}

/**
 * Base scatter 2C (colunas a leste da origem) pode cair em cantos internos no mesmo degrau.
 * Bloqueia OUT_* (quina exterior ao vazio) e EDGE_* (borda exposta), como no Pass 2 para 2B/grama.
 */
export function terrainRoleAllowsScatter2CContinuation(role) {
  if (role == null || role === '') return true;
  const r = String(role);
  if (r.startsWith('OUT_')) return false;
  if (r === 'CENTER') return true;
  if (isTerrainInnerCornerRole(r)) return true;
  return false;
}

/**
 * Remove anomalias de 1px que o motor de 13-roles não consegue renderizar bem.
 */
export function applyMorphologicalCleanup(width, height, isLandAtFunc, setLandFunc) {
  const toChange = [];

  for (let ry = 0; ry < height; ry++) {
    for (let rx = 0; rx < width; rx++) {
      if (!isLandAtFunc(ry, rx)) continue;

      const n = isLandAtFunc(ry - 1, rx);
      const s = isLandAtFunc(ry + 1, rx);
      const w = isLandAtFunc(ry, rx - 1);
      const e = isLandAtFunc(ry, rx + 1);

      // Se for uma linha fina horizontal ou vertical cercada por água
      if ((!n && !s) || (!w && !e)) {
        toChange.push({ ry, rx });
      }
    }
  }

  toChange.forEach(pos => setLandFunc(pos.ry, pos.rx, false));
  return toChange.length > 0;
}

// Helpers Determinísticos para Vegetação
export function seededHash(x, y, seed) {
  let h = (seed * 374761393 + x * 668265263 + y * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1103515245) | 0;
  return ((h & 0x7fffffff) / 0x7fffffff);
}

export function seededHashInt(x, y, seed) {
  let h = (seed * 374761393 + x * 668265263 + y * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1103515245) | 0;
  return h & 0x7fffffff;
}

/** Sales por “camada” para IDs estáveis não colidirem (grama vs scatter vs props). */
export const PROC_SALT_GRASS_CELL = 3_010_033;
export const PROC_SALT_SCATTER_CELL = 3_010_222;
export const PROC_SALT_SCATTER_INSTANCE = 3_010_501;
export const PROC_SALT_FORMAL_TREE_CELL = 3_015_555;
export const PROC_SALT_ROCK = 5_020_100;
export const PROC_SALT_CRYSTAL = 5_020_200;

/** uint32 determinístico: worldSeed + coords micro + sal de tipo (save / estado / debug). */
export function proceduralEntityIdUint32(worldSeed, mx, my, kindSalt) {
  return seededHashInt(mx, my, worldSeed + kindSalt) >>> 0;
}

export function proceduralEntityIdHex(worldSeed, mx, my, kindSalt) {
  return proceduralEntityIdUint32(worldSeed, mx, my, kindSalt).toString(16).padStart(8, '0');
}

export function parseShape(shape) {
  const [h, w] = shape.split('x').map(Number);
  return { rows: h, cols: w };
}
