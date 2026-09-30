import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('product cards avoid duplicate subtitle metadata and clamp dense content',()=>{
  assert.match(mural,/const isProduct = item\.kind === 'product'/);
  assert.match(mural,/mural-card-product-name/);
  assert.match(mural,/!isProduct && item\.subtitle/);
  assert.match(mural,/mural-product-collection/);
  assert.match(css,/\.mural-card-product-name[\s\S]*-webkit-line-clamp:2/);
  assert.match(css,/\.mural-card-product \.mural-card-summary[\s\S]*-webkit-line-clamp:2/);
});

test('detail dialog does not reserve media space when an item has no image',()=>{
  assert.match(mural,/const hasMedia = Boolean\(item\?\.image_url\)/);
  assert.match(mural,/\{hasMedia && <MuralImage/);
  assert.match(mural,/mural-detail\$\{hasMedia \? '' : ' no-media'\}/);
  assert.match(css,/\.mural-detail-body\.no-media/);
});

test('product detail image is contained instead of aggressively cropped',()=>{
  assert.match(mural,/mural-detail-image-\$\{item\.kind\}/);
  assert.match(css,/\.mural-detail-image-product[\s\S]*object-fit:contain/);
});
