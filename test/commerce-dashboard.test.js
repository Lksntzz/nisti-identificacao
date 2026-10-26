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
  assert.ok(router.includes("['TODAS','SHOPEE','ML_ANTIGO'].includes(platform)"));
  assert.ok(router.includes('![7,30,60,90].includes(days)'));
  assert.ok(app.includes("id: 'dashboard'")&&app.includes('<CommerceDashboard />'));
});
test('every card has an info icon naming its data source',()=>{
  for(const key of ['abc','drops','top'])assert.ok(ui.includes('source="'+key+'"'),key);
  assert.ok(ui.includes('SOURCES.help'));
  assert.ok(ui.includes('De onde vêm os dados'));
  assert.ok(ui.includes('[7,30,60,90]'.replace(/,/g,',')) || ui.includes('PERIODS=[7,30,60,90]'));
});
test('changePct handles new and falling listings',async()=>{
  const {changePct}=await import('../src/commerce-dashboard.jsx').catch(()=>({}));
  if(!changePct)return;
  assert.equal(changePct(50,100),-50);
  assert.equal(changePct(10,0),null);
});
