let overlayCacheKey = '';
let routesHost = null;
let nodesHost = null;
let labelsHost = null;
let worldHost = null;

function ensureSvgHosts(svg) {
  let root = svg.querySelector('g[data-map-overlay-root="1"]');
  if (!(root instanceof SVGGElement)) {
    root = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    root.setAttribute('data-map-overlay-root', '1');
    svg.replaceChildren(root);
  }
  let world = root.querySelector('g[data-map-overlay-world="1"]');
  if (!(world instanceof SVGGElement)) {
    world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    world.setAttribute('data-map-overlay-world', '1');
    root.appendChild(world);
  }
  const ensureLayer = (name) => {
    let layer = world.querySelector(`g[data-layer="${name}"]`);
    if (!(layer instanceof SVGGElement)) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.setAttribute('data-layer', name);
      world.appendChild(layer);
    }
    return layer;
  };
  worldHost = world;
  routesHost = ensureLayer('routes');
  nodesHost = ensureLayer('nodes');
  labelsHost = ensureLayer('labels');
}

function clearOverlayGeometry() {
  routesHost?.replaceChildren();
  nodesHost?.replaceChildren();
  labelsHost?.replaceChildren();
}

function buildOverlayGeometry(data, overlayPaths, overlayGraph) {
  clearOverlayGeometry();
  if (overlayPaths && Array.isArray(data.paths)) {
    for (const path of data.paths) {
      if (!Array.isArray(path) || path.length < 2) continue;
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute(
        'points',
        path.map((p) => `${(Number(p.x) || 0) + 0.5},${(Number(p.y) || 0) + 0.5}`).join(' ')
      );
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', 'rgba(255, 215, 100, 0.86)');
      poly.setAttribute('stroke-width', '0.42');
      poly.setAttribute('stroke-linecap', 'round');
      poly.setAttribute('stroke-linejoin', 'round');
      poly.setAttribute('vector-effect', 'non-scaling-stroke');
      routesHost?.appendChild(poly);
    }
  }

  if (overlayGraph && data.graph?.nodes) {
    for (const node of data.graph.nodes) {
      const x = (Number(node.x) || 0) + 0.5;
      const y = (Number(node.y) || 0) + 0.5;
      if (node.isGym) {
        const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        diamond.setAttribute(
          'points',
          `${x},${y - 0.44} ${x + 0.44},${y} ${x},${y + 0.44} ${x - 0.44},${y}`
        );
        diamond.setAttribute('fill', '#ff4747');
        diamond.setAttribute('stroke', 'rgba(0,0,0,0.78)');
        diamond.setAttribute('stroke-width', '0.13');
        diamond.setAttribute('vector-effect', 'non-scaling-stroke');
        nodesHost?.appendChild(diamond);
      } else {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', String(x));
        c.setAttribute('cy', String(y));
        c.setAttribute('r', '0.35');
        c.setAttribute('fill', '#ffffff');
        c.setAttribute('stroke', 'rgba(0,0,0,0.78)');
        c.setAttribute('stroke-width', '0.11');
        c.setAttribute('vector-effect', 'non-scaling-stroke');
        nodesHost?.appendChild(c);
      }

      if (node.name) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(y - 0.6));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-size', '0.72');
        text.setAttribute('fill', '#fff');
        text.setAttribute('stroke', 'rgba(0,0,0,0.92)');
        text.setAttribute('stroke-width', '0.11');
        text.setAttribute('paint-order', 'stroke');
        text.textContent = String(node.name);
        labelsHost?.appendChild(text);
      }
    }
  }
}

/**
 * @param {SVGSVGElement | null} svg
 * @param {any} data
 * @param {{
 *   canvas?: HTMLCanvasElement | null,
 *   appMode?: string,
 *   overlayPaths?: boolean,
 *   overlayGraph?: boolean,
 *   useSvgOverlay?: boolean,
 *   camera?: { ox: number, oy: number, scale: number } | null
 * }} options
 */
export function renderMapOverlaySvg(svg, data, options = {}) {
  if (!svg) return;
  const {
    canvas,
    appMode = 'map',
    overlayPaths = true,
    overlayGraph = true,
    useSvgOverlay = true,
    camera = null
  } = options;

  if (!data || appMode !== 'map' || !useSvgOverlay || !canvas || !camera) {
    svg.classList.add('hidden');
    return;
  }

  svg.classList.remove('hidden');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  svg.style.left = `${canvas.offsetLeft}px`;
  svg.style.top = `${canvas.offsetTop}px`;
  svg.style.width = `${canvas.clientWidth}px`;
  svg.style.height = `${canvas.clientHeight}px`;
  svg.style.zIndex = '7';
  svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
  svg.setAttribute('width', String(canvas.width));
  svg.setAttribute('height', String(canvas.height));

  ensureSvgHosts(svg);

  const cacheKey = [
    data.seed,
    data.width,
    data.height,
    overlayPaths ? 1 : 0,
    overlayGraph ? 1 : 0,
    data.paths?.length || 0,
    data.graph?.nodes?.length || 0
  ].join('|');
  if (overlayCacheKey !== cacheKey) {
    overlayCacheKey = cacheKey;
    buildOverlayGeometry(data, overlayPaths, overlayGraph);
  }

  worldHost?.setAttribute(
    'transform',
    `translate(${(-camera.ox * camera.scale).toFixed(3)} ${(-camera.oy * camera.scale).toFixed(
      3
    )}) scale(${camera.scale.toFixed(6)})`
  );

  const showLabels = camera.scale >= 11;
  if (labelsHost) labelsHost.style.display = showLabels ? '' : 'none';
}
