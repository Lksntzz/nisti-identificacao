import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');

test('Publicar uses the Canva-inspired full-page studio instead of a modal', () => {
  assert.ok(admin.includes('mural-publisher-workspace mural-publish-v2'));
  assert.ok(admin.includes('mural-publish-v2-shell'));
  assert.ok(admin.includes('mural-publish-v2-form'));
  assert.ok(admin.includes('<PublishPreviewCard'));
  assert.equal(admin.includes('className="mural-admin-modal" role="dialog"'), false);
});

test('Publicar starts with three explicit content types', () => {
  assert.ok(admin.includes("['product','product','Produto','Destaque um produto específico no Mural.']"));
  assert.ok(admin.includes("['notice','document','Informação','Comunique avisos e informações importantes.']"));
  assert.ok(admin.includes("['collection','collection','Coleção','Crie uma coleção com produtos e temas.']"));
  assert.ok(admin.includes('Escolha o tipo de publicação'));
  assert.ok(admin.includes('mural-publish-v2-empty-state'));
  assert.ok(css.includes('.mural-publish-v2-type-grid'));
});

test('product panel contains product search editorial image copy and system action', () => {
  assert.ok(admin.includes('Produto em destaque'));
  assert.ok(admin.includes('mural-publish-v2-selected-product'));
  assert.ok(admin.includes('Digite o nome, código ou SKU do produto...'));
  assert.ok(admin.includes("title = 'Imagem editorial (opcional)'"));
  assert.ok(admin.includes('Título da publicação'));
  assert.ok(admin.includes('Descrição curta'));
  assert.ok(admin.includes('Ação no Mural'));
  assert.ok(admin.includes('value="Ver produto"'));
});

test('information panel has priority category copy and image controls', () => {
  assert.ok(admin.includes('Informação para operadores'));
  assert.ok(admin.includes('Prioridade da publicação'));
  for (const label of ['Normal','Atenção','Importante','COMUNICADO INTERNO','PROCESSO','NOVIDADE']) {
    assert.ok(admin.includes(label), label);
  }
  assert.ok(admin.includes('Título da informação'));
  assert.ok(admin.includes('Linha de apoio'));
  assert.ok(admin.includes('Mensagem'));
});

test('collection panel reuses the same studio hierarchy and official collection API', () => {
  assert.equal((admin.match(/function CollectionEditor/g) || []).length, 1);
  assert.ok(admin.includes('mural-publish-v2-collection'));
  assert.ok(admin.includes('Produtos da coleção'));
  assert.ok(admin.includes('Ordem de exibição'));
  assert.ok(admin.includes('Arte da coleção'));
  assert.ok(admin.includes("request(item?\`/api/admin/mural/collections/\${item.id}\`:'/api/admin/mural/collections'"));
  assert.ok(admin.includes("onCreateCollection={()=>setCollectionEditor({mode:'new'})}"));
});

test('all publication panels share a right live preview and fixed action hierarchy', () => {
  assert.ok(admin.includes('Visualize como sua publicação será exibida no app dos operadores.'));
  assert.ok(admin.includes('mural-publish-v2-preview'));
  assert.ok(admin.includes('mural-publish-v2-actions'));
  assert.equal((admin.match(/Salvar rascunho/g) || []).length, 1);
  assert.ok(admin.includes("busy?'Processando…':'Publicar'"));
  assert.ok(css.includes('position:sticky'));
});

test('publication settings expose featured scheduling expiration and order', () => {
  assert.ok(admin.includes('Fixar no topo do Mural'));
  assert.ok(admin.includes('Publicar em'));
  assert.ok(admin.includes('Expira em'));
  assert.ok(admin.includes('Ordem'));
  assert.ok(css.includes('.mural-publish-v2-settings-grid'));
});

test('studio is responsive without a duplicate mobile implementation', () => {
  assert.ok(css.includes('@media(max-width:900px)'));
  assert.ok(css.includes('.mural-publish-v2-shell{grid-template-columns:1fr}'));
  assert.ok(css.includes('@media(max-width:620px)'));
});
