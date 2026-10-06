import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('collection editor keeps desktop content compact without vertical scrolling',()=>{
  assert.ok(css.includes('/* Compact collection editor: fit desktop viewport without page scrolling */'));
  assert.ok(css.includes('.mural-admin-collection-body{\n  overflow:hidden;'));
  assert.ok(css.includes('height:calc(100vh - 20px)'));
  assert.ok(css.includes('grid-template-columns:minmax(0,1.18fr) minmax(300px,.82fr)'));
});

test('collection banner file picker is compact and native filename control is hidden',()=>{
  assert.ok(view.includes('className="mural-collection-file-picker"'));
  assert.ok(view.includes('className="mural-collection-file-row"'));
  assert.ok(view.includes('>Escolher imagem</b>'));
  assert.ok(view.includes('className="mural-collection-file-input"'));
  assert.ok(css.includes('opacity:0'));
});

test('product selection moves to preview column and limits visible search results',()=>{
  assert.ok(view.includes('.slice(0,8)'));
  assert.ok(view.includes('mural-admin-collection-products-compact'));
  assert.ok(view.includes('selectedProducts.slice(0,4)'));
  assert.ok(css.includes('max-height:none;\n  overflow:visible;'));
});
