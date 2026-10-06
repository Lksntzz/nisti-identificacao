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
  assert.ok(admin.includes("{collectionEditor&&<CollectionEditor item={collectionEditor.mode==='new'?null:collectionEditor}"));
  assert.ok(admin.includes("section==='collections'&&<button className=\"primary\" onClick={()=>setCollectionEditor({mode:'new'})}>+ Nova coleção</button>"));
});

test('existing collection publication edit also routes to the official CollectionEditor', () => {
  assert.ok(admin.includes("if(row?.kind==='collection')"));
  assert.ok(admin.includes('setCollectionEditor(linked)'));
  assert.ok(admin.includes('onEdit={openPublicationEditor}'));
});

test('publication side panel keeps the manual image workflow', () => {
  assert.ok(admin.includes('Arte da publicação'));
  assert.ok(admin.includes('Envie uma arte pronta para a publicação.'));
  assert.ok(css.includes('.mural-publisher-art-panel'));
});

test('publication action bar stays universal on desktop and mobile', () => {
  assert.ok(admin.includes('mural-publisher-universal-actions'));
  assert.ok(admin.includes('Produto e Aviso usam este editor; Coleção abre o editor oficial de Nova coleção.'));
  assert.equal((admin.match(/Salvar rascunho/g) || []).length, 1);
  assert.ok(css.includes('.mural-publisher-universal-actions'));
});
