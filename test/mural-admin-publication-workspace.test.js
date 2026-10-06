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
});

test('New publication exposes Product Notice and Collection', () => {
  assert.ok(admin.includes("['product','product','Produto','Destaque um produto específico.']"));
  assert.ok(admin.includes("['notice','notice','Aviso','Comunicado para operadores.']"));
  assert.ok(admin.includes("['collection','collection','Coleção','Use a mesma interface de Nova coleção.']"));
  assert.ok(admin.includes("value==='collection'?onCreateCollection():changeKind(value)"));
  assert.ok(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));
});

test('Collection from New publication reuses the exact official CollectionEditor', () => {
  assert.equal((admin.match(/function CollectionEditor/g) || []).length, 1);
  assert.ok(admin.includes("onCreateCollection={()=>{setEditor(null);setCollectionEditor({mode:'new'})}}"));
  assert.ok(admin.includes('if (collectionEditor) {'));
  assert.ok(admin.includes('return <CollectionEditor'));
  assert.ok(admin.includes("section==='collections'&&<button className=\"primary\" onClick={()=>setCollectionEditor({mode:'new'})}>+ Nova coleção</button>"));
});

test('existing collection publication edit also routes to the official CollectionEditor', () => {
  assert.ok(admin.includes("if(row?.kind==='collection')"));
  assert.ok(admin.includes('setCollectionEditor(linked)'));
  assert.ok(admin.includes('onEdit={openPublicationEditor}'));
});

test('publication side panel keeps the manual image workflow', () => {
  assert.ok(admin.includes('Arte da publicação'));
  assert.ok(admin.includes('Opcional. Use uma arte pronta quando necessário.'));
  assert.ok(css.includes('.mural-publisher-art-panel'));
});

test('publication action bar stays universal on desktop and mobile', () => {
  assert.ok(admin.includes('mural-publisher-universal-actions'));
  assert.ok(admin.includes('Produto e Aviso usam este editor; Coleção abre o editor oficial de Nova coleção.'));
  assert.equal((admin.match(/Salvar rascunho/g) || []).length, 1);
  assert.ok(css.includes('.mural-publisher-universal-actions'));
});


test('publication and collection editors share one full-page panel system', () => {
  assert.ok(css.includes('.mural-publisher-workspace,'));
  assert.ok(css.includes('.mural-collection-workspace{'));
  assert.ok(css.includes('max-width:1480px'));
  assert.ok(admin.includes('mural-publisher-universal-actions mural-collection-universal-actions'));
});


test('product publication has a product-first hierarchy instead of the generic long form', () => {
  assert.ok(admin.includes('mural-publisher-product-panel'));
  assert.ok(admin.includes('Escolha o produto primeiro'));
  assert.ok(admin.includes('mural-publisher-selected-product'));
  assert.ok(admin.includes('PRODUTO SELECIONADO'));
  assert.ok(admin.includes('mural-publisher-copy-panel'));
  assert.ok(css.includes('.mural-publisher-selected-product'));
  assert.ok(css.includes('.mural-publisher-copy-grid'));
});

test('notice publication has a dedicated message and priority panel', () => {
  assert.ok(admin.includes('mural-publisher-notice-panel'));
  assert.ok(admin.includes('Monte o aviso em uma única área'));
  assert.ok(admin.includes('mural-publisher-notice-levels'));
  assert.ok(admin.includes('Título do aviso'));
  assert.ok(admin.includes('Mensagem<textarea'));
  assert.ok(css.includes('.mural-publisher-notice-levels'));
  assert.ok(css.includes('.mural-publisher-notice-copy'));
});

test('product and notice share compact controls and a contextual right preview', () => {
  assert.ok(admin.includes('mural-publisher-controls-grid'));
  assert.ok(admin.includes('mural-publisher-preview-context'));
  assert.ok(admin.includes('Prévia da publicação de produto'));
  assert.ok(admin.includes('Prévia do aviso'));
  assert.ok(css.includes('grid-template-columns:minmax(0,1fr) minmax(320px,370px)'));
  assert.ok(css.includes('.mural-publisher-preview-reference'));
  assert.ok(css.includes('.mural-publisher-preview-notice'));
});
