import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');

test('publication editor opens as an inline workspace instead of a modal', () => {
  assert.ok(admin.includes("if (editor) {"));
  assert.ok(admin.includes('<PostEditor'));
  assert.ok(admin.includes('className="mural-publisher-workspace"'));
  assert.ok(admin.includes('className="mural-publisher-layout"'));
  assert.equal(admin.includes('{editor&&<PostEditor'), false);
});

test('new publication editor contains only product and notice', () => {
  assert.ok(admin.includes("['product','product','Produto','Destaque um produto específico.']"));
  assert.ok(admin.includes("['notice','notice','Aviso','Comunicado para operadores.']"));
  assert.equal(admin.includes("['collection','collection'"), false);
  assert.ok(admin.includes('Editor universal do Mural para Produto ou Aviso.'));
  assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
});

test('collection creation and editing stay exclusively in the Collections editor', () => {
  assert.equal((admin.match(/<CollectionEditor/g) || []).length, 1);
  assert.equal((admin.match(/\+ Nova coleção/g) || []).length, 1);
  assert.ok(admin.includes("section==='collections'&&<button className=\"primary\" onClick={()=>setCollectionEditor({mode:'new'})}>+ Nova coleção</button>"));
  assert.equal(admin.includes('Publicar coleção existente'), false);
  assert.equal(admin.includes("form.kind === 'collection' && ("), false);
  assert.equal(admin.includes('mural-publisher-collection-products'), false);
});

test('existing collection publication edit routes to the official CollectionEditor', () => {
  assert.ok(admin.includes("if(row?.kind==='collection')"));
  assert.ok(admin.includes("const linked=collections.find(collection=>Number(collection.id)===Number(row.collection_id))"));
  assert.ok(admin.includes('setCollectionEditor(linked)'));
  assert.ok(admin.includes('onEdit={openPublicationEditor}'));
});

test('publication side panel keeps only the manual image workflow', () => {
  assert.ok(admin.includes('Arte da publicação'));
  assert.ok(admin.includes('Envie uma arte pronta para a publicação.'));
  assert.equal(admin.includes('Preparar versões de prompt'), false);
  assert.ok(css.includes('.mural-publisher-art-panel'));
});

test('workspace uses one universal action interface on desktop and mobile', () => {
  assert.ok(admin.includes('mural-publisher-universal-actions'));
  assert.equal(admin.includes('mural-publisher-mobile-actions'), false);
  assert.equal(admin.includes('mural-publisher-header-actions'), false);
  assert.ok(admin.includes('Fluxo único para Produto ou Aviso. Coleções usam o editor próprio.'));
  assert.equal((admin.match(/Salvar rascunho/g) || []).length, 1);
  assert.ok(css.includes('.mural-publisher-universal-actions'));
  assert.ok(css.includes('@media(max-width:640px)'));
});

test('collection-specific publisher UI and CSS are removed instead of hidden', () => {
  assert.equal(admin.includes('mural-publisher-collection-source'), false);
  assert.equal(admin.includes('mural-publisher-collection-empty'), false);
  assert.equal(css.includes('.mural-publisher-collection-source'), false);
  assert.equal(css.includes('.mural-publisher-collection-empty'), false);
  assert.equal(css.includes('.mural-publisher-collection-products'), false);
});
