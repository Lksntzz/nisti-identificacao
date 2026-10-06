import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('collection image picker follows the shared Publicar image component',()=>{
  assert.ok(view.includes('title="Arte da coleção"'));
  assert.ok(view.includes('Recomendado: banner horizontal 2:1'));
  assert.ok(view.includes('mural-publish-v2-image-preview'));
  assert.ok(css.includes('.mural-publish-v2-upload'));
});

test('collection product selection is searchable visual and ordered',()=>{
  assert.ok(view.includes('.slice(0,8)'));
  assert.ok(view.includes('mural-publish-v2-collection-product-grid'));
  assert.ok(view.includes('mural-publish-v2-order-list'));
  assert.ok(view.includes('Ordem de exibição'));
  assert.ok(css.includes('max-height:184px'));
});

test('collection advanced metadata stays available without cluttering the main panel',()=>{
  assert.ok(view.includes('mural-publish-v2-collection-advanced'));
  assert.ok(view.includes('Direção visual'));
  assert.ok(view.includes('Elementos / cores do tema'));
  assert.ok(view.includes('Descrição da coleção'));
});
