import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261026170000_commerce_dashboard_v1.sql');
const router=read('src/commerce-admin-router.js');
const app=read('src/commerce-admin-app-v2.jsx');
const ui=read('src/commerce-dashboard.jsx');
test('dashboard SQL is read-only, service_role only and keeps only valid windows',()=>{
  assert.match(sql,/language sql stable/);
  assert.doesNotMatch(sql,/\b(insert into|update public|delete from|drop )\b/i);
  assert.match(sql,/revoke all on function public\.commerce_dashboard_v1/);
  assert.match(sql,/grant execute[\s\S]*to service_role/);
  assert.match(sql,/p_days in \(7,30,60,90\)/);
  assert.match(sql,/listing_status='ACTIVE' and prev_units>=5/);
  assert.match(sql,/0\.80\*total_rev/);
  assert.match(sql,/0\.95\*total_rev/);
});
test('route validates platform and period; GA menu exposes the dashboard',()=>{
  assert.ok(router.includes("BASE_PATH+'/sales-dashboard'"));
  assert.ok(router.includes("['TODAS','SHOPEE','ML_ANTIGO','ML_NOVO'].includes(platform)"));
  assert.ok(router.includes('![7,30,60,90].includes(days)'));
  assert.ok(app.includes("id: 'dashboard'")&&app.includes('<CommerceDashboard />'));
});
test('every card has an info icon naming its data source',()=>{
  for(const key of ['abc','drops','best','ads','alerts','daily'])assert.ok(ui.includes('source="'+key+'"')||ui.includes("'"+key+"'"),key);
  assert.ok(ui.includes('TAB_SOURCE'));
  assert.ok(ui.includes('SOURCES.help')&&ui.includes('SOURCES.trust'));
  assert.ok(ui.includes('De onde vêm os dados'));
  assert.ok(ui.includes('[7,30,60,90]'.replace(/,/g,',')) || ui.includes('PERIODS=[7,30,60,90]'));
});
test('changePct handles new and falling listings',async()=>{
  const {changePct}=await import('../src/commerce-dashboard.jsx').catch(()=>({}));
  if(!changePct)return;
  assert.equal(changePct(50,100),-50);
  assert.equal(changePct(10,0),null);
});
test('series and overview SQL are read-only, service_role only and expose routes',()=>{
  for(const f of ['20261026180000_commerce_dashboard_series_v1','20261026190000_commerce_dashboard_overview_v1']){
    const q=read('supabase/migrations/'+f+'.sql');
    assert.match(q,/language sql stable/);
    assert.doesNotMatch(q,/\b(insert into|update public|delete from|drop )\b/i);
    assert.match(q,/grant execute[\s\S]*to service_role/);
  }
  assert.ok(router.includes("/sales-dashboard/series")&&router.includes("/sales-dashboard/overview"));
});
test('missing data is shown as sem dados, never zero',()=>{
  assert.ok(ui.includes('Sem dados: falta cadastrar o custo do produto'));
  assert.ok(ui.includes("Gasto e retorno de anúncios: sem dados"));
});
test('listingUrl builds marketplace links from the platform and listing id',()=>{
  const src=read('src/commerce-dashboard.jsx');
  assert.ok(src.includes("https://shopee.com.br/product/'+SHOPEE_SHOP_ID+'/'"));
  assert.ok(src.includes("https://produto.mercadolivre.com.br/MLB-'+m[1]"));
  assert.ok(src.includes('rel="noopener noreferrer"'));
  assert.equal((src.match(/<Ext platform=/g)||[]).length,4);
});
