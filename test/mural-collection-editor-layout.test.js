import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('collection editor opens as a full-page workspace instead of a modal',()=>{
  assert.ok(view.includes('className="mural-collection-workspace"'));
  assert.ok(view.includes('className="mural-collection-workspace-layout"'));
  assert.ok(view.includes('className="mural-collection-workspace-form"'));
  assert.ok(view.includes('className="mural-collection-workspace-preview"'));
  assert.equal(view.includes('className="mural-admin-modal" role="dialog"'),false);
  assert.equal(view.includes('mural-admin-editor mural-admin-collection-editor'),false);
});

test('collection workspace follows the same hierarchy as publication workspace',()=>{
  assert.ok(view.includes('mural-publisher-breadcrumb'));
  assert.ok(view.includes('mural-publisher-header mural-collection-workspace-header'));
  assert.ok(view.includes('mural-publisher-universal-actions mural-collection-universal-actions'));
  assert.ok(view.includes('Dados da coleção'));
  assert.ok(view.includes('Banner da coleção'));
  assert.ok(view.includes('Capas da coleção'));
});

test('collection workspace uses a readable two-column desktop layout and one column on smaller screens',()=>{
  assert.ok(css.includes('grid-template-columns:minmax(560px,1.08fr) minmax(380px,.92fr)'));
  assert.ok(css.includes('@media(max-width:960px)'));
  assert.ok(css.includes('.mural-collection-workspace-layout{\n    grid-template-columns:1fr;'));
});

test('collection editor is returned directly instead of overlaying the dashboard',()=>{
  assert.ok(view.includes('if (collectionEditor) {'));
  assert.ok(view.includes('return <CollectionEditor'));
  assert.equal(view.includes('{collectionEditor&&<CollectionEditor'),false);
});
