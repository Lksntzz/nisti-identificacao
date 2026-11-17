import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261117120000_commerce_listing_products_fill_sku_v1.sql','utf8');

test('o gatilho só preenche o SKU quando há exatamente uma correspondência no mesmo produto',()=>{
  assert.match(sql,/create or replace function public\.commerce_listing_products_fill_sku_v1/);
  assert.match(sql,/new\.product_sku_id is null/);
  assert.match(sql,/s\.product_id=new\.product_id/);
  assert.match(sql,/if v_n=1 then new\.product_sku_id:=v_id/);
});

test('o gatilho nunca recusa a gravação nem cria SKU (importações não quebram)',()=>{
  assert.doesNotMatch(sql,/raise exception/i);
  assert.doesNotMatch(sql,/insert into/i);
  assert.match(sql,/before insert or update of product_id, platform_sku, product_sku_id/);
});

test('função segue as regras de acesso do banco',()=>{
  assert.match(sql,/security invoker/);
  assert.match(sql,/revoke all on function public\.commerce_listing_products_fill_sku_v1\(\) from public, anon, authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_listing_products_fill_sku_v1\(\) to service_role/);
});
