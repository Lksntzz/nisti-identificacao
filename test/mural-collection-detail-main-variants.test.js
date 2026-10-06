import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('collection detail identifies the first product as the principal cover',()=>{
  assert.ok(mural.includes('CAPA PRINCIPAL'));
  assert.ok(mural.includes('Capa principal da coleção'));
  assert.ok(mural.includes('mural-collection-main-cover'));
  assert.ok(mural.includes('featuredProduct.name || featuredProduct.type'));
  assert.ok(mural.includes('ProductMeta product={{ ...featuredProduct'));
});

test('collection detail renders every remaining product as an informed variation',()=>{
  assert.ok(mural.includes('aria-label="Variações da coleção"'));
  assert.ok(mural.includes('Outras capas da coleção'));
  assert.ok(mural.includes('mural-collection-variant-list'));
  assert.ok(mural.includes('mural-collection-variant-card'));
  assert.ok(mural.includes("VARIAÇÃO {String(index + 1).padStart(2,'0')}"));
  assert.ok(mural.includes('mural-collection-variant-sku'));
  assert.ok(mural.includes('<CollectionFinishChips product={product} />'));
});

test('mobile collection variants use horizontal readable cards',()=>{
  assert.ok(css.includes('.mural-collection-variant-card{'));
  assert.ok(css.includes('grid-template-columns:minmax(0,42%) minmax(0,1fr)'));
  assert.ok(css.includes('@media (max-width:430px)'));
  assert.ok(css.includes('grid-template-columns:minmax(0,43%) minmax(0,1fr)'));
  assert.ok(css.includes('.mural-collection-variant-copy .mural-collection-finish-chips'));
});

test('collection header reports principal cover and variation count',()=>{
  assert.ok(mural.includes("1 capa principal +"));
  assert.ok(mural.includes("variaç"));
});
