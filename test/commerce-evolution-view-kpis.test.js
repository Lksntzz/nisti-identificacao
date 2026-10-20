import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261020213000_commerce_evolution_sold_filter_kpis_v1.sql','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const child=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');

test('Evolução counts are scoped to the same search and platform, not current page or status',()=>{
  assert.match(sql,/\), searched as \(/);
  assert.match(sql,/select s\.\* from scored s cross join inp i/);
  assert.match(sql,/\), filtered as \(/);
  assert.match(sql,/select s\.\* from searched s cross join inp i/);
  assert.match(sql,/i\.selected_status='SOLD' and s\.current_units>0/);
  assert.match(sql,/'sold',\(select count\(\*\) from searched where current_units>0\)/);
  for(const name of ['rising','falling','zero'])assert.match(sql,new RegExp("'"+name+"',\\(select count\\(\\*\\) from searched where trend="));
  assert.match(sql,/select \* from filtered/);
  assert.match(sql,/from images_for_page p/);
  assert.match(sql,/SECURITY INVOKER/);
  assert.doesNotMatch(sql,/\b(?:update|insert into|delete from|truncate)\s+public\./i);
});

test('SOLD is accepted by authenticated route and by Supabase store, with no new public access',()=>{
  assert.match(router,/\['ALL','SOLD','RISING','FALLING','STABLE','ZERO','NEW','LOW_VOLUME','INSUFFICIENT'\]/);
  assert.match(store,/\['ALL','SOLD','RISING','FALLING','STABLE','ZERO','NEW','LOW_VOLUME','INSUFFICIENT'\]/);
  assert.match(sql,/revoke all on function public\.commerce_sales_evolution_v1/);
  assert.match(sql,/to service_role/);
});

test('one status drives the dropdown and all four clickable KPI cards',()=>{
  for(const key of ['falling','zero','sold','rising'])assert.ok(ui.includes("evolutionCount('"+key+"')"),key);
  assert.match(ui,/setEvolutionStatus\(current=>current===next\?'ALL':next\)/);
  assert.match(ui,/status=\{evolutionStatus\} onStatusChange=\{setEvolutionStatus\}/);
  assert.match(child,/\['SOLD','Com vendas'\]/);
  assert.match(child,/onChange=\{e=>onStatusChange\(e\.target\.value\)\}/);
  assert.match(child,/onSummary\(body\?\.kpis\|\|null\)/);
  assert.match(child,/onSummary\(null\)/);
  assert.doesNotMatch(ui,/trendOverview|trendRequest/);
});
