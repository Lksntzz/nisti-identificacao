import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('collection editor opens as a full-page Publicar studio instead of a modal',()=>{
  assert.ok(view.includes('mural-publisher-workspace mural-studio-workspace'));
  assert.ok(view.includes('mural-studio-body'));
  assert.ok(view.includes('activeKind={activeKind}'));
  assert.equal(view.includes('className="mural-admin-modal" role="dialog"'),false);
});

test('collection workspace follows the same three-step hierarchy as product and information',()=>{
  assert.ok(view.includes('changeKind('collection')'));
  assert.ok(view.includes("2. Textos e conteúdo da publicação"));
  assert.ok(view.includes("3. Configurações de exibição"));
  assert.ok(view.includes('Nome da coleção'));
  assert.ok(view.includes('Produtos da coleção'));
  assert.ok(view.includes('Detalhes editoriais da coleção'));
});

test('collection layout keeps desktop split preview and responsive single column',()=>{
  assert.ok(css.includes('grid-template-columns: minmax(0, 1.28fr) minmax(390px, 430px)'));
  assert.ok(css.includes('@media (max-width: 1120px)'));
  assert.ok(css.includes('.mural-studio-body'));
});

test('collection editor is returned directly instead of overlaying dashboard',()=>{
  assert.ok(view.includes('if (collectionEditor) {'));
  assert.ok(view.includes('return <CollectionEditor'));
  assert.equal(view.includes('{collectionEditor&&<CollectionEditor'),false);
});
