/**
 * Extraído de tileset-browser.js
 * Lógica pura de cálculo de papéis (roles) para a tesselação de 13-roles.
 */

export function getRoleForCell(r, c, rows, cols, isLandAtFunc, setType) {
  if (setType === 'seamless-horizontal-single-piece-a' || setType === 'seamless-vertical-single-piece-a') {
    return 'SEAMLESS_TILE';
  }

  const n  = isLandAtFunc(r - 1, c);
  const s  = isLandAtFunc(r + 1, c);
  const w  = isLandAtFunc(r, c - 1);
  const e  = isLandAtFunc(r, c + 1);

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

  const nw = isLandAtFunc(r - 1, c - 1);
  const ne = isLandAtFunc(r - 1, c + 1);
  const sw = isLandAtFunc(r + 1, c - 1);
  const se = isLandAtFunc(r + 1, c + 1);

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
  if (!n && s && w && e) return setType === 'conc-conv-c' ? 'EDGE_N/IN_EDGE_S' : 'EDGE_N';
  if (n && !s && w && e) return setType === 'conc-conv-c' ? 'EDGE_S/IN_EDGE_N' : 'EDGE_S';
  if (n && s && !w && e) return 'EDGE_W';
  if (n && s && w && !e) return 'EDGE_E';

  // Quinas externas — dois lados cardinais adjacentes expostos
  if (!n && !w && s && e)  return 'OUT_NW';
  if (!n && !e && s && w)  return 'OUT_NE';
  if (!s && !w && n && e)  return 'OUT_SW';
  if (!s && !e && n && w)  return 'OUT_SE';

  // Para conc-conv-c, papéis de corredor interno
  if (setType === 'conc-conv-c') {
    if (!w && !e && n && s) return 'IN_EDGE_E';   // corredor vertical estreito
    if (!n && !s && w && e) return 'IN_EDGE_W';   // corredor horizontal estreito
  }

  // Fallbacks para pontas e pontes finas
  if (!n && !w && !e && s) return 'EDGE_N'; 
  if (!s && !w && !e && n) return 'EDGE_S'; 
  if (!w && !n && !s && e) return 'EDGE_W'; 
  if (!e && !n && !s && w) return 'EDGE_E'; 

  return 'CENTER';
}

/**
 * Base scatter 2C (colunas a leste da origem) pode cair em cantos internos IN_* no mesmo degrau.
 * Bloqueia OUT_* (quina exterior ao vazio) e EDGE_* (borda exposta), como no Pass 2 para 2B/grama.
 */
export function terrainRoleAllowsScatter2CContinuation(role) {
  if (role == null || role === '') return true;
  const r = String(role);
  if (r.startsWith('OUT_')) return false;
  if (r === 'CENTER') return true;
  if (r.startsWith('IN_')) return true;
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
