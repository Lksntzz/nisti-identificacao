import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261019224000_commerce_evolution_shared_product_listing_ids.sql','utf8');
const ui=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');

test('uma chave SKU agrupa todos os IDs de anúncios ativos sem contar vendas duas vezes',()=>{
  assert.match(sql,/array_agg\(distinct a\.external_listing_id order by a\.external_listing_id\)/);
  assert.match(sql,/count\(distinct a\.product_id\)=1/);
  assert.match(sql,/a\.source,a\.model_key/);
  assert.match(sql,/sum\(r\.units\).*current_units/);
  assert.match(sql,/case when count\(distinct a\.listing_id\)=1 then min\(a\.external_listing_id\)/);
  assert.match(sql,/c\.listing_ids,c\.shared_product,c\.active_listing_count/);
  assert.doesNotMatch(sql,/sum\(.*units\*.*active_listing_count/i);
});

test('busca do produto funciona por SKU com separadores ou por qualquer ID do anúncio',()=>{
  assert.match(sql,/unnest\(coalesce\(s\.listing_ids,array\[\]::text\[\]\)\)/);
  assert.match(sql,/listing_ref\.id ilike/);
  assert.match(sql,/commerce_nisti_sku_norm_v1\(i\.searched\)/);
});

test('card mostra ambos IDs com a quantidade total única e ressalva de atribuição',()=>{
  assert.match(ui,/item\.listing_ids/);
  assert.match(ui,/listingIds\.join\(' · '\)/);
  assert.match(ui,/item\.shared_product/);
  assert.match(ui,/Quantidade de vendas do SKU/);
  assert.match(ui,/num\(item\.current_units\)/);
  assert.match(ui,/cada unidade vendida é contada uma única vez/);
  assert.match(ui,/não comprova vendas zero em cada anúncio/);
  assert.match(css,/nim-evolution-shared-sku/);
});

test('mudança é restrita à RPC comercial e não altera scanner, identificação ou vendas importadas',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.commerce_sales_evolution_v1/);
  assert.match(sql,/SECURITY INVOKER/);
  assert.match(sql,/revoke all on function public\.commerce_sales_evolution_v1/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/\b(insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(sql,/nisti_product_links|nisti_scanner|scanner_products/i);
});
