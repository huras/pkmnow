const TILE_PX = 16;

let dataset = null;

function idx(w, x, y) {
  return y * w + x;
}

function pushFace(builder, a, b, c, d, uv, tint) {
  builder.p.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  builder.u.push(uv.u0, uv.v1, uv.u0, uv.v0, uv.u1, uv.v1, uv.u1, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0);
  builder.c.push(tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint);
}

function lerp3(p0, p1, t) {
  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  };
}

function bilerp3(a, b, c, d, u, v) {
  const ab = lerp3(a, b, u);
  const cd = lerp3(c, d, u);
  return lerp3(ab, cd, v);
}

function pushFaceTiled(builder, a, b, c, d, uv, tint, tilesU, tilesV) {
  const tu = Math.max(1, Math.floor(tilesU || 1));
  const tv = Math.max(1, Math.floor(tilesV || 1));
  for (let vy = 0; vy < tv; vy++) {
    const v0 = vy / tv;
    const v1 = (vy + 1) / tv;
    for (let ux = 0; ux < tu; ux++) {
      const u0 = ux / tu;
      const u1 = (ux + 1) / tu;
      const p00 = bilerp3(a, b, c, d, u0, v0);
      const p10 = bilerp3(a, b, c, d, u1, v0);
      const p01 = bilerp3(a, b, c, d, u0, v1);
      const p11 = bilerp3(a, b, c, d, u1, v1);
      pushFace(builder, p00, p10, p01, p11, uv, tint);
    }
  }
}

function uvRect(imageW, imageH, tileId, cols) {
  const sx = (tileId % cols) * TILE_PX;
  const sy = Math.floor(tileId / cols) * TILE_PX;
  return {
    u0: sx / imageW,
    u1: (sx + TILE_PX) / imageW,
    v0: 1 - (sy + TILE_PX) / imageH,
    v1: 1 - sy / imageH,
  };
}

function buildChunk(payload) {
  if (!dataset || dataset.version !== payload.version) return null;
  const {
    span,
    half,
    floorY,
    stepHeight,
    wallShade,
    eps,
    atlasMetaByFileId,
    fileById,
    fileIdByCell,
    spriteByCell,
    colsByCell,
    heightByCell,
  } = dataset;
  const chunk = payload.chunk;
  const lod = Number(payload.lod) || 0;
  const builders = new Map();
  const getBuilder = (fileId) => {
    if (!builders.has(fileId)) builders.set(fileId, { p: [], u: [], c: [] });
    return builders.get(fileId);
  };
  const visitedTop = new Uint8Array(span * span);
  const visitedWallRight = new Uint8Array(span * span);
  const visitedWallDown = new Uint8Array(span * span);
  const inChunk = (x, y) => x >= chunk.x0 && x < chunk.x1 && y >= chunk.y0 && y < chunk.y1;
  const topKeyAt = (x, y) => {
    if (!inChunk(x, y)) return -1;
    const i = idx(span, x, y);
    const fileId = fileIdByCell[i];
    if (fileId < 0) return -1;
    return `${fileId}|${spriteByCell[i]}|${colsByCell[i]}|${heightByCell[i]}`;
  };
  const rightWallKeyAt = (x, y) => {
    if (!inChunk(x, y)) return -1;
    const i = idx(span, x, y);
    const fileId = fileIdByCell[i];
    if (fileId < 0) return -1;
    const py0 = heightByCell[i] * stepHeight;
    const rightI = x + 1 < span ? idx(span, x + 1, y) : -1;
    const rightH = rightI >= 0 ? heightByCell[rightI] * stepHeight : floorY;
    if (Math.abs(py0 - rightH) <= eps) return -1;
    return `${fileId}|${spriteByCell[i]}|${colsByCell[i]}|${Math.min(py0, rightH)}|${Math.max(py0, rightH)}`;
  };
  const downWallKeyAt = (x, y) => {
    if (!inChunk(x, y)) return -1;
    const i = idx(span, x, y);
    const fileId = fileIdByCell[i];
    if (fileId < 0) return -1;
    const py0 = heightByCell[i] * stepHeight;
    const downI = y + 1 < span ? idx(span, x, y + 1) : -1;
    const downH = downI >= 0 ? heightByCell[downI] * stepHeight : floorY;
    if (Math.abs(py0 - downH) <= eps) return -1;
    return `${fileId}|${spriteByCell[i]}|${colsByCell[i]}|${Math.min(py0, downH)}|${Math.max(py0, downH)}`;
  };

  let mergedFaceCount = 0;
  let preFaceEstimate = 0;

  for (let y = chunk.y0; y < chunk.y1; y++) {
    for (let x = chunk.x0; x < chunk.x1; x++) {
      const i = idx(span, x, y);
      const fileId = fileIdByCell[i];
      if (fileId < 0) continue;
      preFaceEstimate++;
      const py0 = heightByCell[i] * stepHeight;
      const rightI = x + 1 < span ? idx(span, x + 1, y) : -1;
      const downI = y + 1 < span ? idx(span, x, y + 1) : -1;
      const rightH = rightI >= 0 ? heightByCell[rightI] * stepHeight : floorY;
      const downH = downI >= 0 ? heightByCell[downI] * stepHeight : floorY;
      if (Math.abs(py0 - rightH) > eps) preFaceEstimate++;
      if (Math.abs(py0 - downH) > eps) preFaceEstimate++;
    }
  }

  for (let y = chunk.y0; y < chunk.y1; y++) {
    for (let x = chunk.x0; x < chunk.x1; x++) {
      const i = idx(span, x, y);
      if (visitedTop[i]) continue;
      const key = topKeyAt(x, y);
      if (key === -1) continue;
      const fileId = fileIdByCell[i];
      const meta = atlasMetaByFileId[fileId];
      if (!meta) continue;
      const uv = uvRect(meta.w, meta.h, spriteByCell[i], colsByCell[i]);
      let runW = 1;
      while (x + runW < chunk.x1 && !visitedTop[idx(span, x + runW, y)] && topKeyAt(x + runW, y) === key) runW++;
      let runH = 1;
      while (y + runH < chunk.y1) {
        let rowOk = true;
        for (let xx = x; xx < x + runW; xx++) {
          const ri = idx(span, xx, y + runH);
          if (visitedTop[ri] || topKeyAt(xx, y + runH) !== key) {
            rowOk = false;
            break;
          }
        }
        if (!rowOk) break;
        runH++;
      }
      for (let yy = y; yy < y + runH; yy++) for (let xx = x; xx < x + runW; xx++) visitedTop[idx(span, xx, yy)] = 1;
      const b = getBuilder(fileId);
      const px0 = x - half;
      const px1 = px0 + runW;
      const pz0 = y - half;
      const pz1 = pz0 + runH;
      const py0 = heightByCell[i] * stepHeight;
      pushFaceTiled(
        b,
        { x: px0, y: py0, z: pz0 },
        { x: px1, y: py0, z: pz0 },
        { x: px0, y: py0, z: pz1 },
        { x: px1, y: py0, z: pz1 },
        uv,
        1,
        runW,
        runH,
      );
      mergedFaceCount++;
    }
  }

  if (lod === 0) {
    for (let y = chunk.y0; y < chunk.y1; y++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const i = idx(span, x, y);
        if (visitedWallRight[i]) continue;
        const key = rightWallKeyAt(x, y);
        if (key === -1) continue;
        const fileId = fileIdByCell[i];
        const meta = atlasMetaByFileId[fileId];
        if (!meta) continue;
        const uv = uvRect(meta.w, meta.h, spriteByCell[i], colsByCell[i]);
        const py0 = heightByCell[i] * stepHeight;
        const rightI = x + 1 < span ? idx(span, x + 1, y) : -1;
        const rightH = rightI >= 0 ? heightByCell[rightI] * stepHeight : floorY;
        const minY = Math.min(py0, rightH);
        const maxY = Math.max(py0, rightH);
        let runH = 1;
        while (y + runH < chunk.y1 && !visitedWallRight[idx(span, x, y + runH)] && rightWallKeyAt(x, y + runH) === key) runH++;
        for (let yy = y; yy < y + runH; yy++) visitedWallRight[idx(span, x, yy)] = 1;
        const b = getBuilder(fileId);
        const px = x - half + 1;
        const pz0 = y - half;
        const pz1 = pz0 + runH;
        const wallSteps = Math.max(1, Math.round((maxY - minY) / Math.max(eps, stepHeight)));
        pushFaceTiled(
          b,
          { x: px, y: minY, z: pz0 },
          { x: px, y: maxY, z: pz0 },
          { x: px, y: minY, z: pz1 },
          { x: px, y: maxY, z: pz1 },
          uv,
          wallShade,
          wallSteps,
          runH,
        );
        mergedFaceCount++;
      }
    }
  }

  if (lod === 0) {
    for (let y = chunk.y0; y < chunk.y1; y++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const i = idx(span, x, y);
        if (visitedWallDown[i]) continue;
        const key = downWallKeyAt(x, y);
        if (key === -1) continue;
        const fileId = fileIdByCell[i];
        const meta = atlasMetaByFileId[fileId];
        if (!meta) continue;
        const uv = uvRect(meta.w, meta.h, spriteByCell[i], colsByCell[i]);
        const py0 = heightByCell[i] * stepHeight;
        const downI = y + 1 < span ? idx(span, x, y + 1) : -1;
        const downH = downI >= 0 ? heightByCell[downI] * stepHeight : floorY;
        const minY = Math.min(py0, downH);
        const maxY = Math.max(py0, downH);
        let runW = 1;
        while (x + runW < chunk.x1 && !visitedWallDown[idx(span, x + runW, y)] && downWallKeyAt(x + runW, y) === key) runW++;
        for (let xx = x; xx < x + runW; xx++) visitedWallDown[idx(span, xx, y)] = 1;
        const b = getBuilder(fileId);
        const px0 = x - half;
        const px1 = px0 + runW;
        const pz = y - half + 1;
        const wallSteps = Math.max(1, Math.round((maxY - minY) / Math.max(eps, stepHeight)));
        pushFaceTiled(
          b,
          { x: px0, y: minY, z: pz },
          { x: px1, y: minY, z: pz },
          { x: px0, y: maxY, z: pz },
          { x: px1, y: maxY, z: pz },
          uv,
          wallShade,
          runW,
          wallSteps,
        );
        mergedFaceCount++;
      }
    }
  }

  const builderPayloads = [];
  const transfer = [];
  let triCount = 0;
  for (const [fileId, b] of builders.entries()) {
    const pos = new Float32Array(b.p);
    const uv = new Float32Array(b.u);
    const col = new Float32Array(b.c);
    triCount += Math.floor(pos.length / 9);
    builderPayloads.push({
      fileId,
      p: pos.buffer,
      u: uv.buffer,
      c: col.buffer,
    });
    transfer.push(pos.buffer, uv.buffer, col.buffer);
  }

  return {
    key: chunk.key,
    chunkX: chunk.chunkX,
    chunkY: chunk.chunkY,
    lod,
    triCount,
    mergedFaceCount,
    preTriEstimate: preFaceEstimate * 2,
    fileById,
    builders: builderPayloads,
    transfer,
  };
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'init-dataset') {
    dataset = msg.payload;
    self.postMessage({ type: 'init-ok', requestId: msg.requestId });
    return;
  }
  if (msg.type === 'build-chunk') {
    const result = buildChunk(msg.payload);
    if (!result) {
      self.postMessage({ type: 'build-result', requestId: msg.requestId, ok: false });
      return;
    }
    self.postMessage(
      {
        type: 'build-result',
        requestId: msg.requestId,
        ok: true,
        payload: {
          key: result.key,
          chunkX: result.chunkX,
          chunkY: result.chunkY,
          lod: result.lod,
          triCount: result.triCount,
          mergedFaceCount: result.mergedFaceCount,
          preTriEstimate: result.preTriEstimate,
          fileById: result.fileById,
          builders: result.builders,
        },
      },
      result.transfer,
    );
  }
};
