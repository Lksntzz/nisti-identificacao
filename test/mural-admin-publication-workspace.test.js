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

test('Nano Banana art studio matches the approved side-panel workflow', () => {
  assert.ok(admin.includes('Arte da publicação'));
  assert.ok(admin.includes('IA · Nano Banana'));
  assert.ok(admin.includes('mural-publisher-ai-style-grid'));
  assert.ok(admin.includes('Gerar arte com IA'));
  assert.ok(admin.includes('Usar esta arte'));
  assert.ok(admin.includes('Gerar outra'));
  assert.ok(admin.includes('Descartar'));
  assert.ok(css.includes('.mural-publisher-art-panel'));
  assert.ok(css.includes('.mural-publisher-art-canvas'));
});

test('workspace remains responsive on tablet and mobile', () => {
  assert.ok(css.includes('@media(max-width:960px)'));
  assert.ok(css.includes('@media(max-width:640px)'));
  assert.ok(css.includes('.mural-publisher-mobile-actions'));
});
