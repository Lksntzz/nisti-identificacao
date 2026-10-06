import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('collection editor uses a dedicated wide two-column layout',()=>{
  assert.ok(view.includes('mural-admin-editor mural-admin-collection-editor'));
  assert.ok(view.includes('mural-admin-collection-body'));
  assert.ok(view.includes('mural-admin-collection-fields'));
  assert.ok(view.includes('mural-admin-collection-preview-pane'));
  assert.equal(view.includes('mural-admin-editor compact"><header><h2>{item?\'Editar coleção\''),false);
  assert.ok(css.includes('grid-template-columns:minmax(0,1.25fr) minmax(330px,.75fr)'));
});

test('collection actions remain outside the scrolling body',()=>{
  const bodyEnd=view.indexOf('</aside>\n        </div>\n        <div className="mural-admin-actions mural-admin-collection-actions">');
  assert.ok(bodyEnd>0);
  assert.ok(css.includes('grid-template-rows:minmax(0,1fr) auto'));
  assert.ok(css.includes('.mural-admin-collection-actions'));
});

test('collection editor collapses to one column on smaller screens',()=>{
  assert.ok(css.includes('@media(max-width:980px)'));
  assert.ok(css.includes('.mural-admin-collection-body{\n    grid-template-columns:1fr;'));
});
