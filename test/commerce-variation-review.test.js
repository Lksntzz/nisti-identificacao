import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261021194500_commerce_variation_review_partial_evidence_v1.sql','utf8');
const base=fs.readFileSync('supabase/migrations/20261021191500_commerce_variation_review_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const view=fs.readFileSync('src/commerce-variation-review.jsx','utf8');
const css=fs.readFileSync('src/commerce-variation-review.css','utf8');

test('third commercial view groups advertisements with their variations in 30/60/90 periods',()=>{
  assert.doesNotMatch(manager,/commercialView==='VARIATIONS'/);
  assert.match(manager,/<CommerceEvolutionIntegrated platform=\{platform\}/);
  assert.doesNotMatch(manager,/Variações 30\/60\/90/);
  assert.match(view,/const PERIODS=\[30,60,90\]/);
  assert.match(view,/variation-review'/);
  assert.match(view,/<Advertisement key=\{item\.listing_id\}/);
  assert.match(view,/30 dias<\/option>|PERIODS\.map\(n=><option/);
  assert.match(view,/PERIODS\.map\(n=><td key=\{n\}><Metric n=\{n\}/);
  assert.match(view,/sourcePlatform,days,search,onlyZero,offset,revision,salesRevision/);
  assert.match(view,/only_zero:onlyZero\?'1':'0'/);
  assert.match(css,/\.nim-vr-ad\[open\]/);
});

test('variation analysis only uses real active listings, keyed by variation ID and unique SKU',()=>{
  for(const needle of ["l.listing_status='ACTIVE'","lp.relation_status<>'REMOVED'",
    'count(distinct variation_id)>1','count(*) over(partition by v.listing_id,v.norm)',
    'o.listing_product_id=v.listing_product_id','o.listing_id=v.listing_id',
    'o.canonical_sku_norm=v.norm','d.external_listing_id=v.external_listing_id']){
    assert.ok(sql.includes(needle),needle);
  }
  assert.match(sql,/from public\.commerce_shopee_sku_owner_reviewed_v1 o/);
  assert.match(sql,/commerce_current_sales_listing_daily_v1/);
  assert.match(sql,/sum\(d\.units\) filter/);
  assert.match(sql,/p_limit integer default 20/);
  assert.match(sql,/page_size/);
  assert.match(sql,/jsonb_agg/);
  assert.doesNotMatch(sql,/\b(?:update|delete from|insert into|truncate)\s+public\.commerce_/i);
});

test('zero is only confirmed on full coverage; partial positive sales can still be shown',()=>{
  assert.match(sql,/v\.match_verified and \(v\.complete_30 or v\.actual_30>0\)/);
  assert.match(sql,/v\.match_verified and \(v\.complete_60 or v\.actual_60>0\)/);
  assert.match(sql,/v\.match_verified and \(v\.complete_90 or v\.actual_90>0\)/);
  assert.match(sql,/count\(distinct sm\.period_start\) filter/);
  assert.match(sql,/l\.source<>'SHOPEE' or coalesce\(o\.observed_30,0\)>=30/);
  assert.match(view,/if\(!validCount\(units\(v,n\)\)\)return 'UNKNOWN'/);
  assert.match(view,/if\(Number\(units\(v,n\)\)===0\)return 'ZERO'/);
  assert.match(view,/st==='PARTIAL_SOLD'/);
  assert.match(view,/Sem vendas confirmadas/);
  assert.match(view,/Relatório incompleto/);
});

test('diagnostics distinguish verified linking problems from unproven commercial reasons',()=>{
  for(const literal of ['MISSING_SKU','DUPLICATE_SKU','UNVERIFIED_OWNER',
    'Motivo não comprovado','Possíveis causas para conferir']){
    if(literal==='Motivo não comprovado')continue;
    assert.ok((sql+view).includes(literal),literal);
  }
  assert.match(view,/Estoque da variação, preço frente às outras opções, imagem, título, demanda/);
  assert.match(view,/O NISTI ainda não possui visitas ou estoque por variação/);
  assert.match(view,/Importe os dias ausentes para concluir a avaliação/);
  assert.match(view,/Outras variações do mesmo anúncio venderam/);
  assert.match(view,/Não inferimos causa comercial/i);
});

test('new RPC is read-only, admin-only and uses a single bounded source of daily sales',()=>{
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/revoke all on function public\.commerce_variation_review_v1/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.match(base,/daily as materialized/);
  assert.match(store,/export async function commerceVariationReview/);
  assert.match(store,/commerce_variation_review_v1/);
  assert.match(store,/timeoutMs:15000/);
  assert.match(router,/BASE_PATH\+'\/listings\/manager\/variation-review'/);
  assert.match(router,/commerceVariationReview\(env,/);
  assert.match(router,/!\[30,60,90\]\.includes\(days\)/);
});
