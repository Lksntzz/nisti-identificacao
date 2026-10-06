import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');

test('publication editor opens as an inline workspace instead of a modal', () => {
  assert.ok(admin.includes("if (editor) {"));
  assert.ok(admin.includes('return <PostEditor'));
  assert.ok(admin.includes('className="mural-publisher-workspace"'));
  assert.ok(admin.includes('className="mural-publisher-layout"'));
  assert.equal(admin.includes('{editor&&<PostEditor'), false);
});

test('publication workspace uses the approved three-type visual selector', () => {
  assert.ok(admin.includes("['product','product','Produto','Destaque um produto específico.']"));
  assert.ok(admin.includes("['collection','collection','Coleção','Destaque uma coleção de produtos.']"));
  assert.ok(admin.includes("['notice','notice','Aviso','Comunicado para operadores.']"));
  assert.ok(admin.includes('mural-publisher-type-grid'));
  assert.ok(css.includes('.mural-publisher-type-grid'));
});

test('collection publication shows real collection products in the editor', () => {
  assert.ok(admin.includes("const selectedCollectionProducts = String(selectedCollection?.product_ids || '')"));
  assert.ok(admin.includes('mural-publisher-collection-products'));
  assert.ok(admin.includes('catalogProducts={products}'));
  assert.ok(css.includes('.mural-publisher-collection-products'));
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
  assert.ok(admin.includes('Fluxo único para Produto, Coleção ou Aviso.'));
  assert.equal((admin.match(/Salvar rascunho/g) || []).length, 1);
  assert.ok(css.includes('.mural-publisher-universal-actions'));
  assert.ok(css.includes('@media(max-width:640px)'));
});


test('universal Mural publisher keeps one editor for product collection and notice', () => {
  assert.ok(admin.includes('Editor universal do Mural para Produto, Coleção ou Aviso.'));
  assert.ok(admin.includes("form.kind === 'product'"));
  assert.ok(admin.includes("form.kind === 'collection'"));
  assert.ok(admin.includes("form.kind === 'notice'"));
  assert.equal((admin.match(/aria-label="Ações da publicação"/g) || []).length, 1);
});
