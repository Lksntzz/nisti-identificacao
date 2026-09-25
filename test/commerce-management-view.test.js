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

test('Gestão possui endpoint e RPC próprios somente de leitura', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const sql = read('supabase/migrations/20260925170004_commerce_management_rows_v1.sql');
  assert.equal(router.includes('/management'), true);
  assert.equal(store.includes("'commerce_management_rows_v1'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.includes("source_code)='ML_NOVO'"), false);
  assert.equal(sql.replace(/\s+/g, ' ').includes("in ('ML_NOVO','ML_ANTIGO')"), true);
  assert.equal(sql.includes('grant execute on function public.commerce_management_rows_v1'), true);
});

test('Gestão separa fontes operacionais e mostra origem da imagem', () => {
  const view = read('src/commerce-management-view.jsx');
  for (const source of ['SHOPEE', 'ML_NOVO', 'ML_ANTIGO', 'AMAZON', 'SHEIN']) {
    assert.equal(view.includes(source), true, source);
  }
  assert.equal(view.includes('Origem da imagem'), true);
  assert.equal(view.includes('Outra plataforma compatível'), true);
  assert.equal(view.includes('Produto Mestre'), true);
  assert.equal(view.includes('Abrir anúncio'), true);
});


test('Gestão prioriza fonte curada sem alterar a fonte comercial original', () => {
  const sql = read('supabase/migrations/20260925170600_commerce_management_curated_sources_v2.sql');
  assert.equal(sql.includes("|| '_GESTAO'"), true);
  assert.equal(sql.includes("linked_image_url"), true);
  assert.equal(sql.includes("linked_image_reference"), true);
  assert.equal(sql.includes("like '%IN STOCK%'"), true);
  assert.equal(sql.includes("then 'ACTIVE'"), true);
  assert.equal(sql.includes("then 'OTHER_MARKETPLACE'"), true);
});


test('painel de Gestão compara o mesmo produto entre plataformas', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const view = read('src/commerce-management-view.jsx');
  const sql = read('supabase/migrations/20260925172400_commerce_management_detail_v1.sql');

  assert.equal(router.includes('managementDetailMatch'), true);
  assert.equal(router.includes('commerceManagementDetail(env, sourceRowId)'), true);
  assert.equal(store.includes("'commerce_management_detail_v1'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes("o.source_code||'_GESTAO'"), true);
  assert.equal(view.includes('Mesmo produto em outras plataformas'), true);
  assert.equal(view.includes('Pendências'), true);
  assert.equal(view.includes('Sem foto segura'), true);
  assert.equal(view.includes('/management/${sourceRowId}/details'), true);
});


test('indicadores usam totais da plataforma inteira', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const view = read('src/commerce-management-view.jsx');
  const sql = read('supabase/migrations/20260925173500_commerce_management_summary_v1.sql');

  assert.equal(router.includes('/management/summary'), true);
  assert.equal(store.includes("'commerce_management_summary_v1'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes("'with_image'"), true);
  assert.equal(sql.includes("'without_image'"), true);
  assert.equal(sql.includes("'with_video'"), true);
  assert.equal(sql.includes("'verify'"), true);
  assert.equal(view.includes('summary?.total'), true);
  assert.equal(view.includes('summary?.without_image'), true);
  assert.equal(view.includes('produtos da plataforma'), true);
  assert.equal(view.includes('nesta página'), false);
});


test('Gestão possui filtros completos por plataforma', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const view = read('src/commerce-management-view.jsx');
  const sql = read('supabase/migrations/20260925174800_commerce_management_filters_v1.sql');

  assert.equal(router.includes('/management/options'), true);
  assert.equal(store.includes("'commerce_management_filter_options_v1'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes("'NEEDS_REVIEW'"), true);
  assert.equal(view.includes('Categoria: todas'), true);
  assert.equal(view.includes('Ano: todos'), true);
  assert.equal(view.includes('Status: todos'), true);
  assert.equal(view.includes('Verificar pendências'), true);
  assert.equal(view.includes("params.set('category', category)"), true);
  assert.equal(view.includes("params.set('year', year)"), true);
  assert.equal(view.includes("params.set('listing_status', listingStatus)"), true);
  assert.equal(view.includes("setRelationStatus('NEEDS_REVIEW')"), true);
  assert.equal(view.includes('Limpar filtros'), true);
});


test('linhas da Gestão destacam atenção visualmente', () => {
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');

  assert.equal(view.includes('function rowVisualState(item)'), true);
  assert.equal(view.includes("level: 'attention'"), true);
  assert.equal(view.includes("level: 'review'"), true);
  assert.equal(view.includes("level: 'ok'"), true);
  assert.equal(view.includes('commerce-management-row-state'), true);
  assert.equal(view.includes('commerce-management-product-cell'), true);
  assert.equal(css.includes('.commerce-management-row.attention'), true);
  assert.equal(css.includes('.commerce-management-row.review'), true);
  assert.equal(css.includes('.commerce-management-row.ok'), true);
  assert.equal(css.includes('position:sticky'), true);
});


test('Gestão ordena itens por prioridade visual', () => {
  const view = read('src/commerce-management-view.jsx');

  assert.equal(view.includes('function rowPriority(item)'), true);
  assert.equal(view.includes("state.level === 'attention'"), true);
  assert.equal(view.includes("state.level === 'review'"), true);
  assert.equal(view.includes('const orderedItems = [...items].sort'), true);
  assert.equal(view.includes('{orderedItems.map(item => {'), true);
  assert.equal(view.includes('source_row_number || a.source_row_id'), true);
});


test('prioridade é aplicada antes da paginação da Gestão', () => {
  const sql = read('supabase/migrations/20260925180500_commerce_management_priority_order.sql');

  const orderIndex = sql.indexOf('order by');
  const limitIndex = sql.indexOf('limit least');
  assert.equal(orderIndex >= 0, true);
  assert.equal(limitIndex > orderIndex, true);
  assert.equal(sql.includes("r.resolved_image_url is null"), true);
  assert.equal(sql.includes("r.normalized_relation_status='UNMATCHED'"), true);
  assert.equal(sql.includes("r.normalized_update_status='NOT_UPDATED'"), true);
  assert.equal(sql.includes("r.normalized_video_status in ('UNKNOWN','NO_DATA','DISABLED')"), true);
  assert.equal(sql.includes('r.source_row_number'), true);
});


test('preview da Gestão usa sandbox comercial isolado', () => {
  const workflow = read('.github/workflows/commerce-preview.yml');
  const rpc = read('src/commerce-rpc.js');
  const sql = read('supabase/migrations/20260925181500_commerce_preview_management_v1.sql');

  assert.equal(workflow.includes("feat/commerce-management"), true);
  assert.equal(rpc.includes("return name.replace(/^commerce_/, 'commerce_preview_')"), true);
  assert.equal(sql.includes('commerce_preview_management_rows_v1'), true);
  assert.equal(sql.includes('commerce_preview_management_summary_v1'), true);
  assert.equal(sql.includes('commerce_preview_management_detail_v1'), true);
  assert.equal(sql.includes('commerce_preview_management_filter_options_v1'), true);
  assert.equal(sql.includes('commerce_preview_source_files'), true);
  assert.equal(sql.includes("preview_snapshot"), true);
});
