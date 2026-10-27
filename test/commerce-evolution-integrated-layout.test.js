import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');
const chartSql=fs.readFileSync('supabase/migrations/20261021221000_commerce_evolution_ad_weekly_v1.sql','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');

test('Painel Comercial sem abas: evolucao de vendas removida, sem ferramenta extra de variacoes',()=>{
  assert.doesNotMatch(manager,/nim-commercial-views|commercialView==='EVOLUTION'/);
  assert.doesNotMatch(manager,/CommerceEvolutionIntegrated|CommerceVariationReview|CommerceSalesEvolution|commercialView==='VARIATIONS'/);
  assert.match(manager,/Gestor de Anúncios/);
  assert.doesNotMatch(manager,/nim-kpis-evolution/);
});

test('real lazy weekly chart uses sale dates and verified listing/SKU only, not fabricated curves',()=>{
  assert.match(chartSql,/generate_series\(0,12\)/);
  assert.match(chartSql,/commerce_current_sales_listing_daily_v1/);
  assert.match(chartSql,/commerce_shopee_sku_owner_reviewed_v1/);
  assert.match(chartSql,/a\.source=d\.platform_code and d\.external_listing_id=a\.external_listing_id/);
  assert.match(chartSql,/revoke all on function public\.commerce_evolution_ad_weekly_v1/);
  assert.match(chartSql,/to service_role/);
});

test('no sales and trend filters represent full ads, never mix SKU counts',()=>{
  assert.match(sql,/when a\.unknown_variations=0 and a\.zero_variations=a\.variation_count then 'ZERO'/);
  assert.match(sql,/when a\.unknown_variations=0 and a\.previous_unknown=0/);
  assert.match(sql,/a\.identified_units>=a\.previous_units\*1\.2/);
  assert.match(sql,/a\.previous_units>=3/);
  assert.match(sql,/a\.identified_units-a\.previous_units>=2/);
  assert.match(sql,/and \(i\.status='ALL' or a\.situation=i\.status\)/);
  assert.match(sql,/'zero',\(select count\(\*\) from classified where situation='ZERO'\)/);
  assert.match(sql,/count\(\*\) filter\(where v\.previous_units is null\)::int previous_unknown/);
});

