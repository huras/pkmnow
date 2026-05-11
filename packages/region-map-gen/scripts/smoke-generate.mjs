import { generate, DEFAULT_CONFIG } from '../src/index.js';

const data = generate(42, DEFAULT_CONFIG);
if (!data || data.width !== 256 || data.height !== 256) throw new Error('unexpected dimensions');
if (!(data.biomes instanceof Uint8Array) || data.biomes.length !== 256 * 256) throw new Error('unexpected biomes');
if (!data.graph?.nodes?.length) throw new Error('expected graph nodes');
console.log('region-map-gen smoke ok', { w: data.width, h: data.height, nodes: data.graph.nodes.length });
