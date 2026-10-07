import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('product cards avoid duplicate subtitle metadata and clamp dense content',()=>{
  assert.match(mural,/const isProduct = item\.kind === 'product'/);
  assert.match(mural,/mural-card-product-name/);
  assert.match(mural,/item\.subtitle \? \(/);
  assert.match(mural,/function CollectionLaunchCard/);
  assert.match(mural,/mural-product-collection/);
  assert.match(css,/\.mural-card-product-name[\s\S]*-webkit-line-clamp:2/);
  assert.match(css,/\.mural-card-product \.mural-card-summary[\s\S]*-webkit-line-clamp:2/);
});

test('detail dialog does not reserve media space when an item has no image',()=>{
  assert.match(mural,/const hasMedia = Boolean\(item\?\.image_url\)/);
  assert.match(mural,/\{hasMedia && <MuralImage/);
  assert.match(mural,/immersiveProduct \? ' mural-detail-immersive' : hasMedia \? '' : ' no-media'/);
  assert.match(css,/\.mural-detail-body\.no-media/);
});

test('product detail image is contained instead of aggressively cropped',()=>{
  assert.match(mural,/mural-detail-image-\$\{item\.kind\}/);
  assert.match(css,/\.mural-detail-image-product[\s\S]*object-fit:contain/);
});


test('collection detail avoids duplicated year in the title',()=>{
  assert.match(mural,/function formatCollectionTitle\(collection\)/);
  assert.match(mural,/name\.endsWith\(year\)/);
  assert.match(mural,/\{formatCollectionTitle\(collection\)\}/);
});

test('detail close glyph is centered inside its circular touch target',()=>{
  assert.match(mural,/className="mural-detail-close"[^>]*><span aria-hidden="true">×<\/span><\/button>/);
  assert.match(css,/\.mural-detail-close\{[\s\S]*display:grid;[\s\S]*place-items:center/);
  assert.match(css,/\.mural-detail-close>span\{[\s\S]*text-align:center/);
});

test('collection product cards use contained imagery and compact mobile sizing',()=>{
  assert.match(css,/\.mural-collection-product img,[\s\S]*object-fit:contain/);
  assert.match(css,/\.mural-collection-detail \.mural-detail-image\{[\s\S]*object-fit:contain/);
});


test('Mural title uses three clean spread drops and reference sparkles',()=>{
  assert.doesNotMatch(mural,/import LOGO from '\.\/assets\/logo\.png'/);
  assert.match(mural,/mural-reference-drop drop-cyan/);
  assert.match(mural,/mural-reference-drop drop-pink/);
  assert.match(mural,/mural-reference-drop drop-yellow/);
  assert.equal((mural.match(/viewBox="0 0 32 70"/g)||[]).length,3);
  assert.match(css,/\.mural-title-accent\{[\s\S]*width:114px;[\s\S]*overflow:visible/);
  assert.match(css,/\.mural-reference-drop\.drop-cyan[\s\S]*rotate\(-29deg\)/);
  assert.match(css,/\.mural-reference-drop\.drop-pink[\s\S]*rotate\(7deg\)/);
  assert.match(css,/\.mural-reference-drop\.drop-yellow[\s\S]*rotate\(34deg\)/);
  assert.match(mural,/className="mural-title-sparkles"/);
  assert.match(mural,/className="star-3"/);
  assert.match(css,/\.mural-title-sparkles \.star-1/);
  assert.match(css,/@keyframes mural-title-sparkle/);
  assert.doesNotMatch(mural,/mural-logo-drop/);
});
