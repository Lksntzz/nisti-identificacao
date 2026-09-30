import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const experience=fs.readFileSync(new URL('../src/mural-product-experience.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('product detail uses a sticky scrollytelling experience',()=>{
  assert.match(mural,/MuralProductExperience/);
  assert.match(experience,/data-story-step/);
  assert.match(experience,/IntersectionObserver/);
  assert.match(css,/\.mural-product-stage\{[\s\S]*position:sticky/);
});

test('Mural applies parallax without layout-triggering top/left animation',()=>{
  assert.match(mural,/--mural-parallax/);
  assert.match(css,/\.mural-hero-image\{[\s\S]*translate3d/);
  assert.match(css,/--story-parallax/);
});

test('product stage uses real WebGL with interactive rotation and zoom',()=>{
  assert.match(experience,/getContext\('webgl'/);
  assert.match(experience,/gl\.drawArrays\(gl\.TRIANGLES/);
  assert.match(experience,/onPointerMove=\{pointerMove\}/);
  assert.match(experience,/Aumentar zoom/);
  assert.match(experience,/Diminuir zoom/);
});

test('cards provide microinteractions and staged entrance',()=>{
  assert.match(mural,/mural-card-arrow/);
  assert.match(mural,/--mural-card-delay/);
  assert.match(css,/@keyframes mural-card-reveal/);
  assert.match(css,/\.mural-card:hover \.mural-card-image/);
});

test('motion-heavy effects respect reduced-motion preferences',()=>{
  assert.match(experience,/prefersReducedMotion/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
});
