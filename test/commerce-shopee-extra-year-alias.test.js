import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261016201000_commerce_shopee_auto_year_26_to_27_extended_v1.sql','utf8');
const original=fs.readFileSync('supabase/migrations/20261016195500_commerce_shopee_auto_year_26_to_27_v1.sql','utf8');
const view=fs.readFileSync('supabase/migrations/20261016191000_commerce_shopee_sales_sku_reconciliation_review_v1.sql','utf8');
const ui=fs.readFileSync('src/commerce-shopee-reconciliation.jsx','utf8');

test('CONFIN26, VACMNO26 and VACMNA26 match only identical complete suffix at year 27',()=>{
  for(const family of ['CONFIN','VACMNO','VACMNA']){
    assert.ok(sql.includes("'^"+family+"26[A-Z0-9]{3,}$'"),family+' 2026 source');
    assert.ok(sql.includes("'"+family+"27'||substr(source_sku,9)"),family+' exact suffix after family plus year');
  }
  for(const family of ['PB','PLAN','AGMT']){
    assert.ok(sql.includes("'^"+family+"26[A-Z0-9]{3,}$'"),family+' prior behavior retained');
  }
  assert.match(sql,/join unique_targets u on u\.sku_norm=c\.target_sku/);
  assert.match(sql,/group by sku_norm having count\(\*\)=1/);
  assert.match(sql,/not exists \(\s*select 1 from active_variations v where v\.sku_norm=c\.source_sku/);
});

test('VACMNO and VACMNA with no year rely on canonical direct owner, never invented 26-to-27 change',()=>{
  assert.match(view,/select v\.norm as source_sku_norm,v\.norm as canonical_sku_norm/);
  assert.doesNotMatch(sql,/when family='VACMNO' then 'VACMNO27'\|\|substr\(source_sku,7\)/);
  assert.doesNotMatch(sql,/when family='VACMNA' then 'VACMNA27'\|\|substr\(source_sku,7\)/);
  assert.match(ui,/VACMNO e VACMNA sem ano usam correspondência direta pelo SKU completo/);
});

test('revocation and manually decided aliases are never overwritten; no product or scanner modifications',()=>{
  assert.match(sql,/not exists \(\s*select 1 from public\.commerce_shopee_sales_sku_alias_reviews_v1 a/);
  assert.match(sql,/on conflict \(source_sku_norm\) do nothing/);
  assert.match(sql,/NISTI_AUTO_YEAR_26_27/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.doesNotMatch(sql,/update public\.products|update public\.commerce_listing_products|update public\.commerce_sales_rows|delete from public\.products/);
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/revoke all on function public\.commerce_shopee_auto_link_year26_v1\(\)/);
  assert.match(sql,/to service_role/);
});

test('migration replaces existing RPC to include new prefixes without new endpoints',()=>{
  assert.match(original,/create or replace function public\.commerce_shopee_auto_link_year26_v1\(\)/);
  assert.match(sql,/create or replace function public\.commerce_shopee_auto_link_year26_v1\(\)/);
  assert.match(ui,/PB, PLAN, AGMT, CONFIN, VACMNO e VACMNA com ano 26 → 27/);
});
