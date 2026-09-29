import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('ponte NISTI ID -> Catálogo usa vínculo permanente e SKU exato', () => {
  const sql = read('supabase/migrations/20260928162216_nisti_id_commerce_product_sync_v1.sql');

  assert.equal(sql.includes('commerce_nisti_product_links'), true);
  assert.equal(sql.includes('nisti_product_id bigint primary key'), true);
  assert.equal(sql.includes('upper(btrim(sku))=v_sku'), true);
  assert.equal(sql.includes("'CONFLICT'"), true);
  assert.equal(sql.includes("'CREATED'"), true);
  assert.equal(sql.includes("'LINKED'"), true);
  assert.equal(sql.includes("'UPDATED'"), true);
  assert.equal(sql.includes('enable row level security'), true);
  assert.equal(sql.includes('to service_role'), true);
});

test('sincronização preserva dados específicos do NISTI ID no payload e atualiza campos compatíveis', () => {
  const helper = read('src/nisti-commerce-sync.js');
  const sql = read('supabase/migrations/20260928162216_nisti_id_commerce_product_sync_v1.sql');

  for (const field of ['miolo_code', 'capa_code', 'acabamento_code', 'wireo_code', 'tassel_code', 'elastico_code', 'gtin']) {
    assert.equal(helper.includes(field), true, `${field} deve seguir no payload da ponte`);
  }

  assert.equal(sql.includes('name=coalesce(v_name,name)'), true);
  assert.equal(sql.includes('reference_image_url=coalesce(v_image,reference_image_url)'), true);
  assert.equal(sql.includes("reference_image_source=case when v_image is not null then 'NISTI_ID'"), true);
});

test('cadastro, edição, imagem e lote do NISTI ID acionam a sincronização', () => {
  const core = read('src/core-router.js');

  assert.equal(core.includes('syncNistiProductToCommerceSafe'), true);
  assert.equal(core.includes('syncNistiProductsToCommerce'), true);
  assert.equal(core.includes("commerce_sync: commerceSync"), true);
  assert.equal(core.includes("syncCommerce: false"), true);
  assert.equal(core.includes("/api/admin/commerce-sync/nisti-products"), true);
});

test('reconciliação inicial usa o banco operacional do NISTI ID e não o mirror antigo', () => {
  const helper = read('src/nisti-commerce-sync.js');
  const main = read('src/main.jsx');

  assert.equal(helper.includes("FROM products p"), true);
  assert.equal(helper.includes("SELECT COUNT(*) AS total FROM products"), true);
  assert.equal(main.includes("/api/admin/commerce-sync/nisti-products"), true);
  assert.equal(main.includes("nisti_commerce_initial_sync_v1"), true);
});

test('preview não escreve no catálogo live', () => {
  const helper = read('src/nisti-commerce-sync.js');

  assert.equal(helper.includes("COMMERCE_DATA_SCOPE"), true);
  assert.equal(helper.includes("preview_scope"), true);
  assert.equal(helper.includes("skipped: true"), true);
});


test('sincronização reconhece SKU normalizado e família anual sem misturar acabamento', () => {
  const sql = read('supabase/migrations/20260928165350_nisti_id_commerce_family_sync_v2.sql');

  assert.equal(sql.includes('commerce_nisti_sku_norm_v1'), true);
  assert.equal(sql.includes("'LINKED_NORMALIZED'"), true);
  assert.equal(sql.includes("'LINKED_FAMILY'"), true);
  assert.equal(sql.includes("ps.sku_type='CURRENT'"), true);
  assert.equal(sql.includes("->>'signature'"), true);
  assert.equal(sql.includes("->>'finish'"), true);
  assert.equal(sql.includes("sku_type='HISTORICAL',is_active=false"), true);
  assert.equal(sql.includes("reference_image_source=case when v_image is not null then 'NISTI_ID'"), true);
});

test('Catálogo prioriza a imagem atual do NISTI ID no Produto Mestre', () => {
  const sql = read('supabase/migrations/20260928165507_commerce_management_nisti_master_image_priority_v1.sql');

  assert.equal(sql.includes("cp.reference_image_source='NISTI_ID'"), true);
  assert.equal(sql.includes('cp.reference_image_url'), true);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.includes('commerce_enrich_management_platforms_v1'), true);
});


test('NISTI ID promove o SKU anual sincronizado para CURRENT único', () => {
  const sql = read('supabase/migrations/20260928171906_nisti_id_authoritative_current_sku_v3.sql');

  assert.equal(sql.includes('commerce_apply_nisti_link_to_product_v1'), true);
  assert.equal(sql.includes("sku_type=case when ps.sku_type='CURRENT' then 'HISTORICAL'"), true);
  assert.equal(sql.includes("sku_type=case when v_year is not null then 'CURRENT'"), true);
  assert.equal(sql.includes('trg_commerce_nisti_link_apply_v1'), true);
  assert.equal(sql.includes("edition_year=coalesce(v_year,edition_year)"), true);
});

test('Catálogo projeta SKU, ano e imagem atuais do Produto Mestre nas plataformas compatíveis', () => {
  const sql = read('supabase/migrations/20260928171906_nisti_id_authoritative_current_sku_v3.sql');

  assert.equal(sql.includes('commerce_sync_management_platforms_to_master_v1'), true);
  assert.equal(sql.includes("'source_sku',i.item->>'sku'"), true);
  assert.equal(sql.includes("'sku',p_master_sku"), true);
  assert.equal(sql.includes("'edition_year',p_master_year"), true);
  assert.equal(sql.includes("'image_source','NISTI_ID'"), false);
  assert.equal(sql.includes("then 'NISTI_ID'"), true);
  assert.equal(sql.includes("'synced_from_master',true"), true);
  assert.equal(sql.includes("ip.item_pat->>'signature'=m.pat->>'signature'"), true);
  assert.equal(sql.includes("coalesce(ip.item_pat->>'finish','')=coalesce(m.pat->>'finish','')"), true);
});


test('NISTI ID é autoritativo também para SKUs sem ano quando há um único vínculo', () => {
  const sql = read('supabase/migrations/20260928173422_nisti_id_authoritative_all_skus_v4.sql');

  assert.equal(sql.includes('v_link_count=1'), true);
  assert.equal(sql.includes("sku_type='CURRENT'"), true);
  assert.equal(sql.includes("sku_type=case when ps.sku_type='CURRENT' then 'HISTORICAL'"), true);
  assert.equal(sql.includes("'nisti_links_on_product',v_link_count"), true);
});

test('variações múltiplas do mesmo Produto Mestre usam o SKU e a imagem corretos do NISTI ID por anúncio', () => {
  const sql = read('supabase/migrations/20260928173422_nisti_id_authoritative_all_skus_v4.sql');

  assert.equal(sql.includes('commerce_sync_management_platforms_to_nisti_v2'), true);
  assert.equal(sql.includes("public.commerce_nisti_sku_norm_v1(l.source_sku)=d.item_norm"), true);
  assert.equal(sql.includes("when lc.n=1 then 2"), true);
  assert.equal(sql.includes("'sku',target.source_sku"), true);
  assert.equal(sql.includes("'image_url',coalesce(nullif(target.source_image_url"), true);
  assert.equal(sql.includes("'nisti_product_id',target.nisti_product_id"), true);
});


test('regra global reconcilia produtos de plataforma com o NISTI ID por SKU compatível', () => {
  const sql = read('supabase/migrations/20260928175841_nisti_global_catalog_sync_rules_v5.sql');

  assert.equal(sql.includes('commerce_nisti_match_sku_v2'), true);
  assert.equal(sql.includes("'EXACT'"), true);
  assert.equal(sql.includes("'FAMILY_YEAR'"), true);
  assert.equal(sql.includes("->>'signature'"), true);
  assert.equal(sql.includes("->>'finish'"), true);
  assert.equal(sql.includes('trg_commerce_source_row_nisti_canonicalize_v1'), true);
  assert.equal(sql.includes('commerce_reconcile_nisti_product_v2'), true);
  assert.equal(sql.includes('perform public.commerce_reconcile_nisti_product_v2'), true);
});

test('Catálogo expõe sincronizado versus sem NISTI', () => {
  const sql = read('supabase/migrations/20260928180154_nisti_catalog_sync_status_v6.sql');
  const ui = read('src/commerce-catalog-workspace.jsx');

  assert.equal(sql.includes("'NISTI_SYNCED'"), true);
  assert.equal(sql.includes("'NISTI_PENDING'"), true);
  assert.equal(sql.includes("'nisti_synced'"), true);
  assert.equal(sql.includes("'nisti_pending'"), true);
  assert.equal(ui.includes("nistiStatus === 'NISTI_SYNCED'"), true);
  assert.equal(ui.includes("nistiStatus === 'NISTI_PENDING'"), true);
  assert.equal(ui.includes("Sincronizado"), true);
  assert.equal(ui.includes("Sem NISTI"), true);
});


test('Catálogo principal usa a leitura rápida em vez de reconstruir o catálogo inteiro', () => {
  const store = read('src/commerce-supabase-store.js');
  const sql = read('supabase/migrations/20260928183545_commerce_catalog_fast_read_v7.sql');

  assert.equal(store.includes("'commerce_management_products_fast_v1'"), true);
  assert.equal(store.includes("presence === 'LINKED'"), true);
  assert.equal(sql.includes('commerce_management_products_fast_v1'), true);
  assert.equal(sql.includes('selected_files as'), true);
  assert.equal(sql.includes("cp.reference_image_source='NISTI_ID'"), true);
  assert.equal(sql.includes('commerce_enrich_management_platforms_v1'), true);
  assert.equal(sql.includes('commerce_sync_management_platforms_to_nisti_v2'), true);
});

test('Resumo do Catálogo não pagina o catálogo inteiro para calcular indicadores', () => {
  const sql = read('supabase/migrations/20260928183545_commerce_catalog_fast_read_v7.sql');

  assert.equal(sql.includes('create or replace function public.commerce_management_product_summary_v2()'), true);
  assert.equal(sql.includes('generate_series(0,700,100)'), false);
  assert.equal(sql.includes("'nisti_synced'"), true);
  assert.equal(sql.includes("'nisti_pending'"), true);
});


test('status da sincronização fica disponível por produto no NISTI ID', () => {
  const sql = read('supabase/migrations/20260928185936_nisti_sync_visibility_v1.sql');
  const helper = read('src/nisti-commerce-sync.js');
  const router = read('src/core-router.js');

  assert.equal(sql.includes('commerce_nisti_product_statuses_v1'), true);
  assert.equal(sql.includes('commerce_product_id bigint'), true);
  assert.equal(sql.includes('commerce_sku text'), true);
  assert.equal(sql.includes('commerce_name text'), true);
  assert.equal(helper.includes('nistiCommerceProductStatuses'), true);
  assert.equal(helper.includes("'commerce_nisti_product_statuses_v1'"), true);
  assert.equal(router.includes('/api/admin/commerce-sync/nisti-products/statuses'), true);
});

test('cadastro e edição exibem confirmação real da sincronização do Catálogo', () => {
  const main = read('src/main.jsx');
  const catalog = read('src/admin/CatalogView.jsx');
  const badge = read('src/admin/CommerceSyncBadge.jsx');

  assert.equal(main.includes('commerce_sync: commerceSync'), true);
  assert.equal(main.includes('imageResult.commerce_sync || commerceSync'), true);
  assert.equal(main.includes('/api/admin/commerce-sync/nisti-products/statuses'), true);
  assert.equal(main.includes('<CommerceSyncBadge sync={item.commerce_sync} />'), true);
  assert.equal(catalog.includes('<CommerceSyncBadge sync={product.commerce_sync} compact />'), true);
  assert.equal(badge.includes('Criado no Catálogo'), true);
  assert.equal(badge.includes('Erro de sincronização'), true);
  assert.equal(badge.includes('Sem sincronização'), true);
});


test('sincronização principal não executa reconciliação histórica dentro do trigger', () => {
  const sql = read('supabase/migrations/20260928192559_nisti_sync_nonblocking_v8.sql');

  assert.equal(sql.includes('commerce_reconcile_nisti_product_v3'), true);
  assert.equal(sql.includes('perform public.commerce_apply_nisti_link_to_product_v1'), true);
  assert.equal(sql.includes('perform public.commerce_reconcile_nisti_product_v3'), false);
  assert.equal(sql.includes('trg_commerce_nisti_link_apply_v1'), true);
});

test('RPC de escrita pode usar timeout maior e a sincronização faz retry temporário', () => {
  const readStore = read('src/supabase-read-store.js');
  const sync = read('src/nisti-commerce-sync.js');

  assert.equal(readStore.includes('MAX_CUSTOM_TIMEOUT_MS = 30000'), true);
  assert.equal(readStore.includes('options?.timeoutMs'), true);
  assert.equal(sync.includes('COMMERCE_SYNC_TIMEOUT_MS = 8000'), true);
  assert.equal(sync.includes('COMMERCE_RECONCILE_TIMEOUT_MS = 15000'), true);
  assert.equal(sync.includes('retryableSyncError'), true);
  assert.equal(sync.includes('attempt <= 2'), true);
});

test('reconciliação histórica roda em segundo plano no cadastro e edição', () => {
  const router = read('src/core-router.js');

  assert.equal(router.includes('scheduleCommerceReconcile'), true);
  assert.equal(router.includes('ctx.waitUntil'), true);
  assert.equal(router.includes('reconcileNistiProductToCommerceSafe'), true);
  assert.equal(router.includes('scheduleCommerceReconcile(ctx, env, saved.id, saved.commerce_sync)'), true);
  assert.equal(router.includes('scheduleCommerceReconcile(ctx, env, id, commerceSync)'), true);
});


test('reconciliação histórica usa índices de SKU e família', () => {
  const sourceSql = read('supabase/migrations/20260928194037_commerce_source_sku_indexes_and_fast_reconcile_v9.sql');
  const linkSql = read('supabase/migrations/20260928194239_commerce_nisti_link_indexes_and_fast_reconcile_v10.sql');
  const sync = read('src/nisti-commerce-sync.js');

  assert.equal(sourceSql.includes('commerce_source_rows_nisti_sku_norm_idx'), true);
  assert.equal(sourceSql.includes('commerce_source_rows_nisti_family_idx'), true);
  assert.equal(sourceSql.includes('commerce_source_row_sku_norm_v1'), true);
  assert.equal(sourceSql.includes('commerce_reconcile_nisti_product_v4'), true);

  assert.equal(linkSql.includes('commerce_nisti_links_norm_product_idx'), true);
  assert.equal(linkSql.includes('commerce_nisti_links_family_year_idx'), true);
  assert.equal(linkSql.includes('commerce_reconcile_nisti_product_v5'), true);
  assert.equal(sync.includes("'commerce_reconcile_nisti_product_v5'"), true);
});


test('detalhe do produto permite corrigir a sincronização individual com o Catálogo', () => {
  const router = read('src/core-router.js');
  const main = read('src/main.jsx');
  const css = read('src/app.css');

  assert.equal(router.includes('/api/admin/commerce-sync/nisti-products\\/(\\d+)\\/repair'), true);
  assert.equal(router.includes('syncNistiProductToCommerceSafe(env, productId)'), true);
  assert.equal(router.includes('reconcileNistiProductToCommerceSafe(env, productId)'), true);
  assert.equal(router.includes("reason: 'sync_not_confirmed'"), true);

  assert.equal(main.includes('Corrigir sincronização'), true);
  assert.equal(main.includes('Ressincronizar Catálogo'), true);
  assert.equal(main.includes('view-sync-repair'), true);
  assert.equal(main.includes('onSyncComplete'), true);
  assert.equal(main.includes('Sincronização corrigida. Produto Mestre e vínculos do Catálogo foram reconciliados.'), true);

  assert.equal(css.includes('.view-sync-repair'), true);
  assert.equal(css.includes('.btn-sync-repair'), true);
  assert.equal(css.includes('.admin-modal.view-modal > .admin-modal-foot.view-modal-foot'), true);
  assert.equal(css.includes('padding:15px 24px 18px'), true);
});
