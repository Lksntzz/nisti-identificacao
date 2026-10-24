import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const view=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');

test('Evolução KPIs are scoped to the whole list, not the current page or selected status',()=>{
 assert.match(sql,/from classified where situation='ZERO'/);
 assert.match(sql,/from classified where situation='STABLE'/);
 assert.match(sql,/from classified where situation='RISING'/);
 assert.match(sql,/from classified\)/);
 assert.match(sql,/from filtered\)/);
 assert.match(sql,/limit \(select page_size from input\) offset \(select page_offset from input\)/);
 assert.match(view,/const kpis=report\?\.kpis/);
 assert.doesNotMatch(sql,/\b(?:update|insert into|delete from|truncate)\s+public\./i);
});

test('sales reporting endpoints are private and validate filters',()=>{
 assert.match(router,/\/listings\/manager\/evolution-ads/);
 assert.match(router,/\['ALL','ZERO','STABLE','RISING','FALLING'\]/);
 assert.match(store,/commerce_evolution_ads_v1/);
 assert.match(sql,/revoke all on function public\.commerce_evolution_ads_v1/);
 assert.match(sql,/to service_role/);
});

test('the three status cards filter the same listing/variation report',()=>{
 assert.match(manager,/status=\{evolutionStatus\} onStatusChange=\{setEvolutionStatus\}/);
 assert.doesNotMatch(manager,/trendOverview|trendRequest/);
});
