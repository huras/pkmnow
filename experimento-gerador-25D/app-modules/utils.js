export const TILE_PX = 16;

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const idx = (w, x, y) => y * w + x;
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export function resolveTextureUrl(filePath) {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('tilesets/')) return `../${normalized}`;
  return `../tilesets/${normalized.split('/').pop()}`;
}

export async function textureFor(THREE, atlasTextures, filePath) {
  if (!filePath) return null;
  if (atlasTextures.has(filePath)) return atlasTextures.get(filePath);
  const tex = await new THREE.TextureLoader().loadAsync(resolveTextureUrl(filePath));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  atlasTextures.set(filePath, tex);
  return tex;
}

export function uvRect(texture, tileId, cols) {
  const w = texture.image.width;
  const h = texture.image.height;
  const sx = (tileId % cols) * TILE_PX;
  const sy = Math.floor(tileId / cols) * TILE_PX;
  return { u0: sx / w, u1: (sx + TILE_PX) / w, v0: 1 - (sy + TILE_PX) / h, v1: 1 - sy / h };
}

export function pushFace(builder, a, b, c, d, uv, tint) {
  builder.p.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  builder.u.push(uv.u0, uv.v1, uv.u0, uv.v0, uv.u1, uv.v1, uv.u1, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0);
  builder.c.push(tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint, tint);
}

export function deterministic01(x, y, seed) {
  let h = (seed * 374761393 + x * 668265263 + y * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1103515245) | 0;
  return (h & 0x7fffffff) / 0x7fffffff;
}

export function seedToInt(seedValue) {
  if (typeof seedValue === 'number' && Number.isFinite(seedValue)) return seedValue | 0;
  const text = String(seedValue ?? '');
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return h | 0;
}

export function getTileUvRect(tileId, cols) {
  const sx = (tileId % cols) * TILE_PX;
  const sy = Math.floor(tileId / cols) * TILE_PX;
  return { sx, sy, sw: TILE_PX, sh: TILE_PX };
}

export function atlasColsFromPath(path) {
  if (path?.includes('caves')) return 50;
  if (path?.includes('Berry Trees')) return 66;
  return 57;
}

export function normalizedShape(shape) {
  return String(shape || '1x1').replace('[', '').replace(']', '');
}

export function clearGroup(group) {
  for (const child of group.children) {
    if (child.geometry) child.geometry.dispose?.();
    if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
  }
  group.clear();
}
