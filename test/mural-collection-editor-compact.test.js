import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('collection banner picker remains custom and readable',()=>{
  assert.ok(view.includes('className="mural-collection-file-picker"'));
  assert.ok(view.includes('className="mural-collection-file-row"'));
  assert.ok(view.includes('>Escolher imagem</b>'));
  assert.ok(view.includes('className="mural-collection-file-input"'));
  assert.ok(css.includes('opacity:0'));
});

test('collection product selection has its own organized panel',()=>{
  assert.ok(view.includes('.slice(0,8)'));
  assert.ok(view.includes('mural-collection-products-panel'));
  assert.ok(view.includes('selectedProducts.slice(0,6)'));
  assert.ok(view.includes('Ordem da coleção'));
  assert.ok(css.includes('max-height:280px'));
});

test('collection fields no longer use tiny compact modal typography',()=>{
  assert.equal(css.includes('/* Compact collection editor: fit desktop viewport without page scrolling */'),false);
  assert.ok(css.includes('.mural-collection-workspace label'));
  assert.ok(css.includes('font-size:11.5px'));
  assert.ok(css.includes('font-size:13px'));
});
