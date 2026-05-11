import { generate, DEFAULT_CONFIG, createWorldFromBiomeMap, BIOMES } from '../src/index.js';

const data = generate(42, DEFAULT_CONFIG);
if (!data || data.width !== 256 || data.height !== 256) throw new Error('unexpected dimensions');
if (!(data.biomes instanceof Uint8Array) || data.biomes.length !== 256 * 256) throw new Error('unexpected biomes');
if (!data.graph?.nodes?.length) throw new Error('expected graph nodes');
console.log('region-map-gen smoke ok', { w: data.width, h: data.height, nodes: data.graph.nodes.length });

const W = 16;
const H = 16;
const painted = new Uint8Array(W * H);
for (let i = 0; i < painted.length; i++) painted[i] = i % 3 === 0 ? BIOMES.OCEAN.id : BIOMES.GRASSLAND.id;
const handMade = createWorldFromBiomeMap({ biomes: painted, width: W, height: H, seed: 'hoenn' });
if (handMade.width !== W || handMade.height !== H) throw new Error('painted dims');
if (!(handMade.biomes instanceof Uint8Array) || handMade.biomes.length !== W * H) throw new Error('painted biomes');
if (!(handMade.cells instanceof Float32Array) || handMade.cells.length !== W * H) throw new Error('painted cells');
if (handMade.source !== 'painted') throw new Error('painted source flag');
console.log('createWorldFromBiomeMap smoke ok', { w: handMade.width, h: handMade.height, source: handMade.source });
