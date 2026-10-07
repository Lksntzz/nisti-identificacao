import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');

test('Publicar uses a full-page studio instead of a modal', () => {
  assert.ok(admin.includes('mural-publisher-workspace mural-studio-workspace'));
  assert.ok(admin.includes('mural-studio-body'));
  assert.ok(admin.includes('mural-studio-form'));
  assert.ok(admin.includes('<PublishPreviewCard'));
  assert.equal(admin.includes('className="mural-admin-modal" role="dialog"'), false);
});

test('Publicar starts with three explicit content types', () => {
  assert.ok(admin.includes("mural-studio-kind-tabs"));
  for(const label of ['Produto','Informação','Coleção']) assert.ok(admin.includes(`<span>${label}</span>`));
  assert.ok(admin.includes("changeKind('collection')"));
  assert.ok(css.includes('.mural-studio-kind-tabs'));
});

test('product panel contains product search editorial image copy and system action', () => {
  assert.ok(admin.includes('Produto e imagem de destaque'));
  assert.ok(admin.includes('mural-studio-selected-product'));
  assert.ok(admin.includes('Digite o SKU, nome ou código do produto...'));
  assert.ok(admin.includes("Imagem de apoio ou foto real (opcional)"));
  assert.ok(admin.includes('Título da publicação'));
  assert.ok(admin.includes('Descrição curta'));
  assert.ok(admin.includes('Ação no Mural'));
  assert.ok(admin.includes('activeKind === 'collection' ? 'Ver coleção' : activeKind === 'notice' ? 'Ver aviso' : 'Ver produto''));
});

test('information panel has priority category copy and image controls', () => {
  assert.ok(admin.includes('Classificação e imagem do comunicado'));
  assert.ok(admin.includes('Prioridade da publicação'));
  for (const label of ['Normal','Atenção','Importante','COMUNICADO INTERNO','PROCESSO','NOVIDADE']) {
    assert.ok(admin.includes(label), label);
  }
  assert.ok(admin.includes('Título da informação'));
  assert.ok(admin.includes('Linha de apoio'));
  assert.ok(admin.includes('Mensagem completa do aviso'));
});

test('collection panel reuses the same studio hierarchy and official collection API', () => {
  assert.equal((admin.match(/function CollectionEditor/g) || []).length, 1);
  assert.ok(admin.includes('mural-studio-workspace'));
  assert.ok(admin.includes('Produtos da coleção'));
  assert.ok(admin.includes('Ordem de exibição'));
  assert.ok(admin.includes('Arte da coleção (banner 2:1 recomendado)'));
  assert.ok(admin.includes("request('/api/admin/mural/collections', {"));
  assert.ok(admin.includes("onCreateCollection={()=>setCollectionEditor({mode:'new'})}"));
});

test('all publication panels share a right live preview and fixed action hierarchy', () => {
  assert.ok(admin.includes('Prévia 100% interativa'));
  assert.ok(admin.includes('mural-studio-preview-pane'));
  assert.ok(admin.includes('mural-studio-topbar-right'));
  assert.equal((admin.match(/Salvar rascunho/g) || []).length, 1);
  assert.ok(admin.includes("busy ? 'Processando…' : publishLabel"));
  assert.ok(css.includes('.mural-studio-preview-pane'));
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
