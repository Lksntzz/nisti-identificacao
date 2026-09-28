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
