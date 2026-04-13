const inflight = new Map();

function loadOne(imageCache, src) {
  if (imageCache.has(src)) return Promise.resolve();
  const existing = inflight.get(src);
  if (existing) return existing;

  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      inflight.delete(src);
      resolve();
    };
    img.onerror = () => {
      console.warn(`[EffectAssetLoader] Failed to load ${src}`);
      inflight.delete(src);
      resolve();
    };
    img.src = src;
  });
  inflight.set(src, p);
  return p;
}

export function ensureEffectAssetsLoaded(imageCache) {
  const assets = [
    'tilesets/effects/actual-fire.png',
    'tilesets/effects/burn-start.png',
    'tilesets/effects/effects.png',
    'tilesets/effects/explosion.png',
    'tilesets/effects/fire.png'
  ];
  return Promise.all(assets.map((src) => loadOne(imageCache, src)));
}
