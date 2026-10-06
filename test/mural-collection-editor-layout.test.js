import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('collection editor opens as a full-page Publicar studio instead of a modal',()=>{
  assert.ok(view.includes('mural-collection-workspace mural-publish-v2 mural-publish-v2-collection'));
  assert.ok(view.includes('mural-publish-v2-shell'));
  assert.ok(view.includes('<PublishPreviewCard activeKind="collection"'));
  assert.equal(view.includes('className="mural-admin-modal" role="dialog"'),false);
});

test('collection workspace follows the same three-step hierarchy as product and information',()=>{
  assert.ok(view.includes('<PublishTypeSelector activeKind="collection"'));
  assert.ok(view.includes("mural-publish-v2-step-number\">2"));
  assert.ok(view.includes("mural-publish-v2-step-number\">3"));
  assert.ok(view.includes('Nova coleção'));
  assert.ok(view.includes('Produtos da coleção'));
  assert.ok(view.includes('Configurações de publicação'));
});

test('collection layout keeps desktop split preview and responsive single column',()=>{
  assert.ok(css.includes('grid-template-columns:minmax(0,1fr) minmax(330px,370px)'));
  assert.ok(css.includes('@media(max-width:900px)'));
  assert.ok(css.includes('.mural-publish-v2-shell{grid-template-columns:1fr}'));
});

test('collection editor is returned directly instead of overlaying dashboard',()=>{
  assert.ok(view.includes('if (collectionEditor) {'));
  assert.ok(view.includes('return <CollectionEditor'));
  assert.equal(view.includes('{collectionEditor&&<CollectionEditor'),false);
});
