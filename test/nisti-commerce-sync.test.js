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
