import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('Gestão é a visão principal do Catálogo Comercial', () => {
  const shell = read('src/commerce-admin-app-v2.jsx');
  assert.equal(shell.includes("{ id: 'management', label: 'Gestão' }"), true);
  assert.equal(shell.includes("useState('management')"), true);
  assert.equal(shell.includes('CommerceManagementView'), true);
});

test('fonte operacional da Gestão preserva regra de imagem por ano', () => {
  const sql = read('supabase/migrations/20260925170004_commerce_management_rows_v1.sql');
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.replace(/\s+/g, ' ').includes("in ('ML_NOVO','ML_ANTIGO')"), true);
  assert.equal(sql.includes('grant execute on function public.commerce_management_rows_v1'), true);
});

test('Gestão prioriza fontes curadas sem apagar fontes antigas', () => {
  const sql = read('supabase/migrations/20260925170600_commerce_management_curated_sources_v2.sql');
  assert.equal(sql.includes("|| '_GESTAO'"), true);
  assert.equal(sql.includes('linked_image_url'), true);
  assert.equal(sql.includes('linked_image_reference'), true);
});

test('Gestão simplificada cruza produtos por Produto Mestre', () => {
  const sql = read('supabase/migrations/20260925183000_commerce_management_product_cards_v1.sql');

  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes('commerce_management_products_v1'), true);
  assert.equal(sql.includes("'MULTI'"), true);
  assert.equal(sql.includes("'EXCLUSIVE'"), true);
  assert.equal(sql.includes("'UNLINKED'"), true);
  assert.equal(sql.includes("'items',mp.items"), true);
  assert.equal(sql.includes('count(*)::integer as platform_count'), true);
  assert.equal(sql.includes('commerce_preview_management_products_v1'), true);
  assert.equal(sql.includes('commerce_preview_products'), true);
});

test('API expõe cards e resumo da Gestão simplificada', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');

  assert.equal(router.includes('/management/products'), true);
  assert.equal(router.includes('/management/product-summary'), true);
  assert.equal(store.includes("'commerce_management_products_v1'"), true);
  assert.equal(store.includes("'commerce_management_product_summary_v1'"), true);
  assert.equal(store.includes("p_presence: cleanText(filters.presence) || 'LINKED'"), true);
});

test('interface mostra um card por produto e plataformas clicáveis', () => {
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');

  assert.equal(view.includes('Um card por Produto Mestre'), true);
  assert.equal(view.includes('Cadastrado em'), true);
  assert.equal(view.includes('Multiplataforma'), true);
  assert.equal(view.includes('Exclusivo'), true);
  assert.equal(view.includes('Para vincular'), true);
  assert.equal(view.includes('setSelection({ card, platform })'), true);
  assert.equal(view.includes('SKU nesta plataforma'), true);
  assert.equal(view.includes('Origem da foto'), true);
  assert.equal(view.includes('Abrir anúncio'), true);
  assert.equal(css.includes('.commerce-product-card-grid'), true);
  assert.equal(css.includes('.commerce-product-platforms button'), true);
});

test('preview da Gestão continua isolado da produção', () => {
  const workflow = read('.github/workflows/commerce-preview.yml');
  const rpc = read('src/commerce-rpc.js');
  const seed = read('supabase/migrations/20260925181500_commerce_preview_management_v1.sql');
  const cards = read('supabase/migrations/20260925183000_commerce_management_product_cards_v1.sql');

  assert.equal(workflow.includes('feat/commerce-management'), true);
  assert.equal(rpc.includes("return name.replace(/^commerce_/, 'commerce_preview_')"), true);
  assert.equal(seed.includes('commerce_preview_source_files'), true);
  assert.equal(seed.includes('preview_snapshot'), true);
  assert.equal(cards.includes('commerce_preview_management_products_v1'), true);
  assert.equal(cards.includes('commerce_preview_management_product_summary_v1'), true);
});
