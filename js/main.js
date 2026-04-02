import { generate } from './generator.js';
import { render } from './render.js';

const canvas = document.getElementById('map');
const seedInput = document.getElementById('seed');
const btnGenerate = document.getElementById('generate');

function run() {
  const data = generate(seedInput.value);
  render(canvas, data);
}

btnGenerate.addEventListener('click', run);
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

run();
