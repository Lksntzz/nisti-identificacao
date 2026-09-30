import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const experience=fs.readFileSync(new URL('../src/mural-product-experience.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('product detail uses the editorial focus experience',()=>{
  assert.match(mural,/MuralProductExperience/);
  assert.match(experience,/mural-product-focus-stage/);
  assert.match(experience,/mural-product-focus-tabs/);
  assert.match(experience,/role="tablist"/);
  assert.match(experience,/aria-selected/);
});

test('product detail no longer simulates 3D rotation with a single image',()=>{
  assert.equal(experience.includes("getContext('webgl'"),false);
  assert.equal(experience.includes('gl.drawArrays'),false);
  assert.equal(experience.includes('onPointerMove'),false);
  assert.match(experience,/mural-product-focus-image/);
});

test('cards provide microinteractions and staged entrance',()=>{
  assert.match(mural,/mural-card-arrow/);
  assert.match(mural,/--mural-card-delay/);
  assert.match(css,/@keyframes mural-card-reveal/);
  assert.match(css,/\.mural-card:hover \.mural-card-image/);
});

test('motion-heavy effects respect reduced-motion preferences',()=>{
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.mural-product-focus-image/);
});

test('collections open as an editorial showcase',()=>{
  assert.match(mural,/mural-collection-editorial-hero/);
  assert.match(mural,/mural-collection-featured-product/);
  assert.match(mural,/mural-collection-collage/);
  assert.match(mural,/data-collection-reveal/);
  assert.match(css,/\.mural-collection-editorial-copy/);
});
