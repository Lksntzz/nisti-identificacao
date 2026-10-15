import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');
test('secondary collection uses official uploaded banner ahead of product collage irrespective of featured flag',()=>{
  const begin=source.indexOf('export function CollectionLaunchCard(');
  const end=source.indexOf('export function MuralCard(',begin);
  const card=source.slice(begin,end);
  assert.match(card,/const hasBanner = Boolean\(item\.image_url\)/);
  assert.match(card,/has-editorial-banner/);
  assert.match(card,/hasBanner && \(/);
  assert.match(card,/mural-collection-secondary-banner-image/);
  assert.match(card,/!hasBanner && <span className="mural-collection-launch-products"/);
  assert.doesNotMatch(card,/item\.featured/);
});
test('banner artwork fills the secondary card without replacing collection detail behavior',()=>{
  assert.match(css,/\.mural-collection-secondary-banner-image/);
  assert.match(css,/object-fit:cover/);
  assert.match(css,/\.mural-collection-launch-card\.has-editorial-banner/);
  assert.match(source,/aria-label={`Abrir coleção \$\{title\}`}/);
});