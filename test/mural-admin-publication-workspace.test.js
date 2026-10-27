import { muralAdminSource } from './helpers/mural-admin-source.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = muralAdminSource;
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');

test('Publicar uses a full-page studio instead of a modal', () => {
  assert.ok(admin.includes('mural-publisher-workspace mural-studio-workspace'));
  assert.ok(admin.includes('mural-studio-body'));
  assert.ok(admin.includes('mural-studio-form'));
  assert.ok(admin.includes('<PublishPreviewCard'));
  assert.equal(admin.includes('className="mural-admin-modal" role="dialog"'), false);
});

test('Publicar starts with three explicit content types', () => {
  assert.ok(admin.includes('className="nps-kinds" role="tablist"'));
  for(const label of ['Produto','Informação','Coleção']) assert.ok(admin.includes(`', '${label}', '`));
  assert.ok(admin.includes('onClick={() => changeKind(key)}'));
  assert.ok(css.includes('.nps-kinds'));
});

test('product panel contains product search editorial image copy and system action', () => {
  assert.ok(admin.includes('Qual produto?'));
  assert.ok(admin.includes('mural-studio-selected-product'));
  assert.ok(admin.includes('Digite o SKU, nome ou código do produto...'));
  assert.ok(admin.includes("Imagem de apoio ou foto real (opcional)"));
  assert.ok(admin.includes('Título da publicação'));
  assert.ok(admin.includes('Descrição curta'));
  assert.ok(!admin.includes('Ação no Mural'), 'campo fixo e não editável foi removido');
  assert.ok(admin.includes("cta: activeKind === 'collection' ? 'Ver coleção' : activeKind === 'product' ? 'Ver produto' : 'Ver aviso'"));
});

test('information panel has priority category copy and image controls', () => {
  assert.ok(admin.includes('Prioridade, tipo e imagem'));
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
  assert.ok(admin.includes('mural-studio-preview-pane nps-side'));
  assert.ok(admin.includes('nps-topbar-actions'));
  assert.ok(admin.includes('nps-checklist'));
  assert.equal((admin.match(/setCanvaModalOpen\(true\)/g) || []).length, 1, 'um único botão do Canva');
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

test('trocar o tipo de publicacao nao copia dados entre Produto, Informacao e Colecao', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/admin/MuralPublishWorkspace.jsx', 'utf8');
  assert.match(src, /draftsRef\.current\[activeKind\] = \{ form, image, selectedProduct, productQuery \}/);
  assert.match(src, /setForm\(saved\?\.form \|\| freshPostForm\(nextKind\)\)/);
  assert.match(src, /setImage\(saved\?\.image \|\| null\)/);
});

test('painel Publicar: aviso comeca por "O que dizer" e as datas ficam visiveis fora de "Mais opções"', () => {
  assert.ok(admin.includes("{activeKind === 'notice' && copyCard}"));
  assert.ok(admin.includes("{activeKind !== 'notice' && copyCard}"));
  assert.ok(admin.includes('Quando aparece no Mural'));
  const more = admin.slice(admin.indexOf('<details className="mural-studio-card nps-more">'));
  assert.ok(!more.slice(0, more.indexOf('</details>')).includes('Publicar em'));
});

test('painel Publicar compacto: formulario recebe classe do tipo e grade de 2 colunas em tela larga', () => {
  assert.ok(admin.includes('mural-studio-form is-${activeKind}'));
  for (const kind of ['notice', 'product', 'collection']) {
    assert.ok(css.includes(`.mural-studio-form.is-${kind}>:nth-child(2)`), kind);
  }
  assert.ok(css.includes('align-content:start'));
});
