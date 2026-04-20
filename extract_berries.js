import fs from 'fs';

const tsxPath = 'tilesets/Game Boy Advance - Pokemon Ruby _ Sapphire - Miscellaneous - Berry Trees.tsx';
const content = fs.readFileSync(tsxPath, 'utf8');

const tiles = {};
const tileMatches = content.matchAll(/<tile id="(\d+)" type="([^"]+)">([\s\S]*?)<\/tile>/g);

for (const match of tileMatches) {
  const id = parseInt(match[1]);
  const type = match[2];
  const propsMatch = match[3].match(/<property name="([^"]+)" value="([^"]+)"\/>/g);
  const props = {};
  if (propsMatch) {
    for (const p of propsMatch) {
      const m = p.match(/name="([^"]+)" value="([^"]+)"/);
      props[m[1]] = parseInt(m[2]);
    }
  }

  if (!tiles[type]) tiles[type] = { stages: {} };
  const stage = props['growth-stage'] ?? 0;
  const anim = props['animation-stage'] ?? 0;

  if (!tiles[type].stages[stage]) tiles[type].stages[stage] = {};
  if (!tiles[type].stages[stage][anim]) tiles[type].stages[stage][anim] = [];
  tiles[type].stages[stage][anim].push(id);
}

const objectSets = {};
const scatterSets = [];

for (const berry in tiles) {
  if (berry === 'base-form') continue;
  
  // Get Stage 2 Frame 0
  const stage2 = tiles[berry].stages[2];
  if (!stage2) continue;
  const ids = stage2[0].sort((a, b) => a - b);
  
  const key = `berry-tree-${berry}`;
  const shape = ids.length === 1 ? '1x1' : '1x2';
  
  const parts = [];
  if (ids.length === 2) {
    parts.push({ role: 'top', ids: [ids[0]], walkable: true, abovePlayer: true });
    parts.push({ role: 'base', ids: [ids[1]], walkable: false, abovePlayer: false });
  } else {
    parts.push({ role: 'base', ids: [ids[0]], walkable: false, abovePlayer: false });
  }
  
  objectSets[`${key} [${shape}]`] = {
    file: "tilesets/Game Boy Advance - Pokemon Ruby _ Sapphire - Miscellaneous - Berry Trees.tsx",
    shape: shape,
    parts: parts
  };
  
  scatterSets.push({
    itemKey: key,
    weight: 0.15
  });
}

console.log('OBJECT_SETS:');
console.log(JSON.stringify(objectSets, null, 2).slice(1, -1));
console.log('\nSCATTER_SETS:');
console.log(JSON.stringify(scatterSets, null, 2));
