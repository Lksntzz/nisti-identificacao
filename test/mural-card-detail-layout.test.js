import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('product cards avoid duplicate subtitle metadata and clamp dense content',()=>{
  assert.match(mural,/const isProduct = item\.kind === 'product'/);
  assert.match(mural,/mural-card-product-name/);
  assert.match(mural,/isNotice && item\.subtitle/);
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


test('Mural title accent shows only the three colored official drops plus scattered sparkles',()=>{
  assert.match(mural,/import LOGO from '\.\/assets\/logo\.png'/);
  assert.match(mural,/className="mural-title-brand-mark" src=\{LOGO\}/);
  assert.match(mural,/className="mural-title-sparkles"/);
  assert.match(mural,/className="star-6"/);
  assert.match(css,/\.mural-title-accent\{[\s\S]*width:51px;[\s\S]*overflow:hidden/);
  assert.match(css,/\.mural-title-brand-mark\{[\s\S]*width:68px;[\s\S]*max-width:none/);
  assert.match(css,/\.mural-title-sparkles \.star-1/);
  assert.match(css,/@keyframes mural-title-sparkle/);
  assert.doesNotMatch(mural,/mural-title-drop/);
  assert.doesNotMatch(css,/\.mural-title-drop/);
});
